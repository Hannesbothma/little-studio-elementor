<?php
// Public-address responses intercepted only in this disposable test installation.
add_filter( 'pre_http_request', static function( $reply, $args, $url ) {
    if ( ! str_starts_with( $url, 'https://93.184.216.34/lse-capture/' ) ) { return $reply; }
    $path = wp_parse_url( $url, PHP_URL_PATH );
    $files = [
        '/lse-capture/maintenance/' => ['text/html', '<title>Green Valley Lodge is under maintenance</title><h1>We will be back shortly</h1>'],
        '/lse-capture/background/' => ['text/html', '<title>Background fixture</title><style>@font-face{font-family:ReportFixture;src:url(missing-report-font.woff2)}@media(min-width:992px){.report-main,.report-sidebar{float:left}.report-main{width:66%}.report-sidebar{width:34%}}@media(max-width:500px){.report-main{min-width:480px}}</style><main><h1>Background fixture</h1><div class="report-row"><div class="report-main"><p>Main content</p></div><div class="report-sidebar"><p>Related items</p></div></div></main>'],
        '/lse-capture/' => [ 'text/html; charset=UTF-8', '<!doctype html><html><head><title>Captured fixture</title><link rel="stylesheet" href="theme.css"><script src="app.js"></script></head><body class="capture-body"><nav><a href="./">Home</a><a href="about/">About</a></nav><main><div class="elementor elementor-17" data-elementor-type="wp-page" data-elementor-id="17"><div class="elementor-element elementor-element-sourceheading elementor-widget-heading" data-id="sourceheading" data-element_type="widget" data-widget_type="heading.default"><div class="elementor-widget-container" role="region" aria-label="Captured heading region"><h1>Captured native heading</h1></div></div></div><img src="pixel.png" alt="Captured pixel"><img src="pixel-copy.png" alt="Same pixel"><div class="elementor-element elementor-widget-gallery" data-id="foreigngallery" data-element_type="widget" data-widget_type="gallery.default" data-settings=\'{"columns":2,"columns_tablet":2,"columns_mobile":1,"gap":{"size":12},"aspect_ratio":"3:2"}\'><div class="elementor-gallery__container"><a href="IMG_9876.svg"><div class="e-gallery-image elementor-gallery-item__image" data-thumbnail="IMG_9876.svg" data-width="320" data-height="180" aria-label="Courtyard view"></div></a></div></div><div data-lse-interaction><button>Custom interaction</button></div><script>var elementorFrontendConfig={foreignSource:true};</script><script src="/wp-includes/js/jquery/jquery.min.js"></script></main><script type="module">window.moduleShouldNotRun=true;</script></body></html>' ],
        '/lse-capture/about/' => [ 'text/html', '<!doctype html><html><head><title>Captured About</title><link rel="stylesheet" href="../theme.css"></head><body><main style="padding:40px"><div class="elementor elementor-33" data-elementor-type="wp-page" data-elementor-id="33"><div class="elementor-element elementor-element-oldabout elementor-widget-heading" data-id="oldabout" data-element_type="widget" data-widget_type="heading.default"><div class="elementor-widget-container"><h1>Captured About</h1></div></div></div><a href="../">Home</a><div data-lse-interaction><button>About interaction</button></div><script>window.capturedEditorScriptShouldNotRun=true;</script></main></body></html>' ],
        '/lse-capture/theme.css' => [ 'text/css', '@import "extra.css"; body{color:#243442}.capture-body main{padding:40px;background-image:url(pixel.png)}' ],
        '/lse-capture/extra.css' => [ 'text/css', '@font-face{font-family:CaptureIcons;src:url(icons.woff2) format("woff2")}h1{font-size:40px;color:rgb(17,34,51);margin:0}' ],
        '/lse-capture/IMG_9876.svg' => [ 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#b56d3a"/></svg>' ],
        '/lse-capture/icons.woff2' => [ 'font/woff2', file_get_contents( WP_PLUGIN_DIR . '/elementor/assets/lib/eicons/fonts/eicons.woff2' ) ],
        '/lse-capture/app.js' => [ 'application/javascript', 'window.capturedClassicScript=true;' ],
        '/lse-capture/pixel.png' => [ 'image/png', base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=' ) ],
        '/lse-capture/pixel-copy.png' => [ 'image/png', base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=' ) ],
    ];
    $files['/lse-capture/bulk/'] = [ 'text/html', '<main>' . implode( '', array_map( static fn( $i ) => '<img src="file-' . $i . '.png">', range( 1, 148 ) ) ) . '</main>' ];
    if ( preg_match( '~^/lse-capture/bulk/file-[0-9]+\.png$~', $path ) ) { $files[$path] = $files['/lse-capture/pixel.png']; }
    $files['/lse-capture/wide/'] = [ 'text/html', '<main>' . implode( '', array_map( static fn( $i ) => '<a href="page-' . $i . '/">Page</a>', range( 1, 201 ) ) ) . implode( '', array_map( static fn( $i ) => '<img src="image-' . $i . '.png">', range( 1, 601 ) ) ) . '</main>' ];
    $files['/lse-capture/'][1] = str_replace( '<main>', '<main>' . str_repeat( '<div class="deep-layout">', 80 ), $files['/lse-capture/'][1] );
    $files['/lse-capture/'][1] = str_replace( '</main>', str_repeat( '</div>', 80 ) . '</main>', $files['/lse-capture/'][1] );
    if ( $path === '/lse-capture/private-redirect' ) { return [ 'headers' => [ 'location' => 'http://127.0.0.1/private' ], 'body' => '', 'response' => [ 'code' => 302, 'message' => 'Found' ], 'cookies' => [] ]; }
    if ( ! isset( $files[$path] ) ) { return [ 'headers' => [], 'body' => '', 'response' => [ 'code' => 404, 'message' => 'Not found' ], 'cookies' => [] ]; }
    return [ 'headers' => [ 'content-type' => $files[$path][0] ], 'body' => $files[$path][1], 'response' => [ 'code' => 200, 'message' => 'OK' ], 'cookies' => [] ];
}, 10, 3 );
// Emulate slow image processing only for the partial-batch regression check.
add_action( 'pre_get_posts', static function( $query ) {
    static $delayed = false;
    if ( ! $delayed && ( $_POST['action'] ?? '' ) === 'lse_assets' && get_option( '_lse_test_slow_media' ) && ( ( $query->get( 'meta_key' ) === '_lse_sha256' || ( $query->get( 'meta_query' )[0]['key'] ?? '' ) === '_lse_sha256' ) ) ) { $delayed = true; usleep( 3100000 ); }
}, 10, 1 );
// Deterministic core-image failure; only enabled by the disposable image queue test.
add_filter('wp_image_editors', static function ($editors) {
    if (!get_option('_lse_test_image_failure')) return $editors;
    require_once ABSPATH . 'wp-includes/class-wp-image-editor.php';
    require_once ABSPATH . 'wp-includes/class-wp-image-editor-gd.php';
    if (!class_exists('LSE_Test_Image_Failure')) {
        class LSE_Test_Image_Failure extends WP_Image_Editor_GD {
            public function make_subsize($size_data) { return new WP_Error('fixture_image_size', 'Disposable image resize failure'); }
        }
    }
    return ['LSE_Test_Image_Failure'];
});
// Installed only into a disposable Playground site; never included in plugin ZIPs.
add_action( 'wp_ajax_lse_test', static function() {
    if ( ! current_user_can( 'manage_options' ) || ! check_ajax_referer( 'lse_import', 'nonce', false ) ) { wp_send_json_error( [ 'message' => 'Forbidden test request.' ], 403 ); }
    $input = json_decode( wp_unslash( $_POST['payload'] ?? '{}' ), true ); $id = (int) ( $input['id'] ?? 0 );
    try {
        switch ( $input['operation'] ?? 'inspect' ) {
            case 'background-cron':
                $hook = $input['kind'] === 'scan' ? 'lse_scan_work' : 'lse_import_work';
                $owner = get_current_user_id();
                $args = [$owner, $input['queue']];
                $due = wp_next_scheduled($hook, $args);
                if ($due === false || $due > time()) {
                    wp_send_json_success(false);
                }
                wp_unschedule_event($due, $hook, $args);
                wp_set_current_user(0);
                try {
                    do_action_ref_array($hook, $args);
                } finally {
                    wp_set_current_user($owner);
                }
                wp_send_json_success(true);
            case 'theme-builder-template':
                if (!class_exists(\ElementorPro\Modules\ThemeBuilder\Module::class)) {
                    throw new RuntimeException('Elementor Pro is required for this test.');
                }
                $kind = $input['kind'];
                $document = \Elementor\Plugin::$instance->documents->create($kind, [
                    'post_title' => 'Existing sitewide ' . $kind,
                    'post_status' => 'publish',
                ]);
                $id = $document->get_main_id();
                update_post_meta($id, '_elementor_conditions', ['include/general', 'exclude/singular/post/123']);
                \ElementorPro\Modules\ThemeBuilder\Module::instance()->get_conditions_manager()->get_cache()->regenerate();
                wp_send_json_success($id);
            case 'theme-builder-conditions':
                wp_send_json_success([
                    'status' => get_post_status($id),
                    'conditions' => get_post_meta($id, '_elementor_conditions', true),
                    'type' => get_post_meta($id, '_elementor_template_type', true),
                ]);
            case 'external-gallery':
                wp_send_json_success(wp_insert_post([
                    'post_type' => 'page',
                    'post_title' => 'Existing gallery',
                    'post_status' => 'publish',
                    'post_content' => '[gallery ids="' . $id . '"]',
                ]));
            case 'seed-cleanup-attachment':
                LSE_Importer::status(['job' => $input['job']]);
                $key = '_lse_job_' . $input['job'];
                $job = get_option($key);
                if (!$id) {
                    $name = sanitize_file_name($input['name']);
                    $uploads = wp_upload_dir();
                    $path = trailingslashit($uploads['path']) . $name;
                    file_put_contents($path, 'Disposable cleanup fixture');
                    $id = wp_insert_attachment([
                        'post_title' => $name,
                        'post_status' => 'inherit',
                        'post_mime_type' => str_ends_with($name, '.woff2') ? 'font/woff2' : 'image/svg+xml',
                    ], $path);
                    update_attached_file($id, $path);
                    update_post_meta($id, '_lse_job', $job['id']);
                }
                add_post_meta($id, '_lse_asset_job', $job['id']);
                $job['assets'][] = ['id' => $id, 'url' => wp_get_attachment_url($id), 'source' => 'https://example.test/fixture-' . $id];
                update_option($key, $job, false);
                wp_send_json_success(['id' => $id, 'font' => get_post_mime_type($id) === 'font/woff2']);
            case 'attachment-exists':
                wp_send_json_success(get_post_type($id) === 'attachment' && is_file(get_attached_file($id) ?: ''));
            case 'navigation':
                LSE_Importer::status(['job'=>$input['job']]);
                $job = get_option('_lse_job_' . $input['job']);
                $menu = (int) $job['menu'];
                $items = wp_get_nav_menu_items($menu, ['post_status'=>'any']);
                $bound = LSE_Native::settings(['lse_imported_menu'=>'yes', 'menu'=>'foreign-source-id'], $job, 'settings');
                wp_send_json_success([
                    'menu'=>$menu, 'binding'=>$bound['menu'],
                    'items'=>array_map(static fn($item)=>['id'=>$item->ID, 'title'=>$item->title, 'parent'=>(int)$item->menu_item_parent, 'object'=>(int)$item->object_id, 'type'=>$item->type, 'url'=>$item->url, 'target'=>$item->target], $items ?: []),
                    'html'=>wp_nav_menu(['menu'=>$menu,'echo'=>false,'fallback_cb'=>false]),
                ]);
            case 'navigation-recovery':
                LSE_Importer::status(['job'=>$input['job']]);
                $job = get_option('_lse_job_' . $input['job']);
                $job['id'] = bin2hex(random_bytes(16));
                unset($job['menu'], $job['menu_signature'], $job['menu_items'], $job['menu_complete']);
                $checkpoint = $job; $calls = 0;
                try {
                    LSE_Navigation::ensure($job, static function($state) use (&$checkpoint, &$calls) {
                        if (++$calls === 3) throw new RuntimeException('Simulated interruption after WordPress saved an item.');
                        $checkpoint = $state;
                    });
                    throw new RuntimeException('Interruption did not run.');
                } catch (RuntimeException $error) {
                    if (!str_starts_with($error->getMessage(), 'Simulated interruption')) throw $error;
                }
                $job = $checkpoint;
                LSE_Navigation::ensure($job, static function($state) {});
                $old_menu = $job['menu'];
                $resumed = wp_get_nav_menu_items($old_menu, ['post_status'=>'any']);
                if (count($resumed) !== count($input['expected_items'])) throw new RuntimeException('Retry duplicated or omitted menu items.');
                wp_update_nav_menu_item($old_menu, $resumed[0]->ID, ['menu-item-title'=>'User edited menu title', 'menu-item-type'=>$resumed[0]->type, 'menu-item-object'=>'page', 'menu-item-object-id'=>$resumed[0]->object_id, 'menu-item-status'=>'publish']);
                LSE_Navigation::ensure($job, static function($state) {});
                if (get_post($resumed[0]->ID)->post_title !== 'User edited menu title') throw new RuntimeException('Completed-menu retry overwrote an edit.');
                $job['site']['navigation'][0]['label'] = 'Changed definition';
                LSE_Navigation::ensure($job, static function($state) {});
                if ($old_menu === $job['menu'] || !wp_get_nav_menu_object($old_menu)) throw new RuntimeException('Changed definition did not preserve the prior menu.');
                wp_send_json_success(['resumeWithoutDuplicates'=>true, 'completedMenuEditsPreserved'=>true, 'changedDefinitionKeepsPriorMenu'=>true]);
            case 'navigation-journals':
                LSE_Importer::status(['job'=>$input['job']]);
                $base = get_option('_lse_job_' . $input['job']);
                foreach (['wp_create_nav_menu', 'wp_update_nav_menu_item'] as $hook) {
                    $job = $base; $job['id'] = bin2hex(random_bytes(16));
                    unset($job['menu'], $job['menu_signature'], $job['menu_items'], $job['menu_complete']);
                    $checkpoint = $job;
                    $stop = static function() { throw new RuntimeException('Journal interruption.'); };
                    add_action($hook, $stop, 999);
                    try {
                        LSE_Navigation::ensure($job, static function($state) use (&$checkpoint) {$checkpoint = $state;});
                        throw new RuntimeException('Journal interruption did not run.');
                    } catch (RuntimeException $error) {
                        if ($error->getMessage() !== 'Journal interruption.') throw $error;
                    } finally { remove_action($hook, $stop, 999); }
                    $job = $checkpoint;
                    LSE_Navigation::ensure($job, static function($state) {});
                    if (count(wp_get_nav_menu_items($job['menu'], ['post_status'=>'any'])) !== count($input['expected_items'])) throw new RuntimeException('Journal recovery duplicated or omitted menu items.');
                    $owned = get_terms(['taxonomy'=>'nav_menu','hide_empty'=>false,'meta_key'=>'_lse_job','meta_value'=>$job['id']]);
                    if (count($owned) !== 1) throw new RuntimeException('Journal recovery duplicated the menu.');
                }
                $job['site']['navigation'][0]['label'] = 'Other definition';
                LSE_Navigation::ensure($job, static function($state) {});
                $job['site'] = $base['site'];
                LSE_Navigation::ensure($job, static function($state) {});
                wp_send_json_success(['menuCreationGapRecovered'=>true, 'itemCreationGapRecovered'=>true, 'definitionCanRevert'=>true]);
            case 'native-validation': wp_send_json_success(LSE_Native::settings($input['settings'] ?? [], ['assets'=>[]], 'settings'));
            case 'purge-resource-fixture':
                $job = get_option( '_lse_job_' . $input['job'] );
                if ( ! is_array( $job ) || (int) $job['owner'] !== get_current_user_id() || $job['state'] !== 'removed' || ! str_starts_with( $job['title'], '148 resource regression ' ) ) { throw new RuntimeException( 'Only this disposable resource fixture can be cleaned.' ); }
                foreach ( array_unique( array_column( $job['assets'], 'id' ) ) as $attachment ) { if ( get_post_meta( $attachment, '_lse_job', true ) === $job['id'] ) { wp_delete_attachment( $attachment, true ); } }
                wp_send_json_success( [ 'ok' => true ] );
            case 'capture-stats':
                $capture = get_transient( 'lse_capture_' . get_current_user_id() . '_' . $input['capture'] );
                wp_send_json_success( [ 'seen' => count( $capture['seen'] ), 'maxPages' => $capture['maxPages'], 'depth' => $capture['depth'] ] );
            case 'suite-media-only':
                $hash = get_post_meta( $id, '_lse_sha256', true ); if ( ! $hash ) { throw new RuntimeException( 'The test media hash is missing.' ); }
                update_post_meta( $id, '_little_studio_import_sha256', $hash ); delete_post_meta( $id, '_lse_sha256' ); wp_send_json_success( [ 'ok' => true ] );
            case 'large-stats':
                $tree = json_decode( get_post_meta( $id, '_elementor_data', true ), true ); $settings_bytes = 0;
                foreach ( $tree as $node ) { $settings_bytes = max( $settings_bytes, strlen( wp_json_encode( $node['settings'] ) ) ); }
                wp_send_json_success( [ 'cssBytes' => strlen( get_post_meta( $id, '_lse_css', true ) ), 'sourceBytes' => strlen( wp_json_encode( get_post_meta( $id, '_lse_source', true ) ) ), 'settingsBytes' => $settings_bytes ] );
            case 'image-failure': update_option('_lse_test_image_failure', !empty($input['enabled'])); wp_send_json_success(['ok'=>true]);
            case 'image-state':
                wp_send_json_success(['meta'=>wp_get_attachment_metadata($id), 'task'=>get_post_meta($id,'_lse_image_task',true), 'queue'=>get_option('_lse_image_queue',[]), 'file'=>get_attached_file($id)]);
            case 'image-partial':
                $meta=wp_get_attachment_metadata($id); $size=$input['size'];
                if (!isset($meta['sizes'][$size])) throw new RuntimeException('Fixture size was not generated.');
                $sizes=wp_get_registered_image_subsizes();
                unset($meta['sizes'][$size]); wp_update_attachment_metadata($id,$meta); LSE_Media::enqueue($id,[$size=>$sizes[$size]]); wp_send_json_success(['ok'=>true]);
            case 'slow-media': update_option( '_lse_test_slow_media', ! empty( $input['enabled'] ) ); wp_send_json_success( [ 'ok' => true ] );
            case 'edit':
                $doc = \Elementor\Plugin::$instance->documents->get( $id ); $tree = $doc->get_elements_data();
                $edit = static function( &$nodes ) use ( &$edit ) { foreach ( $nodes as &$node ) { if ( ( $node['widgetType'] ?? '' ) === 'heading' ) { $node['settings']['title'] = 'Native Elementor edit'; return true; } if ( $edit( $node['elements'] ) ) { return true; } } return false; };
                $edit( $tree ); if ( ! $doc->save( [ 'elements' => $tree ] ) ) { throw new RuntimeException( 'Native editor save failed.' ); } break;
            case 'publish': wp_update_post( [ 'ID' => $id, 'post_status' => 'publish' ] ); break;
            case 'foreign-owner':
                $other = wp_create_user( 'other-admin', 'disposable-test-password', 'other@example.test' ); if ( is_wp_error( $other ) ) { $other = username_exists( 'other-admin' ); }
                ( new WP_User( $other ) )->set_role( 'administrator' ); wp_set_current_user( $other );
                try { LSE_Importer::status( [ 'job' => $input['job'] ] ); throw new RuntimeException( 'Foreign import access unexpectedly succeeded.' ); }
                catch ( RuntimeException $e ) { if ( str_contains( $e->getMessage(), 'unexpectedly' ) ) { throw $e; } wp_send_json_success( [ 'denied' => true ] ); }
                break;
            case 'versions': wp_send_json_success( [ 'wordpress' => get_bloginfo( 'version' ), 'php' => PHP_VERSION, 'elementor' => ELEMENTOR_VERSION ] );
            case 'updater':
                $manifest = json_decode( file_get_contents( '/packages/update-fixture/update.json' ), true );
                $zip = '/packages/update-fixture/little-studio-elementor-' . $manifest['version'] . '.zip';
                if ( ! is_file( $zip ) ) { throw new RuntimeException( 'The simulated updater package is missing.' ); }
                $api = 'https://api.github.com/repos/Hannesbothma/little-studio-elementor';
                $asset = [ 'id' => 999999, 'name' => basename( $zip ), 'state' => 'uploaded', 'url' => $api . '/releases/assets/999999', 'browser_download_url' => $manifest['package'], 'size' => filesize( $zip ), 'digest' => 'sha256:' . hash_file( 'sha256', $zip ) ];
                $json_asset = [ 'id' => 999998, 'name' => 'update.json', 'state' => 'uploaded', 'url' => $api . '/releases/assets/999998', 'browser_download_url' => dirname( $manifest['package'] ) . '/update.json' ];
                add_filter( 'pre_http_request', static function( $reply, $args, $url ) use ( $manifest, $zip, $api, $asset, $json_asset ) {
                    if ( $url === $api . '/releases/latest' ) { return [ 'headers' => [], 'body' => wp_json_encode( [ 'tag_name' => 'v' . $manifest['version'], 'draft' => false, 'prerelease' => false, 'assets' => [ $asset, $json_asset ], 'body' => 'Disposable native upgrade fixture.' ] ), 'response' => [ 'code' => 200, 'message' => 'OK' ], 'cookies' => [] ]; }
                    if ( $url === $json_asset['url'] ) { return [ 'headers' => [], 'body' => wp_json_encode( $manifest ), 'response' => [ 'code' => 200, 'message' => 'OK' ], 'cookies' => [] ]; }
                    if ( $url === $asset['url'] ) { $bytes = file_get_contents( $zip ); if ( ! empty( $args['stream'] ) ) { file_put_contents( $args['filename'], $bytes ); $bytes = ''; } return [ 'headers' => [], 'body' => $bytes, 'response' => [ 'code' => 200, 'message' => 'OK' ], 'cookies' => [] ]; }
                    if ( str_starts_with( $url, 'https://github.com/Hannesbothma/little-studio-elementor/releases/' ) ) { return new WP_Error( 'fixture_504', 'Standard release route deliberately unavailable.' ); }
                    return $reply;
                }, 10, 3 );
                $file = plugin_basename( LSE_FILE ); $preferences = array_values( array_diff( (array) get_site_option( 'auto_update_plugins', [] ), [ $file ] ) ); update_site_option( 'auto_update_plugins', $preferences );
                $before = get_post_meta( $id, '_elementor_data', true );
                $result = LSE_Updates::update_install();
                if ( empty( $result['updated'] ) || $result['installed'] !== $manifest['version'] || get_post_meta( $id, '_elementor_data', true ) !== $before || ! is_plugin_active( $file ) || in_array( $file, (array) get_site_option( 'auto_update_plugins', [] ), true ) ) { throw new RuntimeException( 'Native upgrade or content/preference preservation failed.' ); }
                wp_send_json_success( [ 'nativeUpgrade' => true, 'installed' => $result['installed'], 'contentAndActivationPreserved' => true, 'automaticUpdatePreferencePreserved' => true, 'apiDownloadWithStandardRouteUnavailable' => true ] );
        }
        $post = get_post( $id );
        wp_send_json_success( [ 'post' => $post ? [ 'id' => $post->ID, 'title' => $post->post_title, 'slug' => $post->post_name, 'status' => $post->post_status ] : null, 'elements' => json_decode( get_post_meta( $id, '_elementor_data', true ), true ), 'css' => get_post_meta( $id, '_lse_css', true ), 'js' => get_post_meta( $id, '_lse_js', true ), 'backup' => metadata_exists( 'post', $id, '_lse_refresh_backup' ), 'page_count' => (int) wp_count_posts( 'page' )->draft + (int) wp_count_posts( 'page' )->publish ] );
    } catch ( Throwable $e ) { wp_send_json_error( [ 'message' => $e->getMessage() ], 400 ); }
} );

// A real theme-path stylesheet distinguishes standalone imports from theme layouts.
add_action( 'wp_enqueue_scripts', static function() {
    if ( get_post_field( 'post_title', get_queried_object_id() ) !== 'Source CSS regression' ) { return; }
    wp_enqueue_style( 'lse-test-theme', get_stylesheet_directory_uri() . '/style.css', [], '1' );
    wp_add_inline_style( 'lse-test-theme', 'a{--lse-theme-marker:theme;}' );
}, 29 );
