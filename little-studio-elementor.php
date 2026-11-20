<?php
/**
 * Plugin Name: Little Studio to Elementor
 * Description: Capture website links or import JSON/HTML into Elementor, then manage, refresh and edit imported pages.
 * Version: 0.12.10
 * Plugin URI: https://github.com/Hannesbothma/little-studio-elementor
 * Update URI: https://github.com/Hannesbothma/little-studio-elementor
 * Requires at least: 6.8
 * Requires PHP: 8.0
 * Author: Little Studio
 * License: GPL-3.0-or-later
 * Text Domain: little-studio-elementor
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
define( 'LSE_VERSION', '0.12.10' );
define( 'LSE_FILE', __FILE__ );
// Keep this identity stable while the converted Elementor output stays compatible.
define( 'LSE_CONVERTER_VERSION', 'capture-v18-0.12.1' );
require_once __DIR__ . '/includes/errors.php';
require_once __DIR__ . '/includes/css.php';
require_once __DIR__ . '/includes/locks.php';
require_once __DIR__ . '/includes/page-save.php';
require_once __DIR__ . '/includes/management.php';
require_once __DIR__ . '/includes/media.php';
require_once __DIR__ . '/includes/navigation.php';
require_once __DIR__ . '/includes/native-elementor.php';
require_once __DIR__ . '/includes/spool.php';
require_once __DIR__ . '/includes/background-import.php';
require_once __DIR__ . '/includes/theme-parts.php';
require_once __DIR__ . '/includes/importer.php';
require_once __DIR__ . '/includes/fetch.php';
require_once __DIR__ . '/includes/background-capture.php';
require_once __DIR__ . '/includes/capture.php';
require_once __DIR__ . '/includes/seo.php';
require_once __DIR__ . '/includes/scrolling.php';
require_once __DIR__ . '/includes/appearance.php';
require_once __DIR__ . '/includes/styles.php';
require_once __DIR__ . '/includes/structure.php';
require_once __DIR__ . '/includes/plugin.php';
require_once __DIR__ . '/includes/updates.php';
LSE_Media::init();
LSE_SEO::init();
LSE_Scrolling::init();
LSE_Appearance::init();
LSE_Updates::init();
LSE_Plugin::init();
add_action('lse_import_work', ['LSE_Importer', 'background_work'], 10, 2);
add_action('lse_import_prune', ['LSE_Importer', 'background_prune'], 10, 2);
add_action('lse_scan_work', ['LSE_Capture', 'capture_work'], 10, 2);
add_action('lse_scan_prune', ['LSE_Capture', 'capture_prune'], 10, 2);
