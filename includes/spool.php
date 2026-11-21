<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Atomic, private storage for jobs that may outlive a request. */
final class LSE_Spool
{
    private const PREFIX = "<?php exit; __halt_compiler();\n";

    private static function path($id)
    {
        if (!preg_match('/^(scan|import)-[a-f0-9]{32}$/D', $id)) {
            throw new RuntimeException('Invalid background job.');
        }
        return trailingslashit(get_temp_dir()) .
            'lse-' .
            substr(
                hash('sha256', ABSPATH . ':' . get_current_blog_id()),
                0,
                12,
            ) .
            '-' .
            $id;
    }

    private static function file($dir, $name)
    {
        return $dir . '/' . hash('sha256', $name) . '.php';
    }

    public static function write($id, $name, $data)
    {
        $dir = self::path($id);
        if (!is_dir($dir) && !@mkdir($dir, 0700) && !is_dir($dir)) {
            throw new RuntimeException(
                'The host could not create a private background cache.',
            );
        }
        $temporary = $dir . '/save-' . bin2hex(random_bytes(12)) . '.php';
        try {
            $data = wp_json_encode($data);
            if (
                !is_string($data) ||
                file_put_contents($temporary, self::PREFIX . $data) !==
                    strlen(self::PREFIX) + strlen($data) ||
                !chmod($temporary, 0600) ||
                !rename($temporary, self::file($dir, $name))
            ) {
                throw new RuntimeException(
                    'The host could not write the background checkpoint. Check available disk space.',
                );
            }
        } finally {
            if (is_file($temporary)) {
                unlink($temporary);
            }
        }
    }

    public static function read($id, $name)
    {
        $file = self::file(self::path($id), $name);
        if (!is_file($file)) {
            return null;
        }
        $raw = file_get_contents($file, false, null, strlen(self::PREFIX));
        if (!is_string($raw)) {
            throw new RuntimeException(
                'The background checkpoint could not be read.',
            );
        }
        return json_decode($raw, true, 2147483647, JSON_THROW_ON_ERROR);
    }

    public static function has($id, $name)
    {
        return is_file(self::file(self::path($id), $name));
    }

    public static function remove($id)
    {
        $dir = self::path($id);
        if (!is_dir($dir)) {
            return;
        }
        foreach (glob($dir . '/*') ?: [] as $file) {
            wp_delete_file($file);
        }
        @rmdir($dir);
    }

    public static function schedule($hook, $args, $delay = 0)
    {
        if (wp_next_scheduled($hook, $args) !== false) {
            return;
        }
        if (!wp_schedule_single_event(time() + $delay, $hook, $args)) {
            throw new RuntimeException(
                'WordPress could not schedule background processing. Check WP-Cron on this host.',
            );
        }
    }

    // A concurrent WP-Cron update can drop a single event. The later cleanup
    // event keeps the job address available even when its browser has closed.
    public static function recover_workers()
    {
        if (!wp_doing_cron()) {
            return;
        }
        foreach (_get_cron_array() as $hooks) {
            foreach (['import', 'scan'] as $kind) {
                foreach ($hooks['lse_' . $kind . '_prune'] ?? [] as $event) {
                    $args = $event['args'];
                    if (
                        count($args) !== 2 ||
                        wp_next_scheduled('lse_' . $kind . '_work', $args)
                    ) {
                        continue;
                    }
                    if ($kind === 'import') {
                        LSE_Importer::recover_worker(...$args);
                    } else {
                        LSE_Capture::recover_worker(...$args);
                    }
                }
            }
        }
    }

    public static function kick()
    {
        if (!defined('DISABLE_WP_CRON') || !DISABLE_WP_CRON) {
            spawn_cron();
        }
    }

    public static function as_owner($owner, $work)
    {
        $previous = get_current_user_id();
        wp_set_current_user($owner);
        try {
            if (
                !current_user_can('manage_options') ||
                !current_user_can('edit_pages') ||
                !current_user_can('upload_files')
            ) {
                return;
            }
            require_once ABSPATH . 'wp-admin/includes/admin.php';
            $work();
        } finally {
            wp_set_current_user($previous);
        }
    }
}
