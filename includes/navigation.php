<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Import-owned WordPress menus: nested items, local targets and resumable creation. */
final class LSE_Navigation
{
    public static function validate($items, $page_keys)
    {
        if (!is_array($items)) {
            throw new RuntimeException('Site navigation must be a list.');
        }
        foreach ($items as $item) {
            if (
                !is_array($item) ||
                !is_string($item['label'] ?? null) ||
                !trim($item['label']) ||
                strlen($item['label']) > 150
            ) {
                throw new RuntimeException('A menu item has an invalid label.');
            }
            $key = $item['key'] ?? '';
            $url = $item['url'] ?? '';
            if (
                !is_string($key) ||
                !is_string($url) ||
                strlen($url) > 2048 ||
                ((!$key || !in_array($key, $page_keys, true)) &&
                    (!$url || !self::url($url)))
            ) {
                throw new RuntimeException(
                    'A menu item has an invalid destination.',
                );
            }
            if ($url && !self::url($url)) {
                throw new RuntimeException('A menu item has an unsafe URL.');
            }
            self::validate($item['children'] ?? [], $page_keys);
        }
    }

    private static function url($url)
    {
        if (
            !preg_match('~^(?:https?://|mailto:|tel:|#)~i', $url) ||
            preg_match('/[\x00-\x1f]/', $url)
        ) {
            return '';
        }
        return esc_url_raw($url, ['http', 'https', 'mailto', 'tel']);
    }

    public static function ensure(&$job, $persist)
    {
        $items = $job['site']['navigation'] ?? [];
        if (!$items) {
            return 0;
        }
        $ids = array_column($job['pages'], 'id', 'key');
        self::validate($items, array_keys($ids));
        $signature = hash('sha256', wp_json_encode([$items, $ids]));
        $menu = !empty($job['menu'])
            ? wp_get_nav_menu_object($job['menu'])
            : false;
        if (($job['menu_signature'] ?? '') !== $signature || !$menu) {
            // A changed definition gets a new owned menu. Existing or edited menus remain intact.
            if (
                ($job['menu_pending_signature'] ?? '') !== $signature ||
                empty($job['menu_pending_name'])
            ) {
                $job['menu_pending_name'] =
                    $job['title'] .
                    ' — imported ' .
                    substr($job['id'], 0, 6) .
                    '-' .
                    bin2hex(random_bytes(6));
                $job['menu_pending_signature'] = $signature;
                $persist($job);
            }
            // The recorded random name also recovers a stop between term creation and checkpointing.
            $pending = wp_get_nav_menu_object($job['menu_pending_name']);
            if (
                $pending &&
                get_term_meta($pending->term_id, '_lse_job', true) &&
                get_term_meta($pending->term_id, '_lse_job', true) !==
                    $job['id']
            ) {
                throw new RuntimeException(
                    'The pending imported menu belongs to another import.',
                );
            }
            $created = $pending
                ? (int) $pending->term_id
                : wp_create_nav_menu($job['menu_pending_name']);
            if (is_wp_error($created)) {
                throw new RuntimeException($created->get_error_message());
            }
            if ($menu) {
                $job['previous_menus'] = array_values(
                    array_unique(
                        array_merge($job['previous_menus'] ?? [], [
                            (int) $menu->term_id,
                        ]),
                    ),
                );
            }
            $owned = update_term_meta($created, '_lse_job', $job['id']);
            if (is_wp_error($owned)) {
                throw new RuntimeException($owned->get_error_message());
            }
            $job['menu'] = (int) $created;
            $job['menu_signature'] = $signature;
            $job['menu_items'] = [];
            $job['menu_complete'] = false;
            unset($job['menu_pending_name'], $job['menu_pending_signature']);
            $persist($job);
        }
        if (!empty($job['menu_complete'])) {
            return (int) $job['menu'];
        }
        $existing =
            wp_get_nav_menu_items($job['menu'], ['post_status' => 'any']) ?: [];
        $position = 0;
        $write = static function ($entries, $parent = 0, $prefix = '') use (
            &$write,
            &$position,
            &$job,
            $ids,
            $existing,
            $persist,
        ) {
            foreach ($entries as $i => $item) {
                $path = $prefix . $i;
                $args = [
                    'menu-item-title' => sanitize_text_field($item['label']),
                    'menu-item-parent-id' => $parent,
                    'menu-item-position' => ++$position,
                    'menu-item-status' => 'publish',
                    'menu-item-target' => !empty($item['external'])
                        ? '_blank'
                        : '',
                ];
                if (isset($ids[$item['key'] ?? ''])) {
                    $args += [
                        'menu-item-object' => 'page',
                        'menu-item-object-id' => $ids[$item['key']],
                        'menu-item-type' => 'post_type',
                    ];
                } else {
                    $url = $item['url'] ?? '';
                    $args += [
                        'menu-item-type' => 'custom',
                        'menu-item-url' => self::url($job['map'][$url] ?? $url),
                    ];
                }
                $saved = (int) ($job['menu_items'][$path] ?? 0);
                if (
                    $saved &&
                    !in_array(
                        $saved,
                        array_map(
                            static fn($entry) => (int) $entry->ID,
                            $existing,
                        ),
                        true,
                    )
                ) {
                    $saved = 0;
                }
                if (!$saved) {
                    foreach ($existing as $candidate) {
                        $recorded = get_post_meta(
                            $candidate->ID,
                            '_lse_menu_path',
                            true,
                        );
                        $same_target =
                            $candidate->type === $args['menu-item-type'] &&
                            ($candidate->type === 'post_type'
                                ? (int) $candidate->object_id ===
                                    (int) $args['menu-item-object-id']
                                : $candidate->url === $args['menu-item-url']);
                        if (
                            $recorded === $path ||
                            (!$recorded &&
                                (int) $candidate->menu_order === $position &&
                                (int) $candidate->menu_item_parent ===
                                    $parent &&
                                $candidate->title ===
                                    $args['menu-item-title'] &&
                                $same_target)
                        ) {
                            $saved = (int) $candidate->ID;
                            break;
                        }
                    }
                }
                $saved = wp_update_nav_menu_item($job['menu'], $saved, $args);
                if (is_wp_error($saved)) {
                    throw new RuntimeException($saved->get_error_message());
                }
                update_post_meta($saved, '_lse_menu_path', $path);
                $job['menu_items'][$path] = (int) $saved;
                $persist($job);
                $write($item['children'] ?? [], (int) $saved, $path . '.');
            }
        };
        $write($items);
        $job['menu_complete'] = true;
        $persist($job);
        return (int) $job['menu'];
    }
}
