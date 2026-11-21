<?php
if (!defined('ABSPATH')) {
    exit();
}
final class LSE_Importer
{
    use LSE_Management;
    use LSE_Page_Save;
    use LSE_Background_Import;
    use LSE_Theme_Parts;
    public static function resume_prepared($input)
    {
        $job = self::load($input['job'] ?? '');
        if (
            ($input['fingerprint'] ?? null) !== $job['fingerprint'] ||
            !in_array($job['state'], ['importing', 'finishing'], true)
        ) {
            throw new RuntimeException(
                'This saved preparation no longer matches the import.',
            );
        }
        $result = self::status($input);
        $result['staged_pages'] = array_values(
            array_filter(
                array_column($job['pages'], 'key'),
                static fn($key) => LSE_Spool::has('import-' . $job['id'], $key),
            ),
        );
        return $result;
    }
    private static function key($id)
    {
        if (!is_string($id) || !preg_match('/^[a-f0-9]{32}$/', $id)) {
            throw new RuntimeException('Invalid import identity.');
        }
        return '_lse_job_' . $id;
    }
    private static function load($id)
    {
        $job = get_option(self::key($id));
        if (!is_array($job) || (int) $job['owner'] !== get_current_user_id()) {
            throw new RuntimeException(
                'This import is unavailable to your account.',
            );
        }
        return $job;
    }
    private static function store($job)
    {
        $job['updated'] = time();
        update_option(self::key($job['id']), $job, false);
        self::store_summary($job);
        return $job;
    }
    private static function lock($id)
    {
        self::key($id);
        return LSE_Locks::acquire(self::key($id) . '_lock') + ['id' => $id];
    }
    private static function unlock($lock)
    {
        LSE_Locks::release($lock);
    }
    private static function text($value, $limit = 300)
    {
        if (!is_string($value) || strlen($value) > $limit) {
            throw new RuntimeException('Invalid or oversized text field.');
        }
        return sanitize_text_field($value);
    }
    private static function clean_url($url)
    {
        return esc_url_raw((string) $url, ['http', 'https', 'mailto', 'tel']);
    }
    private static function source_aliases($page)
    {
        $aliases = $page['url_aliases'] ?? [];
        if (!is_array($aliases)) {
            throw new RuntimeException('Invalid source page aliases.');
        }
        $source = self::clean_url($page['url'] ?? '');
        return array_values(
            array_unique(
                array_map(static function ($alias) use ($source) {
                    self::text($alias, 2048);
                    $alias = self::clean_url($alias);
                    [$base, $query] = array_pad(explode('?', $alias, 2), 2, '');
                    if (!$query || !$source || $base !== $source) {
                        throw new RuntimeException(
                            'A captured page alias needs the same URL path as its base page.',
                        );
                    }
                    return $alias;
                }, $aliases),
            ),
        );
    }

    private static function map_page(&$map, $page)
    {
        if (!$page['source_url']) {
            return;
        }
        $map[$page['source_url']] = $page['url'];
        $reserved = array_fill_keys($GLOBALS['wp']->public_query_vars, true);
        foreach ($page['source_aliases'] ?? [] as $alias) {
            parse_str((string) wp_parse_url($alias, PHP_URL_QUERY), $query);
            $suffix = http_build_query(
                array_diff_key($query, $reserved),
                '',
                '&',
                PHP_QUERY_RFC3986,
            );
            $map[$alias] =
                $page['url'] .
                ($suffix
                    ? (str_contains($page['url'], '?') ? '&' : '?') . $suffix
                    : '');
        }
    }

    public static function check($input)
    {
        $fingerprint = $input['fingerprint'] ?? '';
        if (
            !is_string($fingerprint) ||
            !preg_match('/^[a-f0-9]{64}$/', $fingerprint)
        ) {
            throw new RuntimeException('The source file identity is invalid.');
        }
        $last = get_user_meta(get_current_user_id(), '_lse_last_job', true);
        $import = null;
        if (is_string($last) && preg_match('/^[a-f0-9]{32}$/', $last)) {
            $previous = get_option(self::key($last));
            if (
                is_array($previous) &&
                (int) $previous['owner'] === get_current_user_id() &&
                hash_equals($previous['fingerprint'], $fingerprint) &&
                !in_array(
                    $previous['state'],
                    ['removed', 'partly-removed'],
                    true,
                )
            ) {
                $import = self::status(['job' => $last]);
            }
        }
        return [
            'version' => LSE_VERSION,
            'elementor' => defined('ELEMENTOR_VERSION')
                ? ELEMENTOR_VERSION
                : '',
            'import' => $import,
        ];
    }
    public static function prepare($input)
    {
        if (($input['converter_version'] ?? '') !== LSE_CONVERTER_VERSION) {
            throw new RuntimeException(
                'The converter changed after this tab was opened. Reload the plugin page before importing.',
            );
        }
        $connection = self::check($input);
        if (!$connection['elementor']) {
            throw new RuntimeException('Activate Elementor before importing.');
        }
        $job = $connection['import'];
        $target = $input['target_job'] ?? '';
        if ($target && ($job['id'] ?? '') !== $target) {
            $job = null;
        }
        return $target || !$job ? self::start($input) : $job;
    }
    public static function start($input)
    {
        if (
            !is_string($input['fingerprint'] ?? null) ||
            !preg_match('/^[a-f0-9]{64}$/', $input['fingerprint'])
        ) {
            throw new RuntimeException('The source file identity is invalid.');
        }
        $lock = LSE_Locks::acquire(
            '_lse_start_' . get_current_user_id() . '_' . $input['fingerprint'],
        );
        try {
            return self::begin($input);
        } finally {
            LSE_Locks::release($lock);
        }
    }
    private static function begin($input)
    {
        if (
            !defined('ELEMENTOR_VERSION') ||
            !class_exists('\Elementor\Plugin')
        ) {
            throw new RuntimeException('Activate Elementor before importing.');
        }
        if (
            !isset($input['fingerprint']) ||
            !preg_match('/^[a-f0-9]{64}$/', $input['fingerprint'])
        ) {
            throw new RuntimeException('The source file identity is invalid.');
        }
        $pages = $input['pages'] ?? null;
        if (!is_array($pages) || !count($pages)) {
            throw new RuntimeException(
                'A website must contain at least one page.',
            );
        }
        $seen = [];
        foreach ($pages as $index => $page) {
            if (!is_array($page)) {
                throw new RuntimeException('Invalid page metadata.');
            }
            $key = self::text($page['key'] ?? '', 100);
            if (!$key || $key !== $page['key'] || isset($seen[$key])) {
                throw new RuntimeException(
                    'Page keys must be unique plain text.',
                );
            }
            if (!trim(self::text($page['title'] ?? '', 300))) {
                throw new RuntimeException('Page titles cannot be empty.');
            }
            foreach (
                ['slug' => 200, 'url' => 2048, 'parent_key' => 100]
                as $field => $limit
            ) {
                self::text($page[$field] ?? '', $limit);
            }
            $page['url_aliases'] = self::source_aliases($page);
            $pages[$index] = $seen[$key] = $page;
        }
        $input['pages'] = $pages;
        if (
            !is_array($input['site'] ?? []) ||
            !is_array($input['site']['navigation'] ?? [])
        ) {
            throw new RuntimeException('Invalid site navigation.');
        }
        LSE_Navigation::validate(
            $input['site']['navigation'] ?? [],
            array_keys($seen),
        );
        if (
            !empty($input['site']['home_key']) &&
            !isset($seen[$input['site']['home_key']])
        ) {
            throw new RuntimeException(
                'The homepage does not exist in this import.',
            );
        }
        foreach ($pages as $page) {
            $ancestors = [$page['key']];
            $parent = $page['parent_key'] ?? '';
            while ($parent !== '') {
                if (
                    !isset($seen[$parent]) ||
                    in_array($parent, $ancestors, true)
                ) {
                    throw new RuntimeException(
                        'Page hierarchy has a cycle or missing parent.',
                    );
                }
                $ancestors[] = $parent;
                $parent = $seen[$parent]['parent_key'] ?? '';
            }
        }
        if (!empty($input['target_job'])) {
            return self::refresh($input);
        }
        $last = get_user_meta(get_current_user_id(), '_lse_last_job', true);
        if ($last) {
            $previous = get_option(self::key($last));
            if (
                is_array($previous) &&
                $previous['owner'] === get_current_user_id() &&
                $previous['fingerprint'] === $input['fingerprint'] &&
                in_array(
                    $previous['state'],
                    ['importing', 'finishing', 'ready'],
                    true,
                )
            ) {
                return self::status(['job' => $last]);
            }
        }
        $capture = self::capture_report($input['capture'] ?? null);
        $id = bin2hex(random_bytes(16));
        $layout = in_array(
            $input['layout'] ?? '',
            ['elementor_canvas', 'elementor_header_footer'],
            true,
        )
            ? $input['layout']
            : 'elementor_canvas';
        $job = [
            'id' => $id,
            'engine' => LSE_CONVERTER_VERSION,
            'capture' => $capture,
            'site_id' => self::text($input['site_id'] ?? '', 100),
            'owner' => get_current_user_id(),
            'fingerprint' => $input['fingerprint'],
            'title' => self::text($input['title'] ?? 'Imported website', 150),
            'state' => 'importing',
            'created' => time(),
            'pages' => [],
            'assets' => [],
            'fonts' => [],
            'map' => [],
            'reports' => [],
            'layout' => $layout,
            'scripts' =>
                !empty($input['scripts']) &&
                current_user_can('unfiltered_html'),
            'site' => is_array($input['site'] ?? null) ? $input['site'] : [],
            'menu' => 0,
        ];
        self::store($job);
        update_user_meta(get_current_user_id(), '_lse_last_job', $id);
        try {
            foreach ($pages as $page) {
                $post = wp_insert_post(
                    wp_slash([
                        'post_type' => 'page',
                        'post_status' => 'draft',
                        'post_title' => self::text(
                            $page['title'] ?? 'Untitled page',
                        ),
                        'post_name' => sanitize_title(
                            $page['slug'] ?? $page['title'],
                        ),
                        'post_author' => get_current_user_id(),
                        'comment_status' => 'closed',
                        'page_template' => $layout,
                    ]),
                    true,
                );
                if (is_wp_error($post)) {
                    throw new RuntimeException($post->get_error_message());
                }
                update_post_meta($post, '_lse_job', $id);
                update_post_meta($post, '_lse_source_key', $page['key']);
                $job['pages'][] = [
                    'key' => $page['key'],
                    'title' => html_entity_decode(
                        get_the_title($post),
                        ENT_QUOTES,
                        'UTF-8',
                    ),
                    'id' => $post,
                    'source_url' => self::clean_url($page['url'] ?? ''),
                    'source_slug' => (string) ($page['slug'] ?? ''),
                    'source_aliases' => $page['url_aliases'],
                    'parent_key' => $page['parent_key'] ?? '',
                    'done' => false,
                    'initial_stamp' => self::stamp($post),
                ];
                self::store($job);
            }
            $ids = array_column($job['pages'], 'id', 'key');
            foreach ($job['pages'] as &$page) {
                if ($page['parent_key']) {
                    $result = wp_update_post(
                        [
                            'ID' => $page['id'],
                            'post_parent' => $ids[$page['parent_key']],
                        ],
                        true,
                    );
                    if (is_wp_error($result)) {
                        throw new RuntimeException(
                            $result->get_error_message(),
                        );
                    }
                }
                $page['url'] = add_query_arg(
                    'page_id',
                    $page['id'],
                    home_url('/'),
                );
                $page['edit_url'] = admin_url(
                    'post.php?post=' . $page['id'] . '&action=elementor',
                );
                self::map_page($job['map'], $page);
            }
            unset($page);
            foreach ($job['pages'] as &$page) {
                $page['initial_stamp'] = self::stamp($page['id']);
            }
            unset($page);
            self::store($job);
            return self::status(['job' => $id]);
        } catch (Throwable $error) {
            $job['state'] = 'interrupted';
            self::store($job);
            throw $error;
        }
    }
    private static function capture_report($capture)
    {
        if ($capture === null) {
            return null;
        }
        if (
            !is_array($capture) ||
            !is_array($capture['failed_resources'] ?? [])
        ) {
            throw new RuntimeException('Invalid capture report.');
        }
        $failed = [];
        foreach ($capture['failed_resources'] ?? [] as $resource) {
            if (!is_array($resource)) {
                throw new RuntimeException('Invalid captured resource report.');
            }
            $failed[] = [
                'url' => self::clean_url($resource['url'] ?? ''),
                'kind' => self::text($resource['kind'] ?? '', 30),
                'role' => self::text($resource['role'] ?? '', 30),
                'error' => self::text($resource['error'] ?? '', 1500),
                'status' => (int) ($resource['status'] ?? 0),
            ];
        }
        return [
            'source' => self::clean_url($capture['source'] ?? ''),
            'complete' => ($capture['complete'] ?? true) !== false && !$failed,
            'failed_resources' => $failed,
            'warnings' => array_map(
                static function ($message) {
                    if (!is_string($message)) {
                        throw new RuntimeException('Invalid capture warning.');
                    }
                    return sanitize_text_field($message);
                },
                is_array($capture['warnings'] ?? null)
                    ? $capture['warnings']
                    : [],
            ),
        ];
    }
    public static function media_batch_size()
    {
        return max(1, min(32, (int) ini_get('max_file_uploads') ?: 20));
    }
    public static function batch_seconds()
    {
        $host = (int) ini_get('max_execution_time');
        return $host > 0 ? min(3.0, max(0.25, $host / 4)) : 3.0;
    }
    public static function assets($input)
    {
        $items = $input['assets'] ?? null;
        if (
            !is_array($items) ||
            !$items ||
            count($items) > self::media_batch_size()
        ) {
            throw new RuntimeException(
                'The media batch exceeds the hosting upload count. Reload the importer and retry.',
            );
        }
        $bytes = 0;
        foreach ($items as $i => $item) {
            $file = $_FILES['file_' . $i] ?? null;
            if (!is_array($item) || !is_array($file) || !isset($file['size'])) {
                throw new RuntimeException(
                    'A media batch is incomplete. Retry the import.',
                );
            }
            $bytes += (int) $file['size'];
        }
        if ($bytes > 4 * MB_IN_BYTES) {
            throw new RuntimeException(
                'This media batch exceeds its request work size. Use individual uploads.',
            );
        }
        $original = $_FILES['file'] ?? null;
        $saved = [];
        $started = microtime(true);
        $budget = self::batch_seconds();
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            foreach ($items as $i => $item) {
                $_FILES['file'] = $_FILES['file_' . $i];
                try {
                    $saved[] = self::save_asset($item, $job);
                } catch (RuntimeException $error) {
                    return [
                        'assets' => $saved,
                        'failure' => self::asset_failure($error, $item),
                    ];
                }
                if (microtime(true) - $started >= $budget) {
                    break;
                }
            }
        } finally {
            self::unlock($lock);
            if ($original === null) {
                unset($_FILES['file']);
            } else {
                $_FILES['file'] = $original;
            }
        }
        return ['assets' => $saved];
    }
    private static function page_result($job, $index, $input)
    {
        if (!empty($input['compact'])) {
            return [
                'saved' => true,
                'key' => $job['pages'][$index]['key'],
                'stamp' => $job['pages'][$index]['stamp'] ?? '',
            ];
        }
        return self::status(['job' => $job['id']]);
    }
    public static function asset($input)
    {
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            try {
                return self::save_asset($input, $job);
            } catch (RuntimeException $error) {
                $failure = self::asset_failure($error, $input);
                throw new LSE_Import_Error(
                    $failure['message'],
                    $failure['error'],
                );
            }
        } finally {
            self::unlock($lock);
        }
    }
    private static function asset_failure($error, $input)
    {
        $recoverable = !preg_match(
            '/no longer accepts|state|changed|lock|session|permission/i',
            $error->getMessage(),
        );
        return [
            'message' => $error->getMessage(),
            'error' => [
                'code' => $recoverable ? 'asset_failed' : 'import_conflict',
                'stage' => 'media',
                'url' => (string) ($input['url'] ?? ''),
                'recoverable' => (bool) $recoverable,
                'skip' => $recoverable
                    ? [
                        'kind' => 'asset',
                        'url' => (string) ($input['url'] ?? ''),
                    ]
                    : null,
            ],
        ];
    }
    private static function media_types()
    {
        return array_intersect(get_allowed_mime_types(), [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/avif',
            'video/mp4',
            'video/webm',
            'audio/mpeg',
            'audio/wav',
            'audio/x-wav',
            'audio/ogg',
            'application/pdf',
            'text/vtt',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ]);
    }
    public static function asset_lookup($input)
    {
        $items = $input['assets'] ?? null;
        if (!is_array($items) || count($items) > 256) {
            throw new RuntimeException(
                'Send reusable file checks in batches of up to 256.',
            );
        }
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            if ($job['state'] !== 'importing') {
                throw new RuntimeException(
                    'This import no longer accepts files.',
                );
            }
            $hashes = [];
            foreach ($items as $item) {
                if (
                    !is_array($item) ||
                    !preg_match('/^[a-f0-9]{64}$/D', $item['hash'] ?? '') ||
                    !is_string($item['url'] ?? null) ||
                    !$item['url'] ||
                    strlen($item['url']) > 2048
                ) {
                    throw new RuntimeException(
                        'Invalid reusable file reference.',
                    );
                }
                $hashes[] = $item['hash'];
            }
            if (!$hashes) {
                return ['assets' => []];
            }
            $ids = get_posts([
                'post_type' => 'attachment',
                'post_status' => 'inherit',
                'numberposts' => -1,
                'fields' => 'ids',
                'meta_query' => [
                    'relation' => 'OR',
                    [
                        'key' => '_lse_sha256',
                        'value' => array_unique($hashes),
                        'compare' => 'IN',
                    ],
                    [
                        'key' => '_little_studio_import_sha256',
                        'value' => array_unique($hashes),
                        'compare' => 'IN',
                    ],
                ],
            ]);
            update_meta_cache('post', $ids);
            $found = [];
            $types = array_merge(self::media_types(), [
                'svg' => 'image/svg+xml',
                'woff' => 'font/woff',
                'woff2' => 'font/woff2',
                'ttf' => 'font/ttf',
                'otf' => 'font/otf',
            ]);
            foreach ($ids as $id) {
                $hash =
                    get_post_meta($id, '_lse_sha256', true) ?:
                    get_post_meta($id, '_little_studio_import_sha256', true);
                if (isset($found[$hash])) {
                    continue;
                }
                $path =
                    wp_get_original_image_path($id) ?: get_attached_file($id);
                $mime = get_post_mime_type($id);
                $checked_type = $path ? wp_check_filetype($path, $types) : [];
                if (
                    $path &&
                    is_file($path) &&
                    ($checked_type['type'] ?? '') === $mime &&
                    hash_equals($hash, hash_file('sha256', $path))
                ) {
                    if ($mime === 'image/svg+xml') {
                        if (!class_exists('DOMDocument')) {
                            continue;
                        }
                        $raw = file_get_contents($path);
                        if (
                            preg_match('/<!DOCTYPE|<!ENTITY/i', $raw) ||
                            self::html($raw) !== $raw
                        ) {
                            continue;
                        }
                        $xml = new DOMDocument();
                        $previous = libxml_use_internal_errors(true);
                        try {
                            $valid =
                                $xml->loadXML($raw, LIBXML_NONET) &&
                                $xml->documentElement &&
                                $xml->documentElement->localName === 'svg';
                        } finally {
                            libxml_clear_errors();
                            libxml_use_internal_errors($previous);
                        }
                        if (!$valid) {
                            continue;
                        }
                    } elseif (str_starts_with($mime, 'image/')) {
                        if (wp_get_image_mime($path) !== $mime) {
                            continue;
                        }
                    } elseif (str_starts_with($mime, 'font/')) {
                        $signatures = [
                            'font/woff' => ['wOFF'],
                            'font/woff2' => ['wOF2'],
                            'font/ttf' => ["\x00\x01\x00\x00", 'true'],
                            'font/otf' => ['OTTO'],
                        ];
                        $stream = fopen($path, 'rb');
                        $signature = $stream ? fread($stream, 4) : '';
                        if ($stream) {
                            fclose($stream);
                        }
                        if (
                            !in_array(
                                $signature,
                                $signatures[$mime] ?? [],
                                true,
                            )
                        ) {
                            continue;
                        }
                    }
                    $found[$hash] = [
                        'id' => $id,
                        'path' => $path,
                        'type' => get_post_mime_type($id),
                    ];
                }
            }
            $saved = [];
            foreach ($items as $item) {
                $existing = $found[$item['hash']] ?? null;
                if (!$existing || $existing['type'] !== ($item['type'] ?? '')) {
                    continue;
                }
                $already = array_values(
                    array_filter(
                        $job['assets'],
                        static fn($a) => $a['source'] === $item['url'],
                    ),
                );
                if ($already) {
                    $saved[] = $already[0];
                    continue;
                }
                $font = str_starts_with($existing['type'], 'font/');
                // Only signature-checked fonts and allowed media already in the Library are reused.
                if (
                    !$font &&
                    !in_array(
                        $existing['type'],
                        [
                            'image/jpeg',
                            'image/png',
                            'image/gif',
                            'image/webp',
                            'image/avif',
                            'image/svg+xml',
                            'video/mp4',
                            'video/webm',
                            'audio/mpeg',
                            'audio/ogg',
                            'audio/wav',
                            'audio/x-wav',
                            'application/pdf',
                            'text/vtt',
                        ],
                        true,
                    )
                ) {
                    continue;
                }
                $file = [
                    'name' => sanitize_file_name(
                        $item['name'] ?? basename($existing['path']),
                    ),
                    'size' => filesize($existing['path']),
                ];
                $saved[] = self::register_asset(
                    $item,
                    $job,
                    $existing['id'],
                    $file,
                    $item['hash'],
                    $font,
                    true,
                    microtime(true),
                );
            }
            return ['assets' => $saved];
        } finally {
            self::unlock($lock);
        }
    }
    public static function media_process($input)
    {
        $job = self::load($input['job'] ?? '');
        $ids = array_values(array_unique(array_column($job['assets'], 'id')));
        $id = (int) ($input['attachment'] ?? 0);
        if ($id) {
            if (!in_array($id, $ids, true)) {
                throw new RuntimeException(
                    'This image does not belong to this import.',
                );
            }
            $ids = [$id];
        }
        $ids = array_values(
            array_filter(
                $ids,
                static fn($id) => current_user_can('edit_post', $id),
            ),
        );
        $work = LSE_Media::process(
            $ids,
            !empty($input['retry']),
            !empty($input['restore_skipped']),
        );
        return $work + [
            'media' => LSE_Media::status(array_column($job['assets'], 'id')),
        ];
    }
    public static function media_skip($input)
    {
        $job = self::load($input['job'] ?? '');
        $id = (int) ($input['attachment'] ?? 0);
        if (
            !in_array($id, array_column($job['assets'], 'id'), true) ||
            !current_user_can('edit_post', $id)
        ) {
            throw new RuntimeException(
                'This image does not belong to this import.',
            );
        }
        LSE_Media::skip(
            $id,
            (string) ($input['size'] ?? ''),
            $input['token'] ?? '',
        );
        return [
            'media' => LSE_Media::status(array_column($job['assets'], 'id')),
        ];
    }
    public static function import_diagnostics($input)
    {
        $job = self::load($input['job'] ?? '');
        $events = $input['events'] ?? null;
        if (!is_array($events) || count($events) > 20) {
            throw new RuntimeException('Invalid diagnostic batch.');
        }
        $key = '_lse_diagnostics_' . $job['id'];
        $lease = LSE_Locks::acquire($key . '_lock');
        try {
            $stored = get_option($key, []);
            foreach ($events as $id => $message) {
                if (
                    !is_string($id) ||
                    !preg_match('/^[a-f0-9-]{36}$/D', $id) ||
                    !is_string($message) ||
                    strlen($message) > 8192
                ) {
                    throw new RuntimeException('Invalid diagnostic entry.');
                }
                $stored[$id] = sanitize_text_field($message);
            }
            update_option($key, $stored, false);
            return ['recorded' => array_keys($events)];
        } finally {
            LSE_Locks::release($lease);
        }
    }
    public static function skip_page($input)
    {
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            $index = array_search(
                $input['key'] ?? '',
                array_column($job['pages'], 'key'),
                true,
            );
            if ($index === false || $job['state'] !== 'importing') {
                throw new RuntimeException('The import cannot skip this page.');
            }
            $page = $job['pages'][$index];
            if ($page['done']) {
                return [
                    'saved' => true,
                    'key' => $page['key'],
                    'stamp' => $page['stamp'],
                ];
            }
            if (!current_user_can('edit_post', $page['id'])) {
                throw new RuntimeException(
                    'The page cannot be edited by this account.',
                );
            }
            self::recover_page_save($page['id'], $job['id']);
            $job['pages'][$index]['skipped'] = true;
            $job['pages'][$index]['regions'] = [];
            $reason = LSE_Import_Error::clip(
                $input['reason'] ?? 'Conversion failed.',
                1000,
            );
            $job['reports'][$page['key']] = [
                'native' => 0,
                'fallbacks' => 0,
                'warnings' => ['Skipped page: ' . $reason],
            ];
            self::store($job);
            return ['skipped' => true, 'key' => $page['key']];
        } finally {
            self::unlock($lock);
        }
    }
    public static function skip_asset($input)
    {
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            if ($job['state'] !== 'importing') {
                throw new RuntimeException(
                    'This import no longer accepts file decisions.',
                );
            }
            $url = $input['url'] ?? '';
            if (
                !is_string($url) ||
                !$url ||
                strlen($url) > 2048 ||
                preg_match('/[\x00-\x1f]/', $url)
            ) {
                throw new RuntimeException('Missing skipped file reference.');
            }
            foreach ($job['assets'] as $saved) {
                if ($saved['source'] === $url) {
                    return ['saved' => $saved];
                }
            }
            $issue = [
                'url' => $url,
                'name' => LSE_Import_Error::clip($input['name'] ?? '', 200),
                'reason' => LSE_Import_Error::clip(
                    $input['reason'] ?? '',
                    1500,
                ),
            ];
            $job['skipped_assets'][$url] = $issue;
            self::store($job);
            return ['skipped' => $issue];
        } finally {
            self::unlock($lock);
        }
    }
    private static function save_asset($input, &$job)
    {
        $started = microtime(true);
        if ($job['state'] !== 'importing') {
            throw new RuntimeException('This import no longer accepts files.');
        }
        $source = (string) ($input['url'] ?? '');
        if (!$source || strlen($source) > 2048) {
            throw new RuntimeException('Invalid source asset reference.');
        }
        foreach ($job['assets'] as $saved) {
            if ($saved['source'] === $source) {
                return $saved;
            }
        }
        $file = $_FILES['file'] ?? null;
        if (
            !is_array($file) ||
            (int) $file['error'] !== UPLOAD_ERR_OK ||
            !is_uploaded_file($file['tmp_name']) ||
            $file['size'] < 1 ||
            $file['size'] > wp_max_upload_size()
        ) {
            throw new RuntimeException(
                'An asset is missing or exceeds the upload limit.',
            );
        }
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        $font_types = [
            'woff' => 'font/woff',
            'woff2' => 'font/woff2',
            'ttf' => 'font/ttf',
            'otf' => 'font/otf',
        ];
        $is_font = isset($font_types[$ext]);
        $is_svg = $ext === 'svg';
        $types = self::media_types();
        if ($is_font) {
            $signatures = [
                'woff' => ['wOFF'],
                'woff2' => ['wOF2'],
                'otf' => ['OTTO'],
                'ttf' => ["\x00\x01\x00\x00", 'true'],
            ];
            $stream = fopen($file['tmp_name'], 'rb');
            $signature = $stream ? fread($stream, 4) : '';
            if ($stream) {
                fclose($stream);
            }
            if (!in_array($signature, $signatures[$ext], true)) {
                throw new RuntimeException('Invalid font signature.');
            }
            $types = [$ext => $font_types[$ext]];
        } elseif ($is_svg) {
            if (!class_exists('DOMDocument')) {
                throw new RuntimeException(
                    'This SVG needs the PHP DOM extension.',
                );
            }
            $raw = file_get_contents($file['tmp_name']);
            if (preg_match('/<!DOCTYPE|<!ENTITY/i', $raw)) {
                throw new RuntimeException(
                    'SVG document entities are not allowed.',
                );
            }
            $clean_svg = self::html($raw);
            $xml = new DOMDocument();
            $previous = libxml_use_internal_errors(true);
            try {
                $valid =
                    $xml->loadXML($clean_svg, LIBXML_NONET) &&
                    $xml->documentElement &&
                    $xml->documentElement->localName === 'svg';
            } finally {
                libxml_clear_errors();
                libxml_use_internal_errors($previous);
            }
            if (!$valid) {
                throw new RuntimeException(
                    'The SVG file could not be sanitised safely.',
                );
            }
            file_put_contents($file['tmp_name'], $clean_svg);
            $types = ['svg' => 'image/svg+xml'];
        } else {
            $checked = wp_check_filetype_and_ext(
                $file['tmp_name'],
                $file['name'],
                $types,
            );
            if (
                empty($checked['type']) ||
                (str_starts_with($checked['type'], 'image/') &&
                    wp_get_image_mime($file['tmp_name']) !== $checked['type'])
            ) {
                throw new RuntimeException(
                    'This embedded file is invalid or is not allowed by WordPress.',
                );
            }
        }
        $hash = hash_file('sha256', $file['tmp_name']);
        $attachment = 0;
        foreach (
            get_posts([
                'post_type' => 'attachment',
                'post_status' => 'inherit',
                'numberposts' => 10,
                'meta_query' => [
                    'relation' => 'OR',
                    ['key' => '_lse_sha256', 'value' => $hash],
                    ['key' => '_little_studio_import_sha256', 'value' => $hash],
                ],
            ])
            as $existing
        ) {
            $path =
                wp_get_original_image_path($existing->ID) ?:
                get_attached_file($existing->ID);
            if (
                $path &&
                is_file($path) &&
                hash_equals($hash, hash_file('sha256', $path))
            ) {
                $attachment = $existing->ID;
                break;
            }
        }
        $reused = (bool) $attachment;
        if (!$attachment) {
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
            $mime_filter = static function ($mimes) use ($types) {
                return array_merge($mimes, $types);
            };
            if ($is_font || $is_svg) {
                add_filter('upload_mimes', $mime_filter);
            }
            // libmagic reports valid TTF/OTF files as font/sfnt on some hosts.
            // Normalize only this signature-checked upload, never arbitrary files.
            $font_filter = static function (
                $checked,
                $path,
                $name,
                $mimes,
                $real_mime,
            ) use ($file, $ext, $font_types) {
                if (
                    $path === $file['tmp_name'] &&
                    strtolower(pathinfo($name, PATHINFO_EXTENSION)) === $ext &&
                    in_array(
                        $real_mime,
                        [
                            $font_types[$ext],
                            'font/sfnt',
                            'application/font-sfnt',
                            'application/x-font-ttf',
                            'application/x-font-opentype',
                            'application/octet-stream',
                        ],
                        true,
                    )
                ) {
                    $checked['ext'] = $ext;
                    $checked['type'] = $font_types[$ext];
                    $checked['proper_filename'] = false;
                }
                return $checked;
            };
            if ($is_font) {
                add_filter('wp_check_filetype_and_ext', $font_filter, 10, 5);
            }
            $deferred = [];
            $defer =
                ($input['defer_sizes'] ?? true) !== false &&
                LSE_Media::can_defer();
            $size_filter = static function ($sizes, $meta, $id) use (
                &$deferred,
            ) {
                return LSE_Media::capture($sizes, $meta, $id, $deferred);
            };
            if ($defer) {
                add_filter(
                    'intermediate_image_sizes_advanced',
                    $size_filter,
                    PHP_INT_MAX,
                    3,
                );
            }
            try {
                $attachment = media_handle_upload(
                    'file',
                    0,
                    ['post_title' => self::asset_title($file['name'])],
                    ['test_form' => false, 'mimes' => $types],
                );
            } finally {
                if ($defer) {
                    remove_filter(
                        'intermediate_image_sizes_advanced',
                        $size_filter,
                        PHP_INT_MAX,
                    );
                }
                if ($is_font || $is_svg) {
                    remove_filter('upload_mimes', $mime_filter);
                }
                if ($is_font) {
                    remove_filter(
                        'wp_check_filetype_and_ext',
                        $font_filter,
                        10,
                    );
                }
            }
            if (is_wp_error($attachment)) {
                throw new RuntimeException($attachment->get_error_message());
            }
            if (isset($deferred[$attachment])) {
                LSE_Media::enqueue(
                    $attachment,
                    $deferred[$attachment],
                    $job['id'],
                );
            }
            update_post_meta($attachment, '_lse_sha256', $hash);
            update_post_meta($attachment, '_lse_job', $job['id']);
            if (!$is_font) {
                update_post_meta(
                    $attachment,
                    '_wp_attachment_image_alt',
                    self::text($input['alt'] ?? '', 1000),
                );
            }
        }
        if ($is_svg) {
            $root = $xml->documentElement;
            $view = preg_split(
                '/[\s,]+/',
                trim(
                    $root->getAttribute('viewBox') ?:
                    $root->getAttribute('viewbox'),
                ),
            );
            $dimension = static function ($value, $fallback) {
                return preg_match(
                    '/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/D',
                    $value,
                    $m,
                )
                    ? (float) $m[1]
                    : (float) $fallback;
            };
            $width = $dimension($root->getAttribute('width'), $view[2] ?? 0);
            $height = $dimension($root->getAttribute('height'), $view[3] ?? 0);
            $meta = wp_get_attachment_metadata($attachment);
            $meta = is_array($meta) ? $meta : [];
            if (
                $width > 0 &&
                $height > 0 &&
                $width <= 100000 &&
                $height <= 100000 &&
                (empty($meta['width']) || empty($meta['height']))
            ) {
                $meta['width'] = (int) ceil($width);
                $meta['height'] = (int) ceil($height);
                $meta['file'] = get_post_meta(
                    $attachment,
                    '_wp_attached_file',
                    true,
                );
                wp_update_attachment_metadata($attachment, $meta);
            }
        }
        return self::register_asset(
            $input,
            $job,
            $attachment,
            $file,
            $hash,
            $is_font,
            $reused,
            $started,
        );
    }
    private static function register_asset(
        $input,
        &$job,
        $attachment,
        $file,
        $hash,
        $is_font,
        $reused,
        $started,
    ) {
        $asset_lock = LSE_Locks::acquire(
            '_lse_attachment_' . (int) $attachment,
        );
        try {
            if (get_post_type($attachment) !== 'attachment') {
                throw new RuntimeException(
                    'This upload changed while being reused. Retry the file.',
                );
            }
            if (
                $reused &&
                get_post_meta($attachment, '_lse_sha256', true) === $hash &&
                preg_match(
                    '/^(?:captured-)?[a-f0-9]{16,64}$/iD',
                    get_the_title($attachment),
                ) &&
                !preg_match(
                    '/^(?:captured-)?[a-f0-9]{16,64}$/iD',
                    pathinfo($file['name'], PATHINFO_FILENAME),
                )
            ) {
                wp_update_post([
                    'ID' => $attachment,
                    'post_title' => self::asset_title($file['name']),
                ]);
            }
            $source = (string) $input['url'];
            $url = wp_get_attachment_url($attachment);
            $saved = [
                'source' => $source,
                'url' => $url,
                'id' => $attachment,
                'reused' => $reused,
                'name' => sanitize_file_name($file['name']),
                'bytes' => (int) $file['size'],
                'hash' => $hash,
                'font' => $is_font,
            ];
            unset($job['skipped_assets'][$source]);
            $job['assets'][] = $saved;
            $job['map'][$source] = $url;
            if ($is_font) {
                $family = 'LSImport_' . substr($hash, 0, 16);
                $families = $input['families'] ?? [$input['family'] ?? ''];
                if (!is_array($families)) {
                    throw new RuntimeException('Invalid font families.');
                }
                foreach ($families as $source_family) {
                    $source_family = self::text($source_family, 100);
                    if ($source_family) {
                        $job['font_map'][$source_family] = $family;
                    }
                }
                $job['fonts'][] = ['family' => $family, 'url' => $url];
            }
            if (
                !in_array(
                    $job['id'],
                    get_post_meta($attachment, '_lse_asset_job'),
                    true,
                )
            ) {
                add_post_meta($attachment, '_lse_asset_job', $job['id']);
            }
            self::store($job);
            $saved['processing_ms'] = (int) round(
                (microtime(true) - $started) * 1000,
            );
            return $saved;
        } finally {
            LSE_Locks::release($asset_lock);
        }
    }
    private static function asset_title($name)
    {
        return ucwords(
            str_replace(
                ['-', '_'],
                ' ',
                pathinfo(sanitize_file_name($name), PATHINFO_FILENAME),
            ),
        );
    }
    private static function rewrite($value, $map)
    {
        if (!$map) {
            return $value;
        }
        static $cached_map = null,
            $pairs = [],
            $patterns = [];
        if ($cached_map !== $map) {
            $cached_map = $map;
            $pairs = $map;
            foreach ($map as $from => $to) {
                $pairs[str_replace('/', '\\/', $from)] = str_replace(
                    '/',
                    '\\/',
                    $to,
                );
            }
            unset($pairs['']);
            uksort($pairs, static fn($a, $b) => strlen($b) <=> strlen($a));
            $patterns = [];
            $chunk = [];
            $bytes = 0;
            foreach (array_keys($pairs) as $key) {
                $quoted = preg_quote($key, '#');
                if ($chunk && $bytes + strlen($quoted) > 4096) {
                    $patterns[] = self::rewrite_pattern($chunk);
                    $chunk = [];
                    $bytes = 0;
                }
                $chunk[] = $quoted;
                $bytes += strlen($quoted) + 1;
            }
            if ($chunk) {
                $patterns[] = self::rewrite_pattern($chunk);
            }
        }
        return self::rewrite_values($value, $pairs, $patterns);
    }
    private static function rewrite_pattern($keys)
    {
        return '#(?:' . implode('|', $keys) . ')(?=$|[^a-zA-Z0-9_./%~\\-])#';
    }
    private static function rewrite_match($pattern, $value, $offset)
    {
        $found = preg_match(
            $pattern,
            $value,
            $match,
            PREG_OFFSET_CAPTURE,
            $offset,
        );
        if ($found === false) {
            throw new RuntimeException(
                'A captured resource URL could not be remapped: ' .
                    preg_last_error_msg(),
            );
        }
        return $found ? $match[0] : null;
    }
    private static function rewrite_values($value, $pairs, $patterns)
    {
        if (is_array($value)) {
            return array_map(
                static fn($v) => self::rewrite_values($v, $pairs, $patterns),
                $value,
            );
        }
        if (!is_string($value) || !$pairs) {
            return $value;
        }
        if (count($patterns) === 1) {
            $result = preg_replace_callback(
                $patterns[0],
                static fn($match) => $pairs[$match[0]],
                $value,
            );
            if (!is_string($result)) {
                throw new RuntimeException(
                    'A captured resource URL could not be remapped: ' .
                        preg_last_error_msg(),
                );
            }
            return $result;
        }
        // Merge matches from small expressions against the original text. Rewriting each
        // chunk's output would cascade replacements and break longest-match boundaries.
        $next = [];
        foreach ($patterns as $i => $pattern) {
            $next[$i] = self::rewrite_match($pattern, $value, 0);
        }
        $cursor = 0;
        $result = '';
        while (true) {
            $first = null;
            foreach ($next as $match) {
                if (
                    $match !== null &&
                    ($first === null ||
                        $match[1] < $first[1] ||
                        ($match[1] === $first[1] &&
                            strlen($match[0]) > strlen($first[0])))
                ) {
                    $first = $match;
                }
            }
            if ($first === null) {
                return $cursor ? $result . substr($value, $cursor) : $value;
            }
            $result .=
                substr($value, $cursor, $first[1] - $cursor) .
                $pairs[$first[0]];
            $cursor = $first[1] + strlen($first[0]);
            foreach ($next as $i => $match) {
                if ($match !== null && $match[1] < $cursor) {
                    $next[$i] = self::rewrite_match(
                        $patterns[$i],
                        $value,
                        $cursor,
                    );
                }
            }
        }
    }
    private static function html($html, $interactive = false)
    {
        $allowed = wp_kses_allowed_html('post');
        foreach (
            [
                'div',
                'span',
                'section',
                'article',
                'header',
                'footer',
                'main',
                'nav',
                'aside',
                'details',
                'dialog',
                'summary',
                'button',
                'picture',
                'source',
                'video',
                'audio',
                'form',
                'fieldset',
                'legend',
                'label',
            ]
            as $tag
        ) {
            $allowed[$tag] = array_merge($allowed[$tag] ?? [], [
                'class' => true,
                'id' => true,
                'style' => true,
                'role' => true,
                'aria-*' => true,
                'data-*' => true,
                'hidden' => true,
                'tabindex' => true,
            ]);
        }
        $allowed['label']['for'] = true;
        foreach ($allowed as $tag => $attributes) {
            $allowed[$tag] = array_merge($attributes, [
                'class' => true,
                'id' => true,
                'role' => true,
                'aria-*' => true,
                'data-*' => true,
                'hidden' => true,
            ]);
        }
        $svg_attributes = array_fill_keys(
            [
                'viewbox',
                'xmlns',
                'width',
                'height',
                'fill',
                'stroke',
                'stroke-width',
                'stroke-linecap',
                'stroke-linejoin',
                'd',
                'cx',
                'cy',
                'r',
                'rx',
                'ry',
                'x',
                'y',
                'x1',
                'x2',
                'y1',
                'y2',
                'points',
                'transform',
                'opacity',
                'fill-rule',
                'clip-rule',
                'aria-hidden',
                'aria-label',
                'role',
                'focusable',
                'class',
                'id',
                'style',
                'data-lse-source-content',
            ],
            true,
        );
        foreach (
            [
                'svg',
                'g',
                'path',
                'circle',
                'ellipse',
                'rect',
                'line',
                'polyline',
                'polygon',
                'title',
                'desc',
            ]
            as $tag
        ) {
            $allowed[$tag] = $svg_attributes;
        }
        $allowed['button']['type'] = true;
        $allowed['button']['disabled'] = true;
        $field_attributes = array_fill_keys(
            [
                'class',
                'id',
                'type',
                'name',
                'value',
                'placeholder',
                'disabled',
                'readonly',
                'checked',
                'selected',
                'multiple',
                'rows',
                'cols',
                'min',
                'max',
                'step',
                'maxlength',
                'required',
                'autocomplete',
                'inputmode',
                'role',
                'hidden',
                'aria-*',
                'data-*',
            ],
            true,
        );
        foreach (['input', 'select', 'option', 'textarea'] as $tag) {
            $allowed[$tag] = $field_attributes;
        }
        foreach (['source', 'video', 'audio'] as $tag) {
            foreach (
                [
                    'src',
                    'srcset',
                    'sizes',
                    'type',
                    'poster',
                    'controls',
                    'preload',
                    'loop',
                    'muted',
                    'autoplay',
                    'playsinline',
                ]
                as $attr
            ) {
                $allowed[$tag][$attr] = true;
            }
        }
        $allowed['input'] += [
            'src' => true,
            'alt' => true,
            'width' => true,
            'height' => true,
        ];
        $allowed['source']['media'] = true;
        $allowed['track'] = [
            'src' => true,
            'kind' => true,
            'srclang' => true,
            'label' => true,
            'default' => true,
        ];
        $html = preg_replace(
            '~<(script|iframe|object|embed|style)\b[^>]*>[\s\S]*?</\1\s*>~i',
            '',
            (string) $html,
        );
        if (!$interactive) {
            $html = preg_replace(
                '~<form\b[^>]*>~i',
                '<div role="group">',
                $html,
            );
            $html = preg_replace('~</form\s*>~i', '</div>', $html);
        }
        $html = wp_kses($html, $allowed);
        $processor = new WP_HTML_Tag_Processor($html);
        while ($processor->next_tag()) {
            if (
                in_array(
                    $processor->get_tag(),
                    ['INPUT', 'SELECT', 'TEXTAREA'],
                    true,
                )
            ) {
                if (!$interactive) {
                    $processor->set_attribute('disabled', true);
                }
                if ($processor->get_attribute('type') === 'password') {
                    $processor->remove_attribute('value');
                }
            }
            if ($interactive && $processor->get_tag() === 'FORM') {
                $processor->set_attribute('data-lse-local-form', '');
            }
        }
        return $processor->get_updated_html();
    }
    private static function tree(
        $items,
        $job,
        &$count,
        $depth = 0,
        $native = false,
        $skip_css = [],
        &$skipped = [],
    ) {
        if (!is_array($items)) {
            throw new RuntimeException('Element children must be a list.');
        }
        $out = [];
        static $cached_assets = null,
            $asset_ids = [];
        if ($cached_assets !== $job['assets']) {
            $cached_assets = $job['assets'];
            $asset_ids = array_column($job['assets'], 'id', 'url');
        }
        foreach ($items as $item) {
            ++$count;
            if (
                !is_array($item) ||
                !preg_match(
                    $native ? '/^[a-f0-9]{7,8}$/' : '/^[a-f0-9]{8}$/',
                    $item['id'] ?? '',
                )
            ) {
                throw new RuntimeException('Invalid Elementor elements.');
            }
            $type = $item['elType'] ?? '';
            $widget = $item['widgetType'] ?? '';
            $carousel = in_array(
                $widget,
                ['media-carousel', 'reviews', 'slides'],
                true,
            );
            if ($native || $carousel || $widget === 'form') {
                LSE_Native::element($item);
            }
            if (
                !$native &&
                $type !== 'container' &&
                ($type !== 'widget' ||
                    !in_array(
                        $widget,
                        [
                            'heading',
                            'text-editor',
                            'image',
                            'button',
                            'divider',
                            'html',
                            'video',
                            'google_maps',
                            'nav-menu',
                            'icon',
                            'form',
                            'media-carousel',
                            'reviews',
                            'slides',
                        ],
                        true,
                    ))
            ) {
                throw new RuntimeException(
                    'An unsupported Elementor element was rejected.',
                );
            }
            $settings = self::rewrite($item['settings'] ?? [], $job['map']);
            if (!is_array($settings)) {
                throw new RuntimeException(
                    'Element settings must be an object.',
                );
            }
            if (!$native && $widget === 'form') {
                // Only enable local collection. Source email and third-party actions are never copied.
                $fields = [];
                foreach ((array) ($settings['form_fields'] ?? []) as $field) {
                    if (
                        !is_array($field) ||
                        !in_array(
                            $field['field_type'] ?? '',
                            [
                                'text',
                                'email',
                                'tel',
                                'url',
                                'number',
                                'textarea',
                            ],
                            true,
                        )
                    ) {
                        throw new RuntimeException(
                            'Invalid converted contact form field.',
                        );
                    }
                    $index = count($fields);
                    $fields[] = [
                        '_id' => str_pad(dechex($index), 7, '0', STR_PAD_LEFT),
                        'custom_id' => self::text(
                            $field['custom_id'] ?? 'field_' . ($index + 1),
                            100,
                        ),
                        'field_type' => $field['field_type'],
                        'field_label' => self::text(
                            $field['field_label'] ?? '',
                            600,
                        ),
                        'placeholder' => self::text(
                            $field['placeholder'] ?? '',
                            800,
                        ),
                        'width' => (string) max(
                            1,
                            min(100, (int) ($field['width'] ?? 100)),
                        ),
                        'required' => empty($field['required']) ? '' : 'true',
                        'rows' => max(1, min(30, (int) ($field['rows'] ?? 4))),
                    ];
                }
                $settings['form_fields'] = $fields;
                $settings['form_name'] = self::text(
                    $settings['form_name'] ?? 'Contact form',
                    600,
                );
                $settings['button_text'] = self::text(
                    $settings['button_text'] ?? 'Send',
                    400,
                );
                $settings['submit_actions'] = LSE_Plugin::collect_submissions()
                    ? ['save-to-database']
                    : [];
                $settings['submissions_metadata'] = [];
            }
            if (is_array($settings['lse_attributes'] ?? null)) {
                $settings['lse_attributes'] = array_filter(
                    $settings['lse_attributes'],
                    static fn($key) => !preg_match(
                        '/^(?:data-(?:id|element_type|widget_type|settings|model-cid)|data-elementor-(?:id|type|post-type)|data-e-action-hash)$/iD',
                        $key,
                    ),
                    ARRAY_FILTER_USE_KEY,
                );
            }
            if (
                $native ||
                $carousel ||
                in_array($widget, ['icon', 'nav-menu'], true)
            ) {
                $settings = LSE_Native::settings(
                    $settings,
                    $job,
                    'elements.' . $item['id'] . '.settings',
                    $skip_css,
                    $skipped,
                );
            }
            if ($widget === 'slides' && is_array($settings['slides'] ?? null)) {
                foreach ($settings['slides'] as &$slide) {
                    if (!is_array($slide)) {
                        throw new RuntimeException('Invalid slide settings.');
                    }
                    foreach (
                        ['heading', 'description', 'button_text']
                        as $field
                    ) {
                        if (isset($slide[$field])) {
                            $slide[$field] = self::html($slide[$field], false);
                        }
                    }
                }
                unset($slide);
            }
            foreach (['title', 'editor', 'html', 'caption'] as $field) {
                if (isset($settings[$field])) {
                    $settings[$field] = self::html(
                        $settings[$field],
                        $field === 'html' &&
                            ($settings['lse_interactive'] ?? '') === 'yes',
                    );
                }
            }
            foreach ($settings as $field => $value) {
                if (
                    !$native &&
                    (str_contains($field, 'custom_css') ||
                        str_starts_with($field, '__') ||
                        str_contains($field, 'shortcode'))
                ) {
                    unset($settings[$field]);
                } elseif (
                    str_contains($field, 'font_family') &&
                    is_string($value) &&
                    isset($job['font_map'][$value])
                ) {
                    $settings[$field] = $job['font_map'][$value];
                }
            }
            if (isset($settings['link'])) {
                $settings['link']['url'] = self::clean_url(
                    $settings['link']['url'] ?? '',
                );
            }
            foreach (array_keys($settings) as $field) {
                if (
                    preg_match(
                        '/^(?:image|background_image|background_overlay_image|lse_image_background_image|hosted_url|poster)(?:_(?:tablet|mobile))?$/D',
                        $field,
                    ) &&
                    isset($settings[$field]['url'])
                ) {
                    $settings[$field]['url'] = self::clean_url(
                        $settings[$field]['url'],
                    );
                    if (isset($asset_ids[$settings[$field]['url']])) {
                        $settings[$field]['id'] =
                            $asset_ids[$settings[$field]['url']];
                    }
                }
            }
            if (is_array($settings['background_slideshow_gallery'] ?? null)) {
                foreach ($settings['background_slideshow_gallery'] as &$slide) {
                    $slide['url'] = self::clean_url($slide['url'] ?? '');
                    $slide['id'] = $asset_ids[$slide['url']] ?? 0;
                }
                unset($slide);
            }
            $out[] = array_merge(
                [
                    'id' => $item['id'],
                    'elType' => $type,
                    'isInner' => $native ? !empty($item['isInner']) : false,
                    'settings' => $settings,
                    'elements' => self::tree(
                        $item['elements'] ?? [],
                        $job,
                        $count,
                        $depth + 1,
                        $native,
                        $skip_css,
                        $skipped,
                    ),
                ],
                $type === 'widget' ? ['widgetType' => $widget] : [],
            );
        }
        return $out;
    }
    public static function page($input)
    {
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            $index = array_search(
                $input['key'] ?? '',
                array_column($job['pages'], 'key'),
                true,
            );
            if ($index === false) {
                throw new RuntimeException('Unknown source page.');
            }
            $page = $job['pages'][$index];
            if ($page['done']) {
                delete_post_meta($page['id'], '_lse_save_journal');
                delete_post_meta($page['id'], '_lse_save_before');
                return self::page_result($job, $index, $input);
            }
            if ($job['state'] !== 'importing') {
                throw new RuntimeException(
                    'This import no longer accepts pages.',
                );
            }
            if (($job['engine'] ?? '') !== LSE_CONVERTER_VERSION) {
                throw new RuntimeException(
                    'This unfinished import used an earlier converter. Use Update from file to rebuild its existing pages after review.',
                );
            }
            $id = $page['id'];
            self::recover_page_save($id, $job['id']);
            if (
                get_post_status($id) !== ($page['target_status'] ?? 'draft') ||
                !current_user_can('edit_post', $id) ||
                (isset($page['initial_stamp']) &&
                    !hash_equals($page['initial_stamp'], self::stamp($id)))
            ) {
                throw new RuntimeException(
                    'The destination draft changed. Review it before retrying.',
                );
            }
            if (
                isset($page['initial_review_stamp']) &&
                !hash_equals(
                    $page['initial_review_stamp'],
                    self::review_stamp($id),
                )
            ) {
                throw new RuntimeException(
                    'The page or a shared section changed while refreshing. Your edits were preserved.',
                );
            }
            $count = 0;
            $skipped = [];
            $native = ($input['native_elementor'] ?? false) === true;
            if (LSE_Native::uses_imported_menu($input['elements'] ?? [])) {
                $menu_id = LSE_Navigation::ensure($job, static function (
                    $state,
                ) {
                    self::store($state);
                });
                if (!$menu_id) {
                    throw new RuntimeException(
                        'The native navigation needs site navigation items in its website JSON.',
                    );
                }
            }
            $tree = self::tree(
                $input['elements'] ?? [],
                $job,
                $count,
                0,
                $native,
                $input['skip_css'] ?? [],
                $skipped,
            );
            $page_settings = $native
                ? LSE_Native::settings(
                    $input['page_settings'] ?? [],
                    $job,
                    'page_settings',
                    $input['skip_css'] ?? [],
                    $skipped,
                )
                : [];
            if (!$count) {
                throw new RuntimeException('No content was converted.');
            }
            $ids = self::ids($tree);
            if (count(array_unique($ids)) !== count($ids)) {
                throw new RuntimeException(
                    'Element IDs must be unique within a page.',
                );
            }
            $candidate_css = self::rewrite($input['css'] ?? '', $job['map']);
            if (is_string($candidate_css)) {
                $candidate_css = preg_replace_callback(
                    '/font-family:([^;}]+)/i',
                    static fn($match) => 'font-family:' .
                        strtr($match[1], $job['font_map'] ?? []),
                    $candidate_css,
                );
                if ($candidate_css === null) {
                    throw new LSE_Import_Error(
                        'Font style rewriting failed: ' . preg_last_error_msg(),
                        [
                            'code' => 'css_rewrite',
                            'field' => 'css',
                            'recoverable' => false,
                        ],
                    );
                }
                $candidate_css = str_replace(
                    '__LSE_SCOPE__',
                    'body.page-id-' . $id,
                    $candidate_css,
                );
            }
            $css = LSE_CSS::clean(
                $candidate_css,
                'css',
                $input['skip_css'] ?? [],
                $skipped,
            );
            foreach ($input['regions'] ?? [] as $i => $region) {
                if (is_array($region)) {
                    $input['regions'][$i]['context_css'] = LSE_CSS::clean(
                        self::rewrite(
                            $region['context_css'] ?? '',
                            $job['map'],
                        ),
                        'regions.' . $i . '.context_css',
                        $input['skip_css'] ?? [],
                        $skipped,
                    );
                }
            }
            $candidate_source = $input['source'] ?? [];
            if (
                !is_array($candidate_source) ||
                !is_array($input['seo'] ?? []) ||
                !is_array($input['warnings'] ?? []) ||
                !is_array($input['regions'] ?? [])
            ) {
                throw new RuntimeException(
                    'Page metadata or source is invalid.',
                );
            }
            foreach (['html', 'css', 'js'] as $field) {
                if (
                    isset($candidate_source[$field]) &&
                    !is_string($candidate_source[$field])
                ) {
                    throw new RuntimeException(
                        'Original source fields must be text.',
                    );
                }
            }
            foreach ($input['seo'] ?? [] as $field => $value) {
                self::text(
                    $value,
                    in_array($field, ['canonical', 'social_image'], true)
                        ? 2048
                        : 1000,
                );
            }
            foreach ($input['warnings'] ?? [] as $warning) {
                self::text($warning, 1500);
            }
            $source = $candidate_source;
            unset($source['layout_structure'], $source['site_parts']);
            if (!empty($source['structure'])) {
                $source['layout_structure'] = LSE_Structure::clean(
                    self::rewrite($source['structure'], $job['map']),
                    $tree,
                );
                unset($source['structure']);
            }
            foreach ($job['fonts'] as $font) {
                $css .=
                    '@font-face{font-family:"' .
                    $font['family'] .
                    '";src:url("' .
                    esc_url_raw($font['url']) .
                    '");font-display:swap}';
            }
            if (
                !empty($input['regions']) &&
                class_exists(\ElementorPro\Modules\ThemeBuilder\Module::class)
            ) {
                $theme_lock = LSE_Locks::acquire('_lse_theme_builder_import');
            }
            $source['site_parts'] = self::save_site_parts(
                $job,
                $page,
                $tree,
                $input['regions'] ?? [],
                $css,
                $source['layout_structure'] ?? [],
            );
            if (!empty($source['layout_structure'])) {
                LSE_Structure::prepare_editor_blocks(
                    $tree,
                    $source['layout_structure'],
                    $ids,
                );
            }
            self::begin_page_save($id, $job['id']);
            if (!empty($page['refreshing'])) {
                self::backup_refresh($id);
            }
            $document = \Elementor\Plugin::$instance->documents->get($id);
            if (!$document) {
                throw new RuntimeException(
                    'Elementor could not open the draft.',
                );
            }
            $document->set_is_built_with_elementor(true);
            $ok = $document->save([
                'elements' => $tree,
                'settings' => array_merge($page_settings, [
                    'post_status' => $page['target_status'] ?? 'draft',
                    'template' => $job['layout'],
                    'hide_title' => 'yes',
                ]),
            ]);
            if (!$ok) {
                throw new RuntimeException('Elementor did not save the page.');
            }
            update_post_meta($id, '_lse_css', wp_slash($css));
            update_post_meta($id, '_lse_source', wp_slash($source));
            $js = self::rewrite(
                is_string($source['js'] ?? null) ? $source['js'] : '',
                $job['map'],
            );
            update_post_meta($id, '_lse_js', wp_slash($js));
            update_post_meta(
                $id,
                '_lse_scripts_enabled',
                $job['scripts'] ? '1' : '',
            );
            $seo = self::rewrite(
                is_array($input['seo'] ?? null) ? $input['seo'] : [],
                $job['map'],
            );
            $clean = [];
            foreach (
                [
                    'title',
                    'description',
                    'canonical',
                    'indexing',
                    'social_title',
                    'social_description',
                    'social_image',
                ]
                as $field
            ) {
                $clean[$field] = self::text(
                    (string) ($seo[$field] ?? ''),
                    in_array($field, ['canonical', 'social_image'], true)
                        ? 2048
                        : 1000,
                );
            }
            update_post_meta($id, '_lse_seo', wp_slash($clean));
            if (defined('WPSEO_VERSION')) {
                foreach (
                    [
                        'title' => 'title',
                        'description' => 'metadesc',
                        'canonical' => 'canonical',
                        'social_title' => 'opengraph-title',
                        'social_description' => 'opengraph-description',
                        'social_image' => 'opengraph-image',
                    ]
                    as $a => $b
                ) {
                    if ($clean[$a]) {
                        update_post_meta($id, '_yoast_wpseo_' . $b, $clean[$a]);
                    }
                }
            }
            if (defined('RANK_MATH_VERSION')) {
                foreach (
                    [
                        'title' => 'title',
                        'description' => 'description',
                        'canonical' => 'canonical_url',
                        'social_title' => 'facebook_title',
                        'social_description' => 'facebook_description',
                        'social_image' => 'facebook_image',
                    ]
                    as $a => $b
                ) {
                    if ($clean[$a]) {
                        update_post_meta($id, 'rank_math_' . $b, $clean[$a]);
                    }
                }
            }
            if (defined('RANK_MATH_VERSION') && $clean['social_image']) {
                // Rank Math selects social images by attachment ID, not its URL field.
                update_post_meta(
                    $id,
                    'rank_math_facebook_image_id',
                    attachment_url_to_postid($clean['social_image']),
                );
            }
            if (defined('WPSEO_VERSION')) {
                update_post_meta(
                    $id,
                    '_yoast_wpseo_meta-robots-noindex',
                    $clean['indexing'] === 'noindex' ? '1' : '0',
                );
            }
            if (defined('RANK_MATH_VERSION')) {
                update_post_meta(
                    $id,
                    'rank_math_robots',
                    $clean['indexing'] === 'noindex' ? ['noindex'] : [],
                );
            }
            $regions = [];
            foreach ($input['regions'] ?? [] as $region) {
                if (
                    empty($source['site_parts'][$region['kind'] ?? '']) &&
                    preg_match('/^[a-f0-9]{64}$/', $region['hash'] ?? '') &&
                    preg_match('/^[a-f0-9]{8}$/', $region['id'] ?? '') &&
                    in_array($region['kind'] ?? '', ['header', 'footer'], true)
                ) {
                    $regions[] = $region;
                }
            }
            $job['pages'][$index]['regions'] = $regions;
            $warnings = array_map(
                static fn($s) => self::text($s, 1500),
                $input['warnings'] ?? [],
            );
            $fallbacks = max(0, (int) ($input['fallbacks'] ?? 0));
            $job['reports'][$page['key']] = [
                'native' => max(0, $count - $fallbacks),
                'elements' => $count,
                'fallbacks' => $fallbacks,
                'warnings' => array_merge(
                    $warnings,
                    array_column($source['site_parts'], 'warning'),
                    array_map(
                        static fn($item) => 'Skipped file ' .
                            $item['name'] .
                            ': ' .
                            $item['reason'],
                        array_values($job['skipped_assets'] ?? []),
                    ),
                    array_map(
                        static fn($issue) => 'Skipped ' .
                            $issue['skip']['label'] .
                            ' in ' .
                            $issue['field'] .
                            ' at line ' .
                            $issue['line'] .
                            ': ' .
                            $issue['reason'],
                        $skipped,
                    ),
                ),
                'skipped' => $skipped,
            ];
            self::invalidate_css($id);
            unset($job['pages'][$index]['skipped']);
            $job['pages'][$index]['done'] = true;
            $job['pages'][$index]['stamp'] = self::stamp($id);
            self::store($job);
            self::end_page_save($id);
            return self::page_result($job, $index, $input);
        } catch (Throwable $error) {
            self::stop_page_tracking();
            if (isset($id)) {
                self::recover_page_save($id, $job['id']);
            }
            throw $error;
        } finally {
            if (isset($theme_lock)) {
                LSE_Locks::release($theme_lock);
            }
            self::stop_page_tracking();
            self::unlock($lock);
        }
    }
    private static function invalidate_css($id)
    {
        delete_post_meta($id, '_elementor_css');
        if (class_exists(\Elementor\Core\Files\CSS\Post::class)) {
            \Elementor\Core\Files\CSS\Post::create($id)->delete();
        }
    }
    private static function save_site_parts(
        &$job,
        $page,
        &$tree,
        $regions,
        $css,
        $layout,
    ) {
        if ($job['layout'] !== 'elementor_canvas') {
            return [];
        }
        $parts = [];
        $documents = \Elementor\Plugin::$instance->documents;
        $pro = class_exists(\ElementorPro\Modules\ThemeBuilder\Module::class);
        $draft_reason = $job['site_parts_draft_reason'] ?? '';
        if ($pro && $regions) {
            $conditions = \ElementorPro\Modules\ThemeBuilder\Module::instance()->get_conditions_manager();
            $conditions->get_cache()->refresh();
            if (!$draft_reason) {
                // An existing sitewide assignment means this import must
                // keep both new templates separate from the destination site.
                foreach (['header', 'footer'] as $kind) {
                    $existing = $job['templates']['site-' . $kind] ?? [];
                    if (
                        $conditions->get_conditions_conflicts_by_location(
                            'include/general',
                            $kind,
                            (int) ($existing['id'] ?? 0),
                        )
                    ) {
                        $draft_reason =
                            'Theme Builder already has an Entire Site ' .
                            $kind .
                            '.';
                        break;
                    }
                }
                if (
                    !$draft_reason &&
                    (!current_user_can('edit_theme_options') ||
                        !current_user_can('publish_posts'))
                ) {
                    $draft_reason =
                        'This account cannot publish sitewide templates.';
                }
                if ($draft_reason) {
                    $job['site_parts_draft_reason'] = $draft_reason;
                }
            }
        }
        foreach ($regions as $region) {
            $kind = $region['kind'] ?? '';
            $id = $region['id'] ?? '';
            if (
                empty($region['separate']) ||
                !in_array($kind, ['header', 'footer'], true) ||
                !is_string($id) ||
                !preg_match('/^[a-f0-9]{7,8}$/D', $id) ||
                isset($parts[$kind]) ||
                !self::find_node($tree, $id)
            ) {
                continue;
            }
            $nodes = [LSE_Structure::detach($tree, $id, $slot)];
            foreach ($region['additional_ids'] ?? [] as $member) {
                $extra = LSE_Structure::detach($tree, $member, $unused);
                if (!$extra) {
                    throw new RuntimeException(
                        'Missing native template element.',
                    );
                }
                $nodes[] = $extra;
            }
            $key = 'site-' . $kind;
            $existing = $job['templates'][$key] ?? null;
            $global = $pro && $documents->get_document_type($kind, false);
            if ($existing) {
                $template_id = $existing['id'];
                if (
                    get_post_meta($template_id, '_lse_job', true) !==
                        $job['id'] ||
                    !in_array(
                        get_post_status($template_id),
                        ['draft', 'publish', 'private'],
                        true,
                    )
                ) {
                    throw new RuntimeException(
                        'Restore this import’s site ' .
                            $kind .
                            ' template before refreshing.',
                    );
                }
            } else {
                $template = \Elementor\Plugin::$instance->documents->create(
                    $global ? $kind : 'section',
                    [
                        'post_title' => $job['title'] . ' — Site ' . $kind,
                        'post_status' => 'draft',
                    ],
                );
                if (is_wp_error($template) || !$template) {
                    throw new RuntimeException(
                        'The site ' . $kind . ' template could not be created.',
                    );
                }
                $template_id = $template->get_main_id();
                update_post_meta($template_id, '_lse_job', $job['id']);
                $job['templates'][$key] = [
                    'id' => $template_id,
                    'pending' => true,
                ];
                self::store($job);
            }
            $edited =
                !empty($existing['stamp']) &&
                !hash_equals($existing['stamp'], self::stamp($template_id));
            $write_content =
                !$existing ||
                !empty($existing['pending']) ||
                (!$edited &&
                    $page['key'] === ($job['site']['home_key'] ?? '') &&
                    current_user_can('edit_post', $template_id));
            $promote =
                $global &&
                get_post_meta(
                    $template_id,
                    '_elementor_template_type',
                    true,
                ) !== $kind;
            if ($promote) {
                update_post_meta(
                    $template_id,
                    '_elementor_template_type',
                    $kind,
                );
                wp_set_object_terms(
                    $template_id,
                    $kind,
                    'elementor_library_type',
                );
                $documents->get($template_id, false);
            }
            // The homepage supplies the canonical design. Subsequent pages
            // only attach it. A manually edited template stays authoritative.
            if ($write_content || $promote) {
                $template = $documents->get($template_id);
                $template->set_is_built_with_elementor(true);
                if ($write_content) {
                    $settings =
                        $global &&
                        ($nodes[0]['settings']['html_tag'] ?? '') === $kind
                            ? ['content_wrapper_html_tag' => 'div']
                            : [];
                    if (
                        !$template->save([
                            'elements' => $nodes,
                            'settings' => $settings,
                        ])
                    ) {
                        throw new RuntimeException(
                            'The site ' .
                                $kind .
                                ' template could not be saved.',
                        );
                    }
                    $node_ids = array_fill_keys(self::ids($nodes), true);
                    $inner = array_filter(
                        $layout['shells'] ?? [],
                        static fn($shell) => isset(
                            $node_ids[$shell['parent'] ?? ''],
                        ),
                    );
                    update_post_meta(
                        $template_id,
                        '_lse_source',
                        wp_slash([
                            'layout_structure' => [
                                'shells' => $inner,
                                'paths' => array_intersect_key(
                                    $layout['paths'] ?? [],
                                    $node_ids,
                                ),
                            ],
                        ]),
                    );
                }
                if (
                    $global &&
                    !$draft_reason &&
                    (!$existing || !empty($existing['pending']) || $promote)
                ) {
                    $published = wp_update_post(
                        ['ID' => $template_id, 'post_status' => 'publish'],
                        true,
                    );
                    if (
                        is_wp_error($published) ||
                        (get_post_meta(
                            $template_id,
                            '_elementor_conditions',
                            true,
                        ) !== ['include/general'] &&
                            !$conditions->save_conditions($template_id, [
                                ['type' => 'include', 'name' => 'general'],
                            ]))
                    ) {
                        throw new RuntimeException(
                            'Theme Builder could not assign the site ' .
                                $kind .
                                '.',
                        );
                    }
                }
                update_post_meta($template_id, '_lse_job', $job['id']);
                update_post_meta($template_id, '_lse_shared', '1');
                update_post_meta($template_id, '_lse_site_part', $kind);
                $scope = 'body.page-id-' . $page['id'];
                $template_scope = 'body .elementor-' . $template_id;
                $template_css =
                    str_replace(
                        [$scope . ' .lse-imported-site', $scope],
                        $template_scope,
                        $css,
                    ) .
                    str_replace(
                        '__LSE_SCOPE__',
                        $template_scope,
                        $region['context_css'] ?? '',
                    );
                if ($write_content) {
                    update_post_meta(
                        $template_id,
                        '_lse_css',
                        wp_slash($template_css),
                    );
                }
                self::invalidate_css($template_id);
                $job['templates'][$key] = [
                    'id' => $template_id,
                    'kind' => $kind,
                    'stamp' => $edited
                        ? $existing['stamp']
                        : self::stamp($template_id),
                    'edit_url' => admin_url(
                        'post.php?post=' . $template_id . '&action=elementor',
                    ),
                ];
                self::store($job);
            }
            $assigned =
                $global &&
                get_post_status($template_id) === 'publish' &&
                in_array(
                    'include/general',
                    (array) get_post_meta(
                        $template_id,
                        '_elementor_conditions',
                        true,
                    ),
                    true,
                );
            $parts[$kind] = $slot + [
                'template_id' => $template_id,
                'theme_builder' => $assigned,
            ];
            if ($global && !$assigned && $draft_reason) {
                $parts[$kind]['warning'] =
                    $draft_reason .
                    ' The imported ' .
                    $kind .
                    ' is available as a separate template for the imported pages.';
            }
        }
        return $parts;
    }
    private static function stamp($id)
    {
        $native = wp_json_encode([
            get_post_field('post_title', $id),
            get_post_field('post_content', $id),
            get_post_field('post_status', $id),
            get_post_meta($id, '_elementor_data', true),
            get_post_meta($id, '_elementor_page_settings', true),
            get_post_meta($id, '_lse_css', true),
            get_post_field('post_name', $id),
            get_post_field('post_parent', $id),
            get_post_meta($id, '_lse_js', true),
            get_post_meta($id, '_lse_seo', true),
            get_post_meta($id, '_lse_scripts_enabled', true),
        ]);
        $provider = LSE_SEO::snapshot($id);
        $parts = LSE_Structure::site_parts($id);
        return hash(
            'sha256',
            $native .
                ($provider ? '|seo-v1|' . wp_json_encode($provider) : '') .
                ($parts ? '|site-parts-v1|' . wp_json_encode($parts) : ''),
        );
    }
    private static function find_node($tree, $id)
    {
        foreach ($tree as $node) {
            if ($node['id'] === $id) {
                return $node;
            }
            $found = self::find_node($node['elements'] ?? [], $id);
            if ($found) {
                return $found;
            }
        }
        return null;
    }
    private static function ids($tree)
    {
        $ids = [];
        foreach ($tree as $node) {
            $ids[] = $node['id'];
            $ids = array_merge($ids, self::ids($node['elements'] ?? []));
        }
        return $ids;
    }
    private static function replace_node(&$tree, $id, $template, $kind)
    {
        foreach ($tree as &$node) {
            if ($node['id'] === $id) {
                $node = [
                    'id' => $id,
                    'elType' => 'widget',
                    'widgetType' => 'lse-shared',
                    'isInner' => false,
                    'settings' => [
                        'template_id' => $template,
                        '_title' => ucfirst($kind),
                    ],
                    'elements' => [],
                ];
                return true;
            }
            if (self::replace_node($node['elements'], $id, $template, $kind)) {
                return true;
            }
        }
        return false;
    }
    private static function share_one(&$job)
    {
        $groups = [];
        foreach ($job['pages'] as $i => $page) {
            foreach ($page['regions'] ?? [] as $region) {
                $groups[$region['hash']][] = [
                    'index' => $i,
                    'region' => $region,
                ];
            }
        }
        foreach ($groups as $hash => $group) {
            if (
                (count($group) < 2 && empty($group[0]['region']['separate'])) ||
                !empty($job['shared_done'][$hash])
            ) {
                continue;
            }
            $changed = false;
            foreach ($group as $member) {
                $page = $job['pages'][$member['index']];
                if (
                    !hash_equals($page['stamp'] ?? '', self::stamp($page['id']))
                ) {
                    $changed = true;
                }
                wp_cache_delete($page['id'], 'post_meta');
            }
            if ($changed) {
                foreach ($group as $member) {
                    $job['reports'][$job['pages'][$member['index']]['key']][
                        'warnings'
                    ][] =
                        'A page changed during import; this shared section remains local to protect your edits.';
                }
                $job['shared_done'][$hash] = true;
                self::store($job);
                continue;
            }
            $first = $group[0];
            $post_id = $job['pages'][$first['index']]['id'];
            $document = \Elementor\Plugin::$instance->documents->get($post_id);
            $canonical = self::find_node(
                $document->get_elements_data(),
                $first['region']['id'],
            );
            $existing = $job['templates'][$hash] ?? null;
            if (
                $existing &&
                (!hash_equals(
                    $existing['stamp'] ?? '',
                    self::stamp($existing['id']),
                ) ||
                    !current_user_can('edit_post', $existing['id']) ||
                    get_post_status($existing['id']) === 'trash')
            ) {
                foreach ($group as $member) {
                    $job['reports'][$job['pages'][$member['index']]['key']][
                        'warnings'
                    ][] =
                        'The shared template changed; refreshed content remains local to preserve its edits.';
                }
                $job['shared_done'][$hash] = true;
                self::store($job);
                continue;
            }
            if (!$existing) {
                if (
                    !$canonical ||
                    ($canonical['elType'] ?? '') !== 'container'
                ) {
                    $job['shared_done'][$hash] = true;
                    self::store($job);
                    continue;
                }
                $template = \Elementor\Plugin::$instance->documents->create(
                    'section',
                    [
                        'post_title' =>
                            $job['title'] .
                            (count($group) > 1
                                ? ' — shared '
                                : ' — ' . get_the_title($post_id) . ' ') .
                            $first['region']['kind'],
                        'post_status' => 'draft',
                    ],
                );
                if (is_wp_error($template) || !$template) {
                    throw new RuntimeException(
                        'A shared section template could not be created.',
                    );
                }
                $template->set_is_built_with_elementor(true);
                if (
                    !$template->save([
                        'elements' => [$canonical],
                        'settings' => [],
                    ])
                ) {
                    throw new RuntimeException(
                        'A shared section template could not be saved.',
                    );
                }
                $template_id = $template->get_main_id();
                update_post_meta($template_id, '_lse_job', $job['id']);
                update_post_meta($template_id, '_lse_shared', '1');
                $template_css = get_post_meta($post_id, '_lse_css', true);
                $scope = 'body.page-id-' . $post_id;
                $template_scope = 'body .elementor-' . $template_id;
                $template_css = str_replace(
                    [$scope . ' .lse-imported-site', $scope],
                    $template_scope,
                    $template_css,
                );
                $template_css .= str_replace(
                    '__LSE_SCOPE__',
                    $template_scope,
                    $first['region']['context_css'] ?? '',
                );
                update_post_meta(
                    $template_id,
                    '_lse_css',
                    wp_slash($template_css),
                );
                $existing = [
                    'id' => $template_id,
                    'kind' => $first['region']['kind'],
                    'stamp' => self::stamp($template_id),
                    'ids' => self::ids([$canonical]),
                    'edit_url' => admin_url(
                        'post.php?post=' . $template_id . '&action=elementor',
                    ),
                ];
                $job['templates'][$hash] = $existing;
                self::store($job);
            } elseif (
                $canonical &&
                ($canonical['elType'] ?? '') === 'container'
            ) {
                $canonical_ids = self::ids([$canonical]);
                $pairs = [];
                if (count($canonical_ids) === count($existing['ids'])) {
                    $replacement = $canonical;
                    $id_map = array_combine($canonical_ids, $existing['ids']);
                    $rekey = static function (&$node) use (&$rekey, $id_map) {
                        $node['id'] = $id_map[$node['id']] ?? $node['id'];
                        foreach ($node['elements'] as &$child) {
                            $rekey($child);
                        }
                    };
                    $rekey($replacement);
                    // Reuse the template's stable IDs, but refresh its native
                    // settings too. Updating only its supporting CSS leaves
                    // old layout/typography controls in otherwise fresh pages.
                    $template_document = \Elementor\Plugin::$instance->documents->get(
                        $existing['id'],
                    );
                    if (
                        !$template_document->save([
                            'elements' => [$replacement],
                        ])
                    ) {
                        throw new RuntimeException(
                            'The refreshed shared section could not be saved.',
                        );
                    }
                    self::invalidate_css($existing['id']);
                    foreach ($canonical_ids as $n => $source_id) {
                        $pairs['elementor-element-' . $source_id] =
                            'elementor-element-' . $existing['ids'][$n];
                    }
                    $scope = 'body.page-id-' . $post_id;
                    $template_scope = 'body .elementor-' . $existing['id'];
                    $template_css = strtr(
                        get_post_meta($post_id, '_lse_css', true),
                        $pairs,
                    );
                    update_post_meta(
                        $existing['id'],
                        '_lse_css',
                        wp_slash(
                            str_replace(
                                [$scope . ' .lse-imported-site', $scope],
                                $template_scope,
                                $template_css,
                            ) .
                                str_replace(
                                    '__LSE_SCOPE__',
                                    $template_scope,
                                    $first['region']['context_css'] ?? '',
                                ),
                        ),
                    );
                    $existing['stamp'] = self::stamp($existing['id']);
                    $job['templates'][$hash] = $existing;
                }
            }
            foreach ($group as $member) {
                $index = $member['index'];
                $id = $job['pages'][$index]['id'];
                // Inspect saved data before creating an Elementor document;
                // completed members must not fill its per-request cache again.
                $tree =
                    json_decode(
                        get_post_meta($id, '_elementor_data', true),
                        true,
                    ) ?:
                    [];
                $node = self::find_node($tree, $member['region']['id']);
                if (!$node || ($node['widgetType'] ?? '') === 'lse-shared') {
                    continue;
                }
                $doc = \Elementor\Plugin::$instance->documents->get($id);
                $tree = $doc->get_elements_data();
                $original_ids = self::ids([$node]);
                if (count($original_ids) !== count($existing['ids'])) {
                    continue;
                }
                $css = get_post_meta($id, '_lse_css', true);
                $pairs = [];
                foreach ($original_ids as $n => $original_id) {
                    $pairs['elementor-element-' . $original_id] =
                        'elementor-element-' . $existing['ids'][$n];
                }
                self::replace_node(
                    $tree,
                    $member['region']['id'],
                    $existing['id'],
                    $member['region']['kind'],
                );
                if (!$doc->save(['elements' => $tree])) {
                    throw new RuntimeException(
                        'A linked shared section could not be saved.',
                    );
                }
                update_post_meta(
                    $id,
                    '_lse_css',
                    wp_slash(strtr($css, $pairs)),
                );
                self::invalidate_css($id);
                $job['pages'][$index]['stamp'] = self::stamp($id);
                if (count($group) === 1) {
                    $job['shared_done'][$hash] = true;
                }
                self::store($job);
                // Elementor keeps loaded documents and their controls in its
                // request cache. Sharing an entire large group in one request
                // can exhaust PHP memory, especially with SQLite. The saved
                // replacement and stamp are our checkpoint; the next request
                // skips it and continues with the next unshared member.
                return true;
            }
            $job['shared_done'][$hash] = true;
            self::store($job);
            return true;
        }
        return false;
    }
    public static function finish($input)
    {
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            if ($job['state'] === 'ready') {
                LSE_Media::release(array_column($job['assets'], 'id'));
                return !empty($input['worker'])
                    ? ['id' => $job['id'], 'state' => $job['state']]
                    : self::status($input);
            }
            if (!in_array($job['state'], ['importing', 'finishing'], true)) {
                throw new RuntimeException(
                    'This import cannot be finished in its current state.',
                );
            }
            foreach ($job['pages'] as $page) {
                if (!$page['done'] && empty($page['skipped'])) {
                    throw new RuntimeException(
                        'Some pages have not finished. Retry the import.',
                    );
                }
            }
            $job['state'] = 'finishing';
            self::store($job);
            if (self::share_one($job)) {
                // Intermediate browser polls only need the job ID and state.
                // Rebuilding all page fingerprints and media status here made
                // every shared-section checkpoint expensive on large imports.
                return !empty($input['compact'])
                    ? ['id' => $job['id'], 'state' => $job['state']]
                    : self::status($input);
            }
            LSE_Navigation::ensure($job, static function ($state) {
                self::store($state);
            });
            $job['state'] = 'ready';
            self::store($job);
            LSE_Media::release(array_column($job['assets'], 'id'));
            return !empty($input['worker'])
                ? ['id' => $job['id'], 'state' => $job['state']]
                : self::status(['job' => $job['id']]);
        } finally {
            self::unlock($lock);
        }
    }
    public static function status($input)
    {
        $job = self::load($input['job'] ?? '');
        $job['diagnostics'] = get_option('_lse_diagnostics_' . $job['id'], []);
        unset($job['owner'], $job['fingerprint']);
        $shared_cache = [];
        $templates = array_column($job['templates'] ?? [], null, 'id');
        $job['site_template_links'] = [];
        foreach (['header', 'footer'] as $kind) {
            $part = $job['templates']['site-' . $kind] ?? null;
            if (
                !empty($part['edit_url']) &&
                current_user_can('edit_post', $part['id'])
            ) {
                $job['site_template_links'][] = [
                    'kind' => $kind,
                    'edit_url' => $part['edit_url'],
                    'assign' =>
                        $job['state'] === 'ready' &&
                        current_user_can('edit_theme_options') &&
                        current_user_can('publish_posts') &&
                        get_post_meta(
                            $part['id'],
                            '_elementor_template_type',
                            true,
                        ) === $kind &&
                        !self::theme_part_state($part['id'])['conditions'],
                    'restore' =>
                        $job['state'] === 'ready' &&
                        current_user_can('edit_theme_options') &&
                        !empty($job['site_part_swaps'][$kind]),
                ];
            }
        }
        foreach ($job['pages'] as &$page) {
            $post = get_post($page['id']);
            $page['post_status'] = $post ? $post->post_status : 'missing';
            $native_stamp = $post ? self::stamp($post->ID) : '';
            $shared_stamps = $post
                ? self::shared_stamps($post->ID, $shared_cache)
                : [];
            $page['template_links'] = [];
            foreach (array_keys($shared_stamps) as $id) {
                if (
                    !empty($templates[$id]['edit_url']) &&
                    current_user_can('edit_post', $id)
                ) {
                    $page['template_links'][] = [
                        'kind' => $templates[$id]['kind'],
                        'edit_url' => $templates[$id]['edit_url'],
                    ];
                }
            }
            $page['current_stamp'] = $post
                ? hash('sha256', $native_stamp . wp_json_encode($shared_stamps))
                : '';
            $page['changed'] =
                $post &&
                (!hash_equals(
                    $page['stamp'] ?? ($page['initial_stamp'] ?? ''),
                    $native_stamp,
                ) ||
                    self::shared_changed($job, $post->ID, $shared_stamps));
            $page['current_title'] = $post ? $post->post_title : $page['title'];
            $page['slug'] = $post ? $post->post_name : '';
            $page['modified'] = $post
                ? get_post_modified_time('c', true, $post)
                : '';
            $page['preview_url'] =
                $post && $post->post_status !== 'trash'
                    ? (get_preview_post_link($post) ?:
                    get_permalink($post))
                    : '';
            $page['can_edit'] =
                $post && current_user_can('edit_post', $post->ID);
            $page['can_delete'] =
                $post && current_user_can('delete_post', $post->ID);
            $page['can_restore_refresh'] =
                $post &&
                !empty(get_post_meta($post->ID, '_lse_refresh_backup', true)) &&
                hash_equals($page['stamp'] ?? '', $native_stamp);
            if ($post) {
                // WordPress caches all metadata for a post together. Keep only
                // the fingerprints while checking the remaining imported pages.
                wp_cache_delete($post->ID, 'post_meta');
            }
        }
        unset($page);
        $job['background'] = self::background_status($input);
        $job['media'] = LSE_Media::status(array_column($job['assets'], 'id'));
        return $job;
    }
    public static function undo($input)
    {
        $lock = self::lock($input['job'] ?? '');
        $removed = [];
        $kept = [];
        try {
            $job = self::load($lock['id']);
            if (!empty($job['refreshing'])) {
                throw new RuntimeException(
                    'This was a refresh of existing pages. Use Restore before last refresh, or move a selected page to Trash explicitly.',
                );
            }
            if (!EMPTY_TRASH_DAYS) {
                throw new RuntimeException(
                    'WordPress Trash is disabled. No pages were deleted.',
                );
            }
            foreach ($job['pages'] as $page) {
                if (
                    get_post_status($page['id']) === 'trash' ||
                    !get_post($page['id'])
                ) {
                    continue;
                }
                $expected = $page['done']
                    ? $page['stamp'] ?? ''
                    : $page['initial_stamp'] ?? '';
                if (
                    get_post_status($page['id']) === 'draft' &&
                    $expected &&
                    hash_equals($expected, self::stamp($page['id'])) &&
                    current_user_can('delete_post', $page['id'])
                ) {
                    wp_trash_post($page['id']);
                    $removed[] = $page['id'];
                } else {
                    $kept[] = $page['id'];
                }
            }
            if ($job['menu'] && empty($job['activated'])) {
                wp_delete_nav_menu($job['menu']);
                $job['menu'] = 0;
            }
            $job['state'] = $kept ? 'partly-removed' : 'removed';
            $job['cleanup'] = [
                'removed' => $removed,
                'kept' => $kept,
                'media' =>
                    'Media files and shared templates are retained to avoid breaking references.',
            ];
            self::store($job);
            return self::status(['job' => $job['id']]);
        } finally {
            self::unlock($lock);
        }
    }
    public static function activate($input)
    {
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($input['job'] ?? '');
            if (empty($input['consent']) || $job['state'] !== 'ready') {
                throw new RuntimeException(
                    'Review the completed import and confirm site setup first.',
                );
            }
            foreach ($job['pages'] as $page) {
                if (get_post_status($page['id']) !== 'publish') {
                    throw new RuntimeException(
                        'Publish the imported pages in WordPress before applying site setup.',
                    );
                }
            }
            if (!empty($job['activated'])) {
                return self::status($input);
            }
            $job['previous_setup'] = [
                'show_on_front' => get_option('show_on_front'),
                'page_on_front' => get_option('page_on_front'),
                'locations' => get_theme_mod('nav_menu_locations', []),
                'theme' => get_stylesheet(),
            ];
            foreach ($job['pages'] as $page) {
                if ($page['key'] === ($job['site']['home_key'] ?? '')) {
                    update_option('show_on_front', 'page');
                    update_option('page_on_front', $page['id']);
                }
            }
            $locations = get_registered_nav_menus();
            if ($job['menu'] && $locations) {
                $assignments = get_theme_mod('nav_menu_locations', []);
                $assignments[array_key_first($locations)] = $job['menu'];
                set_theme_mod('nav_menu_locations', $assignments);
            }
            $job['applied_setup'] = [
                'show_on_front' => get_option('show_on_front'),
                'page_on_front' => get_option('page_on_front'),
                'locations' => get_theme_mod('nav_menu_locations', []),
            ];
            $job['activated'] = true;
            self::store($job);
            return self::status($input);
        } finally {
            self::unlock($lock);
        }
    }
    public static function restore($input)
    {
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            if (
                empty($job['activated']) ||
                empty($job['previous_setup']) ||
                empty($job['applied_setup'])
            ) {
                throw new RuntimeException(
                    'There is no applied site setup to restore.',
                );
            }
            self::restore_setup($job);
            self::store($job);
            return self::status($input);
        } finally {
            self::unlock($lock);
        }
    }
}
