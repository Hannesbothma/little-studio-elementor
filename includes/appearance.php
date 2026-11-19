<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Source geometry and image paint stay editable on their actual native targets. */
final class LSE_Appearance
{
    public static function init()
    {
        add_action(
            'elementor/element/after_section_end',
            static function ($element, $section) {
                if (
                    $element->get_type() === 'widget' &&
                    !$element->get_controls('lse_widget_display')
                ) {
                    $element->start_controls_section(
                        'section_lse_widget_layout',
                        [
                            'label' => 'Imported layout',
                            'tab' => \Elementor\Controls_Manager::TAB_ADVANCED,
                        ],
                    );
                    self::box_control(
                        $element,
                        'lse_box_sizing',
                        '{{WRAPPER}}',
                    );
                    self::position_controls($element);
                    self::flex_basis_control($element);
                    $element->add_responsive_control('lse_height', [
                        'label' => 'Height',
                        'type' => \Elementor\Controls_Manager::SLIDER,
                        'size_units' => [
                            'px',
                            '%',
                            'vh',
                            'vw',
                            'em',
                            'rem',
                            'custom',
                        ],
                        'selectors' => [
                            '{{WRAPPER}}.elementor-element' =>
                                'height:{{SIZE}}{{UNIT}};',
                        ],
                    ]);
                    $element->add_responsive_control('lse_widget_display', [
                        'label' => 'Display',
                        'type' => \Elementor\Controls_Manager::SELECT,
                        'options' => [
                            '' => 'Default',
                            'var(--lse-source-display)' =>
                                'Captured responsive display',
                            'block' => 'Block',
                            'inline-block' => 'Inline block',
                            'flex' => 'Flex',
                            'inline-flex' => 'Inline flex',
                            'grid' => 'Grid',
                            'inline-grid' => 'Inline grid',
                            'none' => 'Hidden',
                        ],
                        'selectors' => ['{{WRAPPER}}' => 'display:{{VALUE}};'],
                    ]);
                    $element->end_controls_section();
                }
                if (
                    in_array(
                        $element->get_type(),
                        ['container', 'section', 'column'],
                        true,
                    ) &&
                    $section !== 'section_lse_geometry' &&
                    !$element->get_controls('lse_height')
                ) {
                    $element->start_controls_section('section_lse_geometry', [
                        'label' => 'Imported dimensions',
                        'tab' => \Elementor\Controls_Manager::TAB_LAYOUT,
                    ]);
                    self::box_control(
                        $element,
                        'lse_box_sizing',
                        '{{WRAPPER}}',
                    );
                    self::position_controls($element);
                    self::flex_basis_control($element);
                    foreach (
                        ['x' => 'Horizontal', 'y' => 'Vertical']
                        as $axis => $label
                    ) {
                        $element->add_responsive_control(
                            'lse_overflow_' . $axis,
                            [
                                'label' => $label . ' overflow',
                                'description' =>
                                    'Source clipping. Clear to use the standard Overflow setting.',
                                'type' => \Elementor\Controls_Manager::SELECT,
                                'options' => [
                                    '' => 'Default',
                                    'visible' => 'Visible',
                                    'hidden' => 'Hidden',
                                    'clip' => 'Clip',
                                    'auto' => 'Auto',
                                    'scroll' => 'Scroll',
                                ],
                                'selectors' => [
                                    '{{WRAPPER}}.elementor-element' =>
                                        'overflow-' . $axis . ':{{VALUE}};',
                                ],
                            ],
                        );
                    }
                    $element->add_responsive_control('lse_height', [
                        'label' => 'Height',
                        'type' => \Elementor\Controls_Manager::SLIDER,
                        'size_units' => [
                            'px',
                            '%',
                            'vh',
                            'vw',
                            'em',
                            'rem',
                            'custom',
                        ],
                        'selectors' => [
                            '{{WRAPPER}}' => 'height:{{SIZE}}{{UNIT}};',
                        ],
                    ]);
                    $element->add_responsive_control('lse_display', [
                        'label' => 'Display',
                        'type' => \Elementor\Controls_Manager::SELECT,
                        'options' => [
                            '' => 'Default',
                            'var(--lse-source-display)' =>
                                'Captured responsive display',
                            'block' => 'Block',
                            'inline' => 'Inline',
                            'inline-block' => 'Inline block',
                            'flex' => 'Flex',
                            'inline-flex' => 'Inline flex',
                            'grid' => 'Grid',
                            'inline-grid' => 'Inline grid',
                            'contents' => 'Contents',
                            'none' => 'Hidden',
                        ],
                        'selectors' => ['{{WRAPPER}}' => 'display:{{VALUE}};'],
                    ]);
                    foreach (
                        [
                            'direction' => [
                                'row' => 'Row',
                                'row-reverse' => 'Reversed row',
                                'column' => 'Column',
                                'column-reverse' => 'Reversed column',
                            ],
                            'wrap' => [
                                'nowrap' => 'No wrap',
                                'wrap' => 'Wrap',
                                'wrap-reverse' => 'Reversed wrap',
                            ],
                        ]
                        as $property => $choices
                    ) {
                        $element->add_responsive_control(
                            'lse_flex_' . $property,
                            [
                                'label' => 'Flex ' . $property,
                                'description' =>
                                    'For imported layouts that switch between Grid and Flex.',
                                'type' => \Elementor\Controls_Manager::SELECT,
                                'options' =>
                                    [
                                        '' => 'Default',
                                        'var(--lse-source-flex-' .
                                        $property .
                                        ')' => 'Captured responsive value',
                                    ] + $choices,
                                'selectors' => [
                                    '{{WRAPPER}}.elementor-element' =>
                                        'flex-' . $property . ':{{VALUE}};',
                                ],
                            ],
                        );
                    }
                    $element->add_responsive_control('lse_text_align', [
                        'label' => 'Text alignment',
                        'type' => \Elementor\Controls_Manager::SELECT,
                        'options' => [
                            '' => 'Default',
                            'start' => 'Start',
                            'end' => 'End',
                            'left' => 'Left',
                            'center' => 'Center',
                            'right' => 'Right',
                            'justify' => 'Justify',
                        ],
                        'selectors' => [
                            '{{WRAPPER}}' => 'text-align:{{VALUE}};',
                        ],
                    ]);
                    $element->add_responsive_control('lse_justify_self', [
                        'label' => 'Grid horizontal alignment',
                        'type' => \Elementor\Controls_Manager::SELECT,
                        'options' => [
                            'auto' => 'Auto',
                            'normal' => 'Normal',
                            'start' => 'Start',
                            'end' => 'End',
                            'center' => 'Center',
                            'stretch' => 'Stretch',
                            'self-start' => 'Self start',
                            'self-end' => 'Self end',
                        ],
                        'selectors' => [
                            '{{WRAPPER}}' => 'justify-self:{{VALUE}};',
                        ],
                    ]);
                    $element->end_controls_section();
                    $element->start_controls_section('section_lse_paint', [
                        'label' => 'Imported responsive colours',
                        'tab' => \Elementor\Controls_Manager::TAB_STYLE,
                    ]);
                    $element->add_responsive_control('lse_background_color', [
                        'label' => 'Background colour override',
                        'type' => \Elementor\Controls_Manager::COLOR,
                        'selectors' => [
                            '{{WRAPPER}}' => 'background-color:{{VALUE}};',
                        ],
                    ]);
                    $element->add_responsive_control('lse_overlay_color', [
                        'label' => 'Overlay colour override',
                        'type' => \Elementor\Controls_Manager::COLOR,
                        'selectors' => [
                            '{{WRAPPER}}::before, {{WRAPPER}} > .elementor-background-slideshow::before, {{WRAPPER}} > .e-con-inner > .elementor-background-slideshow::before' =>
                                'background-color:{{VALUE}};',
                        ],
                    ]);
                    $element->end_controls_section();
                }
                // After the built-in image controls so mobile overrides keep their order.
                if (
                    $element->get_name() !== 'image' ||
                    $section !== 'section_style_caption' ||
                    $element->get_controls('lse_image_padding')
                ) {
                    return;
                }
                $element->start_controls_section('section_lse_image', [
                    'label' => 'Imported image appearance',
                    'tab' => \Elementor\Controls_Manager::TAB_STYLE,
                ]);
                $element->add_group_control(
                    \Elementor\Group_Control_Background::get_type(),
                    [
                        'name' => 'lse_image_background',
                        'types' => ['classic', 'gradient'],
                        'selector' => '{{WRAPPER}} img',
                        'fields_options' => ['color' => ['responsive' => true]],
                    ],
                );
                self::box_control(
                    $element,
                    'lse_image_box_sizing',
                    '{{WRAPPER}} img',
                );
                $element->add_responsive_control('lse_image_padding', [
                    'label' => 'Image padding',
                    'type' => \Elementor\Controls_Manager::DIMENSIONS,
                    'size_units' => ['px', '%', 'em', 'rem', 'custom'],
                    'selectors' => [
                        '{{WRAPPER}} img' =>
                            'padding:{{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};',
                    ],
                ]);
                $element->add_responsive_control('lse_image_opacity', [
                    'label' => 'Responsive opacity override',
                    'type' => \Elementor\Controls_Manager::SLIDER,
                    'range' => [
                        'px' => ['min' => 0, 'max' => 1, 'step' => 0.01],
                    ],
                    'selectors' => ['{{WRAPPER}} img' => 'opacity:{{SIZE}};'],
                ]);
                $element->end_controls_section();
            },
            30,
            2,
        );
    }
    private static function flex_basis_control($element)
    {
        $element->add_responsive_control('lse_flex_basis', [
            'label' => 'Flex basis',
            'type' => \Elementor\Controls_Manager::SLIDER,
            'size_units' => ['px', '%', 'vw', 'vh', 'em', 'rem', 'custom'],
            'selectors' => [
                '{{WRAPPER}}.elementor-element' =>
                    'flex-basis:{{SIZE}}{{UNIT}};',
            ],
        ]);
    }

    private static function position_controls($element)
    {
        $selector = '{{WRAPPER}}.elementor-element';
        $element->add_responsive_control('lse_position', [
            'label' => 'Imported position',
            'description' =>
                'Preserves positioning per device. Clear this override to use Elementor Position controls.',
            'type' => \Elementor\Controls_Manager::SELECT,
            'options' => [
                '' => 'Default',
                'static' => 'Normal flow',
                'relative' => 'Relative',
                'absolute' => 'Absolute',
                'fixed' => 'Fixed',
                'sticky' => 'Sticky',
            ],
            'selectors' => [$selector => 'position:{{VALUE}};'],
        ]);
        foreach (['top', 'right', 'bottom', 'left'] as $side) {
            $element->add_responsive_control('lse_offset_' . $side, [
                'label' => 'Imported ' . $side,
                'type' => \Elementor\Controls_Manager::SLIDER,
                'size_units' => ['px', '%', 'vh', 'vw', 'em', 'rem', 'custom'],
                'condition' => [
                    'lse_position' => [
                        'relative',
                        'absolute',
                        'fixed',
                        'sticky',
                    ],
                ],
                'selectors' => [$selector => $side . ':{{SIZE}}{{UNIT}};'],
            ]);
        }
    }
    private static function box_control($element, $name, $selector)
    {
        $element->add_responsive_control($name, [
            'label' => 'Box sizing',
            'type' => \Elementor\Controls_Manager::SELECT,
            'options' => [
                '' => 'Default',
                'border-box' => 'Include padding and border',
                'content-box' => 'Content size plus padding and border',
            ],
            'selectors' => [$selector => 'box-sizing:{{VALUE}};'],
        ]);
    }
}
