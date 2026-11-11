<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

trait LSE_Management {
    public static function remove_import( $input ) {
        $job = self::load( $input['job'] ?? '' ); $lock = self::lock( $job['id'] );
        try {
            if ( empty( $input['consent'] ) ) { throw new RuntimeException( 'Confirm removing this whole import first.' ); }
            if ( ! EMPTY_TRASH_DAYS ) { throw new RuntimeException( 'WordPress Trash is disabled. No imported content was removed.' ); }
            // Check every page before changing anything, including edited or published pages.
            foreach ( $job['pages'] as $page ) {
                if ( ! get_post( $page['id'] ) ) { continue; }
                [ , , $post ] = self::managed_page( $job, $page['key'] );
                self::expected_page( $post, $input['expected_stamps'][$page['key']] ?? '' );
                if ( ! current_user_can( 'delete_post', $post->ID ) ) { throw new RuntimeException( 'Your account cannot remove every page in this import. Nothing was removed.' ); }
            }
            if ( ! empty( $job['activated'] ) ) { self::restore_setup( $job ); }
            $removed = []; $kept = [];
            foreach ( $job['pages'] as $page ) {
                if ( ! get_post( $page['id'] ) || get_post_status( $page['id'] ) === 'trash' ) { continue; }
                if ( wp_trash_post( $page['id'] ) ) { $removed[] = $page['id']; } else { $kept[] = $page['id']; }
            }
            $retained_templates = [];
            if ( ! $kept ) {
                foreach ( $job['templates'] ?? [] as $template ) {
                    $id = (int) $template['id'];
                    if ( get_post_meta( $id, '_lse_job', true ) !== $job['id'] || self::template_used_elsewhere( $id, array_column( $job['pages'], 'id' ) ) || ! current_user_can( 'delete_post', $id ) ) { $retained_templates[] = $id; continue; }
                    if ( get_post_status( $id ) !== 'trash' && get_post( $id ) && ! wp_trash_post( $id ) ) { $retained_templates[] = $id; }
                }
                if ( ! empty( $job['menu'] ) ) { $result = wp_delete_nav_menu( $job['menu'] ); if ( ! is_wp_error( $result ) && $result ) { $job['menu'] = 0; } }
            }
            $job['state'] = $kept ? 'partly-removed' : 'removed';
            $job['cleanup'] = [ 'removed' => $removed, 'kept' => $kept, 'templates_kept' => $retained_templates, 'media' => 'Media files are retained because they may be used elsewhere.' ];
            self::store( $job );
            if ( ! $kept && get_user_meta( get_current_user_id(), '_lse_last_job', true ) === $job['id'] ) { delete_user_meta( get_current_user_id(), '_lse_last_job' ); }
            return self::status( [ 'job' => $job['id'] ] );
        } finally { delete_option( $lock ); }
    }
    private static function template_used_elsewhere( $template, $imported_pages ) {
        global $wpdb;
        $rows = $wpdb->get_results( $wpdb->prepare( "SELECT post_id, meta_value FROM {$wpdb->postmeta} WHERE meta_key = '_elementor_data' AND meta_value LIKE %s", '%' . $wpdb->esc_like( (string) $template ) . '%' ) );
        $contains = static function( $nodes ) use ( &$contains, $template ) { foreach ( is_array( $nodes ) ? $nodes : [] as $node ) { if ( (int) ( $node['settings']['template_id'] ?? 0 ) === $template || $contains( $node['elements'] ?? [] ) ) { return true; } } return false; };
        foreach ( $rows as $row ) { if ( ! in_array( (int) $row->post_id, $imported_pages, true ) && ! in_array( get_post_status( $row->post_id ), [ false, 'trash' ], true ) && $contains( json_decode( $row->meta_value, true ) ) ) { return true; } }
        return false;
    }
    private static function restore_setup( &$job ) {
        if ( empty( $job['previous_setup'] ) || empty( $job['applied_setup'] ) ) { return; }
        $old = $job['previous_setup']; $applied = $job['applied_setup']; $kept = [];
        if ( (string) get_option( 'page_on_front' ) === (string) $applied['page_on_front'] && get_option( 'show_on_front' ) === $applied['show_on_front'] ) { update_option( 'page_on_front', $old['page_on_front'] ); update_option( 'show_on_front', $old['show_on_front'] ); } else { $kept[] = 'Homepage settings changed since import and were kept.'; }
        if ( get_stylesheet() === $old['theme'] && get_theme_mod( 'nav_menu_locations', [] ) === $applied['locations'] ) { set_theme_mod( 'nav_menu_locations', $old['locations'] ); } else { $kept[] = 'Theme or menu assignments changed since import and were kept.'; }
        $job['activated'] = false; $job['restoration'] = $kept ?: [ 'Previous homepage and menu assignments restored.' ];
    }
    private static function managed_page( $job, $key ) {
        $index = array_search( $key, array_column( $job['pages'], 'key' ), true );
        if ( $index === false ) { throw new RuntimeException( 'This page does not belong to the selected import.' ); }
        $page = $job['pages'][$index]; $post = get_post( $page['id'] );
        if ( ! $post || $post->post_type !== 'page' || get_post_meta( $post->ID, '_lse_job', true ) !== $job['id'] || get_post_meta( $post->ID, '_lse_source_key', true ) !== $key || ! current_user_can( 'edit_post', $post->ID ) ) { throw new RuntimeException( 'The imported page is missing or is not editable by your account.' ); }
        return [ $index, $page, $post ];
    }
    private static function shared_stamps( $id ) {
        $tree = json_decode( get_post_meta( $id, '_elementor_data', true ) ?: '[]', true ); $stamps = [];
        $walk = static function( $nodes ) use ( &$walk, &$stamps ) { foreach ( is_array( $nodes ) ? $nodes : [] as $node ) { if ( ( $node['widgetType'] ?? '' ) === 'lse-shared' ) { $template = (int) ( $node['settings']['template_id'] ?? 0 ); $stamps[$template] = self::stamp( $template ); } $walk( $node['elements'] ?? [] ); } };
        $walk( $tree ); ksort( $stamps ); return $stamps;
    }
    private static function review_stamp( $id ) { return hash( 'sha256', self::stamp( $id ) . wp_json_encode( self::shared_stamps( $id ) ) ); }
    private static function shared_changed( $job, $id ) {
        foreach ( self::shared_stamps( $id ) as $template => $stamp ) {
            $expected = ''; foreach ( $job['templates'] ?? [] as $saved ) { if ( (int) $saved['id'] === $template ) { $expected = $saved['stamp'] ?? ''; break; } }
            if ( ! $expected || ! hash_equals( $expected, $stamp ) ) { return true; }
        } return false;
    }
    private static function expected_page( $post, $expected ) {
        if ( ! function_exists( 'wp_check_post_lock' ) ) { require_once ABSPATH . 'wp-admin/includes/post.php'; }
        if ( ! is_string( $expected ) || ! hash_equals( self::review_stamp( $post->ID ), $expected ) ) { throw new RuntimeException( 'This page or its shared sections changed after you loaded it. Reload imported pages and review the latest version first.' ); }
        if ( wp_check_post_lock( $post->ID ) ) { throw new RuntimeException( 'Someone else is editing this page. Wait until they finish.' ); }
    }
    private static function backup_refresh( $id ) {
        $backup = [ 'post_content' => get_post_field( 'post_content', $id ), 'meta' => [], 'present' => [] ];
        $fields = [ '_elementor_data', '_elementor_page_settings', '_lse_css', '_lse_source', '_lse_js', '_lse_scripts_enabled', '_lse_seo' ];
        foreach ( [ '_yoast_wpseo_' => [ 'title', 'metadesc', 'canonical', 'opengraph-title', 'opengraph-description', 'opengraph-image' ], 'rank_math_' => [ 'title', 'description', 'canonical_url', 'facebook_title', 'facebook_description', 'facebook_image' ] ] as $prefix => $names ) { foreach ( $names as $name ) { $fields[] = $prefix . $name; } }
        foreach ( $fields as $field ) { $backup['meta'][$field] = get_post_meta( $id, $field, true ); $backup['present'][$field] = metadata_exists( 'post', $id, $field ); }
        update_post_meta( $id, '_lse_refresh_backup', wp_slash( $backup ) );
        wp_save_post_revision( $id );
    }
    public static function restore_refresh( $input ) {
        $job = self::load( $input['job'] ?? '' ); $lock = self::lock( $job['id'] );
        try {
            [ $index, $page, $post ] = self::managed_page( $job, $input['key'] ?? '' );
            self::expected_page( $post, $input['expected_stamp'] ?? '' );
            if ( empty( $input['consent'] ) || ! hash_equals( $page['stamp'] ?? '', self::stamp( $post->ID ) ) ) { throw new RuntimeException( 'The refreshed page changed. Your newer edits were kept; use WordPress revisions to review its history.' ); }
            $backup = get_post_meta( $post->ID, '_lse_refresh_backup', true );
            if ( ! is_array( $backup ) || empty( $backup['meta'] ) ) { throw new RuntimeException( 'No previous refresh is available to restore.' ); }
            $saved = wp_update_post( wp_slash( [ 'ID' => $post->ID, 'post_content' => $backup['post_content'] ] ), true );
            if ( is_wp_error( $saved ) ) { throw new RuntimeException( $saved->get_error_message() ); }
            foreach ( $backup['meta'] as $field => $value ) { if ( empty( $backup['present'][$field] ) ) { delete_post_meta( $post->ID, $field ); } else { update_post_meta( $post->ID, $field, wp_slash( $value ) ); } }
            delete_post_meta( $post->ID, '_elementor_css' ); delete_post_meta( $post->ID, '_lse_refresh_backup' );
            $job['pages'][$index]['stamp'] = self::stamp( $post->ID ); self::store( $job );
            return self::status( [ 'job' => $job['id'] ] );
        } finally { delete_option( $lock ); }
    }
    public static function imports( $input ) {
        global $wpdb;
        $offset = max( 0, (int) ( $input['offset'] ?? 0 ) ); $limit = 50;
        $names = $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s AND LENGTH(option_name) = 41 ORDER BY option_id DESC LIMIT %d OFFSET %d", $wpdb->esc_like( '_lse_job_' ) . '%', $limit + 1, $offset ) );
        $rows = [];
        foreach ( array_slice( $names, 0, $limit ) as $name ) {
            $job = get_option( $name );
            if ( ! is_array( $job ) || (int) ( $job['owner'] ?? 0 ) !== get_current_user_id() || ( $job['state'] ?? '' ) === 'removed' ) { continue; }
            $rows[] = [ 'id' => $job['id'], 'title' => $job['title'], 'state' => $job['state'], 'created' => $job['created'], 'pages' => count( $job['pages'] ), 'site_id' => $job['site_id'] ?? '' ];
        }
        return [ 'imports' => $rows, 'next' => count( $names ) > $limit ? $offset + $limit : null ];
    }
    public static function manage_page( $input ) {
        $job = self::load( $input['job'] ?? '' ); $lock = self::lock( $job['id'] );
        try {
            if ( in_array( $job['state'], [ 'importing', 'finishing' ], true ) ) { throw new RuntimeException( 'Finish or pause the active import before managing its pages.' ); }
            [ $index, $page, $post ] = self::managed_page( $job, $input['key'] ?? '' );
            self::expected_page( $post, $input['expected_stamp'] ?? '' );
            $action = $input['operation'] ?? '';
            if ( $action === 'metadata' ) {
                if ( $post->post_status === 'trash' ) { throw new RuntimeException( 'Restore this page before editing it.' ); }
                $title = trim( self::text( $input['title'] ?? '', 300 ) ); $slug = sanitize_title( self::text( $input['slug'] ?? '', 200 ) );
                if ( ! $title || ! $slug ) { throw new RuntimeException( 'A page title and address are required.' ); }
                $saved = wp_update_post( wp_slash( [ 'ID' => $post->ID, 'post_title' => $title, 'post_name' => $slug ] ), true );
                if ( is_wp_error( $saved ) ) { throw new RuntimeException( $saved->get_error_message() ); }
                $job['pages'][$index]['title'] = $title;
            } elseif ( $action === 'trash' ) {
                if ( empty( $input['consent'] ) || ! current_user_can( 'delete_post', $post->ID ) ) { throw new RuntimeException( 'Confirm moving this page to Trash with an account allowed to delete it.' ); }
                if ( ! EMPTY_TRASH_DAYS ) { throw new RuntimeException( 'WordPress Trash is disabled on this site. No page was deleted.' ); }
                if ( $post->post_status !== 'trash' && ! wp_trash_post( $post->ID ) ) { throw new RuntimeException( 'WordPress did not move this page to Trash.' ); }
            } elseif ( $action === 'untrash' ) {
                if ( $post->post_status !== 'trash' ) { throw new RuntimeException( 'This page is not in Trash.' ); }
                if ( ! wp_untrash_post( $post->ID ) ) { throw new RuntimeException( 'WordPress did not restore this page.' ); }
            } else { throw new RuntimeException( 'Unknown page management action.' ); }
            self::store( $job ); return self::status( [ 'job' => $job['id'] ] );
        } finally { delete_option( $lock ); }
    }
    private static function refresh( $input ) {
        $job = self::load( $input['target_job'] ); $lock = self::lock( $job['id'] );
        try {
            if ( $job['state'] === 'ready' && ! empty( $job['refreshing'] ) && hash_equals( $job['fingerprint'], $input['fingerprint'] ) ) { return self::status( [ 'job' => $job['id'] ] ); }
            if ( in_array( $job['state'], [ 'importing', 'finishing' ], true ) ) {
                if ( hash_equals( $job['fingerprint'], $input['fingerprint'] ) ) { return self::status( [ 'job' => $job['id'] ] ); }
                throw new RuntimeException( 'Finish the active refresh with the same file before starting another one.' );
            }
            if ( ! empty( $job['site_id'] ) && ! empty( $input['site_id'] ) && $job['site_id'] !== $input['site_id'] ) { throw new RuntimeException( 'This file belongs to a different website. Select its matching import.' ); }
            $prepared = [];
            // Preflight every selected destination before changing import state or page content.
            foreach ( $input['pages'] as $source ) {
                $existing = array_search( $source['key'], array_column( $job['pages'], 'key' ), true );
                if ( $existing === false ) { throw new RuntimeException( 'The refresh contains a new page key. Import new pages separately; select existing pages to refresh this website.' ); }
                [ $index, $page, $post ] = self::managed_page( $job, $source['key'] );
                self::expected_page( $post, $input['expected_stamps'][$source['key']] ?? '' );
                if ( ! in_array( $post->post_status, [ 'draft', 'pending', 'private', 'publish' ], true ) ) { throw new RuntimeException( 'Restore trashed pages before selecting them for refresh.' ); }
                $changed = empty( $page['stamp'] ) || ! hash_equals( $page['stamp'], self::stamp( $post->ID ) ) || self::shared_changed( $job, $post->ID );
                if ( ( $changed || $post->post_status !== 'draft' ) && empty( $input['overwrite'] ) ) { throw new RuntimeException( 'A selected page was edited or published. Explicitly allow replacement after reviewing it, or deselect it.' ); }
                $prepared[] = [ $index, $post, $source ];
            }
            if ( empty( $prepared ) ) { throw new RuntimeException( 'Select at least one existing page to refresh.' ); }
            foreach ( $prepared as [ $index, $post, $source ] ) {
                $job['pages'][$index]['done'] = false;
                $job['pages'][$index]['initial_stamp'] = self::stamp( $post->ID );
                $job['pages'][$index]['initial_review_stamp'] = self::review_stamp( $post->ID );
                $job['pages'][$index]['target_status'] = $post->post_status;
                $job['pages'][$index]['refreshing'] = true;
                $job['pages'][$index]['source_url'] = self::clean_url( $source['url'] ?? '' );
                $job['pages'][$index]['source_slug'] = $source['slug'] ?? '';
                $job['pages'][$index]['regions'] = [];
            }
            $job['engine'] = 'capture-v2'; $job['assets'] = []; $job['fonts'] = []; $job['font_map'] = [];
            $job['fingerprint'] = $input['fingerprint']; $job['state'] = 'importing'; $job['refreshing'] = true; $job['updated'] = time();
            $job['scripts'] = ! empty( $input['scripts'] ) && current_user_can( 'unfiltered_html' );
            // Keep existing destinations and their addresses; never create replacement posts.
            foreach ( $job['pages'] as $page ) { if ( $page['source_url'] ) { $job['map'][$page['source_url']] = $page['url']; } }
            self::store( $job ); update_user_meta( get_current_user_id(), '_lse_last_job', $job['id'] );
            return self::status( [ 'job' => $job['id'] ] );
        } finally { delete_option( $lock ); }
    }
}
