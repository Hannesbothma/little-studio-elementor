<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Four independent public GETs; redirects still go through the capture validator. */
final class LSE_Fetch
{
    private static $ready = [];
    public static function concurrency()
    {
        if (
            !function_exists('curl_multi_exec') ||
            has_filter('http_request_args') ||
            has_filter('https_ssl_verify')
        ) {
            return 1;
        }
        _wp_http_get_object();
        $proxy = new WP_HTTP_Proxy();
        return $proxy->is_enabled() ||
            ((int) ini_get('max_execution_time') > 0 &&
                (int) ini_get('max_execution_time') < 20)
            ? 1
            : 4;
    }
    public static function prime($urls, $validate)
    {
        $requests = [];
        $argsByURL = [];
        $http = _wp_http_get_object();
        $proxy = new WP_HTTP_Proxy();
        foreach (
            array_slice(array_unique($urls), 0, self::concurrency())
            as $url
        ) {
            if (array_key_exists($url, self::$ready)) {
                continue;
            }
            try {
                $validate($url);
            } catch (Throwable $error) {
                continue;
            }
            $args = [
                'method' => 'GET',
                'timeout' => 6,
                'redirection' => 0,
                '_redirection' => 0,
                'reject_unsafe_urls' => true,
                'blocking' => true,
                'headers' => ['Accept' => '*/*'],
                'cookies' => [],
                'body' => null,
                'compress' => false,
                'decompress' => true,
                'sslverify' => true,
                'sslcertificates' =>
                    ABSPATH . WPINC . '/certificates/ca-bundle.crt',
                'stream' => false,
                'filename' => null,
                'limit_response_size' => null,
                'httpversion' => '1.0',
                'user-agent' => 'LittleStudioCapture/' . LSE_VERSION,
            ];
            // Hosts/plugins requiring custom request handling keep the normal WP HTTP route.
            if (
                $proxy->is_enabled() ||
                has_filter('http_request_args') ||
                has_filter('https_ssl_verify') ||
                $http->block_request($url)
            ) {
                continue;
            }
            $pre = apply_filters('pre_http_request', false, $args, $url);
            if ($pre !== false) {
                self::$ready[$url] = $pre;
                continue;
            }
            $hooks = new WP_HTTP_Requests_Hooks($url, $args);
            $requests[$url] = [
                'url' => $url,
                'type' => 'GET',
                'headers' => $args['headers'],
                'options' => [
                    'timeout' => 6,
                    'connect_timeout' => 6,
                    'follow_redirects' => false,
                    'verify' => $args['sslcertificates'],
                    'useragent' => $args['user-agent'],
                    'hooks' => $hooks,
                ],
            ];
            $argsByURL[$url] = $args;
        }
        if (!$requests) {
            return;
        }
        try {
            $responses = \WpOrg\Requests\Requests::request_multiple($requests);
        } catch (Throwable $error) {
            return;
        } // Normal per-resource route remains available.
        foreach ($responses as $url => $response) {
            if ($response instanceof \WpOrg\Requests\Response) {
                $wrapper = new WP_HTTP_Requests_Response($response);
                $value = $wrapper->to_array();
                $value['http_response'] = $wrapper;
                do_action(
                    'http_api_debug',
                    $value,
                    'response',
                    'WpOrg\\Requests\\Requests',
                    $argsByURL[$url],
                    $url,
                );
                self::$ready[$url] = apply_filters(
                    'http_response',
                    $value,
                    $argsByURL[$url],
                    $url,
                );
            } elseif ($response instanceof Throwable) {
                self::$ready[$url] = new WP_Error(
                    'http_request_failed',
                    $response->getMessage(),
                );
            }
        }
    }
    public static function get($url)
    {
        if (array_key_exists($url, self::$ready)) {
            $value = self::$ready[$url];
            unset(self::$ready[$url]);
            return $value;
        }
        return wp_safe_remote_get($url, [
            'timeout' => 6,
            'redirection' => 0,
            'cookies' => [],
            'user-agent' => 'LittleStudioCapture/' . LSE_VERSION,
            'headers' => ['Accept' => '*/*'],
        ]);
    }
}
