<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Deliver captured styles once, with a cacheable file when URL semantics permit. */
final class LSE_Styles
{
    private static $assets = [];

    public static function asset($id, $css)
    {
        $hash = hash('sha256', $css);
        $key = $id . '-' . $hash;
        if (array_key_exists($key, self::$assets)) {
            return self::$assets[$key];
        }
        self::$assets[$key] = false;
        // Imports, relative URLs and SVG fragments must keep their document base.
        if (preg_match('~@import\b~i', $css)) {
            return false;
        }
        if (preg_match_all('~\burl\(\s*([^\s)]{1,32})~i', $css, $matches)) {
            foreach ($matches[1] as $value) {
                $value = ltrim($value, "\"'");
                if (!preg_match('~^(?:https?:|data:|//)~i', $value)) {
                    return false;
                }
            }
        }
        $uploads = wp_upload_dir();
        if (!empty($uploads['error'])) {
            return false;
        }
        // Upload-offload plugins may point at remote storage we cannot write to.
        foreach ([PHP_URL_SCHEME, PHP_URL_HOST, PHP_URL_PORT] as $part) {
            if (
                wp_parse_url($uploads['baseurl'], $part) !==
                wp_parse_url(home_url(), $part)
            ) {
                return false;
            }
        }
        $directory = $uploads['basedir'] . '/little-studio-styles';
        if (!wp_mkdir_p($directory)) {
            return false;
        }
        $filename = absint($id) . '-' . $hash . '.css';
        $path = $directory . '/' . $filename;
        if (!is_file($path) || filesize($path) !== strlen($css)) {
            $temporary = wp_tempnam($filename, $directory);
            if (!$temporary) {
                return false;
            }
            $written = @file_put_contents($temporary, $css, LOCK_EX);
            $saved = $written === strlen($css) && @rename($temporary, $path);
            if (is_file($temporary)) {
                wp_delete_file($temporary);
            }
            if (!$saved) {
                return false;
            }
            // Match WordPress upload permissions (temporary files default to 0600).
            $permissions = fileperms($directory);
            @chmod($path, $permissions & 0000666);
        }
        self::$assets[$key] = [
            'url' => $uploads['baseurl'] . '/little-studio-styles/' . $filename,
            'version' => $hash,
        ];
        return self::$assets[$key];
    }

    public static function enqueue($id, $css)
    {
        $asset = self::asset($id, $css);
        if ($asset) {
            wp_enqueue_style('lse-page', $asset['url'], [], $asset['version']);
        } else {
            wp_register_style('lse-page', false, [], LSE_VERSION);
            wp_enqueue_style('lse-page');
            wp_add_inline_style('lse-page', $css);
        }
    }

    public static function shared_is_covered($page_id, $template_id)
    {
        if (!$page_id || $page_id === $template_id) {
            return false;
        }
        $job = get_post_meta($page_id, '_lse_job', true);
        if (!$job || $job !== get_post_meta($template_id, '_lse_job', true)) {
            return false;
        }
        $css = get_post_meta($page_id, '_lse_css', true);
        $tree = json_decode(
            get_post_meta($template_id, '_elementor_data', true),
            true,
        );
        $id = $tree[0]['id'] ?? '';
        // Linking already remaps every original region ID to this template's IDs.
        // A different/manually inserted template must retain its own stylesheet.
        return $id &&
            is_string($css) &&
            str_contains($css, '.elementor-element-' . $id);
    }

    public static function shared($id, $css)
    {
        $asset = self::asset($id, $css);
        if ($asset) {
            echo '<link rel="stylesheet" data-lse-shared-style="' .
                esc_attr($id) .
                '" href="' .
                esc_url($asset['url']) .
                '">';
        } else {
            echo '<style data-lse-shared-style="' .
                esc_attr($id) .
                '">' .
                $css .
                '</style>';
        }
    }
}
