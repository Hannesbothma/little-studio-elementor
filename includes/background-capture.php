<?php
if (!defined('ABSPATH')) {
    exit();
}

trait LSE_Background_Capture
{
    private static function delivery_key($id)
    {
        return self::key($id) . '_delivery';
    }

    private static function delivery_lease($id)
    {
        return LSE_Locks::acquire(self::delivery_key($id) . '_lock');
    }

    private static function delivery_session($id)
    {
        if (!is_string($id) || !preg_match('/^[a-f0-9]{32}$/D', $id)) {
            return null;
        }
        $state = get_transient(self::delivery_key($id));
        return is_array($state) ? $state : null;
    }

    private static function store_delivery($id, $state)
    {
        set_transient(self::delivery_key($id), $state, DAY_IN_SECONDS);
    }

    private static function start_delivery($id, $url)
    {
        $args = [get_current_user_id(), $id];
        self::store_delivery($id, ['url' => $url, 'seq' => 0, 'attempts' => 0]);
        try {
            LSE_Spool::schedule('lse_scan_prune', $args, DAY_IN_SECONDS);
            LSE_Spool::schedule('lse_scan_work', $args);
        } catch (Throwable $e) {
            self::clear_delivery($id);
            throw $e;
        }
    }

    public static function capture_active($input)
    {
        $id = get_user_meta(get_current_user_id(), '_lse_capture', true);
        $state = self::delivery_session($id);
        return $state && !get_transient(self::key($id) . '_cancelled')
            ? ['capture' => $id, 'url' => $state['url']]
            : [];
    }

    public static function capture_delivery($input)
    {
        $id = $input['capture'] ?? '';
        $state = self::delivery_session($id);
        $seq = $input['seq'] ?? -1;
        if (!$state || !is_int($seq) || $seq < 0 || $seq > $state['seq']) {
            throw new RuntimeException(
                'Capture expired. Start again from the website link.',
            );
        }
        $step = LSE_Spool::read('scan-' . $id, (string) $seq);
        if (is_array($step)) {
            return $step;
        }
        if (isset($state['error'])) {
            throw new RuntimeException($state['error']);
        }
        if ($seq < $state['seq'] || !empty($state['done'])) {
            throw new RuntimeException(
                'The saved capture batch is unavailable.',
            );
        }
        LSE_Spool::kick();
        return [
            'waiting' => true,
            'message' => $state['message'] ?? 'Scanning the source website…',
        ];
    }

    public static function capture_restart_worker($input)
    {
        $id = $input['capture'] ?? '';
        $state = self::delivery_session($id);
        if (!$state) {
            throw new RuntimeException(
                'Capture expired. Start again from the website link.',
            );
        }
        $lease = self::delivery_lease($id);
        try {
            if (isset($state['error'])) {
                unset($state['error']);
                $state['attempts'] = 0;
                self::store_delivery($id, $state);
                LSE_Spool::schedule('lse_scan_work', [
                    get_current_user_id(),
                    $id,
                ]);
            }
        } finally {
            LSE_Locks::release($lease);
        }
        LSE_Spool::kick();
        return ['resumed' => true];
    }

    public static function capture_work($owner, $id)
    {
        LSE_Spool::as_owner($owner, static function () use ($owner, $id) {
            if (!self::delivery_session($id)) {
                return;
            }
            $args = [$owner, $id];
            try {
                $lease = self::delivery_lease($id);
            } catch (RuntimeException $error) {
                LSE_Spool::schedule('lse_scan_work', $args, 180);
                return;
            }
            try {
                $state = self::delivery_session($id);
                if (get_transient(self::key($id) . '_cancelled')) {
                    self::clear_capture($id);
                    return;
                }
                if (
                    !$state ||
                    isset($state['error']) ||
                    !empty($state['done'])
                ) {
                    return;
                }
                $from = $state['seq'];
                try {
                    if (++$state['attempts'] > 3) {
                        throw new RuntimeException(
                            'The host stopped scanning this batch repeatedly.',
                        );
                    }
                    self::store_delivery($id, $state);
                    LSE_Spool::schedule('lse_scan_work', $args, 180);
                    $step = LSE_Spool::read('scan-' . $id, (string) $from);
                    if (!$step) {
                        $step = self::capture_batch([
                            'capture' => $id,
                            'seq' => $from,
                        ]);
                        if ($step['seq'] !== $from || $step['done']) {
                            LSE_Spool::write(
                                'scan-' . $id,
                                (string) $from,
                                $step,
                            );
                        }
                    }
                    $state['seq'] = $step['seq'];
                    $state['done'] = $step['done'];
                    $state['message'] =
                        $step['message'] ?? 'Scanning the source website…';
                    $state['attempts'] = 0;
                } catch (Throwable $error) {
                    $state['error'] = LSE_Import_Error::clip(
                        $error->getMessage(),
                        1600,
                    );
                }
                if (get_transient(self::key($id) . '_cancelled')) {
                    self::clear_capture($id);
                    return;
                }
                self::store_delivery($id, $state);
                wp_clear_scheduled_hook('lse_scan_work', $args);
                if (empty($state['done']) && !isset($state['error'])) {
                    LSE_Spool::schedule('lse_scan_work', $args);
                }
            } finally {
                LSE_Locks::release($lease);
            }
        });
    }

    public static function capture_prune($owner, $id)
    {
        $previous = get_current_user_id();
        wp_set_current_user($owner);
        try {
            $lease = self::delivery_lease($id);
            try {
                if (!self::delivery_session($id)) {
                    self::clear_delivery($id);
                } else {
                    LSE_Spool::schedule(
                        'lse_scan_prune',
                        [$owner, $id],
                        DAY_IN_SECONDS,
                    );
                }
            } finally {
                LSE_Locks::release($lease);
            }
        } finally {
            wp_set_current_user($previous);
        }
    }

    private static function clear_delivery($id)
    {
        wp_clear_scheduled_hook('lse_scan_work', [get_current_user_id(), $id]);
        wp_clear_scheduled_hook('lse_scan_prune', [get_current_user_id(), $id]);
        delete_transient(self::delivery_key($id));
        LSE_Spool::remove('scan-' . $id);
    }
}
