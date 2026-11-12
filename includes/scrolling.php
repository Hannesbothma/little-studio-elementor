<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Editable imported sticky settings, independent of the source builder runtime. */
final class LSE_Scrolling
{
    public static function init()
    {
        add_action(
            'elementor/element/after_section_end',
            static function ($element, $section) {
                if (
                    !in_array(
                        $element->get_type(),
                        ['container', 'section', 'column', 'widget'],
                        true,
                    ) ||
                    $section === 'section_lse_scrolling' ||
                    $element->get_controls('lse_sticky')
                ) {
                    return;
                }
                $element->start_controls_section('section_lse_scrolling', [
                    'label' => 'Imported scrolling',
                    'tab' => \Elementor\Controls_Manager::TAB_ADVANCED,
                ]);
                $element->add_control('lse_sticky', [
                    'label' => 'Sticky position',
                    'type' => \Elementor\Controls_Manager::SELECT,
                    'options' => [
                        '' => 'None',
                        'top' => 'Top',
                        'bottom' => 'Bottom',
                    ],
                    'default' => '',
                    'render_type' => 'template',
                ]);
                $element->add_control('lse_sticky_devices', [
                    'label' => 'Sticky on',
                    'type' => \Elementor\Controls_Manager::SELECT2,
                    'multiple' => true,
                    'options' => [
                        'desktop' => 'Desktop',
                        'tablet' => 'Tablet',
                        'mobile' => 'Mobile',
                    ],
                    'default' => ['desktop', 'tablet', 'mobile'],
                    'condition' => ['lse_sticky!' => ''],
                ]);
                $element->add_responsive_control('lse_sticky_offset', [
                    'label' => 'Edge offset',
                    'type' => \Elementor\Controls_Manager::SLIDER,
                    'size_units' => ['px'],
                    'condition' => ['lse_sticky!' => ''],
                ]);
                $element->add_control('lse_sticky_effects_offset', [
                    'label' => 'Effects scroll distance',
                    'type' => \Elementor\Controls_Manager::NUMBER,
                    'default' => 0,
                    'condition' => ['lse_sticky!' => ''],
                ]);
                $element->add_control('lse_sticky_background', [
                    'label' => 'Background when sticky',
                    'description' =>
                        'Leave empty to keep the captured scrolling appearance.',
                    'type' => \Elementor\Controls_Manager::COLOR,
                    'condition' => ['lse_sticky!' => ''],
                    'selectors' => [
                        '{{WRAPPER}}.lse-source-elementor-sticky--effects[data-lse-sticky][data-lse-native]' =>
                            'background-color:{{VALUE}};',
                    ],
                ]);
                $element->add_control('lse_sticky_parent', [
                    'label' => 'Stay inside parent',
                    'type' => \Elementor\Controls_Manager::SWITCHER,
                    'condition' => ['lse_sticky!' => ''],
                ]);
                $element->end_controls_section();
            },
            20,
            2,
        );
        add_action(
            'elementor/frontend/before_render',
            static function ($element) {
                $raw = $element->get_data('settings');
                $mode = $raw['lse_sticky'] ?? '';
                if (!in_array($mode, ['top', 'bottom'], true)) {
                    return;
                }
                $settings = $element->get_settings_for_display();
                $offsets = [];
                foreach (
                    [
                        'desktop' => '',
                        'tablet' => '_tablet',
                        'mobile' => '_mobile',
                    ]
                    as $device => $suffix
                ) {
                    $value =
                        $settings['lse_sticky_offset' . $suffix]['size'] ??
                        null;
                    if (is_numeric($value) && is_finite((float) $value)) {
                        $offsets[$device] = (float) $value;
                    }
                }
                $devices = $settings['lse_sticky_devices'] ?? [
                    'desktop',
                    'tablet',
                    'mobile',
                ];
                $config = [
                    'edge' => $mode,
                    'devices' => array_values(
                        array_intersect(is_array($devices) ? $devices : [], [
                            'desktop',
                            'tablet',
                            'mobile',
                        ]),
                    ),
                    'offsets' => $offsets,
                    'effects' => is_numeric(
                        $settings['lse_sticky_effects_offset'] ?? null,
                    )
                        ? (float) $settings['lse_sticky_effects_offset']
                        : 0,
                    'parent' =>
                        ($settings['lse_sticky_parent'] ?? '') === 'yes',
                ];
                $element->add_render_attribute(
                    '_wrapper',
                    'data-lse-sticky',
                    wp_json_encode($config),
                );
            },
            20,
        );
    }
}
