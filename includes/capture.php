<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Administrator-only public website capture, checkpointed between small requests. */
final class LSE_Capture
{
    private static function url($value, $base = '')
    {
        if (!is_string($value) || strlen($value) > 2048) {
            return '';
        }
        $value = html_entity_decode(
            trim($value),
            ENT_QUOTES | ENT_HTML5,
            'UTF-8',
        );
        if (
            $value === '' ||
            $value[0] === '#' ||
            preg_match('~^(?:data|javascript|mailto|tel|file):~i', $value)
        ) {
            return '';
        }
        if ($base) {
            $value = WP_Http::make_absolute_url($value, $base);
        }
        $value = preg_replace('/#.*$/s', '', $value);
        $p = wp_parse_url($value);
        if (
            !$p ||
            !in_array(
                strtolower($p['scheme'] ?? ''),
                ['http', 'https'],
                true,
            ) ||
            empty($p['host']) ||
            isset($p['user']) ||
            isset($p['pass']) ||
            !in_array((int) ($p['port'] ?? 443), [80, 443], true)
        ) {
            return '';
        }
        $scheme = strtolower($p['scheme']);
        $port = (int) ($p['port'] ?? ($scheme === 'https' ? 443 : 80));
        $segments = explode('/', $p['path'] ?? '/');
        $normalized = [];
        foreach ($segments as $index => $segment) {
            $dot = strtolower(str_replace('%2e', '.', strtolower($segment)));
            if ($dot === '.' || $dot === '..') {
                if ($dot === '..' && count($normalized) > 1) {
                    array_pop($normalized);
                }
                if ($index === count($segments) - 1) {
                    $normalized[] = '';
                }
            } else {
                $normalized[] = $segment;
            }
        }
        $path = '/' . ltrim(implode('/', $normalized), '/');
        $path = preg_replace_callback(
            '/[^\x21-\x7e]|[<>"{}|\\\\^`]/u',
            static fn($m) => rawurlencode($m[0]),
            $path,
        );
        return $scheme .
            '://' .
            strtolower($p['host']) .
            ($port === ($scheme === 'https' ? 443 : 80) ? '' : ':' . $port) .
            $path .
            (isset($p['query']) ? '?' . $p['query'] : '');
    }
    private static function safe($url)
    {
        $host = wp_parse_url($url, PHP_URL_HOST);
        $ip = $host ? gethostbyname($host) : '';
        if (
            !$host ||
            !filter_var(
                $ip,
                FILTER_VALIDATE_IP,
                FILTER_FLAG_IPV4 |
                    FILTER_FLAG_NO_PRIV_RANGE |
                    FILTER_FLAG_NO_RES_RANGE,
            ) ||
            !wp_http_validate_url($url)
        ) {
            throw new RuntimeException(
                'Capture requires a public HTTP or HTTPS address on port 80 or 443.',
            );
        }
    }
    private static function origin($url)
    {
        $p = wp_parse_url($url);
        return strtolower(
            ($p['scheme'] ?? '') .
                '://' .
                ($p['host'] ?? '') .
                ':' .
                ($p['port'] ?? (($p['scheme'] ?? '') === 'https' ? 443 : 80)),
        );
    }
    private static function key($id)
    {
        return 'lse_capture_' . get_current_user_id() . '_' . $id;
    }
    private static function load($input)
    {
        $id = $input['capture'] ?? '';
        if (!is_string($id) || !preg_match('/^[a-f0-9]{32}$/D', $id)) {
            throw new RuntimeException('Invalid capture session.');
        }
        $job = get_transient(self::key($id));
        if (!is_array($job)) {
            throw new RuntimeException(
                'Capture expired. Start again from the website link.',
            );
        }
        return [$id, $job];
    }
    public static function capture_start($input)
    {
        if (!class_exists('DOMDocument')) {
            throw new RuntimeException(
                'Website capture needs the PHP DOM extension. Use the Desktop capture option on this host.',
            );
        }
        $url = self::url($input['url'] ?? '');
        self::safe($url);
        $id = bin2hex(random_bytes(16));
        $job = [
            'source' => $url,
            'origin' => self::origin($url),
            'queue' => [['url' => $url, 'kind' => 'page', 'depth' => 0]],
            'seen' => [$url => true],
            'pages' => 1,
            'maxPages' => isset($input['pages'])
                ? max(1, (int) $input['pages'])
                : 0,
            'depth' => isset($input['depth'])
                ? max(0, (int) $input['depth'])
                : null,
            'seq' => 0,
            'bytes' => 0,
            'warnings' => [],
            'truncated' => false,
        ];
        // One live capture per administrator. Starting afresh discards only crawl metadata.
        $previous = get_user_meta(get_current_user_id(), '_lse_capture', true);
        if (
            is_string($previous) &&
            preg_match('/^[a-f0-9]{32}$/D', $previous)
        ) {
            self::remove_batch($previous);
            delete_transient(self::key($previous));
        }
        set_transient(self::key($id), $job, HOUR_IN_SECONDS);
        update_user_meta(get_current_user_id(), '_lse_capture', $id);
        return ['capture' => $id, 'source' => $url, 'seq' => 0];
    }
    private static function enqueue(
        &$job,
        $value,
        $base,
        $kind,
        $depth,
        $role = '',
    ) {
        $url = self::url($value, $base);
        if (!$url || isset($job['seen'][$url])) {
            return;
        }
        if (
            $kind === 'asset' &&
            preg_match(
                '~(?:/(?:wp-includes/js/(?:jquery|dist)/|wp-content/plugins/elementor(?:-pro)?/).*\.js|/jquery(?:-[0-9.]+)?(?:\.min)?\.js)(?:\?|$)~i',
                $url,
            )
        ) {
            return;
        }
        if ($kind === 'page') {
            if (self::origin($url) !== $job['origin']) {
                return;
            }
            if (
                ($job['depth'] !== null && $depth > $job['depth']) ||
                ($job['maxPages'] && $job['pages'] >= $job['maxPages'])
            ) {
                $job['truncated'] = true;
                return;
            }
            if (
                preg_match(
                    '~\.(?:zip|pdf|xml|json|docx?|xlsx?|jpe?g|png|gif|webp|svg|mp[34]|webm)(?:\?|$)~i',
                    $url,
                )
            ) {
                return;
            }
            ++$job['pages'];
        }
        $job['seen'][$url] = true;
        $job['queue'][] = [
            'url' => $url,
            'kind' => $kind,
            'depth' => $depth,
            'role' => $role,
            'attempt' => 0,
        ];
    }
    private static function css(&$job, $css, $base)
    {
        // Consume quoted strings/comments as tokens. Parentheses inside quoted URLs are data.
        $pattern = '~ /\*[\s\S]*?\*/ (*SKIP)(*F)
          | @import\s* (?: url\(\s* (?: "((?:\\\\[\s\S]|[^"\\\\])*)" | \'((?:\\\\[\s\S]|[^\'\\\\])*)\' | ((?:\\\\[\s\S]|[^)"\'])*) )\s*\) | "((?:\\\\[\s\S]|[^"\\\\])*)" | \'((?:\\\\[\s\S]|[^\'\\\\])*)\' )
          | \burl\(\s* (?: "((?:\\\\[\s\S]|[^"\\\\])*)" | \'((?:\\\\[\s\S]|[^\'\\\\])*)\' | ((?:\\\\[\s\S]|[^)"\'])*) )\s*\)
          | "(?:\\\\[\s\S]|[^"\\\\])*" (*SKIP)(*F) | \'(?:\\\\[\s\S]|[^\'\\\\])*\' (*SKIP)(*F) ~ix';
        preg_match_all($pattern, $css, $matches, PREG_SET_ORDER);
        foreach ($matches as $match) {
            $value = '';
            foreach (array_slice($match, 1) as $part) {
                if ($part !== '') {
                    $value = $part;
                    break;
                }
            }
            $value = preg_replace_callback(
                '/\\\\([0-9a-f]{1,6}\s?|[\s\S])/i',
                static function ($m) {
                    if (ctype_xdigit(trim($m[1]))) {
                        return html_entity_decode(
                            '&#' . hexdec(trim($m[1])) . ';',
                            ENT_NOQUOTES,
                            'UTF-8',
                        );
                    }
                    return preg_match('/[\r\n\f]/', $m[1]) ? '' : $m[1];
                },
                trim($value),
            );
            self::enqueue(
                $job,
                $value,
                $base,
                'asset',
                0,
                str_starts_with(strtolower($match[0]), '@import')
                    ? 'stylesheet'
                    : '',
            );
        }
    }
    private static function discover(&$job, $body, $type, $url, $item)
    {
        if ($type === 'text/css') {
            self::css($job, $body, $url);
            return;
        }
        if ($type !== 'text/html' || $item['kind'] !== 'page') {
            return;
        }
        $dom = new DOMDocument();
        $old = libxml_use_internal_errors(true);
        try {
            $dom->loadHTML(
                '<?xml encoding="UTF-8">' . $body,
                LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING,
            );
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($old);
        }
        $base = $url;
        $bases = $dom->getElementsByTagName('base');
        if ($bases->length) {
            $base =
                self::url($bases->item(0)->getAttribute('href'), $url) ?: $url;
        }
        // Queue files before linked pages so a page limit never starves its styles or images.
        foreach ($dom->getElementsByTagName('*') as $el) {
            $tag = strtolower($el->tagName);
            if ($tag === 'style') {
                self::css($job, $el->textContent, $base);
            }
            foreach (
                [
                    'data-thumbnail',
                    'data-bg',
                    'data-background',
                    'data-lazy-background-image',
                ]
                as $attr
            ) {
                self::enqueue(
                    $job,
                    $el->getAttribute($attr),
                    $base,
                    'asset',
                    0,
                );
            }
            if ($el->hasAttribute('data-settings')) {
                $settings = json_decode(
                    $el->getAttribute('data-settings'),
                    true,
                );
                foreach (
                    is_array($settings) ? $settings : []
                    as $name => $value
                ) {
                    if (
                        preg_match(
                            '/^background(?:_overlay)?_slideshow_gallery$/D',
                            $name,
                        ) &&
                        is_array($value)
                    ) {
                        foreach ($value as $slide) {
                            self::enqueue(
                                $job,
                                $slide['url'] ?? '',
                                $base,
                                'asset',
                                0,
                            );
                        }
                    }
                    if (
                        preg_match(
                            '/^background(?:_overlay)?_image(?:_tablet|_mobile)?$/D',
                            $name,
                        ) &&
                        is_array($value)
                    ) {
                        self::enqueue(
                            $job,
                            $value['url'] ?? '',
                            $base,
                            'asset',
                            0,
                        );
                    }
                }
            }
            if ($el->hasAttribute('style')) {
                self::css($job, $el->getAttribute('style'), $base);
            }
            if (
                in_array(
                    $tag,
                    ['img', 'script', 'source', 'video', 'audio'],
                    true,
                )
            ) {
                foreach (
                    [
                        'src',
                        'poster',
                        'data-src',
                        'data-lazy-src',
                        'data-original',
                    ]
                    as $attr
                ) {
                    self::enqueue(
                        $job,
                        $el->getAttribute($attr),
                        $base,
                        'asset',
                        0,
                    );
                }
                foreach (['srcset', 'data-srcset'] as $attr) {
                    foreach (
                        explode(',', $el->getAttribute($attr))
                        as $candidate
                    ) {
                        self::enqueue(
                            $job,
                            preg_split('/\s+/', trim($candidate))[0],
                            $base,
                            'asset',
                            0,
                        );
                    }
                }
            }
            if (in_array($tag, ['use', 'image'], true)) {
                foreach (['href', 'xlink:href'] as $attr) {
                    self::enqueue(
                        $job,
                        $el->getAttribute($attr),
                        $base,
                        'asset',
                        0,
                    );
                }
            }
            if (
                $tag === 'link' &&
                preg_match(
                    '/(?:^|\s)(?:stylesheet|icon|preload)(?:\s|$)/i',
                    $el->getAttribute('rel'),
                )
            ) {
                self::enqueue(
                    $job,
                    $el->getAttribute('href'),
                    $base,
                    'asset',
                    0,
                    str_contains($el->getAttribute('rel'), 'stylesheet')
                        ? 'stylesheet'
                        : '',
                );
            }
        }
        foreach ($dom->getElementsByTagName('a') as $a) {
            self::enqueue(
                $job,
                $a->getAttribute('href'),
                $base,
                'page',
                $item['depth'] + 1,
            );
        }
    }
    public static function capture_step($input)
    {
        [$id, $job] = self::load($input);
        $lock = LSE_Locks::acquire(self::key($id) . '_lock', 90);
        try {
            // Re-read after acquiring the lock. Only an acknowledged response advances the queue.
            [, $job] = self::load($input);
            $seq = $input['seq'] ?? -1;
            if (
                !is_int($seq) ||
                ($seq !== $job['seq'] && $seq !== $job['seq'] + 1)
            ) {
                throw new RuntimeException(
                    'Capture sequence changed. Start the capture again.',
                );
            }
            if ($seq === $job['seq'] + 1) {
                if (!isset($job['pending'])) {
                    throw new RuntimeException(
                        'No capture response is awaiting acknowledgement.',
                    );
                }
                unset($job['queue'][array_key_first($job['queue'])]);
                $job['bytes'] += $job['pending'];
                unset($job['pending']);
                $job['seq'] = $seq;
            }
            if (!$job['queue']) {
                set_transient(self::key($id), $job, HOUR_IN_SECONDS);
                return [
                    'done' => true,
                    'seq' => $job['seq'],
                    'warnings' => $job['warnings'],
                    'truncated' => $job['truncated'],
                    'failed_resources' => array_values(
                        $job['failed_resources'] ?? [],
                    ),
                ];
            }
            $item = reset($job['queue']);
            $url = $item['url'];
            $record = null;
            $size = 0;
            $transient_failure = false;
            $code = 0;
            try {
                for ($redirect = 0; $redirect <= 3; ++$redirect) {
                    self::safe($url);
                    if (
                        $item['kind'] === 'page' &&
                        $job['seq'] > 0 &&
                        self::origin($url) !== $job['origin']
                    ) {
                        throw new RuntimeException(
                            'A linked page redirected outside the captured website.',
                        );
                    }
                    $response = wp_safe_remote_get($url, [
                        'timeout' => 6,
                        'redirection' => 0,
                        'cookies' => [],
                        'user-agent' => 'LittleStudioCapture/' . LSE_VERSION,
                        'headers' => ['Accept' => '*/*'],
                    ]);
                    if (is_wp_error($response)) {
                        $transient_failure = true;
                        throw new RuntimeException(
                            $response->get_error_message(),
                        );
                    }
                    $code = wp_remote_retrieve_response_code($response);
                    if (!in_array($code, [301, 302, 303, 307, 308], true)) {
                        break;
                    }
                    $url = self::url(
                        wp_remote_retrieve_header($response, 'location'),
                        $url,
                    );
                    if (!$url || $redirect === 3) {
                        throw new RuntimeException(
                            'Unsupported or excessive redirects.',
                        );
                    }
                }
                if ($code < 200 || $code >= 300) {
                    $transient_failure = in_array(
                        $code,
                        [408, 425, 429, 500, 502, 503, 504],
                        true,
                    );
                    throw new RuntimeException('HTTP ' . $code);
                }
                $body = wp_remote_retrieve_body($response);
                $size = strlen($body);
                $header = wp_remote_retrieve_header($response, 'content-type');
                $type = strtolower(trim(explode(';', $header)[0]));
                if ($type === 'application/xhtml+xml') {
                    $type = 'text/html';
                }
                if (!$type) {
                    $type =
                        $item['kind'] === 'page'
                            ? 'text/html'
                            : (wp_check_filetype(
                                wp_parse_url($url, PHP_URL_PATH),
                            )['type'] ?:
                            'application/octet-stream');
                }
                if ($item['kind'] === 'page' && $type !== 'text/html') {
                    throw new RuntimeException(
                        'The linked address did not return an HTML page.',
                    );
                }
                if ($item['kind'] === 'page' && $job['seq'] === 0) {
                    $job['origin'] = self::origin($url);
                }
                preg_match(
                    '/charset\s*=\s*["\']?([\w-]+)/i',
                    $header,
                    $charset,
                );
                $text =
                    str_starts_with($type, 'text/') ||
                    str_contains($type, 'javascript');
                $utf8 =
                    $text && function_exists('mb_convert_encoding')
                        ? mb_convert_encoding(
                            $body,
                            'UTF-8',
                            $charset[1] ?? 'UTF-8',
                        )
                        : $body;
                $job['seen'][$url] = true;
                if ($text) {
                    self::discover($job, $utf8, $type, $url, $item);
                }
                $record = [
                    'url' => $url,
                    'requested' => $item['url'],
                    'kind' => $item['kind'],
                    'type' => $type,
                    'data' => base64_encode($text ? $utf8 : $body),
                ];
            } catch (Throwable $e) {
                $attempt = (int) ($item['attempt'] ?? 0);
                if ($transient_failure && $attempt < 2) {
                    $item['attempt'] = $attempt + 1;
                    $job['queue'][] = $item;
                    // Bounded backoff; the retry itself still revalidates every public URL/redirect.
                    usleep(100000 * 2 ** $attempt);
                } else {
                    if (
                        $item['url'] === $job['source'] &&
                        $item['kind'] === 'page'
                    ) {
                        throw new RuntimeException(
                            'The starting page could not be captured: ' .
                                $e->getMessage(),
                        );
                    }
                    $job['warnings'][$item['url']] =
                        'Could not package ' .
                        $item['url'] .
                        ': ' .
                        $e->getMessage();
                    $job['failed_resources'][$item['url']] = [
                        'url' => $item['url'],
                        'kind' => $item['kind'],
                        'role' => $item['role'] ?? '',
                        'error' => $e->getMessage(),
                        'status' => $code,
                    ];
                }
                $size = 0;
            }
            $job['pending'] = $size;
            set_transient(self::key($id), $job, HOUR_IN_SECONDS);
            return [
                'done' => false,
                'seq' => $job['seq'] + 1,
                'record' => $record,
                'remaining' => count($job['queue']) - 1,
                'message' =>
                    'Captured ' .
                    ($job['seq'] + 1) .
                    ' resources; ' .
                    (count($job['queue']) - 1) .
                    ' queued.',
            ];
        } finally {
            LSE_Locks::release($lock);
        }
    }
    private static function batch_key($id)
    {
        return self::key($id) . '_batch';
    }
    private static function remove_batch($id)
    {
        $batch = get_transient(self::batch_key($id));
        if (
            is_array($batch) &&
            !empty($batch['file']) &&
            str_starts_with(basename($batch['file']), 'lse-capture-')
        ) {
            wp_delete_file($batch['file']);
        }
        delete_transient(self::batch_key($id));
    }
    public static function cleanup_batch($user, $id, $file)
    {
        if (
            !is_string($file) ||
            !str_starts_with(basename($file), 'lse-capture-')
        ) {
            return;
        }
        $active = get_transient(
            'lse_capture_' . (int) $user . '_' . $id . '_batch',
        );
        if (is_array($active) && ($active['file'] ?? '') === $file) {
            wp_schedule_single_event(
                time() + HOUR_IN_SECONDS,
                'lse_capture_cleanup',
                [$user, $id, $file],
            );
        } else {
            wp_delete_file($file);
        }
    }
    private static function read_checkpoint($file)
    {
        if (!is_file($file)) {
            return null;
        }
        $stream = fopen($file, 'rb');
        if (!$stream) {
            return null;
        }
        try {
            $line = fgets($stream);
            $result = is_string($line) ? json_decode($line, true) : null;
            if (!is_array($result)) {
                return null;
            }
            while (($line = fgets($stream)) !== false) {
                // A process killed during an append leaves the preceding complete record replayable.
                if (!str_ends_with($line, "\n")) {
                    break;
                }
                $step = json_decode($line, true);
                if (!is_array($step)) {
                    return null;
                }
                if (!empty($step['record'])) {
                    $result['records'][] = $step['record'];
                }
                $result['message'] =
                    $step['message'] ?? 'Website capture complete.';
                foreach (
                    [
                        'seq',
                        'done',
                        'message',
                        'warnings',
                        'truncated',
                        'failed_resources',
                    ]
                    as $field
                ) {
                    if (array_key_exists($field, $step)) {
                        $result[$field] = $step[$field];
                    }
                }
            }
            return $result;
        } finally {
            fclose($stream);
        }
    }
    public static function capture_batch($input)
    {
        [$id] = self::load($input);
        $seq = $input['seq'] ?? -1;
        if (!is_int($seq) || $seq < 0) {
            throw new RuntimeException('Invalid capture sequence.');
        }
        $lock = LSE_Locks::acquire(self::batch_key($id) . '_lock', 90);
        try {
            $cache = get_transient(self::batch_key($id));
            $result = null;
            if (is_array($cache)) {
                $previous = self::read_checkpoint($cache['file']);
                if (!is_array($previous)) {
                    throw new RuntimeException(
                        'The temporary capture cache is unavailable. Restart the capture.',
                    );
                }
                if (
                    $seq === $previous['from'] &&
                    ($previous['seq'] > $seq || $previous['done'])
                ) {
                    return $previous;
                }
                if ($seq !== $previous['seq']) {
                    throw new RuntimeException(
                        'Capture sequence changed. Start the capture again.',
                    );
                }
                $file = $cache['file'];
            } else {
                require_once ABSPATH . 'wp-admin/includes/file.php';
                $file = wp_tempnam('lse-capture-' . $id);
                if (!$file) {
                    throw new RuntimeException(
                        'The host could not create a private capture cache. Use Desktop capture.',
                    );
                }
                chmod($file, 0600);
                wp_schedule_single_event(
                    time() + HOUR_IN_SECONDS,
                    'lse_capture_cleanup',
                    [get_current_user_id(), $id, $file],
                );
            }
            $result = [
                'from' => $seq,
                'seq' => $seq,
                'records' => [],
                'done' => false,
                'message' => 'Capturing website…',
            ];
            // Persist an empty checkpoint before fetching. Every delivered resource has a replay copy
            // before the next one is acknowledged, including if PHP stops between resources.
            if (
                file_put_contents(
                    $file,
                    wp_json_encode($result) . "\n",
                    LOCK_EX,
                ) === false
            ) {
                throw new RuntimeException(
                    'The capture cache could not be written.',
                );
            }
            set_transient(
                self::batch_key($id),
                ['file' => $file],
                HOUR_IN_SECONDS,
            );
            $started = microtime(true);
            $bytes = 0;
            $budget = LSE_Importer::batch_seconds();
            for ($i = 0; $i < 32; ++$i) {
                $step = self::capture_step([
                    'capture' => $id,
                    'seq' => $result['seq'],
                ]);
                $result['seq'] = $step['seq'];
                $result['done'] = $step['done'];
                if (!empty($step['record'])) {
                    $result['records'][] = $step['record'];
                    $bytes += strlen($step['record']['data']);
                }
                $result['message'] =
                    $step['message'] ?? 'Website capture complete.';
                if ($step['done']) {
                    $result['warnings'] = $step['warnings'];
                    $result['truncated'] = $step['truncated'];
                    $result['failed_resources'] =
                        $step['failed_resources'] ?? [];
                }
                if (
                    file_put_contents(
                        $file,
                        wp_json_encode($step) . "\n",
                        FILE_APPEND | LOCK_EX,
                    ) === false
                ) {
                    throw new RuntimeException(
                        'The capture checkpoint could not be saved. Restart the capture.',
                    );
                }
                if (
                    $step['done'] ||
                    $bytes >= 4 * MB_IN_BYTES ||
                    microtime(true) - $started >= $budget
                ) {
                    break;
                }
            }
            return $result;
        } finally {
            LSE_Locks::release($lock);
        }
    }
    public static function capture_cancel($input)
    {
        [$id] = self::load($input);
        self::remove_batch($id);
        delete_transient(self::key($id));
        return ['cancelled' => true];
    }
}

add_action('lse_capture_cleanup', ['LSE_Capture', 'cleanup_batch'], 10, 3);
