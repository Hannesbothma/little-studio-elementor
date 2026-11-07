<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
final class LSE_Plugin {
    private static $response_level = 0;
    private static function send( $success, $data, $status = 200 ) {
        $extra_output = false;
        while ( self::$response_level && ob_get_level() >= self::$response_level ) { $extra_output = $extra_output || trim( (string) ob_get_contents() ) !== ''; ob_end_clean(); }
        if ( $extra_output ) { error_log( 'Little Studio import: additional server output was suppressed from an AJAX response.' ); if ( ! headers_sent() ) { header( 'X-Little-Studio-Output-Cleaned: 1' ); } }
        wp_send_json( [ 'success' => $success, 'data' => $data ], $status );
    }
    public static function init() {
        $actions = [ 'check', 'start', 'asset', 'page', 'finish', 'status', 'undo', 'activate', 'restore', 'update_check', 'update_install' ];
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
                    $input = json_decode( wp_unslash( $_POST['payload'] ?? '{}' ), true, 128, JSON_THROW_ON_ERROR );
                    if ( ! is_array( $input ) ) { throw new RuntimeException( 'Invalid request.' ); }
                    self::send( true, in_array( $action, [ 'update_check', 'update_install' ], true ) ? LSE_Updates::$action( $input ) : LSE_Importer::$action( $input ) );
                } catch ( Throwable $error ) { self::send( false, [ 'message' => $error->getMessage() ], 400 ); }
            } );
        }
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
        if ( current_user_can( 'update_plugins' ) ) { wp_enqueue_script( 'lse-updates', plugins_url( 'assets/updates.js', LSE_FILE ), [ 'lse-admin' ], LSE_VERSION, true ); wp_add_inline_script( 'lse-updates', 'window.LSE_UPDATE_STATE=' . wp_json_encode( LSE_Updates::state() ) . ';', 'before' ); }
        wp_add_inline_script( 'lse-admin', 'window.LSE_CONFIG=' . wp_json_encode( [ 'version' => LSE_VERSION, 'ajax' => admin_url( 'admin-ajax.php' ), 'nonce' => wp_create_nonce( 'lse_import' ), 'elementor' => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '', 'pro' => defined( 'ELEMENTOR_PRO_VERSION' ), 'maxUpload' => wp_max_upload_size(), 'maxPost' => wp_convert_hr_to_bytes( ini_get( 'post_max_size' ) ), 'canScripts' => current_user_can( 'unfiltered_html' ), 'home' => home_url( '/' ), 'lastJob' => get_user_meta( get_current_user_id(), '_lse_last_job', true ) ] ) . ';', 'before' );
    }
    public static function screen() {
        ?><div class="wrap lse" id="lse-app">
        <header class="lse-head"><div><p class="lse-eyebrow">LITTLE STUDIO</p><h1>Bring your website into Elementor</h1><p>One website JSON. Your pages, images and fonts, connected in WordPress.</p></div><span class="lse-version">Converter <?php echo esc_html( LSE_VERSION ); ?></span></header>
        <?php if ( current_user_can( 'update_plugins' ) ) : ?><section class="lse-card lse-updates" aria-label="Plugin updates"><div><strong>Plugin updates</strong><p id="lse-update-message" role="status">Installed <?php echo esc_html( LSE_VERSION ); ?>.</p></div><div class="lse-update-buttons"><button type="button" class="button" id="lse-update-check">Look for newest update</button><button type="button" class="button button-primary" id="lse-update-now" hidden>Update now</button></div></section><?php endif; ?>
        <ol class="lse-steps" aria-label="Import steps"><li aria-current="step">1 <span>Choose website</span></li><li>2 <span>Review</span></li><li>3 <span>Import</span></li><li>4 <span>Open in Elementor</span></li></ol>
        <div class="lse-notice" id="lse-status" role="status" aria-live="polite">Choose a Little Studio website or page JSON to begin.</div>
        <?php if ( ! defined( 'ELEMENTOR_VERSION' ) ) : ?><div class="notice notice-warning inline"><p>Elementor must be installed and active before you can import. File analysis is available now.</p></div><?php endif; ?>
        <section class="lse-card" id="lse-choose"><h2>Your website file</h2><p>Use the existing JSON export from Little Studio Desktop or Suite. All pages are selected automatically.</p><label class="lse-drop" for="lse-file"><strong>Choose a JSON file</strong><span>or drop it here · up to 64 MB</span><input type="file" id="lse-file" accept=".json,application/json"></label><p class="lse-small">Analysis stays in this browser. Import adds new draft pages and Media Library files to this WordPress installation. It does not publish pages or change your homepage.</p></section>
        <section class="lse-card" id="lse-review" hidden><div class="lse-card-title"><h2>Review your website</h2><button type="button" class="button" id="lse-reset">Choose another file</button></div><div id="lse-summary" class="lse-summary"></div>
        <div class="lse-options"><label>Website name<input id="lse-name" type="text" maxlength="150"></label><label>Page layout<select id="lse-layout"><option value="elementor_canvas">Standalone pages · include source headers and footers</option><option value="elementor_header_footer">Use existing WordPress header and footer · main content only</option></select></label></div>
        <div class="lse-table-scroll"><table class="widefat striped"><thead><tr><th><input type="checkbox" id="lse-all" checked aria-label="Select all pages"></th><th>Page</th><th>Address</th><th>Conversion</th></tr></thead><tbody id="lse-pages"></tbody></table></div>
        <details class="lse-details"><summary>Assets, styles and features to review</summary><div id="lse-findings"></div></details>
        <label class="lse-check"><input type="checkbox" id="lse-css" checked> Preserve additional styling with scoped CSS. Native Elementor controls remain available.</label>
        <label class="lse-check"><input type="checkbox" id="lse-scripts"> Include reviewed custom JavaScript from this file. It runs on imported pages and may need adaptation.</label><p class="lse-small">Keep scripts off unless you trust the source. Forms, payments and accounts need real backend configuration. Unconverted regions are reported.</p>
        <div class="lse-actions"><button type="button" class="button button-primary button-hero" id="lse-import">Import website as drafts</button><span>No existing pages are replaced. Nothing is published.</span></div></section>
        <section class="lse-card" id="lse-progress" hidden aria-labelledby="lse-progress-title"><h2 id="lse-progress-title">Importing your website</h2><progress id="lse-meter" max="100" value="0"></progress><p id="lse-current" role="status"></p><button class="button" type="button" id="lse-retry" hidden>Continue / retry import</button> <button class="button" type="button" id="lse-check" hidden>Check saved import progress</button> <button class="button" type="button" id="lse-error-details" hidden>Save error details</button> <button class="button" type="button" id="lse-cancel" hidden>Remove unedited drafts from this import</button></section>
        <section class="lse-card" id="lse-result" hidden><div class="lse-card-title"><h2 id="lse-result-title">Your website drafts are ready</h2><button type="button" class="button" id="lse-another">Import another website</button></div><p id="lse-result-copy"></p><div id="lse-results"></div><details class="lse-details"><summary>Conversion report</summary><div id="lse-report"></div></details><div class="lse-actions"><button type="button" class="button" id="lse-download">Save report</button><button type="button" class="button" id="lse-undo">Remove unedited imported drafts</button></div><details class="lse-details"><summary>Optional: change homepage/menu after publishing</summary><p>Importing never applies these settings automatically. Only use this section when you want to change your homepage/menu. Publish the reviewed drafts first. This applies the imported navigation and homepage only when the relevant pages are published.</p><label class="lse-check"><input type="checkbox" id="lse-activate-consent"> Apply the imported homepage and assign the imported menu to the first available theme location.</label><button type="button" class="button" id="lse-activate">Apply reviewed site setup</button> <button type="button" class="button" id="lse-restore" hidden>Restore previous homepage and menu assignments</button><p id="lse-restoration" class="lse-small"></p></details></section>
        <footer class="lse-foot">Native content where supported. Clear reports for everything else. Keep this plugin active for imported fallback styles, fonts and optional scripts.</footer></div><?php
    }
    public static function front() {
        if ( ! is_singular() ) { return; }
        $id = get_queried_object_id(); $css = get_post_meta( $id, '_lse_css', true );
        if ( $css ) { wp_register_style( 'lse-page', false, [], LSE_VERSION ); wp_enqueue_style( 'lse-page' ); wp_add_inline_style( 'lse-page', $css ); }
        $js = get_post_meta( $id, '_lse_js', true );
        if ( $js && get_post_meta( $id, '_lse_scripts_enabled', true ) ) { wp_register_script( 'lse-page', false, [], LSE_VERSION, true ); wp_enqueue_script( 'lse-page' ); wp_add_inline_script( 'lse-page', $js ); }
    }
    public static function seo() {
        if ( ! is_singular() || defined( 'WPSEO_VERSION' ) || defined( 'RANK_MATH_VERSION' ) || defined( 'AIOSEO_VERSION' ) ) { return; }
        $seo = get_post_meta( get_queried_object_id(), '_lse_seo', true );
        if ( ! is_array( $seo ) ) { return; }
        if ( ! empty( $seo['description'] ) ) { echo '<meta name="description" content="' . esc_attr( $seo['description'] ) . '">' . "\n"; }
        foreach ( [ 'social_title' => 'og:title', 'social_description' => 'og:description', 'social_image' => 'og:image' ] as $key => $property ) { if ( ! empty( $seo[$key] ) ) { echo '<meta property="' . esc_attr( $property ) . '" content="' . esc_attr( $seo[$key] ) . '">' . "\n"; } }
    }
}
