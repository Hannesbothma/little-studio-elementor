<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Keep source layout ancestors out of Elementor's editable element tree. */
final class LSE_Structure
{
    private const EDITOR_BLOCK_SETTINGS = [
        'content_width' => 'full',
        'lse_display' => 'contents',
    ];

    public static function init()
    {
        foreach (
            ['header' => 'before', 'footer' => 'after']
            as $kind => $position
        ) {
            add_action(
                "elementor/page_templates/canvas/{$position}_content",
                static function () use ($kind) {
                    $part =
                        self::site_parts(get_queried_object_id())[$kind] ?? [];
                    if (
                        !empty($part['theme_builder']) &&
                        function_exists('elementor_theme_do_location')
                    ) {
                        elementor_theme_do_location($kind);
                    }
                },
            );
        }
        // Block themes render template-part blocks instead of calling get_header()/get_footer().
        add_filter('pre_render_block', [self::class, 'theme_block'], 10, 2);
        add_action(
            'elementor/theme/register_locations',
            static function ($manager) {
                if (!wp_is_block_theme()) {
                    return;
                }
                foreach (['header', 'footer'] as $kind) {
                    if (!$manager->get_location($kind)) {
                        $manager->register_core_location($kind);
                    }
                }
            },
            20,
        );
        add_filter(
            'elementor/frontend/builder_content_data',
            [self::class, 'render_tree'],
            10,
            2,
        );
        add_filter(
            'elementor/document/wrapper_attributes',
            [self::class, 'editor_context'],
            10,
            2,
        );
    }

    public static function theme_block($output, $block)
    {
        if (
            $output !== null ||
            $block['blockName'] !== 'core/template-part' ||
            !wp_is_block_theme() ||
            !function_exists('elementor_theme_do_location')
        ) {
            return $output;
        }
        $attrs = $block['attrs'] ?? [];
        $kind = $attrs['area'] ?? ($attrs['tagName'] ?? ($attrs['slug'] ?? ''));
        if (!in_array($kind, ['header', 'footer'], true)) {
            return $output;
        }
        $conditions = \ElementorPro\Modules\ThemeBuilder\Module::instance()->get_conditions_manager();
        $documents = $conditions->get_documents_for_location($kind);
        if (
            !$documents ||
            get_post_meta(
                array_key_first($documents),
                '_lse_site_part',
                true,
            ) !== $kind
        ) {
            return $output;
        }
        ob_start();
        $rendered = elementor_theme_do_location($kind);
        $html = ob_get_clean();
        return $rendered ? $html : $output;
    }

    public static function clean($structure, $elements)
    {
        if (!is_array($structure) || count($structure) > 10000) {
            throw new RuntimeException('Invalid source layout.');
        }
        $parents = [];
        $index = static function ($nodes, $parent) use (&$index, &$parents) {
            foreach ($nodes as $node) {
                $parents[$node['id']] = $parent;
                $index($node['elements'] ?? [], $node['id']);
            }
        };
        $index($elements, null);
        $clean = [];
        $paths = [];
        foreach ($structure as $shell) {
            $id = $shell['id'] ?? '';
            if (
                !is_string($id) ||
                !preg_match('/^[a-f0-9]{8}$/D', $id) ||
                array_key_exists($id, $parents) ||
                isset($clean[$id]) ||
                !in_array($shell['tag'] ?? '', ['div', 'main'], true) ||
                !is_array($shell['members'] ?? null)
            ) {
                throw new RuntimeException('Invalid source layout container.');
            }
            $attributes = [];
            foreach ((array) ($shell['attributes'] ?? []) as $name => $value) {
                if (
                    is_string($value) &&
                    strlen($value) <= 4096 &&
                    is_string($name) &&
                    preg_match(
                        '/^(?:data-(?!lse-|elementor-|settings$|id$|element_type$|widget_type$)[a-z0-9_-]+|aria-[a-z0-9_-]+|role)$/D',
                        $name,
                    )
                ) {
                    $attributes[$name] = $value;
                }
            }
            $parent = $shell['parent'] ?? null;
            if (
                $parent !== null &&
                (!is_string($parent) || !array_key_exists($parent, $parents))
            ) {
                throw new RuntimeException('Invalid layout parent.');
            }
            $members = [];
            foreach ($shell['members'] as $member) {
                if (
                    !is_string($member) ||
                    !array_key_exists($member, $parents) ||
                    $parents[$member] !== $parent ||
                    isset($members[$member])
                ) {
                    throw new RuntimeException(
                        'A source layout container references an unknown or duplicate block.',
                    );
                }
                $members[$member] = true;
                $paths[$member][] = $id;
            }
            $clean[$id] = [
                'id' => $id,
                'parent' => $parent,
                'tag' => $shell['tag'],
                'classes' => sanitize_text_field(
                    (string) ($shell['classes'] ?? ''),
                ),
                'anchor' => sanitize_text_field(
                    (string) ($shell['anchor'] ?? ''),
                ),
                'attributes' => $attributes,
                'members' => array_keys($members),
            ];
        }
        return ['shells' => $clean, 'paths' => $paths];
    }

    private static function layout($post_id)
    {
        return get_post_meta($post_id, '_lse_source', true)[
            'layout_structure'
        ] ?? [];
    }

    public static function site_parts($post_id)
    {
        return get_post_meta($post_id, '_lse_source', true)['site_parts'] ?? [];
    }

    public static function prepare_editor_blocks(&$elements, &$layout, $ids)
    {
        if (version_compare(ELEMENTOR_VERSION, '4.0.0', '>=')) {
            return;
        }
        // The legacy editor only accepts containers or sections at the root.
        $used = array_fill_keys(
            array_merge($ids, array_keys($layout['shells'])),
            true,
        );
        foreach ($elements as &$element) {
            if ($element['elType'] !== 'widget') {
                continue;
            }
            $source_id = $element['id'];
            $attempt = 0;
            do {
                $id = substr(
                    hash(
                        'sha256',
                        'lse-editor-block:' . $source_id . ':' . $attempt++,
                    ),
                    0,
                    8,
                );
            } while (isset($used[$id]));
            $used[$id] = true;
            $layout['editor_blocks'][$id] = $source_id;
            $element = [
                'id' => $id,
                'elType' => 'container',
                'isInner' => false,
                'settings' => self::EDITOR_BLOCK_SETTINGS + [
                    '_title' => $element['settings']['_title'] ?? '',
                ],
                'elements' => [$element],
            ];
        }
    }

    public static function detach(&$elements, $id, &$slot, $parent = null)
    {
        foreach ($elements as $index => &$element) {
            if ($element['id'] === $id) {
                $slot = [
                    'id' => $id,
                    'parent' => $parent,
                    'after' => $elements[$index - 1]['id'] ?? null,
                    'before' => $elements[$index + 1]['id'] ?? null,
                ];
                return array_splice($elements, $index, 1)[0];
            }
            $found = self::detach(
                $element['elements'],
                $id,
                $slot,
                $element['id'],
            );
            if ($found) {
                return $found;
            }
        }
        return null;
    }

    private static function insert_part(
        &$elements,
        $slot,
        $widget,
        $kind,
        $parent = null,
    ) {
        if ($slot['parent'] === $parent) {
            $ids = array_column($elements, 'id');
            $before = array_search($slot['before'], $ids, true);
            $after = array_search($slot['after'], $ids, true);
            $index =
                $before !== false
                    ? $before
                    : ($after !== false
                        ? $after + 1
                        : ($kind === 'header'
                            ? 0
                            : count($elements)));
            array_splice($elements, $index, 0, [$widget]);
            return true;
        }
        foreach ($elements as &$element) {
            if (
                self::insert_part(
                    $element['elements'],
                    $slot,
                    $widget,
                    $kind,
                    $element['id'],
                )
            ) {
                return true;
            }
        }
        return false;
    }

    private static function in_editor()
    {
        return \Elementor\Plugin::$instance->editor->is_edit_mode() ||
            \Elementor\Plugin::$instance->preview->is_preview_mode();
    }

    public static function editor_context($attributes, $document)
    {
        $shells = array_values(
            self::layout($document->get_main_id())['shells'] ?? [],
        );
        if (!$shells || !self::in_editor()) {
            return $attributes;
        }
        foreach ($shells as $shell) {
            if (
                empty($shell['parent']) &&
                $shell['tag'] === 'div' &&
                $shell['members'] === $shells[0]['members']
            ) {
                $attributes['class'] .= ' ' . $shell['classes'];
            }
        }
        $attributes['data-lse-editor-context'] = '';
        return $attributes;
    }

    public static function render_tree($elements, $post_id)
    {
        if (self::in_editor()) {
            return $elements;
        }
        $layout = self::layout($post_id);
        $paths = $layout['paths'] ?? [];
        $replacements = [];
        foreach ($elements as &$element) {
            $id = $element['id'];
            $source_id = $layout['editor_blocks'][$id] ?? null;
            if (!$source_id) {
                continue;
            }
            $settings = $element['settings'];
            unset($settings['_title']);
            if (
                $settings == self::EDITOR_BLOCK_SETTINGS &&
                count($element['elements']) === 1 &&
                $element['elements'][0]['id'] === $source_id
            ) {
                $element = $element['elements'][0];
            } else {
                // A container with its own edits must render as part of the page.
                $paths[$id] = $paths[$source_id] ?? [];
                $replacements[$source_id] = $id;
            }
        }
        unset($element);
        foreach (self::site_parts($post_id) as $kind => $slot) {
            if (
                !empty($slot['theme_builder']) &&
                class_exists(\ElementorPro\Modules\ThemeBuilder\Module::class)
            ) {
                continue;
            }
            $slot['after'] = $replacements[$slot['after']] ?? $slot['after'];
            $slot['before'] = $replacements[$slot['before']] ?? $slot['before'];
            $id = substr(
                hash('sha256', 'lse-site-part:' . $slot['id'] . ':' . $post_id),
                0,
                8,
            );
            $widget = [
                'id' => $id,
                'elType' => 'widget',
                'widgetType' => 'lse-shared',
                'isInner' => false,
                'settings' => [
                    'template_id' => $slot['template_id'],
                    'lse_attributes' => ['data-lse-site-part' => $kind],
                ],
                'elements' => [],
            ];
            if (!self::insert_part($elements, $slot, $widget, $kind)) {
                // The original parent was removed in the page editor.
                $slot['parent'] = null;
                self::insert_part($elements, $slot, $widget, $kind);
            }
            if (isset($paths[$slot['id']])) {
                $paths[$id] = $paths[$slot['id']];
            }
        }
        if (empty($layout['shells'])) {
            return $elements;
        }
        // New blocks belong to the page's shared outer context. If a new
        // block sits between two existing blocks, keep their common group.
        $instances = [];
        $restore = static function (&$nodes) use (
            &$restore,
            $paths,
            $layout,
            &$instances,
        ) {
            foreach ($nodes as &$node) {
                if (empty($node['elements'])) {
                    continue;
                }
                $restore($node['elements']);
                $local = [];
                foreach ($node['elements'] as $child) {
                    $path = $paths[$child['id']] ?? [];
                    if (
                        $path &&
                        ($layout['shells'][$path[0]]['parent'] ?? null) ===
                            $node['id']
                    ) {
                        $local[$child['id']] = $path;
                    }
                }
                if ($local) {
                    $node['elements'] = self::wrap(
                        $node['elements'],
                        $local,
                        $layout['shells'],
                        $instances,
                    );
                }
            }
        };
        $restore($elements);
        $root_shells = array_filter(
            $layout['shells'],
            static fn($shell) => empty($shell['parent']),
        );
        if (!$root_shells) {
            return $elements;
        }
        $outer = reset($root_shells)['members'];
        $default = array_map(
            'strval',
            array_keys(
                array_filter(
                    $root_shells,
                    static fn($shell) => $shell['members'] === $outer,
                ),
            ),
        );
        foreach ($paths as $id => $path) {
            if ($path && !isset($root_shells[$path[0]])) {
                unset($paths[$id]);
            }
        }
        $following = [];
        $next = null;
        foreach (array_reverse($elements, true) as $index => $element) {
            $following[$index] = $next;
            $next = $paths[$element['id']] ?? $next;
        }
        $previous = null;
        foreach ($elements as $index => $element) {
            $id = $element['id'];
            if (isset($paths[$id])) {
                $previous = $paths[$id];
                continue;
            }
            $paths[$id] = $default;
            if ($previous !== null && $following[$index] !== null) {
                $length = 0;
                foreach ($previous as $offset => $shell) {
                    if ($shell !== ($following[$index][$offset] ?? null)) {
                        break;
                    }
                    $length++;
                }
                $paths[$id] = array_slice($previous, 0, $length);
            }
        }
        return self::wrap($elements, $paths, $layout['shells'], $instances);
    }

    private static function wrap(
        $elements,
        $paths,
        $shells,
        &$instances,
        $depth = 0,
    ) {
        $output = [];
        $group = [];
        $active = null;
        $flush = static function () use (
            &$output,
            &$group,
            &$active,
            $paths,
            $shells,
            &$instances,
            $depth,
        ) {
            if (!$group) {
                return;
            }
            $shell = $shells[$active];
            $number = ($instances[$active] ?? 0) + 1;
            $instances[$active] = $number;
            $output[] = [
                'id' =>
                    $number === 1
                        ? $shell['id']
                        : substr(hash('sha256', $active . ':' . $number), 0, 8),
                'elType' => 'container',
                'isInner' => false,
                'settings' => [
                    'html_tag' => $number === 1 ? $shell['tag'] : 'div',
                    'content_width' => 'full',
                    'css_classes' => $shell['classes'],
                    '_element_id' => $number === 1 ? $shell['anchor'] : '',
                    'lse_attributes' =>
                        [
                            'data-lse-layout-shell' => $shell['id'],
                            'data-lse-native' => '',
                        ] + $shell['attributes'],
                ],
                'elements' => self::wrap(
                    $group,
                    $paths,
                    $shells,
                    $instances,
                    $depth + 1,
                ),
            ];
            $group = [];
        };
        foreach ($elements as $element) {
            $next = $paths[$element['id']][$depth] ?? null;
            if ($next !== $active) {
                $flush();
                $active = $next;
            }
            if ($next === null) {
                $output[] = $element;
            } else {
                $group[] = $element;
            }
        }
        $flush();
        return $output;
    }
}
