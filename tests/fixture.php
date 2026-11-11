<?php
// Public-address responses intercepted only in this disposable test installation.
add_filter( 'pre_http_request', static function( $reply, $args, $url ) {
    if ( ! str_starts_with( $url, 'https://93.184.216.34/lse-capture/' ) ) { return $reply; }
    $path = wp_parse_url( $url, PHP_URL_PATH );
    $files = [
        '/lse-capture/' => [ 'text/html; charset=UTF-8', '<!doctype html><html><head><title>Captured fixture</title><link rel="stylesheet" href="theme.css"><script src="app.js"></script></head><body class="capture-body"><nav><a href="./">Home</a><a href="about/">About</a></nav><main><h1>Captured native heading</h1><img src="pixel.png" alt="Captured pixel"><img src="pixel-copy.png" alt="Same pixel"></main><script type="module">window.moduleShouldNotRun=true;</script></body></html>' ],
        '/lse-capture/about/' => [ 'text/html', '<!doctype html><html><head><title>Captured About</title><link rel="stylesheet" href="../theme.css"></head><body><main><h1>Captured About</h1><a href="../">Home</a></main></body></html>' ],
        '/lse-capture/theme.css' => [ 'text/css', '@import "extra.css"; body{color:#243442}.capture-body main{padding:40px;background-image:url(pixel.png)}' ],
        '/lse-capture/extra.css' => [ 'text/css', 'h1{font-size:40px}' ],
        '/lse-capture/app.js' => [ 'application/javascript', 'window.capturedClassicScript=true;' ],
        '/lse-capture/pixel.png' => [ 'image/png', base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=' ) ],
        '/lse-capture/pixel-copy.png' => [ 'image/png', base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=' ) ],
    ];
    if ( $path === '/lse-capture/private-redirect' ) { return [ 'headers' => [ 'location' => 'http://127.0.0.1/private' ], 'body' => '', 'response' => [ 'code' => 302, 'message' => 'Found' ], 'cookies' => [] ]; }
    if ( ! isset( $files[$path] ) ) { return [ 'headers' => [], 'body' => '', 'response' => [ 'code' => 404, 'message' => 'Not found' ], 'cookies' => [] ]; }
    return [ 'headers' => [ 'content-type' => $files[$path][0] ], 'body' => $files[$path][1], 'response' => [ 'code' => 200, 'message' => 'OK' ], 'cookies' => [] ];
}, 10, 3 );
// Installed only into a disposable Playground site; never included in plugin ZIPs.
add_action( 'wp_ajax_lse_test', static function() {
    if ( ! current_user_can( 'manage_options' ) || ! check_ajax_referer( 'lse_import', 'nonce', false ) ) { wp_send_json_error( [ 'message' => 'Forbidden test request.' ], 403 ); }
    $input = json_decode( wp_unslash( $_POST['payload'] ?? '{}' ), true ); $id = (int) ( $input['id'] ?? 0 );
    try {
        switch ( $input['operation'] ?? 'inspect' ) {
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
