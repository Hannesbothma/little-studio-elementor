<?php
if (!defined('ABSPATH')) {
    exit();
}

/** A durable undo journal for a single native save, including interrupted PHP requests. */
trait LSE_Page_Save
{
    private static $save_tracking = null;
    private static $save_callbacks = [];
    private static function post_snapshot($id)
    {
        $post = get_post($id, ARRAY_A);
        return array_intersect_key(
            $post ?: [],
            array_flip([
                'post_title',
                'post_content',
                'post_status',
                'post_name',
                'post_parent',
            ]),
        );
    }
    private static function begin_page_save($id, $job)
    {
        $meta = get_post_meta($id);
        unset($meta['_lse_save_journal'], $meta['_lse_save_before']);
        foreach ($meta as &$values) {
            $values = array_map('maybe_unserialize', $values);
        }
        unset($values);
        $journal = [
            'job' => $job,
            'before' => [
                'post' => self::post_snapshot($id),
                'meta' => array_map([__CLASS__, 'meta_hash'], $meta),
            ],
            'meta' => [],
            'post' => [],
        ];
        update_post_meta($id, '_lse_save_before', wp_slash($meta));
        update_post_meta($id, '_lse_save_journal', wp_slash($journal));
        self::$save_tracking = ['id' => $id, 'journal' => $journal];
        $meta_callback = static function ($check, $post_id, $key, $value) {
            if (
                !self::$save_tracking ||
                (int) $post_id !== self::$save_tracking['id'] ||
                in_array($key, ['_lse_save_journal', '_lse_save_before'], true)
            ) {
                return $check;
            }
            // Record intent before the database write. Either before or after is valid on recovery.
            $allowed = self::$save_tracking['journal']['meta'][$key] ?? [
                self::$save_tracking['journal']['before']['meta'][$key] ??
                self::meta_hash([]),
            ];
            $current = get_post_meta($post_id, $key);
            $hook = current_filter();
            $intended =
                $hook === 'delete_post_metadata'
                    ? []
                    : ($hook === 'add_post_metadata'
                        ? array_merge($current, [$value])
                        : array_fill(0, max(1, count($current)), $value));
            $allowed[] = self::meta_hash($intended);
            self::$save_tracking['journal']['meta'][$key] = $allowed;
            update_post_meta(
                $post_id,
                '_lse_save_journal',
                wp_slash(self::$save_tracking['journal']),
            );
            return $check;
        };
        foreach (
            [
                'add_post_metadata',
                'update_post_metadata',
                'delete_post_metadata',
            ]
            as $hook
        ) {
            add_filter($hook, $meta_callback, -1000, 4);
            self::$save_callbacks[] = [$hook, $meta_callback, -1000];
        }
        $post_callback = static function ($data, $postarr) {
            if (
                self::$save_tracking &&
                (int) ($postarr['ID'] ?? 0) === self::$save_tracking['id']
            ) {
                $after = array_intersect_key(
                    wp_unslash($data),
                    self::$save_tracking['journal']['before']['post'],
                );
                foreach ($after as $field => $value) {
                    self::$save_tracking['journal']['post'][$field][] = $value;
                }
                update_post_meta(
                    self::$save_tracking['id'],
                    '_lse_save_journal',
                    wp_slash(self::$save_tracking['journal']),
                );
            }
            return $data;
        };
        add_filter('wp_insert_post_data', $post_callback, PHP_INT_MAX, 2);
        self::$save_callbacks[] = [
            'wp_insert_post_data',
            $post_callback,
            PHP_INT_MAX,
        ];
    }
    private static function stop_page_tracking()
    {
        foreach (self::$save_callbacks as [$hook, $callback, $priority]) {
            remove_filter($hook, $callback, $priority);
        }
        self::$save_callbacks = [];
        self::$save_tracking = null;
    }
    private static function end_page_save($id)
    {
        self::stop_page_tracking();
        delete_post_meta($id, '_lse_save_journal');
        delete_post_meta($id, '_lse_save_before');
    }
    private static function meta_hash($values)
    {
        // WordPress stores standalone scalar metadata as strings.
        $values = array_map(
            static fn($value) => is_scalar($value) || $value === null
                ? (string) $value
                : $value,
            $values,
        );
        return hash('sha256', maybe_serialize($values));
    }
    private static function same_values($first, $second)
    {
        return maybe_serialize($first) === maybe_serialize($second);
    }
    private static function recover_page_save($id, $job)
    {
        $journal = get_post_meta($id, '_lse_save_journal', true);
        if (!$journal) {
            return;
        }
        if (!is_array($journal) || ($journal['job'] ?? '') !== $job) {
            throw new RuntimeException(
                'This draft has an unrelated interrupted save. Review it before replacing content.',
            );
        }
        // Never roll a newer native/external edit back to an old import snapshot.
        $before = $journal['before'];
        $before_values = get_post_meta($id, '_lse_save_before', true);
        if (!is_array($before_values)) {
            throw new RuntimeException(
                'The interrupted-save snapshot is unavailable. Review the draft before replacing content.',
            );
        }
        $current_post = self::post_snapshot($id);
        foreach ($before['post'] as $field => $value) {
            $allowed = array_merge([$value], $journal['post'][$field] ?? []);
            if (
                !in_array(
                    (string) ($current_post[$field] ?? ''),
                    array_map('strval', $allowed),
                    true,
                )
            ) {
                throw new RuntimeException(
                    'The draft changed after an interrupted save. Your edits were preserved; review it before retrying.',
                );
            }
        }
        $current_meta = get_post_meta($id);
        unset(
            $current_meta['_lse_save_journal'],
            $current_meta['_lse_save_before'],
        );
        foreach ($current_meta as &$values) {
            $values = array_map('maybe_unserialize', $values);
        }
        unset($values);
        $keys = array_unique(
            array_merge(
                array_keys($before['meta']),
                array_keys($current_meta),
                array_keys($journal['meta']),
            ),
        );
        foreach ($keys as $key) {
            // Editor presence and cache timestamps are independent of imported content.
            if (
                in_array(
                    $key,
                    ['_edit_lock', '_edit_last', '_elementor_css'],
                    true,
                )
            ) {
                continue;
            }
            $allowed = $journal['meta'][$key] ?? [
                $before['meta'][$key] ?? self::meta_hash([]),
            ];
            $matches = false;
            foreach ($allowed as $value) {
                if (
                    hash_equals(
                        self::meta_hash($current_meta[$key] ?? []),
                        $value,
                    )
                ) {
                    $matches = true;
                    break;
                }
            }
            if (!$matches) {
                throw new RuntimeException(
                    'The draft changed after an interrupted save. Your edits were preserved; review it before retrying.',
                );
            }
        }
        if (!self::same_values($current_post, $before['post'])) {
            $saved = wp_update_post(
                wp_slash(['ID' => $id] + $before['post']),
                true,
            );
            if (is_wp_error($saved)) {
                throw new RuntimeException($saved->get_error_message());
            }
        }
        foreach (array_keys($journal['meta']) as $key) {
            if (
                self::same_values(
                    $current_meta[$key] ?? [],
                    $before_values[$key] ?? [],
                )
            ) {
                continue;
            }
            delete_post_meta($id, $key);
            foreach ($before_values[$key] ?? [] as $value) {
                add_post_meta($id, $key, wp_slash($value));
            }
        }
        delete_post_meta($id, '_elementor_css');
        delete_post_meta($id, '_lse_save_journal');
        delete_post_meta($id, '_lse_save_before');
        clean_post_cache($id);
        // Drop Elementor's in-request document cache after restoring native metadata.
        if (isset(\Elementor\Plugin::$instance->documents)) {
            \Elementor\Plugin::$instance->documents->get($id, false);
        }
    }
}
