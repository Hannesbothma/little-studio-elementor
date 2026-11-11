<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
final class LSE_Importer {
    use LSE_Management;
    private static function key( $id ) { if ( ! is_string( $id ) || ! preg_match( '/^[a-f0-9]{32}$/', $id ) ) { throw new RuntimeException( 'Invalid import identity.' ); } return '_lse_job_' . $id; }
    private static function load( $id ) { $job = get_option( self::key( $id ) ); if ( ! is_array( $job ) || (int) $job['owner'] !== get_current_user_id() ) { throw new RuntimeException( 'This import is unavailable to your account.' ); } return $job; }
    private static function store( $job ) { update_option( self::key( $job['id'] ), $job, false ); return $job; }
    private static function lock( $id ) { $key = self::key( $id ) . '_lock'; $old = get_option( $key ); if ( $old && time() - (int) $old > 180 ) { delete_option( $key ); } if ( ! add_option( $key, time(), '', false ) ) { throw new RuntimeException( 'This import is already processing a request. Wait a moment and retry.' ); } return $key; }
    private static function text( $value, $limit = 300 ) { if ( ! is_string( $value ) || strlen( $value ) > $limit ) { throw new RuntimeException( 'Invalid or oversized text field.' ); } return sanitize_text_field( $value ); }
    private static function clean_url( $url ) { return esc_url_raw( (string) $url, [ 'http', 'https', 'mailto', 'tel' ] ); }
    public static function check( $input ) {
        $fingerprint = $input['fingerprint'] ?? '';
        if ( ! is_string( $fingerprint ) || ! preg_match( '/^[a-f0-9]{64}$/', $fingerprint ) ) { throw new RuntimeException( 'The source file identity is invalid.' ); }
        $last = get_user_meta( get_current_user_id(), '_lse_last_job', true ); $import = null;
        if ( is_string( $last ) && preg_match( '/^[a-f0-9]{32}$/', $last ) ) { $previous = get_option( self::key( $last ) ); if ( is_array( $previous ) && (int) $previous['owner'] === get_current_user_id() && hash_equals( $previous['fingerprint'], $fingerprint ) && ! in_array( $previous['state'], [ 'removed', 'partly-removed' ], true ) ) { $import = self::status( [ 'job' => $last ] ); } }
        return [ 'version' => LSE_VERSION, 'elementor' => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '', 'import' => $import ];
    }
    public static function prepare( $input ) {
        $connection = self::check( $input );
        if ( ! $connection['elementor'] ) { throw new RuntimeException( 'Activate Elementor before importing.' ); }
        $job = $connection['import']; $target = $input['target_job'] ?? '';
        if ( $target && ( $job['id'] ?? '' ) !== $target ) { $job = null; }
        return ! $job || $target && $job['state'] === 'ready' ? self::start( $input ) : $job;
    }
    public static function start( $input ) {
        if ( ! is_string( $input['fingerprint'] ?? null ) || ! preg_match( '/^[a-f0-9]{64}$/', $input['fingerprint'] ) ) { throw new RuntimeException( 'The source file identity is invalid.' ); }
        $lock = '_lse_start_' . get_current_user_id() . '_' . $input['fingerprint']; $old = get_option( $lock ); if ( $old && time() - (int) $old > 180 ) { delete_option( $lock ); }
        if ( ! add_option( $lock, time(), '', false ) ) { throw new RuntimeException( 'This website is already being prepared. Wait a moment and retry.' ); }
        try { return self::begin( $input ); } finally { delete_option( $lock ); }
    }
    private static function begin( $input ) {
        if ( ! defined( 'ELEMENTOR_VERSION' ) || ! class_exists( '\Elementor\Plugin' ) ) { throw new RuntimeException( 'Activate Elementor before importing.' ); }
        if ( ! isset( $input['fingerprint'] ) || ! preg_match( '/^[a-f0-9]{64}$/', $input['fingerprint'] ) ) { throw new RuntimeException( 'The source file identity is invalid.' ); }
        $pages = $input['pages'] ?? null; if ( ! is_array( $pages ) || ! count( $pages ) ) { throw new RuntimeException( 'A website must contain at least one page.' ); }
        $seen = []; foreach ( $pages as $page ) { if ( ! is_array( $page ) ) { throw new RuntimeException( 'Invalid page metadata.' ); } $key = self::text( $page['key'] ?? '', 100 ); if ( ! $key || $key !== $page['key'] || isset( $seen[$key] ) ) { throw new RuntimeException( 'Page keys must be unique plain text.' ); } if ( ! trim( self::text( $page['title'] ?? '', 300 ) ) ) { throw new RuntimeException( 'Page titles cannot be empty.' ); } foreach ( [ 'slug' => 200, 'url' => 2048, 'parent_key' => 100 ] as $field => $limit ) { self::text( $page[$field] ?? '', $limit ); } $seen[$key] = $page; }
        if ( ! is_array( $input['site'] ?? [] ) || ! is_array( $input['site']['navigation'] ?? [] ) ) { throw new RuntimeException( 'Invalid site navigation.' ); }
        foreach ( $input['site']['navigation'] ?? [] as $item ) { if ( ! is_array( $item ) || ! isset( $seen[$item['key'] ?? ''] ) || ! trim( self::text( $item['label'] ?? '', 150 ) ) ) { throw new RuntimeException( 'A menu item has an invalid destination or label.' ); } }
        if ( ! empty( $input['site']['home_key'] ) && ! isset( $seen[$input['site']['home_key']] ) ) { throw new RuntimeException( 'The homepage does not exist in this import.' ); }
        foreach ( $pages as $page ) { $ancestors = [ $page['key'] ]; $parent = $page['parent_key'] ?? ''; while ( $parent !== '' ) { if ( ! isset( $seen[$parent] ) || in_array( $parent, $ancestors, true ) ) { throw new RuntimeException( 'Page hierarchy has a cycle or missing parent.' ); } $ancestors[] = $parent; $parent = $seen[$parent]['parent_key'] ?? ''; } }
        if ( ! empty( $input['target_job'] ) ) { return self::refresh( $input ); }
        $last = get_user_meta( get_current_user_id(), '_lse_last_job', true );
        if ( $last ) { $previous = get_option( self::key( $last ) ); if ( is_array( $previous ) && $previous['owner'] === get_current_user_id() && $previous['fingerprint'] === $input['fingerprint'] && in_array( $previous['state'], [ 'importing', 'finishing', 'ready' ], true ) ) { return self::status( [ 'job' => $last ] ); } }
        $id = bin2hex( random_bytes( 16 ) ); $layout = in_array( $input['layout'] ?? '', [ 'elementor_canvas', 'elementor_header_footer' ], true ) ? $input['layout'] : 'elementor_canvas';
        $job = [ 'id' => $id, 'engine' => 'capture-v2', 'site_id' => self::text( $input['site_id'] ?? '', 100 ), 'owner' => get_current_user_id(), 'fingerprint' => $input['fingerprint'], 'title' => self::text( $input['title'] ?? 'Imported website', 150 ), 'state' => 'importing', 'created' => time(), 'pages' => [], 'assets' => [], 'fonts' => [], 'map' => [], 'reports' => [], 'layout' => $layout, 'scripts' => ! empty( $input['scripts'] ) && current_user_can( 'unfiltered_html' ), 'site' => is_array( $input['site'] ?? null ) ? $input['site'] : [], 'menu' => 0 ];
        self::store( $job ); update_user_meta( get_current_user_id(), '_lse_last_job', $id );
        try {
            foreach ( $pages as $page ) {
                $post = wp_insert_post( wp_slash( [ 'post_type' => 'page', 'post_status' => 'draft', 'post_title' => self::text( $page['title'] ?? 'Untitled page' ), 'post_name' => sanitize_title( $page['slug'] ?? $page['title'] ), 'post_author' => get_current_user_id(), 'comment_status' => 'closed', 'page_template' => $layout ] ), true );
                if ( is_wp_error( $post ) ) { throw new RuntimeException( $post->get_error_message() ); }
                update_post_meta( $post, '_lse_job', $id ); update_post_meta( $post, '_lse_source_key', $page['key'] );
                $job['pages'][] = [ 'key' => $page['key'], 'title' => html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ), 'id' => $post, 'source_url' => self::clean_url( $page['url'] ?? '' ), 'source_slug' => (string) ( $page['slug'] ?? '' ), 'parent_key' => $page['parent_key'] ?? '', 'done' => false, 'initial_stamp' => self::stamp( $post ) ]; self::store( $job );
            }
            $ids = array_column( $job['pages'], 'id', 'key' );
            foreach ( $job['pages'] as &$page ) { if ( $page['parent_key'] ) { $result = wp_update_post( [ 'ID' => $page['id'], 'post_parent' => $ids[$page['parent_key']] ], true ); if ( is_wp_error( $result ) ) { throw new RuntimeException( $result->get_error_message() ); } } $page['url'] = add_query_arg( 'page_id', $page['id'], home_url( '/' ) ); $page['edit_url'] = admin_url( 'post.php?post=' . $page['id'] . '&action=elementor' ); if ( $page['source_url'] ) { $job['map'][$page['source_url']] = $page['url']; } } unset( $page );
            foreach ( $job['pages'] as &$page ) { $page['initial_stamp'] = self::stamp( $page['id'] ); } unset( $page );
            self::store( $job ); return self::status( [ 'job' => $id ] );
        } catch ( Throwable $error ) { $job['state'] = 'interrupted'; self::store( $job ); throw $error; }
    }
    public static function media_batch_size() { return max( 1, min( 32, (int) ini_get( 'max_file_uploads' ) ?: 20 ) ); }
    public static function batch_seconds() { $host = (int) ini_get( 'max_execution_time' ); return $host > 0 ? min( 3.0, max( 0.25, $host / 4 ) ) : 3.0; }
    public static function assets( $input ) {
        $items = $input['assets'] ?? null;
        if ( ! is_array( $items ) || ! $items || count( $items ) > self::media_batch_size() ) { throw new RuntimeException( 'The media batch exceeds the hosting upload count. Reload the importer and retry.' ); }
        $bytes = 0;
        foreach ( $items as $i => $item ) {
            $file = $_FILES['file_' . $i] ?? null;
            if ( ! is_array( $item ) || ! is_array( $file ) || ! isset( $file['size'] ) ) { throw new RuntimeException( 'A media batch is incomplete. Retry the import.' ); }
            $bytes += (int) $file['size'];
        }
        if ( $bytes > 4 * MB_IN_BYTES ) { throw new RuntimeException( 'This media batch exceeds its request work size. Use individual uploads.' ); }
        $original = $_FILES['file'] ?? null; $saved = []; $started = microtime( true ); $budget = self::batch_seconds(); $job = self::load( $input['job'] ?? '' ); $lock = self::lock( $job['id'] );
        try {
            foreach ( $items as $i => $item ) {
                $_FILES['file'] = $_FILES['file_' . $i];
                $saved[] = self::save_asset( $item, $job );
                if ( microtime( true ) - $started >= $budget ) { break; }
            }
        } finally { delete_option( $lock ); if ( $original === null ) { unset( $_FILES['file'] ); } else { $_FILES['file'] = $original; } }
        return [ 'assets' => $saved ];
    }
    private static function page_result( $job, $index, $input ) {
        if ( ! empty( $input['compact'] ) ) { return [ 'saved' => true, 'key' => $job['pages'][$index]['key'], 'stamp' => $job['pages'][$index]['stamp'] ?? '' ]; }
        return self::status( [ 'job' => $job['id'] ] );
    }
    public static function asset( $input ) {
        $job = self::load( $input['job'] ?? '' ); $lock = self::lock( $job['id'] );
        try { return self::save_asset( $input, $job ); } finally { delete_option( $lock ); }
    }
    private static function save_asset( $input, &$job ) {
        $started = microtime( true );
        if ( $job['state'] !== 'importing' ) { throw new RuntimeException( 'This import no longer accepts files.' ); }
        $source = (string) ( $input['url'] ?? '' ); if ( ! $source || strlen( $source ) > 2048 ) { throw new RuntimeException( 'Invalid source asset reference.' ); }
        foreach ( $job['assets'] as $saved ) { if ( $saved['source'] === $source ) { return $saved; } }
        $file = $_FILES['file'] ?? null; if ( ! is_array( $file ) || (int) $file['error'] !== UPLOAD_ERR_OK || ! is_uploaded_file( $file['tmp_name'] ) || $file['size'] < 1 || $file['size'] > wp_max_upload_size() ) { throw new RuntimeException( 'An asset is missing or exceeds the upload limit.' ); }
        $ext = strtolower( pathinfo( $file['name'], PATHINFO_EXTENSION ) ); $font_types = [ 'woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf', 'otf' => 'font/otf' ]; $is_font = isset( $font_types[$ext] ); $is_svg = $ext === 'svg';
        $types = array_intersect( get_allowed_mime_types(), [ 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ] );
        if ( $is_font ) { $signatures = [ 'woff' => [ 'wOFF' ], 'woff2' => [ 'wOF2' ], 'otf' => [ 'OTTO' ], 'ttf' => [ "\x00\x01\x00\x00", 'true' ] ]; $stream = fopen( $file['tmp_name'], 'rb' ); $signature = $stream ? fread( $stream, 4 ) : ''; if ( $stream ) { fclose( $stream ); } if ( ! in_array( $signature, $signatures[$ext], true ) ) { throw new RuntimeException( 'Invalid font signature.' ); } $types = [ $ext => $font_types[$ext] ]; }
        elseif ( $is_svg ) { $raw = file_get_contents( $file['tmp_name'] ); if ( preg_match( '/<!DOCTYPE|<!ENTITY/i', $raw ) ) { throw new RuntimeException( 'SVG document entities are not allowed.' ); } $clean_svg = self::html( $raw ); $xml = new DOMDocument(); $previous = libxml_use_internal_errors( true ); try { $valid = $xml->loadXML( $clean_svg, LIBXML_NONET ) && $xml->documentElement && $xml->documentElement->localName === 'svg'; } finally { libxml_clear_errors(); libxml_use_internal_errors( $previous ); } if ( ! $valid ) { throw new RuntimeException( 'The SVG file could not be sanitised safely.' ); } file_put_contents( $file['tmp_name'], $clean_svg ); $types = [ 'svg' => 'image/svg+xml' ]; }
        else { $checked = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'], $types ); if ( empty( $checked['type'] ) || ( str_starts_with( $checked['type'], 'image/' ) && wp_get_image_mime( $file['tmp_name'] ) !== $checked['type'] ) ) { throw new RuntimeException( 'This embedded file is invalid or is not allowed by WordPress.' ); } }
        $hash = hash_file( 'sha256', $file['tmp_name'] ); $attachment = 0;
        foreach ( get_posts( [ 'post_type' => 'attachment', 'post_status' => 'inherit', 'numberposts' => 10, 'meta_query' => [ 'relation' => 'OR', [ 'key' => '_lse_sha256', 'value' => $hash ], [ 'key' => '_little_studio_import_sha256', 'value' => $hash ] ] ] ) as $existing ) { $path = wp_get_original_image_path( $existing->ID ) ?: get_attached_file( $existing->ID ); if ( $path && is_file( $path ) && hash_equals( $hash, hash_file( 'sha256', $path ) ) ) { $attachment = $existing->ID; break; } }
        $reused = (bool) $attachment;
        if ( ! $attachment ) {
            require_once ABSPATH . 'wp-admin/includes/file.php'; require_once ABSPATH . 'wp-admin/includes/media.php'; require_once ABSPATH . 'wp-admin/includes/image.php';
            $mime_filter = static function( $mimes ) use ( $types ) { return array_merge( $mimes, $types ); }; if ( $is_font || $is_svg ) { add_filter( 'upload_mimes', $mime_filter ); }
            try { $attachment = media_handle_upload( 'file', 0, [ 'post_title' => self::asset_title( $file['name'] ) ], [ 'test_form' => false, 'mimes' => $types ] ); } finally { if ( $is_font || $is_svg ) { remove_filter( 'upload_mimes', $mime_filter ); } }
            if ( is_wp_error( $attachment ) ) { throw new RuntimeException( $attachment->get_error_message() ); }
            update_post_meta( $attachment, '_lse_sha256', $hash ); update_post_meta( $attachment, '_lse_job', $job['id'] );
            if ( ! $is_font ) { update_post_meta( $attachment, '_wp_attachment_image_alt', self::text( $input['alt'] ?? '', 1000 ) ); }
        }
        if ( $reused && get_post_meta( $attachment, '_lse_sha256', true ) === $hash && preg_match( '/^(?:captured-)?[a-f0-9]{16,64}$/iD', get_the_title( $attachment ) ) && ! preg_match( '/^(?:captured-)?[a-f0-9]{16,64}$/iD', pathinfo( $file['name'], PATHINFO_FILENAME ) ) ) { wp_update_post( [ 'ID' => $attachment, 'post_title' => self::asset_title( $file['name'] ) ] ); }
        if ( $is_svg ) {
            $root = $xml->documentElement; $view = preg_split( '/[\s,]+/', trim( $root->getAttribute( 'viewBox' ) ?: $root->getAttribute( 'viewbox' ) ) );
            $dimension = static function( $value, $fallback ) { return preg_match( '/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/D', $value, $m ) ? (float) $m[1] : (float) $fallback; };
            $width = $dimension( $root->getAttribute( 'width' ), $view[2] ?? 0 ); $height = $dimension( $root->getAttribute( 'height' ), $view[3] ?? 0 );
            $meta = wp_get_attachment_metadata( $attachment ); $meta = is_array( $meta ) ? $meta : [];
            if ( $width > 0 && $height > 0 && $width <= 100000 && $height <= 100000 && ( empty( $meta['width'] ) || empty( $meta['height'] ) ) ) { $meta['width'] = (int) ceil( $width ); $meta['height'] = (int) ceil( $height ); $meta['file'] = get_post_meta( $attachment, '_wp_attached_file', true ); wp_update_attachment_metadata( $attachment, $meta ); }
        }
        $url = wp_get_attachment_url( $attachment ); $saved = [ 'source' => $source, 'url' => $url, 'id' => $attachment, 'reused' => $reused, 'name' => sanitize_file_name( $file['name'] ), 'bytes' => (int) $file['size'], 'hash' => $hash, 'font' => $is_font ];
        $job['assets'][] = $saved; $job['map'][$source] = $url;
        if ( $is_font ) { $family = 'LSImport_' . substr( $hash, 0, 16 ); $families = $input['families'] ?? [ $input['family'] ?? '' ]; if ( ! is_array( $families ) ) { throw new RuntimeException( 'Invalid font families.' ); } foreach ( $families as $source_family ) { $source_family = self::text( $source_family, 100 ); if ( $source_family ) { $job['font_map'][$source_family] = $family; } } $job['fonts'][] = [ 'family' => $family, 'url' => $url ]; }
        self::store( $job ); $saved['processing_ms'] = (int) round( ( microtime( true ) - $started ) * 1000 ); return $saved;
    }
    private static function asset_title( $name ) { return ucwords( str_replace( [ '-', '_' ], ' ', pathinfo( sanitize_file_name( $name ), PATHINFO_FILENAME ) ) ); }
    private static function rewrite( $value, $map ) {
        if ( ! $map ) { return $value; }
        static $cached_map = null, $pairs = [], $patterns = [];
        if ( $cached_map !== $map ) {
            $cached_map = $map; $pairs = $map;
            foreach ( $map as $from => $to ) { $pairs[str_replace( '/', '\\/', $from )] = str_replace( '/', '\\/', $to ); }
            unset( $pairs[''] ); uksort( $pairs, static fn( $a, $b ) => strlen( $b ) <=> strlen( $a ) );
            $patterns = []; $chunk = []; $bytes = 0;
            foreach ( array_keys( $pairs ) as $key ) {
                $quoted = preg_quote( $key, '#' );
                if ( $chunk && $bytes + strlen( $quoted ) > 4096 ) { $patterns[] = self::rewrite_pattern( $chunk ); $chunk = []; $bytes = 0; }
                $chunk[] = $quoted; $bytes += strlen( $quoted ) + 1;
            }
            if ( $chunk ) { $patterns[] = self::rewrite_pattern( $chunk ); }
        }
        return self::rewrite_values( $value, $pairs, $patterns );
    }
    private static function rewrite_pattern( $keys ) { return '#(?:' . implode( '|', $keys ) . ')(?=$|[^a-zA-Z0-9_./%~\\-])#'; }
    private static function rewrite_match( $pattern, $value, $offset ) {
        $found = preg_match( $pattern, $value, $match, PREG_OFFSET_CAPTURE, $offset );
        if ( $found === false ) { throw new RuntimeException( 'A captured resource URL could not be remapped: ' . preg_last_error_msg() ); }
        return $found ? $match[0] : null;
    }
    private static function rewrite_values( $value, $pairs, $patterns ) {
        if ( is_array( $value ) ) { return array_map( static fn( $v ) => self::rewrite_values( $v, $pairs, $patterns ), $value ); }
        if ( ! is_string( $value ) || ! $pairs ) { return $value; }
        if ( count( $patterns ) === 1 ) {
            $result = preg_replace_callback( $patterns[0], static fn( $match ) => $pairs[$match[0]], $value );
            if ( ! is_string( $result ) ) { throw new RuntimeException( 'A captured resource URL could not be remapped: ' . preg_last_error_msg() ); }
            return $result;
        }
        // Merge matches from small expressions against the original text. Rewriting each
        // chunk's output would cascade replacements and break longest-match boundaries.
        $next = []; foreach ( $patterns as $i => $pattern ) { $next[$i] = self::rewrite_match( $pattern, $value, 0 ); }
        $cursor = 0; $result = '';
        while ( true ) {
            $first = null;
            foreach ( $next as $match ) { if ( $match !== null && ( $first === null || $match[1] < $first[1] || ( $match[1] === $first[1] && strlen( $match[0] ) > strlen( $first[0] ) ) ) ) { $first = $match; } }
            if ( $first === null ) { return $cursor ? $result . substr( $value, $cursor ) : $value; }
            $result .= substr( $value, $cursor, $first[1] - $cursor ) . $pairs[$first[0]]; $cursor = $first[1] + strlen( $first[0] );
            foreach ( $next as $i => $match ) { if ( $match !== null && $match[1] < $cursor ) { $next[$i] = self::rewrite_match( $patterns[$i], $value, $cursor ); } }
        }
    }
    private static function html( $html, $interactive = false ) {
        $allowed = wp_kses_allowed_html( 'post' );
        foreach ( [ 'div', 'span', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'details', 'dialog', 'summary', 'button', 'picture', 'source', 'video', 'audio', 'form', 'fieldset', 'legend', 'label' ] as $tag ) { $allowed[$tag] = array_merge( $allowed[$tag] ?? [], [ 'class' => true, 'id' => true, 'style' => true, 'role' => true, 'aria-*' => true, 'data-*' => true, 'hidden' => true, 'tabindex' => true ] ); }
        $allowed['label']['for'] = true;
        foreach ( $allowed as $tag => $attributes ) { $allowed[$tag] = array_merge( $attributes, [ 'class' => true, 'id' => true, 'role' => true, 'aria-*' => true, 'data-*' => true, 'hidden' => true ] ); }
        $svg_attributes = array_fill_keys( [ 'viewbox', 'xmlns', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points', 'transform', 'opacity', 'fill-rule', 'clip-rule', 'aria-hidden', 'aria-label', 'role', 'focusable', 'class', 'id', 'style', 'data-lse-source-content' ], true );
        foreach ( [ 'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'title', 'desc' ] as $tag ) { $allowed[$tag] = $svg_attributes; }
        $allowed['button']['type'] = true; $allowed['button']['disabled'] = true;
        $field_attributes = array_fill_keys( [ 'class', 'id', 'type', 'name', 'value', 'placeholder', 'disabled', 'readonly', 'checked', 'selected', 'multiple', 'rows', 'cols', 'min', 'max', 'step', 'maxlength', 'required', 'autocomplete', 'inputmode', 'role', 'hidden', 'aria-*', 'data-*' ], true ); foreach ( [ 'input', 'select', 'option', 'textarea' ] as $tag ) { $allowed[$tag] = $field_attributes; }
        foreach ( [ 'source', 'video', 'audio' ] as $tag ) { foreach ( [ 'src', 'srcset', 'sizes', 'type', 'poster', 'controls', 'preload', 'loop', 'muted', 'autoplay', 'playsinline' ] as $attr ) { $allowed[$tag][$attr] = true; } }
        $html = preg_replace( '~<(script|iframe|object|embed|style)\b[^>]*>[\s\S]*?</\1\s*>~i', '', (string) $html );
        if ( ! $interactive ) { $html = preg_replace( '~<form\b[^>]*>~i', '<div role="group">', $html ); $html = preg_replace( '~</form\s*>~i', '</div>', $html ); }
        $html = wp_kses( $html, $allowed ); $processor = new WP_HTML_Tag_Processor( $html ); while ( $processor->next_tag() ) { if ( in_array( $processor->get_tag(), [ 'INPUT', 'SELECT', 'TEXTAREA' ], true ) ) { if ( ! $interactive ) { $processor->set_attribute( 'disabled', true ); } if ( $processor->get_attribute( 'type' ) === 'password' ) { $processor->remove_attribute( 'value' ); } } if ( $interactive && $processor->get_tag() === 'FORM' ) { $processor->set_attribute( 'data-lse-local-form', '' ); } } return $processor->get_updated_html();
    }
    private static function css( $css ) { if ( ! is_string( $css ) ) { throw new RuntimeException( 'Generated styles must be CSS text.' ); } if ( preg_match( '~</?style|@import|expression\s*\(|javascript\s*:|-moz-binding|(?<![a-z-])behavior\s*:|[\x00]~i', $css ) ) { throw new RuntimeException( 'Unsafe CSS was rejected.' ); } return $css; }
    private static function tree( $items, $job, &$count, $depth = 0 ) {
        if ( ! is_array( $items ) ) { throw new RuntimeException( 'Element children must be a list.' ); } $out = [];
        static $cached_assets = null, $asset_ids = []; if ( $cached_assets !== $job['assets'] ) { $cached_assets = $job['assets']; $asset_ids = array_column( $job['assets'], 'id', 'url' ); }
        foreach ( $items as $item ) {
            ++$count; if ( ! is_array( $item ) || ! preg_match( '/^[a-f0-9]{8}$/', $item['id'] ?? '' ) ) { throw new RuntimeException( 'Invalid Elementor elements.' ); }
            $type = $item['elType'] ?? ''; $widget = $item['widgetType'] ?? '';
            if ( $type !== 'container' && ( $type !== 'widget' || ! in_array( $widget, [ 'heading', 'text-editor', 'image', 'button', 'divider', 'html', 'video' ], true ) ) ) { throw new RuntimeException( 'An unsupported Elementor element was rejected.' ); }
            $settings = self::rewrite( $item['settings'] ?? [], $job['map'] ); if ( ! is_array( $settings ) ) { throw new RuntimeException( 'Element settings must be an object.' ); }
            if ( is_array( $settings['lse_attributes'] ?? null ) ) { $settings['lse_attributes'] = array_filter( $settings['lse_attributes'], static fn( $key ) => ! preg_match( '/^(?:data-(?:id|element_type|widget_type|settings|model-cid)|data-elementor-(?:id|type|post-type)|data-e-action-hash)$/iD', $key ), ARRAY_FILTER_USE_KEY ); }
            foreach ( [ 'title', 'editor', 'html' ] as $field ) { if ( isset( $settings[$field] ) ) { $settings[$field] = self::html( $settings[$field], $field === 'html' && ( $settings['lse_interactive'] ?? '' ) === 'yes' ); } }
            foreach ( $settings as $field => $value ) { if ( str_contains( $field, 'custom_css' ) || str_starts_with( $field, '__' ) || str_contains( $field, 'shortcode' ) ) { unset( $settings[$field] ); } elseif ( str_contains( $field, 'font_family' ) && is_string( $value ) && isset( $job['font_map'][$value] ) ) { $settings[$field] = $job['font_map'][$value]; } }
            if ( isset( $settings['link'] ) ) { $settings['link']['url'] = self::clean_url( $settings['link']['url'] ?? '' ); }
            foreach ( [ 'image', 'background_image', 'background_overlay_image' ] as $field ) { if ( isset( $settings[$field]['url'] ) ) { $settings[$field]['url'] = self::clean_url( $settings[$field]['url'] ); if ( isset( $asset_ids[$settings[$field]['url']] ) ) { $settings[$field]['id'] = $asset_ids[$settings[$field]['url']]; } } }
            $out[] = array_merge( [ 'id' => $item['id'], 'elType' => $type, 'isInner' => false, 'settings' => $settings, 'elements' => self::tree( $item['elements'] ?? [], $job, $count, $depth + 1 ) ], $type === 'widget' ? [ 'widgetType' => $widget ] : [] );
        } return $out;
    }
    public static function page( $input ) {
        $job = self::load( $input['job'] ?? '' ); $lock = self::lock( $job['id'] );
        try {
            $index = array_search( $input['key'] ?? '', array_column( $job['pages'], 'key' ), true ); if ( $index === false ) { throw new RuntimeException( 'Unknown source page.' ); } $page = $job['pages'][$index]; if ( $page['done'] ) { return self::page_result( $job, $index, $input ); }
            if ( $job['state'] !== 'importing' ) { throw new RuntimeException( 'This import no longer accepts pages.' ); }
            $id = $page['id']; if ( get_post_status( $id ) !== ( $page['target_status'] ?? 'draft' ) || ! current_user_can( 'edit_post', $id ) || isset( $page['initial_stamp'] ) && ! hash_equals( $page['initial_stamp'], self::stamp( $id ) ) ) { throw new RuntimeException( 'The destination draft changed. Review it before retrying.' ); }
            if ( isset( $page['initial_review_stamp'] ) && ! hash_equals( $page['initial_review_stamp'], self::review_stamp( $id ) ) ) { throw new RuntimeException( 'The page or a shared section changed while refreshing. Your edits were preserved.' ); }
            $count = 0; $tree = self::tree( $input['elements'] ?? [], $job, $count ); if ( ! $count ) { throw new RuntimeException( 'No content was converted.' ); }
            $ids = self::ids( $tree ); if ( count( array_unique( $ids ) ) !== count( $ids ) ) { throw new RuntimeException( 'Element IDs must be unique within a page.' ); }
            $css = self::css( self::rewrite( $input['css'] ?? '', $job['map'] ) ); $candidate_source = $input['source'] ?? []; if ( ! is_array( $candidate_source ) || ! is_array( $input['seo'] ?? [] ) || ! is_array( $input['warnings'] ?? [] ) || ! is_array( $input['regions'] ?? [] ) ) { throw new RuntimeException( 'Page metadata or source is invalid.' ); }
            foreach ( [ 'html', 'css', 'js' ] as $field ) { if ( isset( $candidate_source[$field] ) && ! is_string( $candidate_source[$field] ) ) { throw new RuntimeException( 'Original source fields must be text.' ); } }
            foreach ( $input['seo'] ?? [] as $field => $value ) { self::text( $value, in_array( $field, [ 'canonical', 'social_image' ], true ) ? 2048 : 1000 ); }
            foreach ( $input['warnings'] ?? [] as $warning ) { self::text( $warning, 1500 ); }
            if ( ! empty( $page['refreshing'] ) ) { self::backup_refresh( $id ); }
            $document = \Elementor\Plugin::$instance->documents->get( $id ); if ( ! $document ) { throw new RuntimeException( 'Elementor could not open the draft.' ); } $document->set_is_built_with_elementor( true );
            $ok = $document->save( [ 'elements' => $tree, 'settings' => [ 'post_status' => $page['target_status'] ?? 'draft', 'template' => $job['layout'], 'hide_title' => 'yes' ] ] ); if ( ! $ok ) { throw new RuntimeException( 'Elementor did not save the page.' ); }
            $css = preg_replace_callback( '/font-family:([^;}]+)/i', static fn( $match ) => 'font-family:' . strtr( $match[1], $job['font_map'] ?? [] ), $css ); $css = str_replace( '__LSE_SCOPE__', 'body.page-id-' . $id, self::css( $css ) );
            foreach ( $job['fonts'] as $font ) { $css .= '@font-face{font-family:"' . $font['family'] . '";src:url("' . esc_url_raw( $font['url'] ) . '");font-display:swap}'; }
            update_post_meta( $id, '_lse_css', wp_slash( $css ) );
            $source = $input['source'] ?? []; if ( ! is_array( $source ) ) { throw new RuntimeException( 'Original page source must be an object.' ); }
            update_post_meta( $id, '_lse_source', wp_slash( $source ) );
            $js = self::rewrite( is_string( $source['js'] ?? null ) ? $source['js'] : '', $job['map'] ); update_post_meta( $id, '_lse_js', wp_slash( $js ) ); update_post_meta( $id, '_lse_scripts_enabled', $job['scripts'] ? '1' : '' );
            $seo = self::rewrite( is_array( $input['seo'] ?? null ) ? $input['seo'] : [], $job['map'] ); $clean = []; foreach ( [ 'title', 'description', 'canonical', 'indexing', 'social_title', 'social_description', 'social_image' ] as $field ) { $clean[$field] = self::text( (string) ( $seo[$field] ?? '' ), in_array( $field, [ 'canonical', 'social_image' ], true ) ? 2048 : 1000 ); }
            update_post_meta( $id, '_lse_seo', wp_slash( $clean ) );
            if ( defined( 'WPSEO_VERSION' ) ) { foreach ( [ 'title' => 'title', 'description' => 'metadesc', 'canonical' => 'canonical', 'social_title' => 'opengraph-title', 'social_description' => 'opengraph-description', 'social_image' => 'opengraph-image' ] as $a => $b ) { if ( $clean[$a] ) { update_post_meta( $id, '_yoast_wpseo_' . $b, $clean[$a] ); } } }
            if ( defined( 'RANK_MATH_VERSION' ) ) { foreach ( [ 'title' => 'title', 'description' => 'description', 'canonical' => 'canonical_url', 'social_title' => 'facebook_title', 'social_description' => 'facebook_description', 'social_image' => 'facebook_image' ] as $a => $b ) { if ( $clean[$a] ) { update_post_meta( $id, 'rank_math_' . $b, $clean[$a] ); } } }
            $regions = []; foreach ( ( $input['regions'] ?? [] ) as $region ) { if ( preg_match( '/^[a-f0-9]{64}$/', $region['hash'] ?? '' ) && preg_match( '/^[a-f0-9]{8}$/', $region['id'] ?? '' ) && in_array( $region['kind'] ?? '', [ 'header', 'footer' ], true ) ) { $regions[] = $region; } }
            $job['pages'][$index]['regions'] = $regions;
            $warnings = array_map( static fn( $s ) => self::text( $s, 1500 ), ( $input['warnings'] ?? [] ) ); $fallbacks = max( 0, (int) ( $input['fallbacks'] ?? 0 ) ); $job['reports'][$page['key']] = [ 'native' => max( 0, $count - $fallbacks ), 'elements' => $count, 'fallbacks' => $fallbacks, 'warnings' => $warnings ];
            $job['pages'][$index]['done'] = true; $job['pages'][$index]['stamp'] = self::stamp( $id ); self::store( $job ); return self::page_result( $job, $index, $input );
        } finally { delete_option( $lock ); }
    }
    private static function stamp( $id ) { return hash( 'sha256', wp_json_encode( [ get_post_field( 'post_title', $id ), get_post_field( 'post_content', $id ), get_post_field( 'post_status', $id ), get_post_meta( $id, '_elementor_data', true ), get_post_meta( $id, '_elementor_page_settings', true ), get_post_meta( $id, '_lse_css', true ), get_post_field( 'post_name', $id ), get_post_field( 'post_parent', $id ), get_post_meta( $id, '_lse_js', true ), get_post_meta( $id, '_lse_seo', true ), get_post_meta( $id, '_lse_scripts_enabled', true ) ] ) ); }
    private static function find_node( $tree, $id ) { foreach ( $tree as $node ) { if ( $node['id'] === $id ) { return $node; } $found = self::find_node( $node['elements'] ?? [], $id ); if ( $found ) { return $found; } } return null; }
    private static function ids( $tree ) { $ids = []; foreach ( $tree as $node ) { $ids[] = $node['id']; $ids = array_merge( $ids, self::ids( $node['elements'] ?? [] ) ); } return $ids; }
    private static function replace_node( &$tree, $id, $template ) { foreach ( $tree as &$node ) { if ( $node['id'] === $id ) { $node = [ 'id' => $id, 'elType' => 'widget', 'widgetType' => 'lse-shared', 'isInner' => false, 'settings' => [ 'template_id' => $template, '_title' => 'Shared header / footer' ], 'elements' => [] ]; return true; } if ( self::replace_node( $node['elements'], $id, $template ) ) { return true; } } return false; }
    private static function share_one( &$job ) {
        $groups = []; foreach ( $job['pages'] as $i => $page ) { foreach ( $page['regions'] ?? [] as $region ) { $groups[$region['hash']][] = [ 'index' => $i, 'region' => $region ]; } }
        foreach ( $groups as $hash => $group ) {
            if ( count( $group ) < 2 || ! empty( $job['shared_done'][$hash] ) ) { continue; }
            $changed = false; foreach ( $group as $member ) { $page = $job['pages'][$member['index']]; if ( ! hash_equals( $page['stamp'] ?? '', self::stamp( $page['id'] ) ) ) { $changed = true; } }
            if ( $changed ) { foreach ( $group as $member ) { $job['reports'][$job['pages'][$member['index']]['key']]['warnings'][] = 'A page changed during import; this shared section remains local to protect your edits.'; } $job['shared_done'][$hash] = true; self::store( $job ); continue; }
            $first = $group[0]; $post_id = $job['pages'][$first['index']]['id']; $document = \Elementor\Plugin::$instance->documents->get( $post_id ); $canonical = self::find_node( $document->get_elements_data(), $first['region']['id'] );
            $existing = $job['templates'][$hash] ?? null;
            if ( ! $existing ) {
                if ( ! $canonical || ( $canonical['elType'] ?? '' ) !== 'container' ) { $job['shared_done'][$hash] = true; self::store( $job ); continue; }
                $template = \Elementor\Plugin::$instance->documents->create( 'section', [ 'post_title' => $job['title'] . ' — shared ' . $first['region']['kind'], 'post_status' => 'draft' ] );
                if ( is_wp_error( $template ) || ! $template ) { throw new RuntimeException( 'A shared section template could not be created.' ); }
                $template->set_is_built_with_elementor( true ); if ( ! $template->save( [ 'elements' => [ $canonical ], 'settings' => [] ] ) ) { throw new RuntimeException( 'A shared section template could not be saved.' ); }
                $template_id = $template->get_main_id(); update_post_meta( $template_id, '_lse_job', $job['id'] ); update_post_meta( $template_id, '_lse_shared', '1' );
                $existing = [ 'id' => $template_id, 'kind' => $first['region']['kind'], 'stamp' => self::stamp( $template_id ), 'ids' => self::ids( [ $canonical ] ), 'edit_url' => admin_url( 'post.php?post=' . $template_id . '&action=elementor' ) ]; $job['templates'][$hash] = $existing; self::store( $job );
            }
            foreach ( $group as $member ) { $index = $member['index']; $id = $job['pages'][$index]['id']; $doc = \Elementor\Plugin::$instance->documents->get( $id ); $tree = $doc->get_elements_data(); $node = self::find_node( $tree, $member['region']['id'] ); if ( ! $node || ( $node['widgetType'] ?? '' ) === 'lse-shared' ) { continue; }
                $original_ids = self::ids( [ $node ] ); if ( count( $original_ids ) !== count( $existing['ids'] ) ) { continue; }
                $css = get_post_meta( $id, '_lse_css', true ); $pairs = []; foreach ( $original_ids as $n => $original_id ) { $pairs['elementor-element-' . $original_id] = 'elementor-element-' . $existing['ids'][$n]; }
                self::replace_node( $tree, $member['region']['id'], $existing['id'] ); if ( ! $doc->save( [ 'elements' => $tree ] ) ) { throw new RuntimeException( 'A linked shared section could not be saved.' ); }
                update_post_meta( $id, '_lse_css', wp_slash( strtr( $css, $pairs ) ) ); $job['pages'][$index]['stamp'] = self::stamp( $id ); self::store( $job );
            }
            $job['shared_done'][$hash] = true; self::store( $job ); return true;
        } return false;
    }
    public static function finish( $input ) {
        $job = self::load( $input['job'] ?? '' ); $lock = self::lock( $job['id'] );
        try {
            if ( $job['state'] === 'ready' ) { return self::status( $input ); }
            if ( ! in_array( $job['state'], [ 'importing', 'finishing' ], true ) ) { throw new RuntimeException( 'This import cannot be finished in its current state.' ); }
            foreach ( $job['pages'] as $page ) { if ( ! $page['done'] ) { throw new RuntimeException( 'Some pages have not finished. Retry the import.' ); } }
            $job['state'] = 'finishing'; self::store( $job ); $started = microtime( true );
            for ( $i = 0; $i < 4; ++$i ) { if ( ! self::share_one( $job ) ) { break; } if ( $i === 3 || microtime( true ) - $started >= 1 ) { return self::status( $input ); } }
            if ( ! $job['menu'] && ! empty( $job['site']['navigation'] ) ) { $menu = wp_create_nav_menu( $job['title'] . ' — imported ' . substr( $job['id'], 0, 6 ) ); if ( is_wp_error( $menu ) ) { throw new RuntimeException( $menu->get_error_message() ); } $job['menu'] = $menu; self::store( $job ); $ids = array_column( $job['pages'], 'id', 'key' ); foreach ( $job['site']['navigation'] as $item ) { if ( isset( $ids[$item['key'] ?? ''] ) ) { wp_update_nav_menu_item( $menu, 0, [ 'menu-item-title' => self::text( $item['label'] ?? '' ), 'menu-item-object' => 'page', 'menu-item-object-id' => $ids[$item['key']], 'menu-item-type' => 'post_type', 'menu-item-status' => 'publish' ] ); } } }
            $job['state'] = 'ready'; self::store( $job ); return self::status( [ 'job' => $job['id'] ] );
        } finally { delete_option( $lock ); }
    }
    public static function status( $input ) {
        $job = self::load( $input['job'] ?? '' ); unset( $job['owner'], $job['fingerprint'] );
        foreach ( $job['pages'] as &$page ) {
            $post = get_post( $page['id'] ); $page['post_status'] = $post ? $post->post_status : 'missing';
            $page['current_stamp'] = $post ? self::review_stamp( $post->ID ) : '';
            $page['changed'] = $post && ( ! hash_equals( $page['stamp'] ?? $page['initial_stamp'] ?? '', self::stamp( $post->ID ) ) || self::shared_changed( $job, $post->ID ) );
            $page['current_title'] = $post ? $post->post_title : $page['title']; $page['slug'] = $post ? $post->post_name : '';
            $page['modified'] = $post ? get_post_modified_time( 'c', true, $post ) : '';
            $page['preview_url'] = $post && $post->post_status !== 'trash' ? ( get_preview_post_link( $post ) ?: get_permalink( $post ) ) : '';
            $page['can_edit'] = $post && current_user_can( 'edit_post', $post->ID ); $page['can_delete'] = $post && current_user_can( 'delete_post', $post->ID );
            $page['can_restore_refresh'] = $post && ! empty( get_post_meta( $post->ID, '_lse_refresh_backup', true ) ) && hash_equals( $page['stamp'] ?? '', self::stamp( $post->ID ) );
        } unset( $page ); return $job;
    }
    public static function undo( $input ) {
        $job = self::load( $input['job'] ?? '' ); $lock = self::lock( $job['id'] ); $removed = []; $kept = [];
        try { if ( ! empty( $job['refreshing'] ) ) { throw new RuntimeException( 'This was a refresh of existing pages. Use Restore before last refresh, or move a selected page to Trash explicitly.' ); } if ( ! EMPTY_TRASH_DAYS ) { throw new RuntimeException( 'WordPress Trash is disabled. No pages were deleted.' ); } foreach ( $job['pages'] as $page ) { if ( get_post_status( $page['id'] ) === 'trash' || ! get_post( $page['id'] ) ) { continue; } $expected = $page['done'] ? ( $page['stamp'] ?? '' ) : ( $page['initial_stamp'] ?? '' ); if ( get_post_status( $page['id'] ) === 'draft' && $expected && hash_equals( $expected, self::stamp( $page['id'] ) ) && current_user_can( 'delete_post', $page['id'] ) ) { wp_trash_post( $page['id'] ); $removed[] = $page['id']; } else { $kept[] = $page['id']; } } if ( $job['menu'] && empty( $job['activated'] ) ) { wp_delete_nav_menu( $job['menu'] ); $job['menu'] = 0; } $job['state'] = $kept ? 'partly-removed' : 'removed'; $job['cleanup'] = [ 'removed' => $removed, 'kept' => $kept, 'media' => 'Media files and shared templates are retained to avoid breaking references.' ]; self::store( $job ); return self::status( [ 'job' => $job['id'] ] ); } finally { delete_option( $lock ); }
    }
    public static function activate( $input ) {
        $job = self::load( $input['job'] ?? '' ); if ( empty( $input['consent'] ) || $job['state'] !== 'ready' ) { throw new RuntimeException( 'Review the completed import and confirm site setup first.' ); }
        foreach ( $job['pages'] as $page ) { if ( get_post_status( $page['id'] ) !== 'publish' ) { throw new RuntimeException( 'Publish the imported pages in WordPress before applying site setup.' ); } }
        if ( ! empty( $job['activated'] ) ) { return self::status( $input ); } $job['previous_setup'] = [ 'show_on_front' => get_option( 'show_on_front' ), 'page_on_front' => get_option( 'page_on_front' ), 'locations' => get_theme_mod( 'nav_menu_locations', [] ), 'theme' => get_stylesheet() ];
        foreach ( $job['pages'] as $page ) { if ( $page['key'] === ( $job['site']['home_key'] ?? '' ) ) { update_option( 'show_on_front', 'page' ); update_option( 'page_on_front', $page['id'] ); } }
        $locations = get_registered_nav_menus(); if ( $job['menu'] && $locations ) { $assignments = get_theme_mod( 'nav_menu_locations', [] ); $assignments[array_key_first( $locations )] = $job['menu']; set_theme_mod( 'nav_menu_locations', $assignments ); }
        $job['applied_setup'] = [ 'show_on_front' => get_option( 'show_on_front' ), 'page_on_front' => get_option( 'page_on_front' ), 'locations' => get_theme_mod( 'nav_menu_locations', [] ) ]; $job['activated'] = true; self::store( $job ); return self::status( $input );
    }
    public static function restore( $input ) {
        $job = self::load( $input['job'] ?? '' ); $lock = self::lock( $job['id'] );
        try {
            if ( empty( $job['activated'] ) || empty( $job['previous_setup'] ) || empty( $job['applied_setup'] ) ) { throw new RuntimeException( 'There is no applied site setup to restore.' ); }
            self::restore_setup( $job ); self::store( $job ); return self::status( $input );
        } finally { delete_option( $lock ); }
    }
}
