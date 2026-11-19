<?php
if (!defined('ABSPATH')) {
    exit();
}
final class LSE_Native
{
    public static function widgets()
    {
        return array_filter(
            \Elementor\Plugin::$instance->widgets_manager->get_widget_types(),
            static fn($widget) => !is_a(
                $widget,
                'Elementor\\Modules\\Promotions\\Widgets\\Pro_Widget_Promotion',
            ) && !is_a($widget, 'Elementor\\Widget_Pro'),
        );
    }

    public static function uses_imported_menu($nodes)
    {
        if (!is_array($nodes)) {
            return false;
        }
        foreach ($nodes as $node) {
            if (
                ($node['widgetType'] ?? '') === 'nav-menu' &&
                ($node['settings']['lse_imported_menu'] ?? '') === 'yes'
            ) {
                return true;
            }
            if (self::uses_imported_menu($node['elements'] ?? [])) {
                return true;
            }
        }
        return false;
    }

    public static function element($item)
    {
        $type = $item['elType'] ?? '';
        if (
            !in_array($type, ['container', 'section', 'column', 'widget'], true)
        ) {
            throw new RuntimeException(
                'Unsupported native Elementor element type: ' . $type,
            );
        }
        if ($type === 'widget') {
            $name = $item['widgetType'] ?? '';
            if (!is_string($name) || !isset(self::widgets()[$name])) {
                throw new RuntimeException(
                    'Native Elementor widget "' .
                        (is_string($name) ? $name : '') .
                        '" is unavailable. Activate its Elementor Pro or add-on plugin before importing.',
                );
            }
        }
    }
    public static function settings(
        $settings,
        $job,
        $path,
        $skip_css = [],
        &$skipped = [],
    ) {
        if (!is_array($settings)) {
            throw new RuntimeException(
                'Native Elementor settings must be an object at ' . $path,
            );
        }
        if (($settings['lse_imported_menu'] ?? '') === 'yes') {
            if (empty($job['menu']) || !wp_get_nav_menu_object($job['menu'])) {
                throw new RuntimeException(
                    'The imported WordPress menu is not available.',
                );
            }
            $settings['menu'] = (string) $job['menu'];
        }
        $assets = array_column($job['assets'], 'id', 'url');
        $walk = static function ($value, $path) use (
            &$walk,
            $assets,
            $skip_css,
            &$skipped,
        ) {
            if (!is_array($value)) {
                return $value;
            }
            foreach ($value as $key => &$child) {
                $field = $path . '.' . $key;
                if (
                    in_array($key, ['__dynamic__', '__globals__'], true) &&
                    !empty($child)
                ) {
                    throw new RuntimeException(
                        'Destination mapping is required for ' .
                            $field .
                            '. Resolve source dynamic tags or global styles before importing.',
                    );
                }
                if (is_string($key) && str_contains($key, 'custom_css')) {
                    $child = LSE_CSS::clean(
                        $child,
                        $field,
                        $skip_css,
                        $skipped,
                    );
                } elseif ($key === 'url' && is_string($child)) {
                    $child = esc_url_raw($child, [
                        'http',
                        'https',
                        'mailto',
                        'tel',
                    ]);
                } else {
                    $child = $walk($child, $field);
                }
            }
            unset($child);
            // Source attachment IDs have no meaning on the destination site.
            if (isset($value['url']) && array_key_exists('id', $value)) {
                $value['id'] = $assets[$value['url']] ?? 0;
            }
            return $value;
        };
        $settings = $walk($settings, $path);
        // Native widgets may contain executable HTML, shortcodes or form actions.
        // Match the permission needed to author these controls in Elementor itself.
        if (!current_user_can('unfiltered_html')) {
            throw new RuntimeException(
                'Native template import requires an administrator with unfiltered HTML permission.',
            );
        }
        return $settings;
    }
}
