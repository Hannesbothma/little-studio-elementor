<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
final class LSE_Plugin {
    private static $response_level = 0;
    private static function send( $success, $data, $status = 200 ) {
        $extra_output = false;
        while ( self::$response_level && ob_get_level() >= self::$response_level ) { $extra_output = $extra_output || trim( (string) ob_get_contents() ) !== ''; ob_end_clean(); }
        if ( $extra_output ) { error_log( 'Little Studio import: additional server output was suppressed from an AJAX response.' ); if ( ! headers_sent() ) { header( 'X-Little-Studio-Output-Cleaned: 1' ); } }
        if ( ! headers_sent() ) { header( 'X-Little-Studio-Handler: converter' ); }
        wp_send_json( [ 'success' => $success, 'data' => $data ], $status );
    }
    private static function input( $action ) {
        if ( isset( $_FILES['payload_file'] ) ) {
            if ( $action !== 'page' || isset( $_POST['payload'] ) ) { throw new RuntimeException( 'Unexpected or ambiguous page upload.' ); }
            $file = $_FILES['payload_file'];
            if ( ! is_array( $file ) || ! isset( $file['error'] ) || ! is_int( $file['error'] ) || $file['error'] !== UPLOAD_ERR_OK ) { throw new RuntimeException( 'The converted page upload failed. Check the hosting upload limit and retry the saved import.' ); }
            $temporary = $file['tmp_name'] ?? '';
            if ( ! is_string( $temporary ) || ! is_uploaded_file( $temporary ) ) { throw new RuntimeException( 'The converted page must be a valid upload.' ); }
            $size = filesize( $temporary );
            if ( ! $size || $size > 16 * MB_IN_BYTES ) { throw new RuntimeException( 'The converted page upload is empty or exceeds 16 MB.' ); }
            $raw = file_get_contents( $temporary );
            if ( ! is_string( $raw ) || strlen( $raw ) !== $size ) { throw new RuntimeException( 'The converted page upload could not be read completely.' ); }
            if ( str_starts_with( $raw, "\x1f\x8b" ) ) {
                if ( ! function_exists( 'gzdecode' ) ) { throw new RuntimeException( 'Compressed page imports are unavailable on this server.' ); }
                $raw = @gzdecode( $raw, 16 * MB_IN_BYTES + 1 );
                if ( ! is_string( $raw ) ) { throw new RuntimeException( 'The compressed page could not be decoded.' ); }
            }
        } else {
            $raw = $_POST['payload'] ?? '{}';
            if ( ! is_string( $raw ) ) { throw new RuntimeException( 'The request payload must be JSON text.' ); }
            $raw = wp_unslash( $raw );
        }
        if ( strlen( $raw ) > 16 * MB_IN_BYTES || ! str_starts_with( ltrim( $raw ), '{' ) ) { throw new RuntimeException( 'The request must contain one JSON object below 16 MB.' ); }
        $input = json_decode( $raw, true, 128, JSON_THROW_ON_ERROR );
        if ( ! is_array( $input ) ) { throw new RuntimeException( 'Invalid request.' ); }
        return $input;
    }
    public static function init() {
        add_action( 'rest_api_init', static function() {
            register_rest_route( 'little-studio-elementor/v1', '/converted-page', [
                'methods' => 'POST',
                'permission_callback' => static function( $request ) {
                    if ( ! current_user_can( 'manage_options' ) || ! current_user_can( 'edit_pages' ) || ! current_user_can( 'upload_files' ) ) { return new WP_Error( 'lse_forbidden', 'An administrator with page and upload permissions is required.', [ 'status' => 403 ] ); }
                    if ( ! wp_verify_nonce( $request->get_param( 'nonce' ), 'lse_import' ) ) { return new WP_Error( 'lse_session', 'Reload the converter to refresh your session.', [ 'status' => 403 ] ); }
                    return true;
                },
                'callback' => static function() {
                    try { $response = new WP_REST_Response( [ 'success' => true, 'data' => LSE_Importer::page( self::input( 'page' ) ) ], 200 ); }
                    catch ( Throwable $error ) { $response = new WP_REST_Response( [ 'success' => false, 'data' => [ 'message' => $error->getMessage() ] ], 400 ); }
                    $response->header( 'X-Little-Studio-Handler', 'converter' );
                    return $response;
                },
            ] );
        } );
        $actions = [ 'imports', 'manage_page', 'restore_refresh', 'check', 'start', 'asset', 'page', 'finish', 'status', 'undo', 'activate', 'restore', 'update_check', 'update_install' ];
        $requested = $_REQUEST['action'] ?? '';
        if ( defined( 'DOING_AJAX' ) && DOING_AJAX && is_string( $requested ) && in_array( $requested, array_map( static fn( $action ) => 'lse_' . $action, $actions ), true ) ) { self::$response_level = ob_get_level() + 1; ob_start(); }
        add_action( 'elementor/widgets/register', static function( $manager ) { require_once __DIR__ . '/shared-widget.php'; $manager->register( new LSE_Shared_Widget() ); } );
        add_action( 'elementor/element/image/section_image/before_section_end', static function( $element ) { $element->add_control( 'lse_alt_override', [ 'label' => 'Use page-specific alternative text', 'type' => \Elementor\Controls_Manager::SWITCHER, 'default' => '' ] ); $element->add_control( 'lse_image_alt', [ 'label' => 'Alternative text', 'description' => 'Imported image description for this page. Leave empty for a decorative image.', 'type' => \Elementor\Controls_Manager::TEXTAREA, 'condition' => [ 'lse_alt_override' => 'yes' ] ] ); } );
        add_filter( 'elementor/widget/render_content', static function( $content, $widget ) { if ( $widget->get_name() === 'image' && $widget->get_settings( 'lse_alt_override' ) === 'yes' ) { $html = new WP_HTML_Tag_Processor( $content ); if ( $html->next_tag( 'img' ) ) { $html->set_attribute( 'alt', (string) $widget->get_settings( 'lse_image_alt' ) ); return $html->get_updated_html(); } } return $content; }, 10, 2 );
        add_action( 'admin_menu', [ __CLASS__, 'menu' ] );
        add_action( 'admin_init', static function() { global $pagenow; if ( $pagenow === 'tools.php' && ( $_GET['page'] ?? '' ) === 'little-studio-elementor' && current_user_can( 'manage_options' ) ) { wp_safe_redirect( admin_url( 'admin.php?page=little-studio-elementor' ) ); exit; } } );
        add_filter( 'plugin_action_links_' . plugin_basename( LSE_FILE ), static function( $links ) { array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=little-studio-elementor' ) ) . '">Open converter</a>' ); return $links; } );
        add_action( 'admin_enqueue_scripts', [ __CLASS__, 'assets' ] );
        foreach ( $actions as $action ) {
            add_action( 'wp_ajax_lse_' . $action, function() use ( $action ) {
                try {
                    if ( ! current_user_can( 'manage_options' ) || ! current_user_can( 'edit_pages' ) || ! current_user_can( 'upload_files' ) ) { self::send( false, [ 'message' => 'An administrator with page and upload permissions is required.' ], 403 ); }
                    if ( ! check_ajax_referer( 'lse_import', 'nonce', false ) ) { self::send( false, [ 'message' => 'Your WordPress session expired. Reload the converter page and sign in if needed.' ], 403 ); }
                    $input = self::input( $action );
                    self::send( true, in_array( $action, [ 'update_check', 'update_install' ], true ) ? LSE_Updates::$action( $input ) : LSE_Importer::$action( $input ) );
                } catch ( Throwable $error ) { self::send( false, [ 'message' => $error->getMessage() ], 400 ); }
            } );
        }
        add_action( 'elementor/frontend/before_render', static function( $element ) {
            $settings = $element->get_data( 'settings' );
            foreach ( is_array( $settings['lse_attributes'] ?? null ) ? $settings['lse_attributes'] : [] as $name => $value ) {
                if ( preg_match( '/^(?:data-[a-z0-9_-]+|aria-[a-z0-9_-]+|role)$/iD', $name ) && is_string( $value ) && strlen( $value ) <= 4096 ) { $element->add_render_attribute( '_wrapper', $name, $value ); }
            }
        } );
        add_action( 'wp_enqueue_scripts', [ __CLASS__, 'front' ], 30 );
        add_action( 'wp_head', [ __CLASS__, 'seo' ], 2 );
        add_filter( 'pre_get_document_title', static function( $title ) { if ( ! is_singular() || defined( 'WPSEO_VERSION' ) || defined( 'RANK_MATH_VERSION' ) || defined( 'AIOSEO_VERSION' ) ) { return $title; } $seo = get_post_meta( get_queried_object_id(), '_lse_seo', true ); return ! empty( $seo['title'] ) ? $seo['title'] : $title; } );
        add_filter( 'wp_robots', static function( $robots ) { if ( is_singular() && ! defined( 'WPSEO_VERSION' ) && ! defined( 'RANK_MATH_VERSION' ) && ! defined( 'AIOSEO_VERSION' ) ) { $seo = get_post_meta( get_queried_object_id(), '_lse_seo', true ); if ( ( $seo['indexing'] ?? '' ) === 'noindex' ) { $robots['noindex'] = true; unset( $robots['index'] ); } } return $robots; } );
    }
    public static function menu() { add_menu_page( 'Little Studio to Elementor', 'Studio to Elementor', 'manage_options', 'little-studio-elementor', [ __CLASS__, 'screen' ], 'dashicons-migrate', 65.5 ); }
    public static function assets( $hook ) {
        if ( 'toplevel_page_little-studio-elementor' !== $hook ) { return; }
        wp_enqueue_style( 'lse-admin', plugins_url( 'assets/admin.css', LSE_FILE ), [], LSE_VERSION );
        wp_enqueue_script( 'lse-converter', plugins_url( 'assets/converter.js', LSE_FILE ), [], LSE_VERSION, true );
        wp_enqueue_script( 'lse-admin', plugins_url( 'assets/admin.js', LSE_FILE ), [ 'lse-converter' ], LSE_VERSION, true );
        wp_enqueue_script( 'lse-manage', plugins_url( 'assets/manage.js', LSE_FILE ), [ 'lse-admin' ], LSE_VERSION, true );
        if ( current_user_can( 'update_plugins' ) ) { wp_enqueue_script( 'lse-updates', plugins_url( 'assets/updates.js', LSE_FILE ), [ 'lse-admin' ], LSE_VERSION, true ); wp_add_inline_script( 'lse-updates', 'window.LSE_UPDATE_STATE=' . wp_json_encode( LSE_Updates::state() ) . ';', 'before' ); }
        wp_add_inline_script( 'lse-admin', 'window.LSE_CONFIG=' . wp_json_encode( [ 'version' => LSE_VERSION, 'ajax' => admin_url( 'admin-ajax.php' ), 'nonce' => wp_create_nonce( 'lse_import' ), 'elementor' => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '', 'pro' => defined( 'ELEMENTOR_PRO_VERSION' ), 'maxUpload' => wp_max_upload_size(), 'maxPost' => wp_convert_hr_to_bytes( ini_get( 'post_max_size' ) ), 'pageTransport' => function_exists( 'gzdecode' ) ? 'json-gzip-v1' : 'json-file-v1', 'pageRest' => rest_url( 'little-studio-elementor/v1/converted-page' ), 'restNonce' => wp_create_nonce( 'wp_rest' ), 'conversionVersion' => 'interactive-v1', 'maxPagePayload' => 16 * MB_IN_BYTES, 'canScripts' => current_user_can( 'unfiltered_html' ), 'home' => home_url( '/' ), 'lastJob' => get_user_meta( get_current_user_id(), '_lse_last_job', true ) ] ) . ';', 'before' );
    }
    public static function screen() {
        ?><div class="wrap lse" id="lse-app">
        <header class="lse-head"><div><p class="lse-eyebrow">LITTLE STUDIO</p><h1>Bring your website into Elementor</h1><p>Import JSON or HTML, then manage your existing Elementor pages.</p></div><span class="lse-version">Converter <?php echo esc_html( LSE_VERSION ); ?></span></header>
        <?php if ( current_user_can( 'update_plugins' ) ) : ?><section class="lse-card lse-updates" aria-label="Plugin updates"><div><strong>Plugin updates</strong><p id="lse-update-message" role="status">Installed <?php echo esc_html( LSE_VERSION ); ?>.</p></div><div class="lse-update-buttons"><button type="button" class="button" id="lse-update-check">Look for newest update</button><button type="button" class="button button-primary" id="lse-update-now" hidden>Update now</button></div></section><?php endif; ?>
        <section class="lse-card" id="lse-managed"><div class="lse-card-title"><h2>Imported websites</h2><button type="button" class="button" id="lse-reload-imports">Reload imports</button></div><p>Open and edit existing pages, change their details, or refresh them from an updated file.</p><div class="lse-options"><label>Website<select id="lse-import-list"><option value="">Choose an imported website</option></select></label><button type="button" class="button" id="lse-more-imports" hidden>Load more</button></div><div id="lse-managed-pages"></div><div class="lse-actions"><button type="button" class="button button-primary" id="lse-refresh-import" disabled>Refresh from JSON or HTML</button></div><p id="lse-manage-message" role="status"></p></section>
        <ol class="lse-steps" aria-label="Import steps"><li aria-current="step">1 <span>Choose website</span></li><li>2 <span>Review</span></li><li>3 <span>Import</span></li><li>4 <span>Open in Elementor</span></li></ol>
        <div class="lse-notice" id="lse-status" role="status" aria-live="polite">Choose a Little Studio website or page JSON to begin.</div>
        <?php if ( ! defined( 'ELEMENTOR_VERSION' ) ) : ?><div class="notice notice-warning inline"><p>Elementor must be installed and active before you can import. File analysis is available now.</p></div><?php endif; ?>
        <section class="lse-card" id="lse-choose"><h2>Your website file</h2><p>Use your existing Little Studio JSON export or a self-contained HTML page. Inline CSS, scripts and embedded media are supported.</p><label class="lse-drop" for="lse-file"><strong>Choose JSON or HTML</strong><span>or drop it here · up to 64 MB</span><input type="file" id="lse-file" accept=".json,.html,.htm,application/json,text/html"></label><p class="lse-small">Analysis stays in this browser. Import adds new draft pages and Media Library files to this WordPress installation. It does not publish pages or change your homepage.</p></section>
        <section class="lse-card" id="lse-review" hidden><div class="lse-card-title"><h2>Review your website</h2><button type="button" class="button" id="lse-reset">Choose another file</button></div><div id="lse-summary" class="lse-summary"></div>
        <div class="lse-options"><label>Website name<input id="lse-name" type="text" maxlength="150"></label><label>Page layout<select id="lse-layout"><option value="elementor_canvas">Standalone pages · include source headers and footers</option><option value="elementor_header_footer">Use existing WordPress header and footer · main content only</option></select></label></div>
        <div class="lse-table-scroll"><table class="widefat striped"><thead><tr><th><input type="checkbox" id="lse-all" checked aria-label="Select all pages"></th><th>Page</th><th>Address</th><th>Conversion</th></tr></thead><tbody id="lse-pages"></tbody></table></div>
        <div class="lse-setup" id="lse-setup" hidden><h3>Needs setup</h3><div id="lse-findings"></div></div>
        <label class="lse-check"><input type="checkbox" id="lse-scripts" checked> Keep website interactions working <span class="lse-small">Runs JavaScript from this file.</span></label>
        <details class="lse-details"><summary>Import options</summary><label class="lse-check"><input type="checkbox" id="lse-css" checked> Keep the website styling</label></details>
        <p id="lse-refresh-context" hidden></p><label class="lse-check" id="lse-overwrite-option" hidden><input type="checkbox" id="lse-overwrite"> Replace selected pages even if edited or published. This replaces their Elementor content and keeps their current publication status.</label><div class="lse-actions"><button type="button" class="button button-primary button-hero" id="lse-import">Import website as drafts</button><span id="lse-import-scope">New imports add drafts. Nothing is published.</span></div></section>
        <section class="lse-card" id="lse-progress" hidden aria-labelledby="lse-progress-title"><h2 id="lse-progress-title">Importing your website</h2><progress id="lse-meter" max="100" value="0"></progress><p id="lse-current" role="status"></p><button class="button" type="button" id="lse-retry" hidden>Continue / retry import</button> <button class="button" type="button" id="lse-check" hidden>Check saved import progress</button> <button class="button" type="button" id="lse-error-details" hidden>Save error details</button> <button class="button" type="button" id="lse-cancel" hidden>Remove unedited drafts from this import</button></section>
        <section class="lse-card" id="lse-result" hidden><div class="lse-card-title"><h2 id="lse-result-title">Your website drafts are ready</h2><button type="button" class="button" id="lse-another">Import another website</button></div><p id="lse-result-copy"></p><div id="lse-results"></div><details class="lse-details"><summary>Import details</summary><div id="lse-report"></div></details><div class="lse-actions"><button type="button" class="button" id="lse-download">Save report</button><button type="button" class="button" id="lse-undo">Remove unedited imported drafts</button></div><details class="lse-details"><summary>Optional: change homepage/menu after publishing</summary><p>Importing never applies these settings automatically. Only use this section when you want to change your homepage/menu. Publish the reviewed drafts first. This applies the imported navigation and homepage only when the relevant pages are published.</p><label class="lse-check"><input type="checkbox" id="lse-activate-consent"> Apply the imported homepage and assign the imported menu to the first available theme location.</label><button type="button" class="button" id="lse-activate">Apply reviewed site setup</button> <button type="button" class="button" id="lse-restore" hidden>Restore previous homepage and menu assignments</button><p id="lse-restoration" class="lse-small"></p></details></section>
        <footer class="lse-foot">Keep this plugin active for your imported website.</footer></div><?php
    }
    public static function front() {
        if ( ! is_singular() ) { return; }
        $id = get_queried_object_id(); $css = get_post_meta( $id, '_lse_css', true );
        if ( $css ) { wp_register_style( 'lse-page', false, [], LSE_VERSION ); wp_enqueue_style( 'lse-page' ); wp_add_inline_style( 'lse-page', $css ); }
        $js = get_post_meta( $id, '_lse_js', true );
        wp_enqueue_script( 'lse-interactions', plugins_url( 'assets/interactions.js', LSE_FILE ), [], LSE_VERSION, true );
        if ( $js && get_post_meta( $id, '_lse_scripts_enabled', true ) ) { wp_add_inline_script( 'lse-interactions', 'window.LSEInteractions.register(' . wp_json_encode( (string) $id ) . ', function(){' . "\n" . $js . "\n" . '});' ); }
    }
    public static function seo() {
        if ( ! is_singular() || defined( 'WPSEO_VERSION' ) || defined( 'RANK_MATH_VERSION' ) || defined( 'AIOSEO_VERSION' ) ) { return; }
        $seo = get_post_meta( get_queried_object_id(), '_lse_seo', true );
        if ( ! is_array( $seo ) ) { return; }
        if ( ! empty( $seo['description'] ) ) { echo '<meta name="description" content="' . esc_attr( $seo['description'] ) . '">' . "\n"; }
        foreach ( [ 'social_title' => 'og:title', 'social_description' => 'og:description', 'social_image' => 'og:image' ] as $key => $property ) { if ( ! empty( $seo[$key] ) ) { echo '<meta property="' . esc_attr( $property ) . '" content="' . esc_attr( $seo[$key] ) . '">' . "\n"; } }
    }
}
