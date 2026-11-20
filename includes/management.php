<?php
if (!defined('ABSPATH')) {
    exit();
}

trait LSE_Management
{
    public static function remove_import($input)
    {
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            if (empty($input['consent'])) {
                throw new RuntimeException(
                    'Confirm removing this whole import first.',
                );
            }
            if (!EMPTY_TRASH_DAYS) {
                throw new RuntimeException(
                    'WordPress Trash is disabled. No imported content was removed.',
                );
            }
            // Check every page before changing anything, including edited or published pages.
            foreach ($job['pages'] as $page) {
                if (!get_post($page['id'])) {
                    continue;
                }
                [, , $post] = self::managed_page($job, $page['key']);
                self::expected_page(
                    $post,
                    $input['expected_stamps'][$page['key']] ?? '',
                );
                if (!current_user_can('delete_post', $post->ID)) {
                    throw new RuntimeException(
                        'Your account cannot remove every page in this import. Nothing was removed.',
                    );
                }
            }
            if (!empty($job['activated'])) {
                self::restore_setup($job);
            }
            $removed = [];
            $kept = [];
            foreach ($job['pages'] as $page) {
                if (
                    !get_post($page['id']) ||
                    get_post_status($page['id']) === 'trash'
                ) {
                    continue;
                }
                if (wp_trash_post($page['id'])) {
                    $removed[] = $page['id'];
                } else {
                    $kept[] = $page['id'];
                }
            }
            $retained_templates = [];
            $removed_templates = [];
            $deleted_assets = [];
            $kept_assets = [];
            $failed_assets = [];
            if (!$kept) {
                foreach ($job['templates'] ?? [] as $template) {
                    $id = (int) $template['id'];
                    if (!get_post($id)) {
                        continue;
                    }
                    if (
                        get_post_meta($id, '_lse_job', true) !== $job['id'] ||
                        self::template_used_elsewhere(
                            $id,
                            array_column($job['pages'], 'id'),
                        ) ||
                        !current_user_can('delete_post', $id)
                    ) {
                        $retained_templates[] = $id;
                        continue;
                    }
                    if (
                        get_post_status($id) !== 'trash' &&
                        get_post($id) &&
                        !wp_trash_post($id)
                    ) {
                        $retained_templates[] = $id;
                    } else {
                        $removed_templates[] = $id;
                    }
                }
                if (
                    !empty($job['menu']) &&
                    !self::menu_used_elsewhere(
                        (int) $job['menu'],
                        array_merge(
                            array_column($job['pages'], 'id'),
                            $removed_templates,
                        ),
                    )
                ) {
                    $result = wp_delete_nav_menu($job['menu']);
                    if (!is_wp_error($result) && $result) {
                        $job['menu'] = 0;
                    }
                }
                [
                    $deleted_assets,
                    $kept_assets,
                    $failed_assets,
                ] = self::remove_import_assets(
                    $job,
                    array_merge(
                        array_column($job['pages'], 'id'),
                        $removed_templates,
                    ),
                );
            }
            $job['state'] =
                $kept || $failed_assets ? 'partly-removed' : 'removed';
            $job['cleanup'] = [
                'removed' => $removed,
                'kept' => $kept,
                'templates_kept' => $retained_templates,
                'assets_removed' => $deleted_assets,
                'assets_kept' => $kept_assets,
                'assets_failed' => $failed_assets,
            ];
            self::store($job);
            if (
                $job['state'] === 'removed' &&
                get_user_meta(get_current_user_id(), '_lse_last_job', true) ===
                    $job['id']
            ) {
                delete_user_meta(get_current_user_id(), '_lse_last_job');
            }
            return self::status(['job' => $job['id']]);
        } finally {
            self::unlock($lock);
        }
    }
    private static function menu_used_elsewhere($id, $excluded)
    {
        global $wpdb;
        if (
            in_array($id, array_map('intval', get_nav_menu_locations()), true)
        ) {
            return true;
        }
        foreach ((array) get_option('widget_nav_menu', []) as $widget) {
            if (is_array($widget) && (int) ($widget['nav_menu'] ?? 0) === $id) {
                return true;
            }
        }
        $exclude = implode(
            ',',
            array_map('intval', array_merge([0], $excluded)),
        );
        $data = $wpdb->get_col(
            $wpdb->prepare(
                "SELECT meta_value FROM {$wpdb->postmeta} WHERE post_id NOT IN ($exclude) AND meta_key = '_elementor_data' AND meta_value LIKE %s",
                '%' . $wpdb->esc_like('"menu"') . '%',
            ),
        );
        if ($wpdb->last_error) {
            return true;
        }
        foreach ($data as $value) {
            if (preg_match('/"menu"\s*:\s*"?' . $id . '"?\s*[,}]/', $value)) {
                return true;
            }
        }
        return false;
    }
    private static function remove_import_assets($job, $excluded)
    {
        global $wpdb;
        $owned = get_posts([
            'post_type' => 'attachment',
            'post_status' => ['inherit', 'publish', 'private', 'trash'],
            'posts_per_page' => -1,
            'fields' => 'ids',
            'meta_key' => '_lse_job',
            'meta_value' => $job['id'],
        ]);
        $ids = array_values(
            array_unique(
                array_map(
                    'intval',
                    array_merge(
                        $owned,
                        array_column($job['assets'] ?? [], 'id'),
                    ),
                ),
            ),
        );
        if (!$ids) {
            return [[], [], []];
        }
        // Older imports have asset IDs in their saved jobs instead of attachment metadata.
        $shared = [];
        $names = $wpdb->get_col(
            $wpdb->prepare(
                "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s AND LENGTH(option_name) = 41",
                $wpdb->esc_like('_lse_job_') . '%',
            ),
        );
        foreach ($names as $name) {
            if ($name === self::key($job['id'])) {
                continue;
            }
            $other = get_option($name);
            if (!is_array($other)) {
                continue;
            }
            if (($other['state'] ?? '') === 'removed') {
                foreach (
                    array_merge(
                        array_column($other['pages'] ?? [], 'id'),
                        array_column($other['templates'] ?? [], 'id'),
                    )
                    as $document
                ) {
                    if (get_post_status($document) === 'trash') {
                        $excluded[] = (int) $document;
                    }
                }
                continue;
            }
            foreach ($other['assets'] ?? [] as $asset) {
                $shared[(int) $asset['id']] = true;
            }
        }
        $gallery_ids = self::gallery_attachment_ids($excluded);
        if ($gallery_ids === null) {
            return [[], [], $ids];
        }
        $deleted = [];
        $kept = [];
        $failed = [];
        foreach ($ids as $id) {
            if (get_post_type($id) !== 'attachment') {
                continue;
            }
            try {
                $asset_lock = LSE_Locks::acquire('_lse_attachment_' . $id);
            } catch (RuntimeException $error) {
                $failed[] = $id;
                continue;
            }
            try {
                $owner = get_post_meta($id, '_lse_job', true);
                $can_remove = $owner === $job['id'];
                if (
                    !$can_remove &&
                    is_string($owner) &&
                    preg_match('/^[a-f0-9]{32}$/D', $owner)
                ) {
                    $original = get_option(self::key($owner));
                    $can_remove = ($original['state'] ?? '') === 'removed';
                }
                if (
                    !$can_remove ||
                    isset($shared[$id]) ||
                    isset($gallery_ids[$id]) ||
                    !current_user_can('delete_post', $id) ||
                    self::attachment_used_elsewhere($id, $job['id'], $excluded)
                ) {
                    $kept[] = $id;
                } elseif (wp_delete_attachment($id, true)) {
                    $deleted[] = $id;
                } else {
                    $failed[] = $id;
                }
            } finally {
                LSE_Locks::release($asset_lock);
            }
        }
        return [$deleted, $kept, $failed];
    }
    private static function attachment_used_elsewhere($id, $job_id, $excluded)
    {
        global $wpdb;
        if (
            $id === (int) get_option('site_icon') ||
            $id === (int) get_theme_mod('custom_logo')
        ) {
            return true;
        }
        $parent = (int) wp_get_post_parent_id($id);
        if (
            $parent &&
            !in_array($parent, $excluded, true) &&
            get_post($parent)
        ) {
            return true;
        }
        foreach (get_post_meta($id, '_lse_asset_job') as $reference) {
            if (
                $reference === $job_id ||
                !is_string($reference) ||
                !preg_match('/^[a-f0-9]{32}$/D', $reference)
            ) {
                continue;
            }
            $other = get_option(self::key($reference));
            if (is_array($other) && ($other['state'] ?? '') !== 'removed') {
                return true;
            }
        }
        // Check normal WordPress, block, and Elementor references, including resized URLs.
        $file = (string) get_post_meta($id, '_wp_attached_file', true);
        $needles = [
            'wp-image-' . $id,
            '"id":' . $id . ',',
            '"id":' . $id . '}',
            '"id":"' . $id . '"',
            'attachment_id=' . $id,
        ];
        if ($file !== '') {
            $metadata = (array) wp_get_attachment_metadata($id);
            $variants = array_column($metadata['sizes'] ?? [], 'file');
            if (!empty($metadata['original_image'])) {
                $variants[] = $metadata['original_image'];
            }
            $files = array_merge(
                [$file],
                array_map(
                    static fn($name) => trailingslashit(dirname($file)) . $name,
                    $variants,
                ),
            );
            foreach ($files as $path) {
                $needles[] = $path;
                $needles[] = str_replace('/', '\/', $path);
            }
            $needles = array_values(array_unique($needles));
        }
        $exclude = implode(
            ',',
            array_map('intval', array_merge([$id], $excluded)),
        );
        $where = static function ($column) use ($wpdb, $needles) {
            return implode(
                ' OR ',
                array_map(
                    static fn($needle) => $wpdb->prepare(
                        "$column LIKE %s",
                        '%' . $wpdb->esc_like($needle) . '%',
                    ),
                    $needles,
                ),
            );
        };
        $queries = [
            "SELECT ID FROM {$wpdb->posts} WHERE ID NOT IN ($exclude) AND post_type <> 'revision' AND (" .
            $where('post_content') .
            ') LIMIT 1',
            "SELECT post_id FROM {$wpdb->postmeta} WHERE post_id NOT IN ($exclude) AND meta_key NOT IN ('_lse_save_before', '_lse_refresh_backup', '_wp_attached_file', '_wp_attachment_metadata') AND (" .
            $where('meta_value') .
            ') LIMIT 1',
            $wpdb->prepare(
                "SELECT post_id FROM {$wpdb->postmeta} WHERE post_id NOT IN ($exclude) AND meta_key = '_thumbnail_id' AND meta_value = %s LIMIT 1",
                (string) $id,
            ),
            "SELECT option_id FROM {$wpdb->options} WHERE (option_name LIKE 'widget_%' OR option_name LIKE 'theme_mods_%') AND (" .
            $where('option_value') .
            ') LIMIT 1',
        ];
        foreach ($queries as $query) {
            if ($wpdb->get_var($query) || $wpdb->last_error) {
                return true;
            }
        }
        return false;
    }
    private static function gallery_attachment_ids($excluded)
    {
        global $wpdb;
        $exclude = implode(
            ',',
            array_map('intval', array_merge([0], $excluded)),
        );
        $contents = $wpdb->get_col(
            $wpdb->prepare(
                "SELECT post_content FROM {$wpdb->posts} WHERE ID NOT IN ($exclude) AND post_type <> 'revision' AND (post_content LIKE %s OR post_content LIKE %s)",
                '%[gallery%',
                '%"ids"%',
            ),
        );
        if ($wpdb->last_error) {
            return null;
        }
        $ids = [];
        foreach ($contents as $content) {
            preg_match_all(
                '/(?:\[gallery[^\]]*\bids\s*=\s*["\']|"ids"\s*:\s*\[)([\d,\s]+)/i',
                $content,
                $matches,
            );
            foreach ($matches[1] as $list) {
                foreach (explode(',', $list) as $id) {
                    $ids[(int) $id] = true;
                }
            }
        }
        $galleries = $wpdb->get_col(
            "SELECT meta_value FROM {$wpdb->postmeta} WHERE post_id NOT IN ($exclude) AND meta_key = '_product_image_gallery'",
        );
        if ($wpdb->last_error) {
            return null;
        }
        foreach ($galleries as $gallery) {
            foreach (explode(',', $gallery) as $id) {
                $ids[(int) $id] = true;
            }
        }
        return $ids;
    }
    private static function template_used_elsewhere($template, $imported_pages)
    {
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT post_id, meta_key, meta_value FROM {$wpdb->postmeta} WHERE meta_key IN ('_elementor_data', '_lse_source') AND meta_value LIKE %s",
                '%' . $wpdb->esc_like((string) $template) . '%',
            ),
        );
        $contains = static function ($nodes) use (&$contains, $template) {
            foreach (is_array($nodes) ? $nodes : [] as $node) {
                if (
                    (int) ($node['settings']['template_id'] ?? 0) ===
                        $template ||
                    $contains($node['elements'] ?? [])
                ) {
                    return true;
                }
            }
            return false;
        };
        foreach ($rows as $row) {
            if (
                !in_array((int) $row->post_id, $imported_pages, true) &&
                !in_array(
                    get_post_status($row->post_id),
                    [false, 'trash'],
                    true,
                ) &&
                ($row->meta_key === '_lse_source'
                    ? in_array(
                        $template,
                        array_map(
                            'intval',
                            array_column(
                                maybe_unserialize($row->meta_value)[
                                    'site_parts'
                                ] ?? [],
                                'template_id',
                            ),
                        ),
                        true,
                    )
                    : $contains(json_decode($row->meta_value, true)))
            ) {
                return true;
            }
        }
        return false;
    }
    private static function restore_setup(&$job)
    {
        if (empty($job['previous_setup']) || empty($job['applied_setup'])) {
            return;
        }
        $old = $job['previous_setup'];
        $applied = $job['applied_setup'];
        $kept = [];
        if (
            (string) get_option('page_on_front') ===
                (string) $applied['page_on_front'] &&
            get_option('show_on_front') === $applied['show_on_front']
        ) {
            update_option('page_on_front', $old['page_on_front']);
            update_option('show_on_front', $old['show_on_front']);
        } else {
            $kept[] = 'Homepage settings changed since import and were kept.';
        }
        if (
            get_stylesheet() === $old['theme'] &&
            get_theme_mod('nav_menu_locations', []) === $applied['locations']
        ) {
            set_theme_mod('nav_menu_locations', $old['locations']);
        } else {
            $kept[] =
                'Theme or menu assignments changed since import and were kept.';
        }
        $job['activated'] = false;
        $job['restoration'] = $kept ?: [
            'Previous homepage and menu assignments restored.',
        ];
    }
    private static function managed_page($job, $key)
    {
        $index = array_search($key, array_column($job['pages'], 'key'), true);
        if ($index === false) {
            throw new RuntimeException(
                'This page does not belong to the selected import.',
            );
        }
        $page = $job['pages'][$index];
        $post = get_post($page['id']);
        if (
            !$post ||
            $post->post_type !== 'page' ||
            get_post_meta($post->ID, '_lse_job', true) !== $job['id'] ||
            get_post_meta($post->ID, '_lse_source_key', true) !== $key ||
            !current_user_can('edit_post', $post->ID)
        ) {
            throw new RuntimeException(
                'The imported page is missing or is not editable by your account.',
            );
        }
        return [$index, $page, $post];
    }
    private static function shared_stamps($id, &$cache = null)
    {
        $tree = json_decode(
            get_post_meta($id, '_elementor_data', true) ?: '[]',
            true,
        );
        $stamps = [];
        $cache = $cache ?? [];
        $walk = static function ($nodes) use (&$walk, &$stamps, &$cache) {
            foreach (is_array($nodes) ? $nodes : [] as $node) {
                if (($node['widgetType'] ?? '') === 'lse-shared') {
                    $template = (int) ($node['settings']['template_id'] ?? 0);
                    $stamps[$template] =
                        $cache[$template] ??
                        ($cache[$template] = self::stamp($template));
                }
                $walk($node['elements'] ?? []);
            }
        };
        $walk($tree);
        ksort($stamps);
        return $stamps;
    }
    private static function review_stamp($id)
    {
        return hash(
            'sha256',
            self::stamp($id) . wp_json_encode(self::shared_stamps($id)),
        );
    }
    private static function shared_changed($job, $id, $stamps = null)
    {
        foreach ($stamps ?? self::shared_stamps($id) as $template => $stamp) {
            $expected = '';
            foreach ($job['templates'] ?? [] as $saved) {
                if ((int) $saved['id'] === $template) {
                    $expected = $saved['stamp'] ?? '';
                    break;
                }
            }
            if (!$expected || !hash_equals($expected, $stamp)) {
                return true;
            }
        }
        return false;
    }
    private static function expected_page($post, $expected)
    {
        if (!function_exists('wp_check_post_lock')) {
            require_once ABSPATH . 'wp-admin/includes/post.php';
        }
        if (
            !is_string($expected) ||
            !hash_equals(self::review_stamp($post->ID), $expected)
        ) {
            throw new RuntimeException(
                'This page or its shared sections changed after you loaded it. Reload imported pages and review the latest version first.',
            );
        }
        if (wp_check_post_lock($post->ID)) {
            throw new RuntimeException(
                'Someone else is editing this page. Wait until they finish.',
            );
        }
    }
    private static function backup_refresh($id)
    {
        $backup = [
            'post_content' => get_post_field('post_content', $id),
            'meta' => [],
            'present' => [],
        ];
        $fields = [
            '_elementor_data',
            '_elementor_page_settings',
            '_lse_css',
            '_lse_source',
            '_lse_js',
            '_lse_scripts_enabled',
            '_lse_seo',
        ];
        $fields = array_merge($fields, LSE_SEO::fields());
        foreach ($fields as $field) {
            $backup['meta'][$field] = get_post_meta($id, $field, true);
            $backup['present'][$field] = metadata_exists('post', $id, $field);
        }
        update_post_meta($id, '_lse_refresh_backup', wp_slash($backup));
        wp_save_post_revision($id);
    }
    public static function restore_refresh($input)
    {
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            [$index, $page, $post] = self::managed_page(
                $job,
                $input['key'] ?? '',
            );
            self::expected_page($post, $input['expected_stamp'] ?? '');
            if (
                empty($input['consent']) ||
                !hash_equals($page['stamp'] ?? '', self::stamp($post->ID))
            ) {
                throw new RuntimeException(
                    'The refreshed page changed. Your newer edits were kept; use WordPress revisions to review its history.',
                );
            }
            $backup = get_post_meta($post->ID, '_lse_refresh_backup', true);
            if (!is_array($backup) || empty($backup['meta'])) {
                throw new RuntimeException(
                    'No previous refresh is available to restore.',
                );
            }
            $saved = wp_update_post(
                wp_slash([
                    'ID' => $post->ID,
                    'post_content' => $backup['post_content'],
                ]),
                true,
            );
            if (is_wp_error($saved)) {
                throw new RuntimeException($saved->get_error_message());
            }
            foreach ($backup['meta'] as $field => $value) {
                if (empty($backup['present'][$field])) {
                    delete_post_meta($post->ID, $field);
                } else {
                    update_post_meta($post->ID, $field, wp_slash($value));
                }
            }
            delete_post_meta($post->ID, '_elementor_css');
            delete_post_meta($post->ID, '_lse_refresh_backup');
            $job['pages'][$index]['stamp'] = self::stamp($post->ID);
            self::store($job);
            return self::status(['job' => $job['id']]);
        } finally {
            self::unlock($lock);
        }
    }
    private static function summary_prefix()
    {
        return '_lse_summary_' . get_current_user_id() . '_';
    }
    private static function store_summary($job)
    {
        $name = '_lse_summary_' . (int) $job['owner'] . '_' . $job['id'];
        if ($job['state'] === 'removed') {
            delete_option($name);
            return;
        }
        update_option(
            $name,
            [
                'id' => $job['id'],
                'title' => $job['title'],
                'state' => $job['state'],
                'created' => $job['created'],
                'pages' => count($job['pages']),
                'site_id' => $job['site_id'] ?? '',
            ],
            false,
        );
    }
    public static function imports($input)
    {
        global $wpdb;
        $owner = get_current_user_id();
        $migration = '_lse_summaries_' . $owner;
        if (!get_option($migration)) {
            // One-time legacy backfill. New imports update their own small summary row.
            $cursor = 0;
            do {
                $rows = $wpdb->get_results(
                    $wpdb->prepare(
                        "SELECT option_id, option_value FROM {$wpdb->options} WHERE option_name LIKE %s AND LENGTH(option_name) = 41 AND option_id > %d ORDER BY option_id LIMIT 50",
                        $wpdb->esc_like('_lse_job_') . '%',
                        $cursor,
                    ),
                );
                foreach ($rows as $row) {
                    $cursor = (int) $row->option_id;
                    $job = maybe_unserialize($row->option_value);
                    if (
                        is_array($job) &&
                        (int) ($job['owner'] ?? 0) === $owner
                    ) {
                        self::store_summary($job);
                    }
                }
            } while (count($rows) === 50);
            update_option($migration, true, false);
        }
        $offset = max(0, (int) ($input['offset'] ?? 0));
        $limit = 50;
        $names = $wpdb->get_col(
            $wpdb->prepare(
                "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s ORDER BY option_id DESC LIMIT %d OFFSET %d",
                $wpdb->esc_like(self::summary_prefix()) . '%',
                $limit + 1,
                $offset,
            ),
        );
        $rows = [];
        foreach (array_slice($names, 0, $limit) as $name) {
            $summary = get_option($name);
            if (is_array($summary)) {
                $rows[] = $summary;
            }
        }
        return [
            'imports' => $rows,
            'next' => count($names) > $limit ? $offset + $limit : null,
        ];
    }
    public static function manage_page($input)
    {
        $lock = self::lock($input['job'] ?? '');
        try {
            $job = self::load($lock['id']);
            if (
                in_array($job['state'], ['importing', 'finishing'], true) &&
                (($job['engine'] ?? '') === LSE_CONVERTER_VERSION ||
                    !$operation)
            ) {
                throw new RuntimeException(
                    'Finish or pause the active import before managing its pages.',
                );
            }
            [$index, $page, $post] = self::managed_page(
                $job,
                $input['key'] ?? '',
            );
            self::expected_page($post, $input['expected_stamp'] ?? '');
            $action = $input['operation'] ?? '';
            if ($action === 'metadata') {
                if ($post->post_status === 'trash') {
                    throw new RuntimeException(
                        'Restore this page before editing it.',
                    );
                }
                $title = trim(self::text($input['title'] ?? '', 300));
                $slug = sanitize_title(self::text($input['slug'] ?? '', 200));
                if (!$title || !$slug) {
                    throw new RuntimeException(
                        'A page title and address are required.',
                    );
                }
                $saved = wp_update_post(
                    wp_slash([
                        'ID' => $post->ID,
                        'post_title' => $title,
                        'post_name' => $slug,
                    ]),
                    true,
                );
                if (is_wp_error($saved)) {
                    throw new RuntimeException($saved->get_error_message());
                }
                $job['pages'][$index]['title'] = $title;
            } elseif ($action === 'trash') {
                if (
                    empty($input['consent']) ||
                    !current_user_can('delete_post', $post->ID)
                ) {
                    throw new RuntimeException(
                        'Confirm moving this page to Trash with an account allowed to delete it.',
                    );
                }
                if (!EMPTY_TRASH_DAYS) {
                    throw new RuntimeException(
                        'WordPress Trash is disabled on this site. No page was deleted.',
                    );
                }
                if (
                    $post->post_status !== 'trash' &&
                    !wp_trash_post($post->ID)
                ) {
                    throw new RuntimeException(
                        'WordPress did not move this page to Trash.',
                    );
                }
            } elseif ($action === 'untrash') {
                if ($post->post_status !== 'trash') {
                    throw new RuntimeException('This page is not in Trash.');
                }
                if (!wp_untrash_post($post->ID)) {
                    throw new RuntimeException(
                        'WordPress did not restore this page.',
                    );
                }
            } else {
                throw new RuntimeException('Unknown page management action.');
            }
            self::store($job);
            return self::status(['job' => $job['id']]);
        } finally {
            self::unlock($lock);
        }
    }
    private static function refresh($input)
    {
        $lock = self::lock($input['target_job']);
        try {
            $job = self::load($lock['id']);
            $operation = self::text($input['operation_id'] ?? '', 100);
            $same_operation =
                $operation &&
                hash_equals($job['operation_id'] ?? '', $operation) &&
                hash_equals($job['fingerprint'], $input['fingerprint']);
            if ($job['state'] === 'ready' && $same_operation) {
                return self::status(['job' => $job['id']]);
            }
            if (
                in_array($job['state'], ['importing', 'finishing'], true) &&
                (($job['engine'] ?? '') === LSE_CONVERTER_VERSION ||
                    !$operation)
            ) {
                if (
                    hash_equals($job['fingerprint'], $input['fingerprint']) &&
                    ($same_operation || !$operation)
                ) {
                    return self::status(['job' => $job['id']]);
                }
                throw new RuntimeException(
                    'Finish the active refresh with the same file before starting another one.',
                );
            }
            if (
                !empty($job['site_id']) &&
                !empty($input['site_id']) &&
                $job['site_id'] !== $input['site_id']
            ) {
                throw new RuntimeException(
                    'This file belongs to a different website. Select its matching import.',
                );
            }
            $prepared = [];
            // Preflight every selected destination before changing import state or page content.
            foreach ($input['pages'] as $source) {
                $existing = array_search(
                    $source['key'],
                    array_column($job['pages'], 'key'),
                    true,
                );
                if ($existing === false) {
                    throw new RuntimeException(
                        'The refresh contains a new page key. Import new pages separately; select existing pages to refresh this website.',
                    );
                }
                [$index, $page, $post] = self::managed_page(
                    $job,
                    $source['key'],
                );
                self::expected_page(
                    $post,
                    $input['expected_stamps'][$source['key']] ?? '',
                );
                if (
                    !in_array(
                        $post->post_status,
                        ['draft', 'pending', 'private', 'publish'],
                        true,
                    )
                ) {
                    throw new RuntimeException(
                        'Restore trashed pages before selecting them for refresh.',
                    );
                }
                $changed =
                    (empty($page['stamp']) && empty($page['initial_stamp'])) ||
                    !hash_equals(
                        $page['stamp'] ?? ($page['initial_stamp'] ?? ''),
                        self::stamp($post->ID),
                    ) ||
                    self::shared_changed($job, $post->ID);
                if (
                    ($changed || $post->post_status !== 'draft') &&
                    empty($input['overwrite'])
                ) {
                    throw new RuntimeException(
                        'A selected page was edited or published. Explicitly allow replacement after reviewing it, or deselect it.',
                    );
                }
                $prepared[] = [$index, $post, $source];
            }
            if (empty($prepared)) {
                throw new RuntimeException(
                    'Select at least one existing page to refresh.',
                );
            }
            foreach ($prepared as [$index, $post, $source]) {
                unset($job['pages'][$index]['skipped']);
                $job['pages'][$index]['done'] = false;
                $job['pages'][$index]['initial_stamp'] = self::stamp($post->ID);
                $job['pages'][$index][
                    'initial_review_stamp'
                ] = self::review_stamp($post->ID);
                $job['pages'][$index]['target_status'] = $post->post_status;
                $job['pages'][$index]['refreshing'] = true;
                $job['pages'][$index]['source_url'] = self::clean_url(
                    $source['url'] ?? '',
                );
                $job['pages'][$index]['source_slug'] = $source['slug'] ?? '';
                $job['pages'][$index]['regions'] = [];
            }
            if (isset($input['site']['navigation'])) {
                $job['site'] = $input['site'];
            }
            $job['skipped_assets'] = [];
            $job['capture'] = self::capture_report($input['capture'] ?? null);
            $job['operation_id'] = $operation;
            $job['shared_done'] = [];
            $job['engine'] = LSE_CONVERTER_VERSION;
            $job['assets'] = [];
            $job['fonts'] = [];
            $job['font_map'] = [];
            $job['fingerprint'] = $input['fingerprint'];
            $job['state'] = 'importing';
            $job['refreshing'] = true;
            $job['updated'] = time();
            $job['scripts'] =
                !empty($input['scripts']) &&
                current_user_can('unfiltered_html');
            // Keep existing destinations and their addresses; never create replacement posts.
            foreach ($job['pages'] as $page) {
                if ($page['source_url']) {
                    $job['map'][$page['source_url']] = $page['url'];
                }
            }
            self::store($job);
            update_user_meta(
                get_current_user_id(),
                '_lse_last_job',
                $job['id'],
            );
            return self::status(['job' => $job['id']]);
        } finally {
            self::unlock($lock);
        }
    }
}
