<?php
/**
 * Plugin Name: Little Studio to Elementor
 * Description: Capture website links or import JSON/HTML into Elementor, then manage, refresh and edit imported pages.
 * Version: 0.6.2
 * Plugin URI: https://github.com/Hannesbothma/little-studio-elementor
 * Update URI: https://github.com/Hannesbothma/little-studio-elementor
 * Requires at least: 6.8
 * Requires PHP: 8.0
 * Author: Little Studio
 * License: GPL-3.0-or-later
 * Text Domain: little-studio-elementor
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
define( 'LSE_VERSION', '0.6.2' );
define( 'LSE_FILE', __FILE__ );
require_once __DIR__ . '/includes/management.php';
require_once __DIR__ . '/includes/importer.php';
require_once __DIR__ . '/includes/capture.php';
require_once __DIR__ . '/includes/plugin.php';
require_once __DIR__ . '/includes/updates.php';
LSE_Updates::init();
LSE_Plugin::init();
