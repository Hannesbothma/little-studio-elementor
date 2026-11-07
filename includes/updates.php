<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

final class LSE_Updates {
    const REPO = 'https://github.com/Hannesbothma/little-studio-elementor';
    const MANIFEST = 'https://github.com/Hannesbothma/little-studio-elementor/releases/latest/download/update.json';
    const CACHE = 'lse_public_release';
    private static function file() { return plugin_basename( LSE_FILE ); }
    private static function installed() { $data = get_file_data( LSE_FILE, [ 'Version' => 'Version' ], 'plugin' ); return $data['Version'] ?: LSE_VERSION; }

    public static function init() {
        add_action( 'admin_init', [ __CLASS__, 'initialize_automatic_updates' ] );
        add_filter( 'update_plugins_github.com', [ __CLASS__, 'offer' ], 10, 4 );
        add_filter( 'pre_set_site_transient_update_plugins', [ __CLASS__, 'merge' ] );
        add_filter( 'plugins_api', [ __CLASS__, 'information' ], 10, 3 );
        add_filter( 'upgrader_pre_download', [ __CLASS__, 'download' ], 10, 4 );
        add_filter( 'upgrader_source_selection', [ __CLASS__, 'source' ], 10, 4 );
        add_action( 'upgrader_process_complete', static function( $upgrader, $extra ) { if ( ( $extra['plugin'] ?? '' ) === self::file() || in_array( self::file(), (array) ( $extra['plugins'] ?? [] ), true ) ) { delete_site_transient( self::CACHE ); } }, 10, 2 );
    }

    public static function initialize_automatic_updates() {
        if ( ! current_user_can( 'update_plugins' ) || get_site_option( 'lse_automatic_updates_initialized', false ) ) { return; }
        $plugins = (array) get_site_option( 'auto_update_plugins', [] );
        if ( ! in_array( self::file(), $plugins, true ) ) { $plugins[] = self::file(); update_site_option( 'auto_update_plugins', $plugins ); }
        // A later choice in WordPress's Plugins screen is respected.
        update_site_option( 'lse_automatic_updates_initialized', true );
    }

    private static function release( $force = false ) {
        $cached = get_site_transient( self::CACHE );
        if ( ! $force && is_array( $cached ) ) { return $cached; }
        if ( get_site_transient( self::CACHE . '_lock' ) ) { return is_array( $cached ) ? $cached : [ 'error' => 'An update check is already running. Try again shortly.' ]; }
        set_site_transient( self::CACHE . '_lock', 1, 25 );
        try {
            $response = wp_safe_remote_get( $force ? add_query_arg( 'lse_check', time(), self::MANIFEST ) : self::MANIFEST, [ 'timeout' => 15, 'redirection' => 3, 'limit_response_size' => MB_IN_BYTES, 'headers' => [ 'Accept' => 'application/json', 'User-Agent' => 'Little-Studio-Elementor/' . self::installed(), 'Cache-Control' => 'no-cache' ] ] );
            if ( is_wp_error( $response ) ) { $release = [ 'error' => 'Could not reach the update server. Please try again.' ]; }
            elseif ( wp_remote_retrieve_response_code( $response ) !== 200 ) { $release = [ 'error' => 'Could not check the newest release (HTTP ' . wp_remote_retrieve_response_code( $response ) . '). Please try again shortly.' ]; }
            else {
                $data = json_decode( wp_remote_retrieve_body( $response ), true ); $release = [ 'error' => 'A ready update package was not found. Please try again shortly.' ];
                if ( is_array( $data ) && is_string( $data['version'] ?? null ) && is_string( $data['sha256'] ?? null ) && preg_match( '/^\d+\.\d+\.\d+$/D', $data['version'] ?? '' ) && preg_match( '/^[a-f0-9]{64}$/D', $data['sha256'] ?? '' ) ) {
                    $version = $data['version']; $expected = self::REPO . '/releases/download/v' . $version . '/little-studio-elementor-' . $version . '.zip';
                    if ( ( $data['package'] ?? '' ) === $expected ) { $release = [ 'version' => $version, 'package' => $expected, 'digest' => 'sha256:' . $data['sha256'], 'notes' => is_string( $data['notes'] ?? null ) ? $data['notes'] : '', 'checked_at' => time() ]; }
                }
            }
            $release['checked_at'] = time(); set_site_transient( self::CACHE, $release, isset( $release['error'] ) ? MINUTE_IN_SECONDS : HOUR_IN_SECONDS );
            return $release;
        } finally { delete_site_transient( self::CACHE . '_lock' ); }
    }

    private static function item( $release ) {
        return (object) [ 'id' => self::REPO, 'slug' => 'little-studio-elementor', 'plugin' => self::file(), 'new_version' => $release['version'], 'url' => self::REPO, 'package' => $release['package'], 'requires' => '6.8', 'requires_php' => '8.0', 'tested' => '7.1.3' ];
    }

    public static function merge( $updates ) {
        $release = get_site_transient( self::CACHE ); if ( ! is_array( $release ) || isset( $release['error'] ) || empty( $release['version'] ) || empty( $release['package'] ) ) { return $updates; }
        if ( ! is_object( $updates ) ) { $updates = new stdClass(); }
        if ( ! isset( $updates->response ) ) { $updates->response = []; } if ( ! isset( $updates->no_update ) ) { $updates->no_update = []; }
        unset( $updates->response[self::file()], $updates->no_update[self::file()] );
        if ( version_compare( $release['version'], self::installed(), '>' ) ) { $updates->response[self::file()] = self::item( $release ); }
        else { $updates->no_update[self::file()] = self::item( $release ); }
        return $updates;
    }

    public static function offer( $update, $data, $file, $locales = [] ) {
        if ( $file !== self::file() ) { return $update; } $release = self::release(); if ( isset( $release['error'] ) ) { return false; }
        return [ 'id' => self::REPO, 'slug' => 'little-studio-elementor', 'version' => $release['version'], 'url' => self::REPO, 'package' => $release['package'], 'requires' => '6.8', 'requires_php' => '8.0', 'tested' => '7.1.3' ];
    }

    public static function information( $result, $action, $args ) {
        if ( $action !== 'plugin_information' || ( $args->slug ?? '' ) !== 'little-studio-elementor' ) { return $result; }
        $release = self::release(); return (object) [ 'name' => 'Little Studio to Elementor', 'slug' => 'little-studio-elementor', 'version' => $release['version'] ?? self::installed(), 'homepage' => self::REPO, 'download_link' => $release['package'] ?? '', 'requires' => '6.8', 'requires_php' => '8.0', 'tested' => '7.1.3', 'sections' => [ 'description' => 'Import complete Little Studio website JSON into native Elementor draft pages.', 'changelog' => nl2br( esc_html( $release['notes'] ?? 'No release notes available.' ) ) ] ];
    }

    public static function download( $reply, $package, $upgrader, $extra = [] ) {
        if ( $reply !== false || ( $extra['plugin'] ?? '' ) !== self::file() ) { return $reply; }
        $release = self::release(); if ( isset( $release['error'] ) || $package !== $release['package'] ) { return new WP_Error( 'lse_update_changed', 'The update changed. Look for the newest update again.' ); }
        require_once ABSPATH . 'wp-admin/includes/file.php'; $path = download_url( $package, 120 ); if ( is_wp_error( $path ) ) { return $path; }
        if ( ! empty( $release['digest'] ) && ! hash_equals( substr( $release['digest'], 7 ), hash_file( 'sha256', $path ) ) ) { wp_delete_file( $path ); return new WP_Error( 'lse_update_download', 'The downloaded update was incomplete. Please try again.' ); }
        return $path;
    }

    public static function source( $source, $remote_source, $upgrader, $extra = [] ) {
        if ( ( $extra['plugin'] ?? '' ) !== self::file() || is_wp_error( $source ) ) { return $source; }
        global $wp_filesystem; $main = trailingslashit( $source ) . basename( self::file() );
        if ( ! $wp_filesystem->exists( $main ) || basename( untrailingslashit( $source ) ) !== dirname( self::file() ) ) { return new WP_Error( 'lse_update_package', 'This package does not match the installed converter.' ); }
        $contents = $wp_filesystem->get_contents( $main ); $release = self::release();
        if ( ! is_string( $contents ) || ! preg_match( '/^[ \t*#\/]*Version:\s*([0-9.]+)/mi', $contents, $match ) || $match[1] !== ( $release['version'] ?? '' ) || ! preg_match( '/Text Domain:\s*little-studio-elementor\b/i', $contents ) ) { return new WP_Error( 'lse_update_version', 'The update package version did not match. Please check again.' ); }
        return $source;
    }

    public static function state() {
        $release = get_site_transient( self::CACHE ); $installed = self::installed(); $valid = is_array( $release ) && ! isset( $release['error'] ) && ! empty( $release['version'] );
        return [ 'installed' => $installed, 'latest' => $valid ? $release['version'] : '', 'available' => $valid && version_compare( $release['version'], $installed, '>' ), 'automatic' => in_array( self::file(), (array) get_site_option( 'auto_update_plugins', [] ), true ) ];
    }

    public static function update_check( $input = [] ) {
        if ( ! current_user_can( 'update_plugins' ) ) { throw new RuntimeException( 'Your WordPress account cannot update plugins.' ); }
        $release = self::release( ! empty( $input['force'] ) ); if ( isset( $release['error'] ) ) { throw new RuntimeException( $release['error'] ); }
        set_site_transient( 'update_plugins', self::merge( get_site_transient( 'update_plugins' ) ) ); return self::state();
    }

    public static function update_install( $input = [] ) {
        if ( ! current_user_can( 'update_plugins' ) ) { throw new RuntimeException( 'Your WordPress account cannot update plugins.' ); }
        if ( ! add_option( 'lse_plugin_update_lock', time(), '', false ) ) { $time = (int) get_option( 'lse_plugin_update_lock' ); if ( $time && time() - $time > 300 ) { delete_option( 'lse_plugin_update_lock' ); } throw new RuntimeException( 'An update is already running. Try again shortly.' ); }
        try {
            $state = self::update_check( [ 'force' => true ] ); if ( ! $state['available'] ) { return $state; }
            require_once ABSPATH . 'wp-admin/includes/file.php'; require_once ABSPATH . 'wp-admin/includes/plugin.php'; require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
            if ( ! WP_Filesystem() ) { throw new RuntimeException( 'WordPress could not write to its plugin folder. Check the hosting file permissions.' ); }
            $active = is_plugin_active( self::file() ); $network = is_plugin_active_for_network( self::file() ); $skin = new WP_Ajax_Upgrader_Skin(); $upgrader = new Plugin_Upgrader( $skin );
            $result = $upgrader->upgrade( self::file(), [ 'clear_update_cache' => true ] );
            if ( is_wp_error( $result ) ) { throw new RuntimeException( $result->get_error_message() ); }
            if ( ! $result ) { $errors = $skin->get_errors(); throw new RuntimeException( $errors->has_errors() ? $errors->get_error_message() : 'WordPress could not finish the update. Please try again.' ); }
            wp_clean_plugins_cache( false ); if ( $active && ! is_plugin_active( self::file() ) ) { $activation = activate_plugin( self::file(), '', $network, true ); if ( is_wp_error( $activation ) ) { throw new RuntimeException( $activation->get_error_message() ); } }
            delete_site_transient( self::CACHE ); return array_merge( self::state(), [ 'updated' => true ] );
        } finally { delete_option( 'lse_plugin_update_lock' ); }
    }
}
