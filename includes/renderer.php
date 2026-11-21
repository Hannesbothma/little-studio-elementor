<?php
if (!defined('ABSPATH')) {
    exit();
}

/** The signed-in user's local Chromium worker consumes one explicit URL import at a time. */
final class LSE_Renderer
{
    public static function handle($input)
    {
        $user = get_current_user_id();
        $key = '_lse_renderer_task';
        $presence = 'lse_renderer_' . $user;
        $operation = $input['operation'] ?? 'status';
        $read = static function () use ($user, $key, $presence) {
            $task = get_user_meta($user, $key, true) ?: [];
            unset($task['worker']);
            return [
                'online' => (bool) get_transient($presence),
                'task' => $task,
            ];
        };
        if ($operation === 'status') {
            return $read();
        }
        $lease = LSE_Locks::acquire($presence . '_lock');
        try {
            $task = get_user_meta($user, $key, true) ?: [];
            $worker = $input['worker'] ?? '';
            if (in_array($operation, ['claim', 'update'], true)) {
                if (!is_string($worker) || !wp_is_uuid($worker)) {
                    throw new RuntimeException('Invalid renderer ID.');
                }
                set_transient($presence, 1, 60);
            }
            if ($operation === 'submit') {
                if (!get_transient($presence)) {
                    throw new RuntimeException(
                        'The local renderer is offline.',
                    );
                }
                if (
                    in_array(
                        $task['state'] ?? '',
                        ['queued', 'working', 'waiting'],
                        true,
                    ) &&
                    ($task['state'] === 'queued' ||
                        time() - $task['updated'] < 120)
                ) {
                    throw new RuntimeException(
                        'An import is already queued or running.',
                    );
                }
                $url = $input['url'] ?? '';
                if (
                    !is_string($url) ||
                    strlen($url) > 2048 ||
                    !wp_http_validate_url($url)
                ) {
                    throw new RuntimeException('Enter a public website URL.');
                }
                $task = [
                    'id' => wp_generate_uuid4(),
                    'url' => esc_url_raw($url),
                    'updated' => time(),
                    'state' => 'queued',
                    'message' => 'Queued for the local renderer.',
                ];
            } elseif ($operation === 'claim') {
                if (($task['state'] ?? '') !== 'queued') {
                    if (
                        in_array(
                            $task['state'] ?? '',
                            ['working', 'waiting'],
                            true,
                        ) &&
                        ($task['worker'] ?? '') === $worker
                    ) {
                        return ['task' => $read()['task'] + ['resume' => true]];
                    }
                    return ['task' => null];
                }
                $task['worker'] = $worker;
                $task['state'] = 'working';
                $task['updated'] = time();
                $task['message'] = 'Starting the website scan.';
            } elseif ($operation === 'update') {
                if (
                    ($task['worker'] ?? '') !== $worker ||
                    ($task['id'] ?? '') !== ($input['id'] ?? null) ||
                    !in_array($task['state'], ['working', 'waiting'], true)
                ) {
                    throw new RuntimeException(
                        'This renderer no longer owns the job.',
                    );
                }
                $state = $input['state'] ?? '';
                if (
                    !in_array(
                        $state,
                        ['working', 'waiting', 'submitted', 'failed'],
                        true,
                    )
                ) {
                    throw new RuntimeException('Invalid renderer progress.');
                }
                $command = $task['command'] ?? '';
                unset($task['command']);
                $task['state'] = $state;
                $task['updated'] = time();
                $task['message'] = sanitize_text_field(
                    substr((string) ($input['message'] ?? ''), 0, 600),
                );
                $issue =
                    $state === 'waiting'
                        ? hash(
                            'sha256',
                            $task['id'] .
                                '|' .
                                $task['message'] .
                                '|' .
                                substr(
                                    (string) ($input['item'] ?? ''),
                                    0,
                                    1000,
                                ),
                        )
                        : '';
                if ($issue !== ($task['issue'] ?? '')) {
                    $command = '';
                }
                $task['issue'] = $issue;
                $task['choices'] = array_values(
                    array_intersect(
                        ['skip', 'retry'],
                        (array) ($input['choices'] ?? []),
                    ),
                );
                if (!empty($input['report'])) {
                    $task['report'] = sanitize_textarea_field(
                        substr((string) $input['report'], 0, 18000),
                    );
                }
                if (
                    preg_match(
                        '/^[a-f0-9]{32}$/D',
                        (string) ($input['job'] ?? ''),
                    )
                ) {
                    $task['job'] = $input['job'];
                }
                if (in_array($state, ['submitted', 'failed'], true)) {
                    unset($task['worker']);
                }
            } elseif ($operation === 'decide') {
                $command = $input['choice'] ?? '';
                if (
                    ($task['id'] ?? '') !== ($input['id'] ?? null) ||
                    ($task['state'] ?? '') !== 'waiting' ||
                    ($task['issue'] ?? '') !== ($input['issue'] ?? null) ||
                    !in_array($command, $task['choices'] ?? [], true)
                ) {
                    throw new RuntimeException(
                        'This item is no longer waiting for that choice.',
                    );
                }
                $task['command'] = $command;
            } else {
                throw new RuntimeException('Unknown renderer operation.');
            }
            update_user_meta($user, $key, $task);
            return $read() + [
                'command' => $operation === 'update' ? $command : '',
            ];
        } finally {
            LSE_Locks::release($lease);
        }
    }
}
