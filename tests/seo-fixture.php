<?php
// Disposable SEO provider checks; not included in the distributable plugin.
add_action('wp_ajax_lse_seo_test', static function () {
    if (
        !current_user_can('manage_options') ||
        !check_ajax_referer('lse_import', 'nonce', false)
    ) {
        wp_send_json_error([], 403);
    }
    $input = json_decode(wp_unslash($_POST['payload'] ?? '{}'), true);
    try {
        if (($input['operation'] ?? '') === 'provider') {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
            $plugins = [
                'yoast' => 'wordpress-seo/wp-seo.php',
                'rankmath' => 'seo-by-rank-math/rank-math.php',
                'aioseo' => 'all-in-one-seo-pack/all_in_one_seo_pack.php',
            ];
            foreach ($plugins as $file) {
                deactivate_plugins($file, true);
            }
            if (isset($plugins[$input['provider'] ?? ''])) {
                $result = activate_plugin(
                    $plugins[$input['provider']],
                    '',
                    false,
                    false,
                );
                if (is_wp_error($result)) {
                    throw new RuntimeException($result->get_error_message());
                }
            }
            // Native activation initializes defaults; no account connection/onboarding is needed for these isolated output checks.
            if (($input['provider'] ?? '') === 'rankmath') {
                update_option('rank_math_registration_skip', true);
                update_option('rank_math_wizard_completed', true);
            }
            delete_transient('_rank_math_activation_redirect');
            delete_transient('_aioseo_activation_redirect');
            wp_send_json_success(['active' => $input['provider'] ?? 'none']);
        }
        if (($input['operation'] ?? '') === 'publish') {
            $id = (int) ($input['id'] ?? 0);
            if (
                !str_starts_with(get_the_title($id), 'SEO regression') ||
                !current_user_can('edit_post', $id)
            ) {
                throw new RuntimeException(
                    'Only this disposable SEO fixture may be published.',
                );
            }
            $result = wp_update_post(
                ['ID' => $id, 'post_status' => 'publish'],
                true,
            );
            if (is_wp_error($result)) {
                throw new RuntimeException($result->get_error_message());
            }
            wp_send_json_success(['url' => get_permalink($id)]);
        }
        throw new RuntimeException('Unknown SEO fixture request.');
    } catch (Throwable $e) {
        wp_send_json_error(['message' => $e->getMessage()], 400);
    }
});
