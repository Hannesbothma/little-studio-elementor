<?php
// Owned disposable fixtures only; not shipped in the plugin package.
add_action('wp_ajax_lse_fidelity_test', static function () {
    if (
        !current_user_can('manage_options') ||
        !check_ajax_referer('lse_import', 'nonce', false)
    ) {
        wp_send_json_error([], 403);
    }
    try {
        $input = json_decode(wp_unslash($_POST['payload'] ?? '{}'), true);
        $id = (int) ($input['id'] ?? 0);
        $job = get_option('_lse_job_' . get_post_meta($id, '_lse_job', true));
        if (
            !is_array($job) ||
            (int) $job['owner'] !== get_current_user_id() ||
            !str_starts_with($job['title'], 'Fidelity regression') ||
            !current_user_can('edit_post', $id)
        ) {
            throw new RuntimeException(
                'Only the owned fidelity fixture may be changed.',
            );
        }
        $document = \Elementor\Plugin::$instance->documents->get($id);
        $tree = $document->get_elements_data();
        $edited = [];
        $walk = static function (&$nodes) use (&$walk, &$edited) {
            foreach ($nodes as &$node) {
                $classes =
                    $node['settings']['css_classes'] ??
                    ($node['settings']['_css_classes'] ?? '');
                if (
                    ($node['widgetType'] ?? '') === 'image' &&
                    in_array('painted', explode(' ', $classes), true)
                ) {
                    $node['settings']['height'] = [
                        'unit' => 'px',
                        'size' => 170,
                    ];
                    $node['settings']['lse_image_background_color'] = '#dd44cc';
                    $edited[] = 'image';
                }
                if (in_array('replica-sticky', explode(' ', $classes), true)) {
                    $node['settings']['lse_sticky_offset'] = [
                        'unit' => 'px',
                        'size' => 26,
                    ];
                    $node['settings']['lse_sticky_devices'] = ['desktop'];
                    $node['settings']['lse_sticky_background'] = '#bb7733';
                    $edited[] = 'sticky';
                }
                $walk($node['elements']);
            }
        };
        $walk($tree);
        if (!$document->save(['elements' => $tree])) {
            throw new RuntimeException(
                'Native Elementor document save failed.',
            );
        }
        \Elementor\Core\Files\CSS\Post::create($id)->delete();
        wp_send_json_success([
            'edited' => $edited,
            'status' => get_post_status($id),
        ]);
    } catch (Throwable $e) {
        wp_send_json_error(['message' => $e->getMessage()], 400);
    }
});
