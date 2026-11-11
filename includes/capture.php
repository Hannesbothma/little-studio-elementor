<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Administrator-only public website capture, checkpointed between small requests. */
final class LSE_Capture {
    private static function url( $value, $base = '' ) {
        if ( ! is_string( $value ) || strlen( $value ) > 2048 ) { return ''; }
        $value = html_entity_decode( trim( $value ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
        if ( $value === '' || $value[0] === '#' || preg_match( '~^(?:data|javascript|mailto|tel|file):~i', $value ) ) { return ''; }
        if ( $base ) { $value = WP_Http::make_absolute_url( $value, $base ); }
        $value = preg_replace( '/#.*$/s', '', $value );
        $p = wp_parse_url( $value );
        if ( ! $p || ! in_array( strtolower( $p['scheme'] ?? '' ), [ 'http', 'https' ], true ) || empty( $p['host'] ) || isset( $p['user'] ) || isset( $p['pass'] ) || ! in_array( (int) ( $p['port'] ?? 443 ), [ 80, 443 ], true ) ) { return ''; }
        $scheme = strtolower( $p['scheme'] ); $port = (int) ( $p['port'] ?? ( $scheme === 'https' ? 443 : 80 ) );
        $segments = explode( '/', $p['path'] ?? '/' ); $normalized = [];
        foreach ( $segments as $index => $segment ) {
            $dot = strtolower( str_replace( '%2e', '.', strtolower( $segment ) ) );
            if ( $dot === '.' || $dot === '..' ) {
                if ( $dot === '..' && count( $normalized ) > 1 ) { array_pop( $normalized ); }
                if ( $index === count( $segments ) - 1 ) { $normalized[] = ''; }
            } else { $normalized[] = $segment; }
        }
        $path = '/' . ltrim( implode( '/', $normalized ), '/' );
        return $scheme . '://' . strtolower( $p['host'] ) . ( $port === ( $scheme === 'https' ? 443 : 80 ) ? '' : ':' . $port ) . $path . ( isset( $p['query'] ) ? '?' . $p['query'] : '' );
    }
    private static function safe( $url ) {
        $host = wp_parse_url( $url, PHP_URL_HOST );
        $ip = $host ? gethostbyname( $host ) : '';
        if ( ! $host || ! filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) || ! wp_http_validate_url( $url ) ) { throw new RuntimeException( 'Capture requires a public HTTP or HTTPS address on port 80 or 443.' ); }
    }
    private static function origin( $url ) { $p = wp_parse_url( $url ); return strtolower( ( $p['scheme'] ?? '' ) . '://' . ( $p['host'] ?? '' ) . ':' . ( $p['port'] ?? ( ( $p['scheme'] ?? '' ) === 'https' ? 443 : 80 ) ) ); }
    private static function key( $id ) { return 'lse_capture_' . get_current_user_id() . '_' . $id; }
    private static function load( $input ) {
        $id = $input['capture'] ?? '';
        if ( ! is_string( $id ) || ! preg_match( '/^[a-f0-9]{32}$/D', $id ) ) { throw new RuntimeException( 'Invalid capture session.' ); }
        $job = get_transient( self::key( $id ) );
        if ( ! is_array( $job ) ) { throw new RuntimeException( 'Capture expired. Start again from the website link.' ); }
        return [ $id, $job ];
    }
    public static function capture_start( $input ) {
        if ( ! class_exists( 'DOMDocument' ) ) { throw new RuntimeException( 'Website capture needs the PHP DOM extension. Use the Desktop capture option on this host.' ); }
        $url = self::url( $input['url'] ?? '' ); self::safe( $url );
        $id = bin2hex( random_bytes( 16 ) );
        $job = [ 'source' => $url, 'origin' => self::origin( $url ), 'queue' => [ [ 'url' => $url, 'kind' => 'page', 'depth' => 0 ] ], 'seen' => [ $url => true ], 'pages' => 1, 'maxPages' => isset( $input['pages'] ) ? max( 1, (int) $input['pages'] ) : 0, 'depth' => isset( $input['depth'] ) ? max( 0, (int) $input['depth'] ) : null, 'seq' => 0, 'bytes' => 0, 'warnings' => [], 'truncated' => false ];
        // One live capture per administrator. Starting afresh discards only crawl metadata.
        $previous = get_user_meta( get_current_user_id(), '_lse_capture', true );
        if ( is_string( $previous ) && preg_match( '/^[a-f0-9]{32}$/D', $previous ) ) { self::remove_batch( $previous ); delete_transient( self::key( $previous ) ); }
        set_transient( self::key( $id ), $job, HOUR_IN_SECONDS ); update_user_meta( get_current_user_id(), '_lse_capture', $id );
        return [ 'capture' => $id, 'source' => $url, 'seq' => 0 ];
    }
    private static function enqueue( &$job, $value, $base, $kind, $depth ) {
        $url = self::url( $value, $base );
        if ( ! $url || isset( $job['seen'][$url] ) ) { return; }
        if ( $kind === 'asset' && preg_match( '~(?:/(?:wp-includes/js/(?:jquery|dist)/|wp-content/plugins/elementor(?:-pro)?/).*\.js|/jquery(?:-[0-9.]+)?(?:\.min)?\.js)(?:\?|$)~i', $url ) ) { return; }
        if ( $kind === 'page' ) {
            if ( self::origin( $url ) !== $job['origin'] ) { return; }
            if ( ( $job['depth'] !== null && $depth > $job['depth'] ) || ( $job['maxPages'] && $job['pages'] >= $job['maxPages'] ) ) { $job['truncated'] = true; return; }
            if ( preg_match( '~\.(?:zip|pdf|xml|json|docx?|xlsx?|jpe?g|png|gif|webp|svg|mp[34]|webm)(?:\?|$)~i', $url ) ) { return; }
            ++$job['pages'];
        }
        $job['seen'][$url] = true;
        $job['queue'][] = [ 'url' => $url, 'kind' => $kind, 'depth' => $depth ];
    }
    private static function css( &$job, $css, $base ) {
        preg_match_all( '~url\(\s*[\'"]?([^\'"\)]+)[\'"]?\s*\)|@import\s+[\'"]([^\'"]+)[\'"]~i', $css, $matches, PREG_SET_ORDER );
        foreach ( $matches as $m ) { self::enqueue( $job, trim( $m[1] ?: ( $m[2] ?? '' ) ), $base, 'asset', 0 ); }
    }
    private static function discover( &$job, $body, $type, $url, $item ) {
        if ( $type === 'text/css' ) { self::css( $job, $body, $url ); return; }
        if ( $type !== 'text/html' || $item['kind'] !== 'page' ) { return; }
        $dom = new DOMDocument(); $old = libxml_use_internal_errors( true );
        try { $dom->loadHTML( '<?xml encoding="UTF-8">' . $body, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING ); }
        finally { libxml_clear_errors(); libxml_use_internal_errors( $old ); }
        $base = $url;
        $bases = $dom->getElementsByTagName( 'base' );
        if ( $bases->length ) { $base = self::url( $bases->item( 0 )->getAttribute( 'href' ), $url ) ?: $url; }
        // Queue files before linked pages so a page limit never starves its styles or images.
        foreach ( $dom->getElementsByTagName( '*' ) as $el ) {
            $tag = strtolower( $el->tagName );
            if ( $tag === 'style' ) { self::css( $job, $el->textContent, $base ); }
            foreach ( [ 'data-thumbnail', 'data-bg', 'data-background', 'data-lazy-background-image' ] as $attr ) { self::enqueue( $job, $el->getAttribute( $attr ), $base, 'asset', 0 ); }
            if ( $el->hasAttribute( 'style' ) ) { self::css( $job, $el->getAttribute( 'style' ), $base ); }
            if ( in_array( $tag, [ 'img', 'script', 'source', 'video', 'audio' ], true ) ) {
                foreach ( [ 'src', 'poster', 'data-src', 'data-lazy-src', 'data-original' ] as $attr ) { self::enqueue( $job, $el->getAttribute( $attr ), $base, 'asset', 0 ); }
                foreach ( [ 'srcset', 'data-srcset' ] as $attr ) { foreach ( explode( ',', $el->getAttribute( $attr ) ) as $candidate ) { self::enqueue( $job, preg_split( '/\s+/', trim( $candidate ) )[0], $base, 'asset', 0 ); } }
            }
            if ( in_array( $tag, [ 'use', 'image' ], true ) ) { foreach ( [ 'href', 'xlink:href' ] as $attr ) { self::enqueue( $job, $el->getAttribute( $attr ), $base, 'asset', 0 ); } }
            if ( $tag === 'link' && preg_match( '/(?:^|\s)(?:stylesheet|icon|preload)(?:\s|$)/i', $el->getAttribute( 'rel' ) ) ) { self::enqueue( $job, $el->getAttribute( 'href' ), $base, 'asset', 0 ); }
        }
        foreach ( $dom->getElementsByTagName( 'a' ) as $a ) { self::enqueue( $job, $a->getAttribute( 'href' ), $base, 'page', $item['depth'] + 1 ); }
    }
    public static function capture_step( $input ) {
        [ $id, $job ] = self::load( $input );
        $lock = self::key( $id ) . '_lock';
        $held = get_option( $lock );
        if ( $held && (int) $held < time() - 90 ) { delete_option( $lock ); }
        if ( ! add_option( $lock, time(), '', false ) ) { throw new RuntimeException( 'This capture request is still running. Wait a moment, then retry.' ); }
        try {
            // Re-read after acquiring the lock. Only an acknowledged response advances the queue.
            [ , $job ] = self::load( $input ); $seq = $input['seq'] ?? -1;
            if ( ! is_int( $seq ) || ( $seq !== $job['seq'] && $seq !== $job['seq'] + 1 ) ) { throw new RuntimeException( 'Capture sequence changed. Start the capture again.' ); }
            if ( $seq === $job['seq'] + 1 ) {
                if ( ! isset( $job['pending'] ) ) { throw new RuntimeException( 'No capture response is awaiting acknowledgement.' ); }
                array_shift( $job['queue'] ); $job['bytes'] += $job['pending']; unset( $job['pending'] ); $job['seq'] = $seq;
            }
            if ( ! $job['queue'] ) { set_transient( self::key( $id ), $job, HOUR_IN_SECONDS ); return [ 'done' => true, 'seq' => $job['seq'], 'warnings' => $job['warnings'], 'truncated' => $job['truncated'] ]; }
            $item = $job['queue'][0]; $url = $item['url']; $record = null; $size = 0;
            try {
                for ( $redirect = 0; $redirect <= 3; ++$redirect ) {
                    self::safe( $url );
                    if ( $item['kind'] === 'page' && $job['seq'] > 0 && self::origin( $url ) !== $job['origin'] ) { throw new RuntimeException( 'A linked page redirected outside the captured website.' ); }
                    $response = wp_safe_remote_get( $url, [ 'timeout' => 6, 'redirection' => 0, 'cookies' => [], 'user-agent' => 'LittleStudioCapture/' . LSE_VERSION, 'headers' => [ 'Accept' => '*/*' ] ] );
                    if ( is_wp_error( $response ) ) { throw new RuntimeException( $response->get_error_message() ); }
                    $code = wp_remote_retrieve_response_code( $response );
                    if ( ! in_array( $code, [ 301, 302, 303, 307, 308 ], true ) ) { break; }
                    $url = self::url( wp_remote_retrieve_header( $response, 'location' ), $url );
                    if ( ! $url || $redirect === 3 ) { throw new RuntimeException( 'Unsupported or excessive redirects.' ); }
                }
                if ( $code < 200 || $code >= 300 ) { throw new RuntimeException( 'HTTP ' . $code ); }
                $body = wp_remote_retrieve_body( $response ); $size = strlen( $body );
                $header = wp_remote_retrieve_header( $response, 'content-type' ); $type = strtolower( trim( explode( ';', $header )[0] ) );
                if ( $type === 'application/xhtml+xml' ) { $type = 'text/html'; }
                if ( ! $type ) { $type = $item['kind'] === 'page' ? 'text/html' : ( wp_check_filetype( wp_parse_url( $url, PHP_URL_PATH ) )['type'] ?: 'application/octet-stream' ); }
                if ( $item['kind'] === 'page' && $type !== 'text/html' ) { throw new RuntimeException( 'The linked address did not return an HTML page.' ); }
                if ( $item['kind'] === 'page' && $job['seq'] === 0 ) { $job['origin'] = self::origin( $url ); }
                preg_match( '/charset\s*=\s*["\']?([\w-]+)/i', $header, $charset );
                $text = str_starts_with( $type, 'text/' ) || str_contains( $type, 'javascript' );
                $utf8 = $text && function_exists( 'mb_convert_encoding' ) ? mb_convert_encoding( $body, 'UTF-8', $charset[1] ?? 'UTF-8' ) : $body;
                $job['seen'][$url] = true;
                if ( $text ) { self::discover( $job, $utf8, $type, $url, $item ); }
                $record = [ 'url' => $url, 'requested' => $item['url'], 'kind' => $item['kind'], 'type' => $type, 'data' => base64_encode( $text ? $utf8 : $body ) ];
            } catch ( Throwable $e ) {
                if ( $job['seq'] === 0 ) { throw new RuntimeException( 'The starting page could not be captured: ' . $e->getMessage() ); }
                $job['warnings'][$item['url']] = 'Could not package ' . $item['url'] . ': ' . $e->getMessage(); $size = 0;
            }
            $job['pending'] = $size; set_transient( self::key( $id ), $job, HOUR_IN_SECONDS );
            return [ 'done' => false, 'seq' => $job['seq'] + 1, 'record' => $record, 'remaining' => count( $job['queue'] ) - 1, 'message' => 'Captured ' . ( $job['seq'] + 1 ) . ' resources; ' . ( count( $job['queue'] ) - 1 ) . ' queued.' ];
        } finally { delete_option( $lock ); }
    }
    private static function batch_key( $id ) { return self::key( $id ) . '_batch'; }
    private static function remove_batch( $id ) {
        $batch = get_transient( self::batch_key( $id ) );
        if ( is_array( $batch ) && ! empty( $batch['file'] ) && str_starts_with( basename( $batch['file'] ), 'lse-capture-' ) ) { wp_delete_file( $batch['file'] ); }
        delete_transient( self::batch_key( $id ) );
    }
    public static function cleanup_batch( $user, $id, $file ) {
        if ( ! is_string( $file ) || ! str_starts_with( basename( $file ), 'lse-capture-' ) ) { return; }
        $active = get_transient( 'lse_capture_' . (int) $user . '_' . $id . '_batch' );
        if ( is_array( $active ) && ( $active['file'] ?? '' ) === $file ) { wp_schedule_single_event( time() + HOUR_IN_SECONDS, 'lse_capture_cleanup', [ $user, $id, $file ] ); }
        else { wp_delete_file( $file ); }
    }
    public static function capture_batch( $input ) {
        [ $id ] = self::load( $input ); $seq = $input['seq'] ?? -1;
        if ( ! is_int( $seq ) || $seq < 0 ) { throw new RuntimeException( 'Invalid capture sequence.' ); }
        $lock = self::batch_key( $id ) . '_lock'; $held = get_option( $lock );
        if ( $held && (int) $held < time() - 90 ) { delete_option( $lock ); }
        if ( ! add_option( $lock, time(), '', false ) ) { throw new RuntimeException( 'This capture batch is still running. Wait a moment and retry.' ); }
        try {
            $cache = get_transient( self::batch_key( $id ) ); $result = null;
            if ( is_array( $cache ) ) {
                $raw = is_file( $cache['file'] ) ? file_get_contents( $cache['file'] ) : false;
                $previous = is_string( $raw ) ? json_decode( $raw, true ) : null;
                if ( ! is_array( $previous ) ) { throw new RuntimeException( 'The temporary capture cache is unavailable. Restart the capture.' ); }
                if ( $seq === $previous['from'] && ( $previous['seq'] > $seq || $previous['done'] ) ) { return $previous; }
                if ( $seq !== $previous['seq'] ) { throw new RuntimeException( 'Capture sequence changed. Start the capture again.' ); }
                $file = $cache['file'];
            } else {
                require_once ABSPATH . 'wp-admin/includes/file.php';
                $file = wp_tempnam( 'lse-capture-' . $id );
                if ( ! $file ) { throw new RuntimeException( 'The host could not create a private capture cache. Use Desktop capture.' ); }
                chmod( $file, 0600 );
                wp_schedule_single_event( time() + HOUR_IN_SECONDS, 'lse_capture_cleanup', [ get_current_user_id(), $id, $file ] );
            }
            $result = [ 'from' => $seq, 'seq' => $seq, 'records' => [], 'done' => false, 'message' => 'Capturing website…' ];
            // Persist an empty checkpoint before fetching. Every delivered resource has a replay copy
            // before the next one is acknowledged, including if PHP stops between resources.
            if ( file_put_contents( $file, wp_json_encode( $result ), LOCK_EX ) === false ) { throw new RuntimeException( 'The capture cache could not be written.' ); }
            set_transient( self::batch_key( $id ), [ 'file' => $file ], HOUR_IN_SECONDS );
            $started = microtime( true ); $bytes = 0; $budget = LSE_Importer::batch_seconds();
            for ( $i = 0; $i < 32; ++$i ) {
                $step = self::capture_step( [ 'capture' => $id, 'seq' => $result['seq'] ] );
                $result['seq'] = $step['seq']; $result['done'] = $step['done'];
                if ( ! empty( $step['record'] ) ) { $result['records'][] = $step['record']; $bytes += strlen( $step['record']['data'] ); }
                $result['message'] = $step['message'] ?? 'Website capture complete.';
                if ( $step['done'] ) { $result['warnings'] = $step['warnings']; $result['truncated'] = $step['truncated']; }
                if ( file_put_contents( $file, wp_json_encode( $result ), LOCK_EX ) === false ) { throw new RuntimeException( 'The capture checkpoint could not be saved. Restart the capture.' ); }
                if ( $step['done'] || $bytes >= 4 * MB_IN_BYTES || microtime( true ) - $started >= $budget ) { break; }
            }
            return $result;
        } finally { delete_option( $lock ); }
    }
    public static function capture_cancel( $input ) {
        [ $id ] = self::load( $input ); self::remove_batch( $id ); delete_transient( self::key( $id ) ); return [ 'cancelled' => true ];
    }
}

add_action( 'lse_capture_cleanup', [ 'LSE_Capture', 'cleanup_batch' ], 10, 3 );
