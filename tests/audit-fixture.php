<?php
// Regression probes installed only in disposable tests. Never shipped in the plugin.
add_action('wp_ajax_lse_audit_test', static function () {
    if (
        !current_user_can('manage_options') ||
        !check_ajax_referer('lse_import', 'nonce', false)
    ) {
        wp_send_json_error([], 403);
    }
    $input = json_decode(wp_unslash($_POST['payload'] ?? '{}'), true);
    try {
        $op = $input['operation'] ?? '';
        if ($op === 'syntax') {
            foreach (
                glob(WP_PLUGIN_DIR . '/little-studio-elementor/includes/*.php')
                as $file
            ) {
                token_get_all(file_get_contents($file), TOKEN_PARSE);
            }
            wp_send_json_success(['syntax' => true]);
        }
        if ($op === 'compatibility') {
            $manifest = [
                'version' => '99.1.2',
                'sha256' => str_repeat('a', 64),
                'package' =>
                    LSE_Updates::REPO .
                    '/releases/download/v99.1.2/little-studio-elementor-99.1.2.zip',
                'requires' => '6.9',
                'requires_php' => '8.1',
                'tested' => '7.1.4',
            ];
            $parse = new ReflectionMethod('LSE_Updates', 'manifest');
            $parse->setAccessible(true);
            $release = $parse->invoke(null, $manifest);
            $item = new ReflectionMethod('LSE_Updates', 'item');
            $item->setAccessible(true);
            wp_send_json_success((array) $item->invoke(null, $release));
        }
        if ($op === 'css-parser') {
            $job = ['queue' => [], 'seen' => []];
            $method = new ReflectionMethod('LSE_Capture', 'css');
            $method->setAccessible(true);
            $method->invokeArgs(null, [
                &$job,
                '/*url(fake.png)*/ .x{content:"url(fake2.png)";background:url("photo (1).jpg");mask:url(icon\\(2\\).svg)}@import "nested (3).css";',
                'https://source.example/css/main.css',
            ]);
            wp_send_json_success([
                'queued' => array_column($job['queue'], 'url'),
            ]);
        }
        if ($op === 'pagination') {
            $ids = [];
            $owner = get_current_user_id();
            try {
                for ($i = 0; $i < 55; $i++) {
                    $id = bin2hex(random_bytes(16));
                    $ids[] = $id;
                    add_option(
                        '_lse_job_' . $id,
                        [
                            'id' => $id,
                            'owner' => $owner + 1000,
                            'title' => 'Foreign pagination fixture',
                            'state' => 'ready',
                            'created' => time(),
                            'pages' => [],
                        ],
                        '',
                        false,
                    );
                }
                for ($i = 0; $i < 55; $i++) {
                    $id = bin2hex(random_bytes(16));
                    $ids[] = $id;
                    add_option(
                        '_lse_job_' . $id,
                        [
                            'id' => $id,
                            'owner' => $owner,
                            'title' => 'Removed pagination fixture',
                            'state' => 'removed',
                            'created' => time(),
                            'pages' => [],
                        ],
                        '',
                        false,
                    );
                }
                delete_option('_lse_summaries_' . $owner);
                $listed = LSE_Importer::imports([]);
            } finally {
                foreach ($ids as $id) {
                    delete_option('_lse_job_' . $id);
                }
            }
            wp_send_json_success($listed);
        }
        if ($op === 'capture-reset') {
            delete_option('_lse_retry_fixture');
            wp_send_json_success(['ok' => true]);
        }
        if ($op === 'capture-count') {
            wp_send_json_success([
                'attempts' => (int) get_option('_lse_retry_fixture'),
            ]);
        }
        if ($op === 'font') {
            wp_send_json_success([
                'data' => base64_encode(
                    file_get_contents(
                        WP_PLUGIN_DIR .
                            '/elementor/assets/lib/eicons/fonts/eicons.ttf',
                    ),
                ),
            ]);
        }
        $id = $input['job'] ?? '';
        $key = '_lse_job_' . $id;
        $job = get_option($key);
        if (
            !is_array($job) ||
            (int) $job['owner'] !== get_current_user_id() ||
            !str_starts_with($job['title'], 'Audit regression')
        ) {
            throw new RuntimeException(
                'Only this disposable regression job may be changed.',
            );
        }
        $page = $job['pages'][0];
        if ($op === 'old-engine') {
            $job['engine'] = 'capture-v2';
            $job['state'] = 'importing';
            update_option($key, $job, false);
            wp_send_json_success(['ok' => true]);
        }
        if ($op === 'race') {
            $status = LSE_Importer::status(['job' => $id]);
            $p = $status['pages'][0];
            $hit = false;
            $filter = static function ($pre) use ($key, &$hit) {
                if (!$hit) {
                    $hit = true;
                    $other = get_option($key);
                    $other['other_writer'] = 'retained';
                    update_option($key, $other, false);
                }
                return $pre;
            };
            add_filter('pre_option_' . $key . '_lock', $filter);
            try {
                LSE_Importer::manage_page([
                    'job' => $id,
                    'key' => $p['key'],
                    'operation' => 'metadata',
                    'expected_stamp' => $p['current_stamp'],
                    'title' => $p['current_title'],
                    'slug' => $p['slug'],
                ]);
            } finally {
                remove_filter('pre_option_' . $key . '_lock', $filter);
            }
            wp_send_json_success([
                'injected' => $hit,
                'retained' =>
                    (get_option($key)['other_writer'] ?? '') === 'retained',
            ]);
        }
        if (in_array($op, ['partial-save', 'partial-refresh-backup'], true)) {
            $before_backup = get_post_meta(
                $page['id'],
                '_lse_refresh_backup',
                true,
            );
            if ($op === 'partial-refresh-backup') {
                $status = LSE_Importer::status(['job' => $id]);
                LSE_Importer::prepare([
                    'converter_version' => LSE_CONVERTER_VERSION,
                    'fingerprint' => hash('sha256', random_bytes(16)),
                    'operation_id' => bin2hex(random_bytes(16)),
                    'target_job' => $id,
                    'site_id' => $job['site_id'],
                    'title' => $job['title'],
                    'site' => $job['site'],
                    'pages' => [
                        [
                            'key' => $page['key'],
                            'title' => $page['title'],
                            'url' => $page['source_url'],
                            'slug' => $page['source_slug'],
                            'parent_key' => '',
                        ],
                    ],
                    'expected_stamps' => [
                        $page['key'] => $status['pages'][0]['current_stamp'],
                    ],
                    'overwrite' => true,
                ]);
                $input['page']['elements'][0]['settings']['_title'] =
                    'Interrupted refresh';
            }
            $payload = $input['page'];
            $payload['job'] = $id;
            $payload['key'] = $page['key'];
            $hit = false;
            $fail = static function ($meta, $post, $field) use ($page, &$hit) {
                if (
                    !$hit &&
                    (int) $post === (int) $page['id'] &&
                    $field === '_elementor_data'
                ) {
                    $hit = true;
                    throw new RuntimeException(
                        'Injected interruption after native write',
                    );
                }
            };
            add_action('added_post_meta', $fail, 10, 3);
            add_action('updated_post_meta', $fail, 10, 3);
            $error = '';
            try {
                LSE_Importer::page($payload);
            } catch (Throwable $e) {
                $error = $e->getMessage();
            } finally {
                remove_action('added_post_meta', $fail, 10);
                remove_action('updated_post_meta', $fail, 10);
            }
            $backup_preserved =
                $before_backup ===
                get_post_meta($page['id'], '_lse_refresh_backup', true);
            $retry = LSE_Importer::page($payload);
            wp_send_json_success([
                'injected' => $hit,
                'backupPreservedOnFailure' => $backup_preserved,
                'error' => $error,
                'retry' => get_option($key)['pages'][0]['done'],
                'journalRemoved' => !metadata_exists(
                    'post',
                    $page['id'],
                    '_lse_save_journal',
                ),
            ]);
        }
        if ($op === 'native-color') {
            $doc = \Elementor\Plugin::$instance->documents->get($page['id']);
            $tree = $doc->get_elements_data();
            $walk = static function (&$nodes) use (&$walk) {
                foreach ($nodes as &$node) {
                    if (($node['widgetType'] ?? '') === 'heading') {
                        $node['settings']['title_color'] = 'rgb(0, 128, 0)';
                        return true;
                    }
                    if ($walk($node['elements'])) {
                        return true;
                    }
                }
                return false;
            };
            $walk($tree);
            $doc->save(['elements' => $tree]);
            \Elementor\Core\Files\CSS\Post::create($page['id'])->delete();
            wp_send_json_success([
                'edited' => true,
                'savedGreen' => str_contains(
                    get_post_meta($page['id'], '_elementor_data', true),
                    'rgb(0, 128, 0)',
                ),
            ]);
        }
        if ($op === 'lease') {
            $name = $key . '_owned_lease';
            $first = LSE_Locks::acquire($name);
            update_option($name, [
                'token' => 'successor',
                'expires' => time() + 100,
            ]);
            LSE_Locks::release($first);
            $kept = get_option($name);
            delete_option($name);
            wp_send_json_success([
                'successorRetained' => ($kept['token'] ?? '') === 'successor',
            ]);
        }
        throw new RuntimeException('Unknown regression operation.');
    } catch (Throwable $e) {
        wp_send_json_error(['message' => $e->getMessage()], 400);
    }
});
add_filter(
    'pre_http_request',
    static function ($reply, $args, $url) {
        if (!str_starts_with($url, 'https://93.184.216.34/lse-audit/')) {
            return $reply;
        }
        $path = wp_parse_url($url, PHP_URL_PATH);
        $code = 200;
        $type = 'text/css';
        $body = '';
        if ($path === '/lse-audit/') {
            $type = 'text/html';
            $body =
                '<html><head><title>Audit regression capture</title><link rel="stylesheet" href="retry.css"><link rel="stylesheet" href="missing.css"></head><body><div data-settings=\'{"background_background":"slideshow","background_slideshow_gallery":[{"url":"slide.svg"}]}\'><h1>Captured background</h1></div></body></html>';
        } elseif ($path === '/lse-audit/retry.css') {
            $count = (int) get_option('_lse_retry_fixture');
            update_option('_lse_retry_fixture', $count + 1);
            if ($count === 0) {
                $code = 503;
            } else {
                $body = 'h1{color:red}';
            }
        } elseif ($path === '/lse-audit/missing.css') {
            $code = 404;
        } elseif ($path === '/lse-audit/slide.svg') {
            $type = 'image/svg+xml';
            $body =
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>';
        } else {
            $code = 404;
        }
        return [
            'headers' => ['content-type' => $type],
            'body' => $body,
            'response' => ['code' => $code, 'message' => 'Fixture'],
            'cookies' => [],
        ];
    },
    10,
    3,
);
