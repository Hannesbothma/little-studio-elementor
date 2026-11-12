<?php
if (!defined('ABSPATH')) {
    exit();
}
final class LSE_Plugin
{
    private static $response_level = 0;
    private static function send($success, $data, $status = 200)
    {
        $extra_output = false;
        while (
            self::$response_level &&
            ob_get_level() >= self::$response_level
        ) {
            $extra_output =
                $extra_output || trim((string) ob_get_contents()) !== '';
            ob_end_clean();
        }
        if ($extra_output) {
            error_log(
                'Little Studio import: additional server output was suppressed from an AJAX response.',
            );
            if (!headers_sent()) {
                header('X-Little-Studio-Output-Cleaned: 1');
            }
        }
        if (!headers_sent()) {
            header('X-Little-Studio-Handler: converter');
        }
        wp_send_json(['success' => $success, 'data' => $data], $status);
    }
    private static function input($action)
    {
        if (isset($_FILES['payload_file'])) {
            if ($action !== 'page' || isset($_POST['payload'])) {
                throw new RuntimeException(
                    'Unexpected or ambiguous page upload.',
                );
            }
            $file = $_FILES['payload_file'];
            if (
                !is_array($file) ||
                !isset($file['error']) ||
                !is_int($file['error']) ||
                $file['error'] !== UPLOAD_ERR_OK
            ) {
                throw new RuntimeException(
                    'The converted page upload failed. Check the hosting upload limit and retry the saved import.',
                );
            }
            $temporary = $file['tmp_name'] ?? '';
            if (!is_string($temporary) || !is_uploaded_file($temporary)) {
                throw new RuntimeException(
                    'The converted page must be a valid upload.',
                );
            }
            $size = filesize($temporary);
            if (!$size) {
                throw new RuntimeException(
                    'The converted page upload is empty.',
                );
            }
            $raw = file_get_contents($temporary);
            if (!is_string($raw) || strlen($raw) !== $size) {
                throw new RuntimeException(
                    'The converted page upload could not be read completely.',
                );
            }
            if (str_starts_with($raw, "\x1f\x8b")) {
                if (!function_exists('gzdecode')) {
                    throw new RuntimeException(
                        'Compressed page imports are unavailable on this server.',
                    );
                }
                $raw = @gzdecode($raw);
                if (!is_string($raw)) {
                    throw new RuntimeException(
                        'The compressed page could not be decoded.',
                    );
                }
            }
        } else {
            $raw = $_POST['payload'] ?? '{}';
            if (!is_string($raw)) {
                throw new RuntimeException(
                    'The request payload must be JSON text.',
                );
            }
            $raw = wp_unslash($raw);
        }
        if (!str_starts_with(ltrim($raw), '{')) {
            throw new RuntimeException(
                'The request must contain one JSON object.',
            );
        }
        $input = json_decode($raw, true, 2147483647, JSON_THROW_ON_ERROR);
        if (!is_array($input)) {
            throw new RuntimeException('Invalid request.');
        }
        return $input;
    }
    public static function init()
    {
        add_action('rest_api_init', static function () {
            register_rest_route(
                'little-studio-elementor/v1',
                '/converted-page',
                [
                    'methods' => 'POST',
                    'permission_callback' => static function ($request) {
                        if (
                            !current_user_can('manage_options') ||
                            !current_user_can('edit_pages') ||
                            !current_user_can('upload_files')
                        ) {
                            return new WP_Error(
                                'lse_forbidden',
                                'An administrator with page and upload permissions is required.',
                                ['status' => 403],
                            );
                        }
                        if (
                            !wp_verify_nonce(
                                $request->get_param('nonce'),
                                'lse_import',
                            )
                        ) {
                            return new WP_Error(
                                'lse_session',
                                'Reload the converter to refresh your session.',
                                ['status' => 403],
                            );
                        }
                        return true;
                    },
                    'callback' => static function () {
                        try {
                            $response = new WP_REST_Response(
                                [
                                    'success' => true,
                                    'data' => LSE_Importer::page(
                                        self::input('page'),
                                    ),
                                ],
                                200,
                            );
                        } catch (Throwable $error) {
                            $response = new WP_REST_Response(
                                [
                                    'success' => false,
                                    'data' => [
                                        'message' => $error->getMessage(),
                                    ],
                                ],
                                400,
                            );
                        }
                        $response->header(
                            'X-Little-Studio-Handler',
                            'converter',
                        );
                        return $response;
                    },
                ],
            );
        });
        $actions = [
            'imports',
            'remove_import',
            'manage_page',
            'restore_refresh',
            'check',
            'start',
            'asset',
            'page',
            'finish',
            'status',
            'undo',
            'activate',
            'restore',
            'update_check',
            'update_install',
            'prepare',
            'capture_start',
            'capture_step',
            'capture_cancel',
            'capture_batch',
            'assets',
        ];
        $requested = $_REQUEST['action'] ?? '';
        if (
            defined('DOING_AJAX') &&
            DOING_AJAX &&
            is_string($requested) &&
            in_array(
                $requested,
                array_map(static fn($action) => 'lse_' . $action, $actions),
                true,
            )
        ) {
            self::$response_level = ob_get_level() + 1;
            ob_start();
        }
        add_action('elementor/widgets/register', static function ($manager) {
            require_once __DIR__ . '/shared-widget.php';
            $manager->register(new LSE_Shared_Widget());
        });
        add_action(
            'elementor/element/image/section_image/before_section_end',
            static function ($element) {
                $element->add_control('lse_alt_override', [
                    'label' => 'Use page-specific alternative text',
                    'type' => \Elementor\Controls_Manager::SWITCHER,
                    'default' => '',
                ]);
                $element->add_control('lse_image_alt', [
                    'label' => 'Alternative text',
                    'description' =>
                        'Imported image description for this page. Leave empty for a decorative image.',
                    'type' => \Elementor\Controls_Manager::TEXTAREA,
                    'condition' => ['lse_alt_override' => 'yes'],
                ]);
            },
        );
        add_filter(
            'elementor/widget/render_content',
            static function ($content, $widget) {
                if (
                    $widget->get_name() === 'image' &&
                    $widget->get_settings('lse_alt_override') === 'yes'
                ) {
                    $html = new WP_HTML_Tag_Processor($content);
                    if ($html->next_tag('img')) {
                        $html->set_attribute(
                            'alt',
                            (string) $widget->get_settings('lse_image_alt'),
                        );
                        return $html->get_updated_html();
                    }
                }
                return $content;
            },
            10,
            2,
        );
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_init', static function () {
            global $pagenow;
            if (
                $pagenow === 'tools.php' &&
                ($_GET['page'] ?? '') === 'little-studio-elementor' &&
                current_user_can('manage_options')
            ) {
                wp_safe_redirect(
                    admin_url('admin.php?page=little-studio-elementor'),
                );
                exit();
            }
        });
        add_filter(
            'plugin_action_links_' . plugin_basename(LSE_FILE),
            static function ($links) {
                array_unshift(
                    $links,
                    '<a href="' .
                        esc_url(
                            admin_url('admin.php?page=little-studio-elementor'),
                        ) .
                        '">Open converter</a>',
                );
                return $links;
            },
        );
        add_action('admin_enqueue_scripts', [__CLASS__, 'assets']);
        foreach ($actions as $action) {
            add_action('wp_ajax_lse_' . $action, function () use ($action) {
                try {
                    if (
                        !current_user_can('manage_options') ||
                        !current_user_can('edit_pages') ||
                        !current_user_can('upload_files')
                    ) {
                        self::send(
                            false,
                            [
                                'message' =>
                                    'An administrator with page and upload permissions is required.',
                            ],
                            403,
                        );
                    }
                    if (!check_ajax_referer('lse_import', 'nonce', false)) {
                        self::send(
                            false,
                            [
                                'message' =>
                                    'Your WordPress session expired. Reload the converter page and sign in if needed.',
                            ],
                            403,
                        );
                    }
                    $input = self::input($action);
                    self::send(
                        true,
                        str_starts_with($action, 'capture_')
                            ? LSE_Capture::$action($input)
                            : (in_array(
                                $action,
                                ['update_check', 'update_install'],
                                true,
                            )
                                ? LSE_Updates::$action($input)
                                : LSE_Importer::$action($input)),
                    );
                } catch (Throwable $error) {
                    self::send(false, ['message' => $error->getMessage()], 400);
                }
            });
        }
        add_action(
            'elementor/element/after_section_end',
            static function ($element, $section) {
                if (
                    $section === 'section_lse_responsive' ||
                    !in_array(
                        $element->get_name(),
                        ['heading', 'text-editor', 'button'],
                        true,
                    ) ||
                    $element->get_controls('lse_text_color')
                ) {
                    return;
                }
                $selector =
                    '{{WRAPPER}} ' .
                    ($element->get_name() === 'heading'
                        ? '.elementor-heading-title'
                        : ($element->get_name() === 'button'
                            ? '.elementor-button'
                            : ''));
                $element->start_controls_section('section_lse_responsive', [
                    'label' => 'Imported responsive styles',
                    'tab' => \Elementor\Controls_Manager::TAB_STYLE,
                ]);
                $element->add_responsive_control('lse_text_color', [
                    'label' => 'Text color',
                    'type' => \Elementor\Controls_Manager::COLOR,
                    'selectors' => [$selector => 'color: {{VALUE}};'],
                ]);
                $element->add_responsive_control('lse_font_family', [
                    'label' => 'Font family',
                    'type' => \Elementor\Controls_Manager::TEXT,
                    'selectors' => [$selector => 'font-family: {{VALUE}};'],
                ]);
                $element->add_responsive_control('lse_font_weight', [
                    'label' => 'Font weight',
                    'type' => \Elementor\Controls_Manager::SELECT,
                    'options' => [
                        '' => 'Default',
                        '100' => '100',
                        '200' => '200',
                        '300' => '300',
                        '400' => '400',
                        '500' => '500',
                        '600' => '600',
                        '700' => '700',
                        '800' => '800',
                        '900' => '900',
                    ],
                    'selectors' => [$selector => 'font-weight: {{VALUE}};'],
                ]);
                if ($element->get_name() === 'button') {
                    $element->add_responsive_control(
                        'lse_button_container_width',
                        [
                            'type' => \Elementor\Controls_Manager::HIDDEN,
                            'selectors' => [
                                '{{WRAPPER}} > .elementor-widget-container' =>
                                    'width:{{VALUE}};',
                            ],
                        ],
                    );
                    $element->add_responsive_control('lse_button_min_height', [
                        'label' => 'Minimum height',
                        'type' => \Elementor\Controls_Manager::SLIDER,
                        'size_units' => ['px', 'vh', 'em', 'rem'],
                        'selectors' => [
                            $selector =>
                                'min-height:{{SIZE}}{{UNIT}};display:inline-flex;justify-content:center;align-items:center;',
                        ],
                    ]);
                }
                $element->end_controls_section();
            },
            10,
            2,
        );
        add_action('elementor/frontend/before_render', static function (
            $element,
        ) {
            $settings = $element->get_data('settings');
            foreach (
                is_array($settings['lse_attributes'] ?? null)
                    ? $settings['lse_attributes']
                    : []
                as $name => $value
            ) {
                if (
                    !preg_match(
                        '/^(?:data-(?:id|element_type|widget_type|settings|model-cid)|data-elementor-(?:id|type|post-type)|data-e-action-hash)$/iD',
                        $name,
                    ) &&
                    preg_match(
                        '/^(?:data-[a-z0-9_-]+|aria-[a-z0-9_-]+|role)$/iD',
                        $name,
                    ) &&
                    is_string($value) &&
                    strlen($value) <= 4096
                ) {
                    $element->add_render_attribute('_wrapper', $name, $value);
                }
            }
        });
        add_action('wp_enqueue_scripts', [__CLASS__, 'front'], 30);
        add_action(
            'wp_print_styles',
            [__CLASS__, 'canvas_styles'],
            PHP_INT_MAX,
        );
        add_action('wp_head', [__CLASS__, 'seo'], 2);
        add_filter('pre_get_document_title', static function ($title) {
            if (
                !is_singular() ||
                defined('WPSEO_VERSION') ||
                defined('RANK_MATH_VERSION') ||
                defined('AIOSEO_VERSION')
            ) {
                return $title;
            }
            $seo = get_post_meta(get_queried_object_id(), '_lse_seo', true);
            return !empty($seo['title']) ? $seo['title'] : $title;
        });
        add_filter(
            'get_canonical_url',
            static function ($canonical, $post) {
                if (
                    defined('WPSEO_VERSION') ||
                    defined('RANK_MATH_VERSION') ||
                    defined('AIOSEO_VERSION')
                ) {
                    return $canonical;
                }
                $seo = get_post_meta($post->ID, '_lse_seo', true);
                return !empty($seo['canonical'])
                    ? esc_url_raw($seo['canonical'], ['http', 'https'])
                    : $canonical;
            },
            10,
            2,
        );
        add_filter('wp_robots', static function ($robots) {
            if (
                is_singular() &&
                !defined('WPSEO_VERSION') &&
                !defined('RANK_MATH_VERSION') &&
                !defined('AIOSEO_VERSION')
            ) {
                $seo = get_post_meta(get_queried_object_id(), '_lse_seo', true);
                if (($seo['indexing'] ?? '') === 'noindex') {
                    $robots['noindex'] = true;
                    unset($robots['index']);
                }
            }
            return $robots;
        });
    }
    public static function menu()
    {
        add_menu_page(
            'Little Studio to Elementor',
            'Studio to Elementor',
            'manage_options',
            'little-studio-elementor',
            [__CLASS__, 'screen'],
            'dashicons-migrate',
            65.5,
        );
    }
    public static function assets($hook)
    {
        if ('toplevel_page_little-studio-elementor' !== $hook) {
            return;
        }
        wp_enqueue_style(
            'lse-admin',
            plugins_url('assets/admin.css', LSE_FILE),
            [],
            LSE_VERSION,
        );
        wp_enqueue_script(
            'lse-converter',
            plugins_url('assets/converter.js', LSE_FILE),
            [],
            LSE_VERSION,
            true,
        );
        wp_enqueue_script(
            'lse-admin',
            plugins_url('assets/admin.js', LSE_FILE),
            ['lse-converter'],
            LSE_VERSION,
            true,
        );
        wp_enqueue_script(
            'lse-capture',
            plugins_url('assets/capture.js', LSE_FILE),
            ['lse-admin', 'lse-manage'],
            LSE_VERSION,
            true,
        );
        wp_enqueue_script(
            'lse-manage',
            plugins_url('assets/manage.js', LSE_FILE),
            ['lse-admin'],
            LSE_VERSION,
            true,
        );
        if (current_user_can('update_plugins')) {
            wp_enqueue_script(
                'lse-updates',
                plugins_url('assets/updates.js', LSE_FILE),
                ['lse-admin'],
                LSE_VERSION,
                true,
            );
            wp_add_inline_script(
                'lse-updates',
                'window.LSE_UPDATE_STATE=' .
                    wp_json_encode(LSE_Updates::state()) .
                    ';',
                'before',
            );
        }
        wp_add_inline_script(
            'lse-admin',
            'window.LSE_CONFIG=' .
                wp_json_encode([
                    'version' => LSE_VERSION,
                    'ajax' => admin_url('admin-ajax.php'),
                    'nonce' => wp_create_nonce('lse_import'),
                    'elementor' => defined('ELEMENTOR_VERSION')
                        ? ELEMENTOR_VERSION
                        : '',
                    'pro' => defined('ELEMENTOR_PRO_VERSION'),
                    'maxUpload' => wp_max_upload_size(),
                    'maxPost' => wp_convert_hr_to_bytes(
                        ini_get('post_max_size'),
                    ),
                    'mediaBatchSize' => LSE_Importer::media_batch_size(),
                    'mediaBatchMilliseconds' =>
                        (int) (LSE_Importer::batch_seconds() * 1000),
                    'pageTransport' => function_exists('gzdecode')
                        ? 'json-gzip-v1'
                        : 'json-file-v1',
                    'pageRest' => rest_url(
                        'little-studio-elementor/v1/converted-page',
                    ),
                    'restNonce' => wp_create_nonce('wp_rest'),
                    'conversionVersion' => LSE_CONVERTER_VERSION,
                    'canScripts' => current_user_can('unfiltered_html'),
                    'home' => home_url('/'),
                    'lastJob' => get_user_meta(
                        get_current_user_id(),
                        '_lse_last_job',
                        true,
                    ),
                ]) .
                ';',
            'before',
        );
    }
    public static function screen()
    {
        ?><div class="wrap lse" id="lse-app">
        <section class="lse-card lse-shell" id="lse-managed" data-mode="choose">
            <header class="lse-head">
                <div class="lse-brand"><span class="lse-brand-icon" aria-hidden="true"></span><span>Studio to Elementor</span></div>
                <div class="lse-head-actions">
                    <span class="lse-version">v<?php echo esc_html(
                        LSE_VERSION,
                    ); ?></span>
                    <?php if (current_user_can('update_plugins')): ?>
                    <details class="lse-plugin-updates lse-popover">
                        <summary>Plugin updates</summary>
                        <div class="lse-popover-panel">
                            <p id="lse-update-message" role="status">Installed <?php echo esc_html(
                                LSE_VERSION,
                            ); ?>.</p>
                            <div class="lse-actions"><button type="button" class="button" id="lse-update-check">Check for updates</button><button type="button" class="button button-primary" id="lse-update-now" hidden>Update now</button></div>
                        </div>
                    </details>
                    <?php endif; ?>
                </div>
            </header>
            <div class="lse-layout">
                <aside class="lse-sidebar" aria-labelledby="lse-sidebar-title">
                    <button type="button" class="button button-primary" id="lse-new-import"><span aria-hidden="true">+</span> New import</button>
                    <button type="button" class="button" data-capture-open aria-label="Import from website link">Import website link</button>
                    <label for="lse-import-list" class="screen-reader-text">Imported website</label>
                    <select id="lse-import-list"><option value="">New import</option></select>
                    <h2 id="lse-sidebar-title">Imported websites</h2>
                    <nav id="lse-import-nav" aria-label="Imported websites"></nav>
                    <button type="button" class="button lse-subtle" id="lse-more-imports" hidden>More websites</button>
                </aside>
                <main class="lse-workspace">
                    <div id="lse-status" class="lse-notice" role="status" aria-live="polite">Choose a file or capture a website link to get started.</div>
                    <p id="lse-manage-message" class="lse-notice" role="status" aria-live="polite"></p>
                    <?php if (
                        !defined('ELEMENTOR_VERSION')
                    ): ?><p class="lse-notice is-error">Activate Elementor before importing.</p><?php endif; ?>
                    <input type="file" id="lse-file" accept=".json,.html,.htm,application/json,text/html" hidden>
                    <div id="lse-choose">
                        <div class="lse-drop">
                            <span class="lse-empty-icon" aria-hidden="true">↑</span>
                            <h1>Bring your website into Elementor</h1>
                            <p>Drop a Little Studio JSON export or an HTML file here.</p>
                            <div class="lse-actions lse-import-methods"><button type="button" class="button button-primary" id="lse-choose-file">Choose file</button>
                            <button type="button" class="button" data-capture-open>Paste website link</button></div>
                            <small>Imported pages are saved as drafts.</small>
                        </div>
                    </div>
                    <section id="lse-project" aria-labelledby="lse-project-title" hidden>
                        <div class="lse-project-head">
                            <div><h1 id="lse-project-title"></h1><p id="lse-project-meta"></p></div>
                            <div class="lse-actions" id="lse-import-actions">
                                <button type="button" class="button button-primary" id="lse-refresh-import"><span aria-hidden="true">↑</span> Update from file</button>
                                <details class="lse-popover" id="lse-import-menu">
                                    <summary class="button lse-icon-button" aria-label="Import options">⋯</summary>
                                    <div class="lse-popover-panel lse-menu">
                                        <button type="button" id="lse-download">Download report</button>
                                        <button type="button" id="lse-remove-import" class="lse-danger">Remove import</button>
                                    </div>
                                </details>
                            </div>
                        </div>
                        <div class="lse-tabs" role="tablist" aria-label="Import workspace">
                            <button type="button" class="lse-tab" id="lse-pages-tab" role="tab" aria-selected="true" aria-controls="lse-managed-pages" data-tab="pages">Pages <span id="lse-page-count"></span></button>
                            <button type="button" class="lse-tab" id="lse-details-tab" role="tab" aria-selected="false" aria-controls="lse-import-details" data-tab="details" tabindex="-1">Import details</button>
                        </div>
                        <div id="lse-managed-pages" class="lse-page-layout" role="tabpanel" aria-labelledby="lse-pages-tab">
                            <section class="lse-page-list" aria-label="Imported pages">
                                <div class="lse-page-controls">
                                    <label class="lse-search"><span class="screen-reader-text">Search pages</span><input type="search" id="lse-page-search" placeholder="Search pages"></label>
                                    <label><span class="screen-reader-text">Filter pages by status</span><select id="lse-page-filter"><option value="all">All statuses</option><option value="draft">Draft</option><option value="publish">Published</option><option value="pending">Pending review</option><option value="private">Private</option><option value="trash">In Trash</option><option value="missing">Missing</option></select></label>
                                </div>
                                <div class="lse-list-heading" aria-hidden="true"><span>Page</span><span>Status</span></div>
                                <div id="lse-page-rows"></div>
                                <p id="lse-list-footer" role="status"></p>
                            </section>
                            <aside id="lse-page-inspector" class="lse-inspector" aria-label="Selected page" hidden></aside>
                        </div>
                        <div id="lse-import-details" class="lse-detail-grid" role="tabpanel" aria-labelledby="lse-details-tab" hidden>
                            <section class="lse-detail-card"><h2>Import summary</h2><div id="lse-import-summary"></div></section>
                            <section class="lse-detail-card"><h2>Homepage and menu</h2><p>Publish reviewed pages before applying site setup.</p><label class="lse-check"><input type="checkbox" id="lse-activate-consent"> Use this import's homepage and menu.</label><div class="lse-actions"><button type="button" class="button" id="lse-activate">Apply</button><button type="button" class="button" id="lse-restore" hidden>Restore previous setup</button></div><p id="lse-restoration" class="lse-small"></p></section>
                            <section class="lse-detail-card lse-conversion-report"><h2>Conversion report</h2><div id="lse-report"></div></section>
                        </div>
                    </section>
                </main>
            </div>
        </section>
        <dialog id="lse-flow-dialog" class="lse-dialog" aria-labelledby="lse-flow-title">
            <header class="lse-dialog-head"><h2 id="lse-flow-title">Review new import</h2><button type="button" class="button lse-subtle lse-icon-button" id="lse-flow-close" aria-label="Close import">×</button></header>
            <div class="lse-dialog-body">
                <p id="lse-dialog-status" class="lse-notice" role="status" aria-live="polite" hidden></p>
                <div id="lse-review" hidden>
                    <div id="lse-summary" class="lse-summary"></div>
                    <p id="lse-refresh-context" hidden></p>
                    <details class="lse-details" open><summary>Pages</summary><div class="lse-table-scroll"><table class="widefat striped"><thead><tr><th><input type="checkbox" id="lse-all" checked aria-label="Select all pages"></th><th>Page</th><th>Address</th><th>Review</th></tr></thead><tbody id="lse-pages"></tbody></table></div></details>
                    <div class="lse-setup" id="lse-setup" hidden><div id="lse-findings"></div></div>
                    <details class="lse-details"><summary>Import options</summary><div class="lse-options"><label>Website name<input id="lse-name" type="text" maxlength="150"></label><label>Page layout<select id="lse-layout"><option value="elementor_canvas">Standalone pages</option><option value="elementor_header_footer">Use WordPress header and footer</option></select></label></div><label class="lse-check"><input type="checkbox" id="lse-scripts" checked> Keep website interactions</label><label class="lse-check"><input type="checkbox" id="lse-css" checked> Keep website styling</label></details>
                    <label class="lse-check" id="lse-overwrite-option" hidden><input type="checkbox" id="lse-overwrite"> Allow replacing selected edited or published pages.</label>
                    <div class="lse-dialog-actions"><button type="button" class="button" id="lse-reset">Cancel</button><button type="button" class="button" id="lse-source-download">Download JSON</button><span id="lse-import-scope">New pages are saved as drafts.</span><button type="button" class="button button-primary" id="lse-import">Import</button></div>
                </div>
                <div id="lse-progress" hidden><progress id="lse-meter" max="100" value="0"></progress><p id="lse-current" role="status"></p><div class="lse-actions"><button class="button" type="button" id="lse-retry" hidden>Retry</button><button class="button" type="button" id="lse-check" hidden>Check progress</button><button class="button" type="button" id="lse-error-details" hidden>Error details</button><button class="button lse-danger" type="button" id="lse-cancel" hidden>Remove import</button></div></div>
            </div>
        </dialog>
        <dialog id="lse-capture-dialog" class="lse-dialog" aria-labelledby="lse-capture-title">
            <form id="lse-capture-form">
                <header class="lse-dialog-head"><h2 id="lse-capture-title">Import from a website link</h2><button type="button" class="button" id="lse-capture-close">Close</button></header>
                <div class="lse-dialog-body">
                    <p>Capture public pages, styles, images and fonts into a Little Studio JSON, then review the Elementor import.</p>
                    <label class="lse-field">Website address<input id="lse-capture-url" type="url" placeholder="https://your-website.com" required maxlength="2048"></label>
                    <p class="lse-small">Keep this tab open. Review the result before publishing. Logins, stores, forms and JavaScript apps may need rebuilding.</p>
                    <p id="lse-capture-status" class="lse-notice" role="status" aria-live="polite"></p>
                </div>
                <footer class="lse-dialog-actions"><button type="button" class="button" id="lse-capture-retry" hidden>Retry capture</button><button type="submit" class="button button-primary" id="lse-capture-start">Capture website</button></footer>
            </form>
        </dialog>
        <dialog id="lse-page-dialog" class="lse-dialog lse-page-dialog" aria-labelledby="lse-page-dialog-title">
            <form id="lse-page-form">
                <header class="lse-dialog-head"><h2 id="lse-page-dialog-title">Edit page details</h2><button type="button" class="button lse-subtle lse-icon-button" id="lse-page-close" aria-label="Close page details">×</button></header>
                <div class="lse-dialog-body"><label class="lse-field">Page title<input name="title" id="lse-page-title" type="text" maxlength="300" required></label><label class="lse-field">Page address<input name="slug" id="lse-page-slug" type="text" maxlength="200" required></label><p id="lse-page-error" class="is-error" role="alert" hidden></p></div>
                <footer class="lse-dialog-actions"><button type="button" class="button" id="lse-page-cancel">Cancel</button><button type="submit" class="button button-primary" id="lse-page-save">Save details</button></footer>
            </form>
        </dialog>
        <footer class="lse-foot">Keep this plugin active for your imported website.</footer>
        </div><?php
    }
    public static function canvas_styles()
    {
        $id = get_queried_object_id();
        if (
            !is_singular() ||
            get_page_template_slug($id) !== 'elementor_canvas' ||
            !get_post_meta($id, '_lse_css', true)
        ) {
            return;
        }
        $urls = array_unique(
            array_map(
                static fn($url) => trailingslashit(
                    (string) wp_parse_url($url, PHP_URL_PATH),
                ),
                [get_template_directory_uri(), get_stylesheet_directory_uri()],
            ),
        );
        $paths = array_unique(
            array_map(
                static fn($path) => trailingslashit(wp_normalize_path($path)),
                [get_template_directory(), get_stylesheet_directory()],
            ),
        );
        $styles = wp_styles();
        foreach ($styles->queue as $handle) {
            $style = $styles->registered[$handle] ?? null;
            if (!$style) {
                continue;
            }
            $url = (string) wp_parse_url((string) $style->src, PHP_URL_PATH);
            $file = wp_normalize_path($style->extra['path'] ?? '');
            foreach ($urls as $prefix) {
                if ($url && str_starts_with($url, $prefix)) {
                    wp_dequeue_style($handle);
                    continue 2;
                }
            }
            foreach ($paths as $prefix) {
                if ($file && str_starts_with($file, $prefix)) {
                    wp_dequeue_style($handle);
                    continue 2;
                }
            }
        }
    }
    public static function front()
    {
        if (!is_singular()) {
            return;
        }
        $id = get_queried_object_id();
        if (!get_post_meta($id, '_lse_job', true)) {
            return;
        }
        $css = get_post_meta($id, '_lse_css', true);
        if ($css) {
            wp_register_style('lse-page', false, [], LSE_VERSION);
            wp_enqueue_style('lse-page');
            wp_add_inline_style('lse-page', $css);
        }
        if (
            class_exists(\Elementor\Plugin::class) &&
            isset(\Elementor\Plugin::$instance) &&
            (\Elementor\Plugin::$instance->editor->is_edit_mode() ||
                \Elementor\Plugin::$instance->preview->is_preview_mode())
        ) {
            return;
        }
        $js = get_post_meta($id, '_lse_js', true);
        wp_enqueue_script(
            'lse-interactions',
            plugins_url('assets/interactions.js', LSE_FILE),
            [],
            LSE_VERSION,
            true,
        );
        if ($js && get_post_meta($id, '_lse_scripts_enabled', true)) {
            wp_add_inline_script(
                'lse-interactions',
                'window.LSEInteractions.register(' .
                    wp_json_encode((string) $id) .
                    ', function(){' .
                    "\n" .
                    $js .
                    "\n" .
                    '});',
            );
        }
    }
    public static function seo()
    {
        if (
            !is_singular() ||
            defined('WPSEO_VERSION') ||
            defined('RANK_MATH_VERSION') ||
            defined('AIOSEO_VERSION')
        ) {
            return;
        }
        $seo = get_post_meta(get_queried_object_id(), '_lse_seo', true);
        if (!is_array($seo)) {
            return;
        }
        if (!empty($seo['description'])) {
            echo '<meta name="description" content="' .
                esc_attr($seo['description']) .
                '">' .
                "\n";
        }
        foreach (
            [
                'social_title' => 'og:title',
                'social_description' => 'og:description',
                'social_image' => 'og:image',
            ]
            as $key => $property
        ) {
            if (!empty($seo[$key])) {
                echo '<meta property="' .
                    esc_attr($property) .
                    '" content="' .
                    esc_attr($seo[$key]) .
                    '">' .
                    "\n";
            }
        }
    }
}
