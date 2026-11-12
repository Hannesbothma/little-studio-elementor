<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Keep originals usable while core creates exactly the originally requested image sizes. */
final class LSE_Media
{
    private const META = '_lse_image_task';
    private const QUEUE = '_lse_image_queue';
    public static function init()
    {
        add_action('lse_media_worker', [__CLASS__, 'cron']);
    }
    public static function can_defer()
    {
        // File-offload/storage adapters retain the original synchronous lifecycle.
        if (has_filter('get_attached_file')) {
            return false;
        }
        $uploads = wp_upload_dir();
        if (!empty($uploads['error'])) {
            return false;
        }
        foreach ([PHP_URL_SCHEME, PHP_URL_HOST, PHP_URL_PORT] as $part) {
            if (
                wp_parse_url($uploads['baseurl'], $part) !==
                wp_parse_url(home_url(), $part)
            ) {
                return false;
            }
        }
        return true;
    }
    public static function capture($sizes, $meta, $id, &$deferred)
    {
        if (!wp_attachment_is_image($id)) {
            return $sizes;
        }
        $needed = [];
        foreach ($sizes as $name => $size) {
            if (
                image_resize_dimensions(
                    $meta['width'],
                    $meta['height'],
                    $size['width'],
                    $size['height'],
                    $size['crop'],
                )
            ) {
                $needed[$name] = $size;
            }
        }
        if ($needed) {
            $deferred[$id] = $needed;
        }
        return [];
    }
    private static function schedule($delay = 15)
    {
        if (!wp_next_scheduled('lse_media_worker')) {
            wp_schedule_single_event(time() + $delay, 'lse_media_worker');
        }
    }
    private static function queue($id, $add)
    {
        $lock = LSE_Locks::acquire(self::QUEUE . '_lock');
        try {
            $ids = get_option(self::QUEUE, []);
            if ($add) {
                $ids[(string) $id] = $id;
            } else {
                unset($ids[(string) $id]);
            }
            update_option(self::QUEUE, $ids, false);
        } finally {
            LSE_Locks::release($lock);
        }
        if ($add) {
            self::schedule();
        }
    }
    public static function enqueue($id, $sizes, $job = '')
    {
        if (!$sizes) {
            return;
        }
        update_post_meta($id, self::META, [
            'sizes' => $sizes,
            'job' => $job,
            'released' => !$job,
            'skipped' => [],
            'attempts' => 0,
            'error' => null,
            'retry_after' => 0,
        ]);
        self::queue($id, true);
    }
    public static function release($ids)
    {
        update_meta_cache('post', array_unique($ids));
        foreach (array_unique($ids) as $id) {
            $task = get_post_meta($id, self::META, true);
            if (is_array($task) && empty($task['released'])) {
                $task['released'] = true;
                update_post_meta($id, self::META, $task);
            }
        }
        if ($ids) {
            self::schedule();
        }
    }
    private static function waiting($task)
    {
        if (!empty($task['released']) || empty($task['job'])) {
            return false;
        }
        $job = get_option('_lse_job_' . $task['job']);
        $lock = get_option('_lse_job_' . $task['job'] . '_lock');
        // Avoid competing with an active import; abandoned partial imports still finish their media.
        return is_array($job) &&
            in_array($job['state'], ['importing', 'finishing'], true) &&
            (($job['updated'] ?? 0) > time() - 180 ||
                (is_array($lock) && ($lock['expires'] ?? 0) > time()));
    }
    private static function missing($id, $task)
    {
        $meta = wp_get_attachment_metadata($id);
        return array_diff_key(
            $task['sizes'] ?? [],
            $meta['sizes'] ?? [],
            $task['skipped'] ?? [],
        );
    }
    public static function status($ids)
    {
        $pending = [];
        $errors = [];
        $skipped = [];
        update_meta_cache('post', array_unique($ids));
        foreach (array_unique($ids) as $id) {
            $task = get_post_meta($id, self::META, true);
            if (!is_array($task)) {
                continue;
            }
            foreach ($task['skipped'] ?? [] as $size => $reason) {
                $skipped[] = [
                    'id' => $id,
                    'name' => get_the_title($id),
                    'size' => $size,
                    'reason' => $reason,
                ];
            }
            $missing = self::missing($id, $task);
            if (!$missing) {
                continue;
            }
            $pending[] = [
                'id' => $id,
                'name' => get_the_title($id),
                'sizes' => array_keys($missing),
            ];
            if (!empty($task['error'])) {
                $size = array_key_first($missing);
                $errors[] = [
                    'code' => 'image_size_failed',
                    'id' => $id,
                    'name' => get_the_title($id),
                    'size' => $size,
                    'message' => $task['error'],
                    'skip' => empty($task['can_skip'])
                        ? null
                        : [
                            'kind' => 'image_size',
                            'id' => $id,
                            'size' => $size,
                            'token' => hash(
                                'sha256',
                                wp_json_encode($task['sizes'][$size]),
                            ),
                        ],
                ];
            }
        }
        return [
            'pending' => count($pending),
            'items' => $pending,
            'errors' => $errors,
            'skipped' => $skipped,
        ];
    }
    public static function process(
        $ids,
        $retry = false,
        $restore_skipped = false,
    ) {
        try {
            $worker = LSE_Locks::acquire('_lse_media_worker_lock', 120);
        } catch (RuntimeException $error) {
            return ['processed' => 0, 'busy' => true];
        }
        try {
            require_once ABSPATH . 'wp-admin/includes/image.php';
            if ($restore_skipped) {
                foreach ($ids as $id) {
                    $task = get_post_meta($id, self::META, true);
                    if (is_array($task)) {
                        $task['skipped'] = [];
                        $task['error'] = null;
                        $task['attempts'] = 0;
                        update_post_meta($id, self::META, $task);
                        if (self::missing($id, $task)) {
                            self::queue($id, true);
                        }
                    }
                }
            }
            foreach ($ids as $id) {
                $task = get_post_meta($id, self::META, true);
                if (!is_array($task) || self::waiting($task)) {
                    continue;
                }
                if (get_post_type($id) !== 'attachment') {
                    self::queue($id, false);
                    continue;
                }
                $missing = self::missing($id, $task);
                if (!$missing) {
                    self::queue($id, false);
                    continue;
                }
                if (
                    !$retry &&
                    (!empty($task['error']) &&
                        ($task['attempts'] >= 3 ||
                            ($task['retry_after'] ?? 0) > time()))
                ) {
                    continue;
                }
                $task['error'] = null;
                $task['can_skip'] = false;
                try {
                    $file = get_attached_file($id);
                    if (!$file || !is_file($file)) {
                        throw new RuntimeException(
                            'The original image is unavailable on this host. Restore its local file before retrying image sizes.',
                        );
                    }
                    $meta = wp_get_attachment_metadata($id);
                    if (!is_array($meta)) {
                        throw new RuntimeException(
                            'WordPress image metadata is unavailable.',
                        );
                    }
                    $task['can_skip'] = true;
                    $meta = _wp_make_subsizes($missing, $file, $meta, $id);
                    if (is_wp_error($meta)) {
                        throw new RuntimeException($meta->get_error_message());
                    }
                    // Preserve the standard post-generation integration point for media plugins.
                    $meta = apply_filters(
                        'wp_generate_attachment_metadata',
                        $meta,
                        $id,
                        'update',
                    );
                    wp_update_attachment_metadata($id, $meta);
                    if (self::missing($id, $task)) {
                        throw new RuntimeException(
                            'WordPress could not generate all requested image sizes for this file.',
                        );
                    }
                    $task['attempts'] = 0;
                    $task['retry_after'] = 0;
                    self::queue($id, false);
                } catch (Throwable $error) {
                    $task['error'] = LSE_Import_Error::clip(
                        $error->getMessage(),
                        1000,
                    );
                    $task['attempts'] = $retry
                        ? 1
                        : ($task['attempts'] ?? 0) + 1;
                    $task['retry_after'] = time() + 60;
                }
                update_post_meta($id, self::META, $task);
                self::schedule(30);
                return ['processed' => 1, 'busy' => false];
            }
            return ['processed' => 0, 'busy' => false];
        } finally {
            LSE_Locks::release($worker);
        }
    }
    public static function skip($id, $size, $token)
    {
        $lock = LSE_Locks::acquire('_lse_media_worker_lock', 120);
        try {
            $task = get_post_meta($id, self::META, true);
            if (
                !is_array($task) ||
                !isset($task['sizes'][$size]) ||
                empty($task['error']) ||
                empty($task['can_skip']) ||
                array_key_first(self::missing($id, $task)) !== $size ||
                !is_string($token) ||
                !hash_equals(
                    hash('sha256', wp_json_encode($task['sizes'][$size])),
                    $token,
                )
            ) {
                throw new RuntimeException(
                    'The image-size task changed. Refresh its status before skipping.',
                );
            }
            $missing = self::missing($id, $task);
            if (isset($missing[$size])) {
                $task['skipped'][$size] =
                    $task['error'] ?: 'Skipped by the importing administrator.';
                $task['error'] = null;
                $task['attempts'] = 0;
                $task['retry_after'] = 0;
                update_post_meta($id, self::META, $task);
                if (!self::missing($id, $task)) {
                    self::queue($id, false);
                }
            }
        } finally {
            LSE_Locks::release($lock);
        }
        self::schedule();
    }
    public static function cron()
    {
        $ids = array_values(get_option(self::QUEUE, []));
        if (!$ids) {
            return;
        }
        self::process($ids);
        foreach (get_option(self::QUEUE, []) as $id) {
            $task = get_post_meta($id, self::META, true);
            if (
                is_array($task) &&
                self::missing($id, $task) &&
                (empty($task['error']) || ($task['attempts'] ?? 0) < 3)
            ) {
                self::schedule(60);
                break;
            }
        }
    }
}
