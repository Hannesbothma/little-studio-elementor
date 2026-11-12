<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Compare-and-delete leases: an expired request cannot release its successor's lock. */
final class LSE_Locks
{
    public static function acquire($key, $seconds = 180)
    {
        $host = (int) ini_get('max_execution_time');
        $lease = [
            'token' => bin2hex(random_bytes(16)),
            'expires' => time() + max($seconds, $host > 0 ? $host + 60 : 900),
        ];
        $old = get_option($key);
        $expires = is_array($old)
            ? $old['expires'] ?? PHP_INT_MAX
            : (int) $old + $seconds;
        if ($old && $expires < time()) {
            self::remove($key, $old);
        }
        if (!add_option($key, $lease, '', false)) {
            throw new RuntimeException(
                'This operation is already processing a request. Wait a moment and retry.',
            );
        }
        return ['key' => $key, 'value' => $lease];
    }
    private static function remove($key, $value)
    {
        global $wpdb;
        $wpdb->query(
            $wpdb->prepare(
                "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s",
                $key,
                maybe_serialize($value),
            ),
        );
        wp_cache_delete($key, 'options');
    }
    public static function release($lease)
    {
        self::remove($lease['key'], $lease['value']);
    }
}
