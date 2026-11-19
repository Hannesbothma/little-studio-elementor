<?php
// studio wp eval-file <this file> setup|step|refresh|cleanup (a fresh PHP process per step).
if (!defined('ABSPATH') || wp_get_environment_type() !== 'local') {
    throw new RuntimeException('Requires a local disposable test site.');
}
wp_set_current_user(get_user_by('login', 'labadmin')->ID);
$stage = $args[0] ?? 'step';
$option = '_lse_test_bounded_sharing';
$save_pages = static function ($job, $pages, $size, $offset = 0) {
    foreach ($pages as $n => $page) {
        $id = sprintf('fa%06x', $offset + $n * 2 + 1);
        LSE_Importer::page([
            'job' => $job['id'],
            'key' => $page['key'],
            'elements' => [
                [
                    'id' => $id,
                    'elType' => 'container',
                    'settings' => [
                        'html_tag' => 'header',
                        'content_width' => 'full',
                    ],
                    'elements' => [
                        [
                            'id' => sprintf('fa%06x', $offset + $n * 2 + 2),
                            'elType' => 'widget',
                            'widgetType' => 'heading',
                            'settings' => [
                                'title' => 'Editable shared header',
                                'typography_typography' => 'custom',
                                'typography_font_size' => [
                                    'unit' => 'px',
                                    'size' => $size,
                                ],
                            ],
                            'elements' => [],
                        ],
                    ],
                ],
            ],
            'regions' => [
                [
                    'id' => $id,
                    'kind' => 'header',
                    'hash' => hash('sha256', 'owned same header'),
                ],
            ],
        ]);
    }
};
if ($stage === 'setup') {
    if (get_option($option)) {
        throw new RuntimeException(
            'Clean up the previous sharing fixture first.',
        );
    }
    $last = get_user_meta(get_current_user_id(), '_lse_last_job', true);
    $pages = [];
    for ($n = 0; $n < 3; ++$n) {
        $pages[] = [
            'key' => 'batch-' . $n,
            'title' => 'LS owned sharing check ' . $n,
        ];
    }
    $job = LSE_Importer::start([
        'fingerprint' => hash('sha256', random_bytes(32)),
        'site_id' => 'owned-sharing-check',
        'title' => 'LS owned sharing check',
        'pages' => $pages,
        'site' => ['navigation' => []],
    ]);
    update_option($option, ['job' => $job['id'], 'last' => $last], false);
    $save_pages($job, $pages, 20);
    update_user_meta(get_current_user_id(), '_lse_last_job', $last);
    echo wp_json_encode(['setup' => true]);
    return;
}
$fixture = get_option($option);
if (!$fixture) {
    throw new RuntimeException('Set up the sharing fixture first.');
}
if ($stage === 'refresh') {
    $before = LSE_Importer::status(['job' => $fixture['job']]);
    if ($before['state'] !== 'ready') {
        throw new RuntimeException('Finish the first sharing round.');
    }
    $pages = array_map(
        static fn($page) => ['key' => $page['key'], 'title' => $page['title']],
        $before['pages'],
    );
    $job = LSE_Importer::start([
        'target_job' => $before['id'],
        'fingerprint' => hash('sha256', random_bytes(32)),
        'site_id' => 'owned-sharing-check',
        'title' => $before['title'],
        'pages' => $pages,
        'expected_stamps' => array_column(
            $before['pages'],
            'current_stamp',
            'key',
        ),
    ]);
    $fixture['refreshed'] = true;
    $fixture['template_id'] = array_values($before['templates'])[0]['id'];
    update_option($option, $fixture, false);
    $save_pages($job, $pages, 42, 100);
    update_user_meta(get_current_user_id(), '_lse_last_job', $fixture['last']);
    echo wp_json_encode(['refresh_prepared' => true]);
    return;
}
if ($stage === 'cleanup') {
    $job = LSE_Importer::status(['job' => $fixture['job']]);
    LSE_Importer::remove_import([
        'job' => $job['id'],
        'consent' => true,
        'expected_stamps' => array_column(
            $job['pages'],
            'current_stamp',
            'key',
        ),
    ]);
    update_user_meta(get_current_user_id(), '_lse_last_job', $fixture['last']);
    delete_option($option);
    echo wp_json_encode(['cleanup' => true]);
    return;
}
$before = LSE_Importer::status(['job' => $fixture['job']]);
$count = static function ($job) {
    $count = 0;
    foreach ($job['pages'] as $page) {
        $tree = json_decode(
            get_post_meta($page['id'], '_elementor_data', true),
            true,
        );
        if (($tree[0]['widgetType'] ?? '') === 'lse-shared') {
            ++$count;
        }
    }
    return $count;
};
$prior = $count($before);
$step = LSE_Importer::finish(['job' => $fixture['job'], 'compact' => true]);
if ($step['state'] === 'finishing' && array_keys($step) !== ['id', 'state']) {
    throw new RuntimeException(
        'Intermediate finish responses must remain compact.',
    );
}
$after =
    $step['state'] === 'ready'
        ? $step
        : LSE_Importer::status(['job' => $fixture['job']]);
$shared = $count($after);
if ($shared - $prior > 1 || ($prior < 3 && $shared !== $prior + 1)) {
    throw new RuntimeException(
        'A finish request must checkpoint exactly one pending page.',
    );
}
foreach ($after['pages'] as $page) {
    if ($page['changed']) {
        throw new RuntimeException('Sharing lost the saved page fingerprint.');
    }
}
if (
    $after['state'] === 'ready' &&
    ($shared !== 3 || count($after['templates']) !== 1)
) {
    throw new RuntimeException(
        'The resumed fixture did not reuse one shared header.',
    );
}
if ($after['state'] === 'ready' && !empty($fixture['refreshed'])) {
    $template = array_values($after['templates'])[0];
    $tree = json_decode(
        get_post_meta($template['id'], '_elementor_data', true),
        true,
    );
    if (
        $template['id'] !== $fixture['template_id'] ||
        $tree[0]['id'] !== 'fa000001' ||
        $tree[0]['elements'][0]['settings']['typography_font_size']['size'] !==
            42
    ) {
        throw new RuntimeException(
            'Shared refresh must update native controls while preserving template and element IDs.',
        );
    }
}
echo wp_json_encode([
    'state' => $after['state'],
    'shared' => $shared,
    'delta' => $shared - $prior,
]);
