<?php
if (!defined('ABSPATH')) {
    exit();
}

final class LSE_Updates
{
    const REPO = 'https://github.com/Hannesbothma/little-studio-elementor';
    const MANIFEST = 'https://github.com/Hannesbothma/little-studio-elementor/releases/latest/download/update.json';
    const API = 'https://api.github.com/repos/Hannesbothma/little-studio-elementor';
    const CACHE = 'lse_public_release_v3';
    const MAX_PACKAGE = 16 * 1024 * 1024;
    private static function file()
    {
        return plugin_basename(LSE_FILE);
    }
    private static function installed()
    {
        $data = get_file_data(LSE_FILE, ['Version' => 'Version'], 'plugin');
        return $data['Version'] ?: LSE_VERSION;
    }

    public static function init()
    {
        add_action('admin_init', [__CLASS__, 'initialize_automatic_updates']);
        add_filter('update_plugins_github.com', [__CLASS__, 'offer'], 10, 4);
        add_filter('pre_set_site_transient_update_plugins', [
            __CLASS__,
            'merge',
        ]);
        add_filter('plugins_api', [__CLASS__, 'information'], 10, 3);
        add_filter('upgrader_pre_download', [__CLASS__, 'download'], 10, 4);
        add_filter('upgrader_source_selection', [__CLASS__, 'source'], 10, 4);
        add_action(
            'upgrader_process_complete',
            static function ($upgrader, $extra) {
                if (
                    ($extra['plugin'] ?? '') === self::file() ||
                    in_array(
                        self::file(),
                        (array) ($extra['plugins'] ?? []),
                        true,
                    )
                ) {
                    delete_site_transient(self::CACHE);
                }
            },
            10,
            2,
        );
    }

    public static function initialize_automatic_updates()
    {
        if (
            !current_user_can('update_plugins') ||
            get_site_option('lse_automatic_updates_initialized', false)
        ) {
            return;
        }
        $plugins = (array) get_site_option('auto_update_plugins', []);
        if (!in_array(self::file(), $plugins, true)) {
            $plugins[] = self::file();
            update_site_option('auto_update_plugins', $plugins);
        }
        // A later choice in WordPress's Plugins screen is respected.
        update_site_option('lse_automatic_updates_initialized', true);
    }

    private static function http($url, $binary = false, $extra = [])
    {
        if (
            str_starts_with($url, self::API . '/') &&
            get_site_transient(self::CACHE . '_api_wait')
        ) {
            return new WP_Error(
                'lse_api_wait',
                'GitHub is limiting update checks. Try again later, or install the ZIP manually.',
            );
        }
        $response = wp_safe_remote_get(
            $url,
            array_merge(
                [
                    'timeout' => 15,
                    'redirection' => 5,
                    'limit_response_size' => MB_IN_BYTES,
                    'headers' => [
                        'Accept' => $binary
                            ? 'application/octet-stream'
                            : 'application/vnd.github+json',
                        'User-Agent' =>
                            'Little-Studio-Elementor/' . self::installed(),
                        'X-GitHub-Api-Version' => '2022-11-28',
                    ],
                ],
                $extra,
            ),
        );
        if (!is_wp_error($response) && str_starts_with($url, self::API . '/')) {
            $code = wp_remote_retrieve_response_code($response);
            if (
                $code === 429 ||
                ($code === 403 &&
                    ((string) wp_remote_retrieve_header(
                        $response,
                        'x-ratelimit-remaining',
                    ) === '0' ||
                        wp_remote_retrieve_header($response, 'retry-after')))
            ) {
                $wait = max(
                    60,
                    (int) wp_remote_retrieve_header($response, 'retry-after'),
                    (int) wp_remote_retrieve_header(
                        $response,
                        'x-ratelimit-reset',
                    ) - time(),
                );
                set_site_transient(self::CACHE . '_api_wait', 1, $wait);
                return new WP_Error(
                    'lse_api_wait',
                    'GitHub is limiting update checks. Try again later, or install the ZIP manually.',
                );
            }
        }
        return $response;
    }

    private static function manifest($data)
    {
        if (
            !is_array($data) ||
            !is_string($data['version'] ?? null) ||
            !is_string($data['sha256'] ?? null) ||
            !preg_match('/^\d+\.\d+\.\d+$/D', $data['version']) ||
            !preg_match('/^[a-f0-9]{64}$/D', $data['sha256'])
        ) {
            return false;
        }
        $expected =
            self::REPO .
            '/releases/download/v' .
            $data['version'] .
            '/little-studio-elementor-' .
            $data['version'] .
            '.zip';
        if (($data['package'] ?? '') !== $expected) {
            return false;
        }
        if (
            isset($data['bytes']) &&
            (!is_int($data['bytes']) ||
                $data['bytes'] < 1 ||
                $data['bytes'] > self::MAX_PACKAGE)
        ) {
            return false;
        }
        foreach (['requires', 'requires_php', 'tested'] as $field) {
            if (
                !is_string($data[$field] ?? null) ||
                !preg_match('/^[0-9]+(?:\.[0-9]+){1,2}$/D', $data[$field])
            ) {
                return false;
            }
        }
        return [
            'version' => $data['version'],
            'requires' => $data['requires'],
            'requires_php' => $data['requires_php'],
            'tested' => $data['tested'],
            'package' => $expected,
            'digest' => 'sha256:' . $data['sha256'],
            'bytes' => $data['bytes'] ?? 0,
            'notes' => is_string($data['notes'] ?? null) ? $data['notes'] : '',
        ];
    }

    private static function asset($data, $name, $version)
    {
        foreach ((array) ($data['assets'] ?? []) as $asset) {
            if (!is_array($asset) || ($asset['name'] ?? '') !== $name) {
                continue;
            }
            $id = $asset['id'] ?? null;
            if (
                !is_int($id) ||
                $id < 1 ||
                ($asset['state'] ?? '') !== 'uploaded' ||
                ($asset['url'] ?? '') !==
                    self::API . '/releases/assets/' . $id ||
                ($asset['browser_download_url'] ?? '') !==
                    self::REPO . '/releases/download/v' . $version . '/' . $name
            ) {
                return false;
            }
            return $asset;
        }
        return false;
    }

    private static function api_release()
    {
        $response = self::http(self::API . '/releases/latest');
        if (is_wp_error($response)) {
            return $response;
        }
        if (wp_remote_retrieve_response_code($response) !== 200) {
            return new WP_Error(
                'lse_api_unavailable',
                'Could not reach GitHub. Try again shortly, or install the ZIP manually.',
            );
        }
        $data = json_decode(wp_remote_retrieve_body($response), true);
        $invalid = new WP_Error(
            'lse_invalid_release',
            'A verified update package was not found.',
        );
        if (
            !is_array($data) ||
            !is_string($data['tag_name'] ?? null) ||
            !preg_match('/^v(\d+\.\d+\.\d+)$/D', $data['tag_name'], $match) ||
            ($data['draft'] ?? true) !== false ||
            ($data['prerelease'] ?? true) !== false
        ) {
            return $invalid;
        }
        $version = $match[1];
        $zip = self::asset(
            $data,
            'little-studio-elementor-' . $version . '.zip',
            $version,
        );
        if (
            !$zip ||
            !is_int($zip['size'] ?? null) ||
            $zip['size'] < 1 ||
            $zip['size'] > self::MAX_PACKAGE
        ) {
            return $invalid;
        }
        // Read compatibility from the same release manifest even when GitHub supplies a digest.
        $json = self::asset($data, 'update.json', $version);
        if (!$json) {
            return $invalid;
        }
        $response = self::http($json['url'], true);
        if (is_wp_error($response)) {
            return $response;
        }
        $manifest =
            wp_remote_retrieve_response_code($response) === 200
                ? self::manifest(
                    json_decode(wp_remote_retrieve_body($response), true),
                )
                : false;
        if (
            !$manifest ||
            $manifest['version'] !== $version ||
            ($manifest['bytes'] && $manifest['bytes'] !== $zip['size'])
        ) {
            return $invalid;
        }
        $digest = $zip['digest'] ?? '';
        if (
            !is_string($digest) ||
            !preg_match('/^sha256:[a-f0-9]{64}$/D', $digest)
        ) {
            $digest = $manifest['digest'];
        }
        if ($digest !== $manifest['digest']) {
            return $invalid;
        }
        return [
            'version' => $version,
            'package' => $zip['browser_download_url'],
            'asset_api' => $zip['url'],
            'digest' => $digest,
            'bytes' => $zip['size'],
            'notes' => is_string($data['body'] ?? null)
                ? substr(wp_strip_all_tags($data['body']), 0, 10000)
                : '',
            'transport' => 'github-api',
            'requires' => $manifest['requires'],
            'requires_php' => $manifest['requires_php'],
            'tested' => $manifest['tested'],
        ];
    }

    private static function release($force = false)
    {
        $cached = get_site_transient(self::CACHE);
        if (!$force && is_array($cached)) {
            return $cached;
        }
        if (get_site_transient(self::CACHE . '_lock')) {
            return is_array($cached)
                ? $cached
                : [
                    'error' =>
                        'An update check is already running. Try again shortly.',
                ];
        }
        set_site_transient(self::CACHE . '_lock', 1, 60);
        try {
            $release = self::api_release();
            if (
                is_wp_error($release) &&
                $release->get_error_code() !== 'lse_invalid_release'
            ) {
                // Independent fallback for hosts that cannot reach the public API.
                $response = self::http(self::MANIFEST);
                $legacy =
                    !is_wp_error($response) &&
                    wp_remote_retrieve_response_code($response) === 200
                        ? self::manifest(
                            json_decode(
                                wp_remote_retrieve_body($response),
                                true,
                            ),
                        )
                        : false;
                if ($legacy) {
                    $release = $legacy + ['transport' => 'release-manifest'];
                }
            }
            if (is_wp_error($release)) {
                $release = [
                    'error' =>
                        $release->get_error_code() === 'lse_api_wait'
                            ? $release->get_error_message()
                            : ($release->get_error_code() ===
                            'lse_invalid_release'
                                ? 'A verified update package was not found.'
                                : 'Could not reach GitHub. Try again shortly, or install the ZIP manually.'),
                ];
            }
            $release['checked_at'] = time();
            set_site_transient(
                self::CACHE,
                $release,
                isset($release['error']) ? MINUTE_IN_SECONDS : HOUR_IN_SECONDS,
            );
            return $release;
        } finally {
            delete_site_transient(self::CACHE . '_lock');
        }
    }

    private static function item($release)
    {
        return (object) [
            'id' => self::REPO,
            'slug' => 'little-studio-elementor',
            'plugin' => self::file(),
            'new_version' => $release['version'],
            'url' => self::REPO,
            'package' => $release['package'],
            'requires' => $release['requires'] ?? '',
            'requires_php' => $release['requires_php'] ?? '',
            'tested' => $release['tested'] ?? '',
        ];
    }

    public static function merge($updates)
    {
        $release = get_site_transient(self::CACHE);
        if (
            !is_array($release) ||
            isset($release['error']) ||
            empty($release['version']) ||
            empty($release['package'])
        ) {
            return $updates;
        }
        if (!is_object($updates)) {
            $updates = new stdClass();
        }
        if (!isset($updates->response)) {
            $updates->response = [];
        }
        if (!isset($updates->no_update)) {
            $updates->no_update = [];
        }
        unset(
            $updates->response[self::file()],
            $updates->no_update[self::file()],
        );
        if (version_compare($release['version'], self::installed(), '>')) {
            $updates->response[self::file()] = self::item($release);
        } else {
            $updates->no_update[self::file()] = self::item($release);
        }
        return $updates;
    }

    public static function offer($update, $data, $file, $locales = [])
    {
        if ($file !== self::file()) {
            return $update;
        }
        $release = self::release();
        if (isset($release['error'])) {
            return false;
        }
        return [
            'id' => self::REPO,
            'slug' => 'little-studio-elementor',
            'version' => $release['version'],
            'url' => self::REPO,
            'package' => $release['package'],
            'requires' => $release['requires'] ?? '',
            'requires_php' => $release['requires_php'] ?? '',
            'tested' => $release['tested'] ?? '',
        ];
    }

    public static function information($result, $action, $args)
    {
        if (
            $action !== 'plugin_information' ||
            ($args->slug ?? '') !== 'little-studio-elementor'
        ) {
            return $result;
        }
        $release = self::release();
        return (object) [
            'name' => 'Little Studio to Elementor',
            'slug' => 'little-studio-elementor',
            'version' => $release['version'] ?? self::installed(),
            'homepage' => self::REPO,
            'download_link' => $release['package'] ?? '',
            'requires' => $release['requires'] ?? '',
            'requires_php' => $release['requires_php'] ?? '',
            'tested' => $release['tested'] ?? '',
            'sections' => [
                'description' =>
                    'Import complete Little Studio website JSON into native Elementor draft pages.',
                'changelog' => nl2br(
                    esc_html(
                        $release['notes'] ?? 'No release notes available.',
                    ),
                ),
            ],
        ];
    }

    public static function download($reply, $package, $upgrader, $extra = [])
    {
        if ($reply !== false || ($extra['plugin'] ?? '') !== self::file()) {
            return $reply;
        }
        $release = self::release();
        if (isset($release['error']) || $package !== $release['package']) {
            return new WP_Error(
                'lse_update_changed',
                'The update changed. Look for the newest update again.',
            );
        }
        require_once ABSPATH . 'wp-admin/includes/file.php';
        $urls = [];
        if (
            is_string($release['asset_api'] ?? null) &&
            preg_match(
                '~^' .
                    preg_quote(self::API, '~') .
                    '/releases/assets/[1-9][0-9]*$~D',
                $release['asset_api'],
            )
        ) {
            $urls[] = $release['asset_api'];
        }
        $urls[] = $package;
        foreach ($urls as $url) {
            $path = wp_tempnam(
                'little-studio-elementor-' . $release['version'] . '.zip',
            );
            if (!$path) {
                return new WP_Error(
                    'lse_update_temp',
                    'WordPress could not create a temporary update file.',
                );
            }
            $response = self::http($url, true, [
                'timeout' => 120,
                'stream' => true,
                'filename' => $path,
                'limit_response_size' => self::MAX_PACKAGE,
            ]);
            if (
                is_wp_error($response) ||
                wp_remote_retrieve_response_code($response) !== 200
            ) {
                wp_delete_file($path);
                continue;
            }
            $bytes = filesize($path);
            if (
                !$bytes ||
                $bytes > self::MAX_PACKAGE ||
                (!empty($release['bytes']) && $bytes !== $release['bytes']) ||
                !hash_equals(
                    substr($release['digest'], 7),
                    hash_file('sha256', $path),
                )
            ) {
                wp_delete_file($path);
                return new WP_Error(
                    'lse_update_download',
                    'The downloaded update was incomplete. Please try again.',
                );
            }
            return $path;
        }
        return new WP_Error(
            'lse_update_connection',
            'Could not download the update. Try again shortly, or install the ZIP manually.',
        );
    }

    public static function source(
        $source,
        $remote_source,
        $upgrader,
        $extra = [],
    ) {
        if (($extra['plugin'] ?? '') !== self::file() || is_wp_error($source)) {
            return $source;
        }
        global $wp_filesystem;
        $main = trailingslashit($source) . basename(self::file());
        if (
            !$wp_filesystem->exists($main) ||
            basename(untrailingslashit($source)) !== dirname(self::file())
        ) {
            return new WP_Error(
                'lse_update_package',
                'This package does not match the installed converter.',
            );
        }
        $contents = $wp_filesystem->get_contents($main);
        $release = self::release();
        if (
            !is_string($contents) ||
            !preg_match(
                '/^[ \t*#\/]*Version:\s*([0-9.]+)/mi',
                $contents,
                $match,
            ) ||
            $match[1] !== ($release['version'] ?? '') ||
            !preg_match(
                '/Text Domain:\s*little-studio-elementor\b/i',
                $contents,
            )
        ) {
            return new WP_Error(
                'lse_update_version',
                'The update package version did not match. Please check again.',
            );
        }
        return $source;
    }

    public static function state()
    {
        $release = get_site_transient(self::CACHE);
        $installed = self::installed();
        $valid =
            is_array($release) &&
            !isset($release['error']) &&
            !empty($release['version']);
        return [
            'installed' => $installed,
            'latest' => $valid ? $release['version'] : '',
            'available' =>
                $valid && version_compare($release['version'], $installed, '>'),
            'automatic' => in_array(
                self::file(),
                (array) get_site_option('auto_update_plugins', []),
                true,
            ),
        ];
    }

    public static function update_check($input = [])
    {
        if (!current_user_can('update_plugins')) {
            throw new RuntimeException(
                'Your WordPress account cannot update plugins.',
            );
        }
        $release = self::release(!empty($input['force']));
        if (isset($release['error'])) {
            throw new RuntimeException($release['error']);
        }
        set_site_transient(
            'update_plugins',
            self::merge(get_site_transient('update_plugins')),
        );
        return self::state();
    }

    public static function update_install($input = [])
    {
        if (!current_user_can('update_plugins')) {
            throw new RuntimeException(
                'Your WordPress account cannot update plugins.',
            );
        }
        if (!add_option('lse_plugin_update_lock', time(), '', false)) {
            $time = (int) get_option('lse_plugin_update_lock');
            if ($time && time() - $time > 300) {
                delete_option('lse_plugin_update_lock');
            }
            throw new RuntimeException(
                'An update is already running. Try again shortly.',
            );
        }
        try {
            $state = self::update_check(['force' => true]);
            if (!$state['available']) {
                return $state;
            }
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
            require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
            if (!WP_Filesystem()) {
                throw new RuntimeException(
                    'WordPress could not write to its plugin folder. Check the hosting file permissions.',
                );
            }
            $active = is_plugin_active(self::file());
            $network = is_plugin_active_for_network(self::file());
            $skin = new WP_Ajax_Upgrader_Skin();
            $upgrader = new Plugin_Upgrader($skin);
            $result = $upgrader->upgrade(self::file(), [
                'clear_update_cache' => true,
            ]);
            if (is_wp_error($result)) {
                throw new RuntimeException($result->get_error_message());
            }
            if (!$result) {
                $errors = $skin->get_errors();
                throw new RuntimeException(
                    $errors->has_errors()
                        ? $errors->get_error_message()
                        : 'WordPress could not finish the update. Please try again.',
                );
            }
            wp_clean_plugins_cache(false);
            if ($active && !is_plugin_active(self::file())) {
                $activation = activate_plugin(self::file(), '', $network, true);
                if (is_wp_error($activation)) {
                    throw new RuntimeException(
                        $activation->get_error_message(),
                    );
                }
            }
            delete_site_transient(self::CACHE);
            return array_merge(self::state(), ['updated' => true]);
        } finally {
            delete_option('lse_plugin_update_lock');
        }
    }
}
