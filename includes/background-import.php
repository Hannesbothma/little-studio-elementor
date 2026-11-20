<?php
if (!defined('ABSPATH')) {
    exit();
}

trait LSE_Background_Import
{
    private static function background_key($id)
    {
        self::key($id);
        return '_lse_background_import_' . $id;
    }

    private static function background_lease($id)
    {
        return LSE_Locks::acquire(self::background_key($id) . '_lock');
    }

    public static function stage_page($input)
    {
        $id = $input['job'] ?? '';
        $lease = self::background_lease($id);
        try {
            $job = self::load($id);
            $key = $input['key'] ?? '';
            $index = array_search(
                $key,
                array_column($job['pages'], 'key'),
                true,
            );
            if ($index === false) {
                throw new RuntimeException('Unknown website page.');
            }
            $queue = get_option(self::background_key($id));
            if ($job['state'] !== 'importing' || is_array($queue)) {
                throw new RuntimeException(
                    'This import is no longer accepting prepared pages.',
                );
            }
            $page = $job['pages'][$index];
            if (!$page['done'] && empty($page['skipped'])) {
                LSE_Spool::write('import-' . $id, $key, $input);
            }
            LSE_Spool::schedule(
                'lse_import_prune',
                [$job['owner'], $id],
                WEEK_IN_SECONDS,
            );
            return ['staged' => true, 'key' => $key];
        } finally {
            LSE_Locks::release($lease);
        }
    }

    public static function background_start($input)
    {
        $id = $input['job'] ?? '';
        $lease = self::background_lease($id);
        try {
            $job = self::load($id);
            $queue = get_option(self::background_key($id));
            if (is_array($queue)) {
                return self::background_status($input);
            }
            $pending = array_filter(
                $job['pages'],
                static fn($page) => !$page['done'] && empty($page['skipped']),
            );
            $keys = array_values(array_column($pending, 'key'));
            $home = array_search($job['site']['home_key'] ?? '', $keys, true);
            if ($home > 0) {
                array_unshift($keys, ...array_splice($keys, $home, 1));
            }
            foreach ($keys as $key) {
                if (!LSE_Spool::has('import-' . $id, $key)) {
                    throw new RuntimeException(
                        'Some pages are still being prepared.',
                    );
                }
            }
            if (!in_array($job['state'], ['importing', 'finishing'], true)) {
                throw new RuntimeException('This import cannot be queued.');
            }
            $queue = [
                'phase' => 'queued',
                'keys' => $keys,
                'position' => 0,
                'attempts' => 0,
                'error' => null,
                'events' => [],
            ];
            update_option(self::background_key($id), $queue, false);
            try {
                LSE_Spool::schedule('lse_import_work', [$job['owner'], $id]);
            } catch (Throwable $error) {
                delete_option(self::background_key($id));
                throw $error;
            }
            return self::background_status($input);
        } finally {
            LSE_Locks::release($lease);
        }
    }

    public static function background_status($input)
    {
        $job = self::load($input['job'] ?? '');
        $queue = get_option(self::background_key($job['id']));
        if (!is_array($queue)) {
            return ['phase' => ''];
        }
        return [
            'phase' => $queue['phase'],
            'position' => $queue['position'],
            'total' => count($queue['keys']),
            'error' => $queue['error'],
            'events' => $queue['events'] ?? [],
        ];
    }

    public static function background_decide($input)
    {
        $id = $input['job'] ?? '';
        $lease = self::background_lease($id);
        try {
            $job = self::load($id);
            $queue = get_option(self::background_key($id));
            if (!is_array($queue) || $queue['phase'] !== 'paused') {
                throw new RuntimeException(
                    'This background import is no longer paused.',
                );
            }
            $key = $queue['keys'][$queue['position']] ?? '';
            $decision = $input['decision'] ?? '';
            if ($decision === 'skip' && $key) {
                $issue = $queue['error']['error'] ?? [];
                if (
                    ($issue['skip']['kind'] ?? '') === 'css' &&
                    !empty($issue['skip']['id'])
                ) {
                    $page = LSE_Spool::read('import-' . $id, $key);
                    if (!is_array($page)) {
                        throw new RuntimeException(
                            'The saved page preparation is missing.',
                        );
                    }
                    $page['skip_css'][] = $issue['skip']['id'];
                    LSE_Spool::write('import-' . $id, $key, $page);
                } else {
                    self::skip_page([
                        'job' => $id,
                        'key' => $key,
                        'reason' => $queue['error']['message'],
                    ]);
                    ++$queue['position'];
                }
            } elseif ($decision !== 'retry') {
                throw new RuntimeException('Choose Retry to continue.');
            }
            self::background_event(
                $queue,
                $decision === 'skip'
                    ? 'Skipped the reported item.'
                    : 'Retried the background import.',
                $key,
            );
            $queue['attempts'] = 0;
            $queue['error'] = null;
            $queue['phase'] = 'queued';
            LSE_Spool::schedule('lse_import_work', [$job['owner'], $id]);
            update_option(self::background_key($id), $queue, false);
            return self::background_status($input);
        } finally {
            LSE_Locks::release($lease);
        }
    }

    private static function background_event(&$queue, $message, $key)
    {
        $queue['events'][] =
            gmdate('c') .
            '  ' .
            ($key ? $key . ' · ' : '') .
            sanitize_text_field(LSE_Import_Error::clip($message, 1500));
        $queue['events'] = array_slice($queue['events'], -50);
    }

    public static function background_work($owner, $id)
    {
        LSE_Spool::as_owner($owner, static function () use ($owner, $id) {
            $args = [$owner, $id];
            try {
                $lease = self::background_lease($id);
            } catch (RuntimeException $error) {
                LSE_Spool::schedule('lse_import_work', $args, 180);
                return;
            }
            try {
                $queue = get_option(self::background_key($id));
                if (
                    !is_array($queue) ||
                    !in_array($queue['phase'], ['queued', 'running'], true)
                ) {
                    return;
                }
                $job = self::load($id);
                if (
                    in_array(
                        $job['state'],
                        ['removed', 'partly-removed', 'undone'],
                        true,
                    )
                ) {
                    self::background_remove($owner, $id);
                    return;
                }
                $key = $queue['keys'][$queue['position']] ?? '';
                try {
                    if (++$queue['attempts'] > 3) {
                        throw new RuntimeException(
                            'The host stopped processing this step repeatedly.',
                        );
                    }
                    $queue['phase'] = 'running';
                    update_option(self::background_key($id), $queue, false);
                    // Leave a retry if PHP stops before saving the result.
                    LSE_Spool::schedule('lse_import_work', $args, 180);
                    if ($key) {
                        $page = LSE_Spool::read('import-' . $id, $key);
                        if (!is_array($page)) {
                            throw new RuntimeException(
                                'The prepared page is no longer available.',
                            );
                        }
                        self::page($page + ['compact' => true]);
                        ++$queue['position'];
                    } else {
                        $result = self::finish([
                            'job' => $id,
                            'compact' => true,
                        ]);
                        if ($result['state'] === 'ready') {
                            $queue['phase'] = 'ready';
                        }
                    }
                    $queue['attempts'] = 0;
                } catch (Throwable $error) {
                    $queue['phase'] = 'paused';
                    self::background_event($queue, $error->getMessage(), $key);
                    $queue['error'] = LSE_Import_Error::response(
                        $error,
                        $key ? 'background_page' : 'background_finish',
                        ['key' => $key],
                    );
                }
                update_option(self::background_key($id), $queue, false);
                wp_clear_scheduled_hook('lse_import_work', $args);
                if ($queue['phase'] === 'ready') {
                    LSE_Spool::remove('import-' . $id);
                } elseif ($queue['phase'] === 'running') {
                    LSE_Spool::schedule('lse_import_work', $args);
                }
            } finally {
                LSE_Locks::release($lease);
            }
        });
    }

    public static function background_prune($owner, $id)
    {
        $lease = self::background_lease($id);
        try {
            if (!get_option(self::background_key($id))) {
                LSE_Spool::remove('import-' . $id);
            }
        } finally {
            LSE_Locks::release($lease);
        }
    }

    private static function background_remove($owner, $id)
    {
        wp_clear_scheduled_hook('lse_import_work', [$owner, $id]);
        wp_clear_scheduled_hook('lse_import_prune', [$owner, $id]);
        delete_option(self::background_key($id));
        LSE_Spool::remove('import-' . $id);
    }
}
