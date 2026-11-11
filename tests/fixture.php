<?php
// Public-address responses intercepted only in this disposable test installation.
add_filter( 'pre_http_request', static function( $reply, $args, $url ) {
    if ( ! str_starts_with( $url, 'https://93.184.216.34/lse-capture/' ) ) { return $reply; }
    $path = wp_parse_url( $url, PHP_URL_PATH );
    $files = [
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
// Installed only into a disposable Playground site; never included in plugin ZIPs.
add_action( 'wp_ajax_lse_test', static function() {
    if ( ! current_user_can( 'manage_options' ) || ! check_ajax_referer( 'lse_import', 'nonce', false ) ) { wp_send_json_error( [ 'message' => 'Forbidden test request.' ], 403 ); }
    $input = json_decode( wp_unslash( $_POST['payload'] ?? '{}' ), true ); $id = (int) ( $input['id'] ?? 0 );
    try {
        switch ( $input['operation'] ?? 'inspect' ) {
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
                add_filter( 'pre_http_request', static function( $reply, $args, $url ) use ( $manifest, $zip, $api, $asset ) {
                    if ( $url === $api . '/releases/latest' ) { return [ 'headers' => [], 'body' => wp_json_encode( [ 'tag_name' => 'v' . $manifest['version'], 'draft' => false, 'prerelease' => false, 'assets' => [ $asset ], 'body' => 'Disposable native upgrade fixture.' ] ), 'response' => [ 'code' => 200, 'message' => 'OK' ], 'cookies' => [] ]; }
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
