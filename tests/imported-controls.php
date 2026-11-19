<?php
// Run inside a disposable/local WordPress site: studio wp eval-file <this file>.
if (!defined('ABSPATH') || wp_get_environment_type() !== 'local') {
    throw new RuntimeException(
        'These checks require a local WordPress installation.',
    );
}
$checks = [];
$check = static function ($ok, $label) use (&$checks) {
    if (!$ok) {
        throw new RuntimeException($label);
    }
    $checks[] = $label;
};
$admin = get_user_by('login', 'labadmin');
if ($admin) {
    wp_set_current_user($admin->ID);
}
$id = wp_insert_post([
    'post_type' => 'page',
    'post_status' => 'draft',
    'post_title' => 'LS automated imported-controls check',
]);
if (!$id || is_wp_error($id)) {
    throw new RuntimeException('Could not create the owned test draft.');
}
try {
    update_post_meta($id, '_elementor_edit_mode', 'builder');
    $elements = [
        [
            'id' => 'b0110001',
            'elType' => 'container',
            'isInner' => false,
            'settings' => [
                'html_tag' => 'button',
                'content_width' => 'full',
                'lse_attributes' => [
                    'data-lse-source-tag' => 'button',
                    'data-lse-native' => '',
                ],
                'lse_position' => 'static',
                'z_index' => 1,
                'lse_overflow_x' => 'hidden',
                'lse_overflow_y' => 'visible',
                'lse_position_mobile' => 'absolute',
                'lse_offset_top_mobile' => ['unit' => 'px', 'size' => 14],
            ],
            'elements' => [
                [
                    'id' => 'b0110002',
                    'elType' => 'widget',
                    'widgetType' => 'heading',
                    'isInner' => false,
                    'elements' => [],
                    'settings' => [
                        'title' => 'Editable action label',
                        'header_size' => 'span',
                        'typography_typography' => 'custom',
                        'typography_font_family' => 'Georgia',
                        'lse_font_fallbacks' => '"Times New Roman", serif',
                        'lse_text_max_width' => ['unit' => 'ch', 'size' => 12],
                        'typography_font_size' => [
                            'unit' => 'custom',
                            'size' => 'clamp(24px, 4vw, 60px)',
                        ],
                        'typography_line_height' => [
                            'unit' => 'em',
                            'size' => 1.08,
                        ],
                    ],
                ],
            ],
        ],
    ];
    $elements[] = [
        'id' => 'b0110003',
        'elType' => 'container',
        'settings' => [
            'lse_flex_basis' => ['unit' => '%', 'size' => 100],
            '_flex_size' => 'custom',
            '_flex_grow' => 0,
            '_flex_shrink' => 0,
            'padding' => [
                'unit' => 'custom',
                'top' => 'var(--lse-source-padding-top)',
                'right' => '0',
                'bottom' => '0',
                'left' => '0',
                'isLinked' => false,
            ],
            'flex_gap' => [
                'unit' => 'custom',
                'row' => 'var(--lse-source-row-gap)',
                'column' => 'var(--lse-source-column-gap)',
                'isLinked' => false,
            ],
        ],
        'elements' => [
            [
                'id' => 'b0110004',
                'elType' => 'widget',
                'widgetType' => 'image',
                'settings' => [
                    'image' => [
                        'url' => includes_url('images/blank.gif'),
                        'id' => 0,
                    ],
                    'lse_height' => ['unit' => '%', 'size' => 100],
                    'height' => ['unit' => '%', 'size' => 100],
                ],
                'elements' => [],
            ],
        ],
    ];
    $elements[] = [
        'id' => 'b0110005',
        'elType' => 'container',
        'settings' => [
            'container_type' => 'grid',
            'lse_flex_direction_mobile' => 'column',
            'lse_flex_wrap_mobile' => 'wrap',
        ],
        'elements' => [],
    ];
    $doc = \Elementor\Plugin::$instance->documents->get($id);
    $check(
        $doc && $doc->save(['elements' => $elements]),
        'Native controls save successfully',
    );
    $file = \Elementor\Core\Files\CSS\Post::create($id);
    $file->update();
    $css = $file->get_content();
    $check(
        str_contains($css, '"Georgia","Times New Roman", serif'),
        'Font fallbacks survive native CSS generation',
    );
    $check(
        str_contains($css, 'clamp(24px, 4vw, 60px)'),
        'Fluid typography remains an editable native size',
    );
    $check(
        (bool) preg_match(
            '/b0110002 \\.elementor-heading-title[^{}]*\\{[^{}]*max-width:12ch/',
            $css,
        ),
        'Text wrapping uses the actual heading font for ch units',
    );
    $check(
        str_contains($css, 'position:static') &&
            str_contains($css, 'position:absolute'),
        'Desktop and mobile positioning remain distinct',
    );
    $check(
        str_contains($css, 'top:14px'),
        'Mobile positioning offsets generate CSS',
    );
    $check(
        str_contains($css, 'z-index:1'),
        'Native stacking order preserves overlay text contrast',
    );
    $check(
        str_contains($css, 'overflow-x:hidden') &&
            str_contains($css, 'overflow-y:visible'),
        'Source clipping remains editable and prevents gallery overflow',
    );
    $check(
        str_contains($css, '--padding-top:var(--lse-source-padding-top)') &&
            str_contains($css, 'var(--lse-source-row-gap)') &&
            !str_contains($css, ')custom'),
        'Responsive source variables work in native dimensions and gaps',
    );
    $check(
        str_contains($css, 'flex-basis:100%') &&
            str_contains($css, '--flex-shrink:0'),
        'Full-width gallery slides keep their flex basis and do not shrink',
    );
    $check(
        (bool) preg_match(
            '/b0110005[^{}]*\{[^{}]*flex-direction:column/',
            $css,
        ) && (bool) preg_match('/b0110005[^{}]*\{[^{}]*flex-wrap:wrap/', $css),
        'Desktop Grid containers can switch to a vertical wrapped Flex layout',
    );
    $check(
        (bool) preg_match('/b0110004[^{}]*\{[^{}]*height:100%/', $css) &&
            (bool) preg_match('/b0110004 img[^{}]*\{[^{}]*height:100%/', $css),
        'Native image wrapper and image keep percentage heights',
    );
    $html = \Elementor\Plugin::$instance->frontend->get_builder_content_for_display(
        $id,
        true,
    );
    $check(
        (bool) preg_match('/<button\b[^>]*type="button"/', $html),
        'Imported actions render as real non-submit buttons',
    );
    $check(
        str_contains($html, 'Editable action label'),
        'Action content remains in native child widgets',
    );
    $elements[0]['elements'][0]['settings']['typography_font_family'] = 'Arial';
    $check($doc->save(['elements' => $elements]), 'A native font edit saves');
    $file->update();
    $check(
        str_contains($file->get_content(), '"Arial","Times New Roman", serif'),
        'Font fallbacks follow the edited native font',
    );
    $saved = json_decode(get_post_meta($id, '_elementor_data', true), true);
    $check(
        $saved[0]['elements'][0]['settings']['typography_font_family'] ===
            'Arial',
        'The edited font survives a database reload',
    );
    echo wp_json_encode(['checks' => $checks, 'count' => count($checks)]);
} finally {
    wp_delete_post($id, true);
}
