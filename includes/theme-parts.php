<?php
if (!defined('ABSPATH')) {
    exit();
}

trait LSE_Theme_Parts
{
    private static function theme_part_state($id)
    {
        return [
            'conditions' => array_values(
                (array) (get_post_meta($id, '_elementor_conditions', true) ?:
                []),
            ),
            'status' => get_post_status($id),
        ];
    }

    private static function write_theme_part_state($id, $state)
    {
        if (get_post_status($id) !== $state['status']) {
            $updated = wp_update_post(
                ['ID' => $id, 'post_status' => $state['status']],
                true,
            );
            if (is_wp_error($updated) || !$updated) {
                throw new RuntimeException(
                    'Theme Builder could not change the template status.',
                );
            }
        }
        if ($state['conditions']) {
            update_post_meta(
                $id,
                '_elementor_conditions',
                $state['conditions'],
            );
        } else {
            delete_post_meta($id, '_elementor_conditions');
        }
        if (self::theme_part_state($id) !== $state) {
            throw new RuntimeException(
                'Theme Builder could not save the display conditions.',
            );
        }
    }

    private static function theme_part_manager()
    {
        if (
            !class_exists(\ElementorPro\Modules\ThemeBuilder\Module::class) ||
            !current_user_can('edit_theme_options') ||
            !current_user_can('publish_posts')
        ) {
            throw new RuntimeException(
                'Elementor Pro and permission to publish site templates are required.',
            );
        }
        $manager = \ElementorPro\Modules\ThemeBuilder\Module::instance()->get_conditions_manager();
        $manager->get_cache()->regenerate();
        return $manager;
    }

    private static function apply_theme_part_changes($rows, $manager, $restore)
    {
        $from = $restore ? 'after' : 'before';
        $to = $restore ? 'before' : 'after';
        if ($restore) {
            $rows = array_reverse($rows);
        }
        foreach ($rows as $row) {
            if (
                !current_user_can('edit_post', $row['id']) ||
                self::theme_part_state($row['id']) !== $row[$from]
            ) {
                throw new RuntimeException(
                    'A template or its display conditions changed. Review the templates in Theme Builder before continuing.',
                );
            }
        }
        $written = [];
        try {
            foreach ($rows as $row) {
                $written[] = $row;
                self::write_theme_part_state($row['id'], $row[$to]);
            }
        } catch (Throwable $error) {
            foreach (array_reverse($written) as $row) {
                self::write_theme_part_state($row['id'], $row[$from]);
            }
            throw $error;
        } finally {
            $manager->get_cache()->regenerate();
        }
    }

    public static function theme_part($input)
    {
        if (($input['consent'] ?? null) !== true) {
            throw new RuntimeException('Confirm the sitewide template change.');
        }
        $kind = $input['kind'] ?? '';
        if (!in_array($kind, ['header', 'footer'], true)) {
            throw new RuntimeException('Choose a header or footer.');
        }
        $lock = self::lock($input['job'] ?? '');
        try {
            $theme_lock = LSE_Locks::acquire('_lse_theme_builder_import');
            $job = self::load($lock['id']);
            if ($job['state'] !== 'ready') {
                throw new RuntimeException(
                    'Finish importing the website before changing its sitewide templates.',
                );
            }
            $part = $job['templates']['site-' . $kind] ?? [];
            $id = (int) ($part['id'] ?? 0);
            if (
                !$id ||
                get_post_meta($id, '_lse_job', true) !== $job['id'] ||
                get_post_meta($id, '_elementor_template_type', true) !==
                    $kind ||
                !current_user_can('edit_post', $id)
            ) {
                throw new RuntimeException(
                    'This import has no editable Theme Builder ' . $kind . '.',
                );
            }
            $manager = self::theme_part_manager();
            if (($input['operation'] ?? '') === 'restore') {
                self::restore_theme_part($job, $kind, $manager);
            } elseif (($input['operation'] ?? '') === 'assign') {
                $before = self::theme_part_state($id);
                if (
                    !in_array($before['status'], ['draft', 'publish'], true) ||
                    $before['conditions']
                ) {
                    throw new RuntimeException(
                        'This template already has display conditions. Review them in Theme Builder.',
                    );
                }
                $rows = [];
                foreach (
                    $manager->get_conditions_conflicts_by_location(
                        'include/general',
                        $kind,
                        $id,
                    )
                    as $conflict
                ) {
                    $other = (int) $conflict['template_id'];
                    $previous = self::theme_part_state($other);
                    $next = $previous;
                    $next['conditions'] = array_values(
                        array_diff($previous['conditions'], [
                            'include/general',
                        ]),
                    );
                    $rows[] = [
                        'id' => $other,
                        'before' => $previous,
                        'after' => $next,
                    ];
                }
                $rows[] = [
                    'id' => $id,
                    'before' => $before,
                    'after' => [
                        'conditions' => ['include/general'],
                        'status' => 'publish',
                    ],
                ];
                self::apply_theme_part_changes($rows, $manager, false);
                $job['site_part_swaps'][$kind] = $rows;
            } else {
                throw new RuntimeException(
                    'Choose how to update this template.',
                );
            }
            self::store($job);
            return self::status(['job' => $job['id']]);
        } finally {
            if (isset($theme_lock)) {
                LSE_Locks::release($theme_lock);
            }
            self::unlock($lock);
        }
    }

    private static function restore_theme_part(&$job, $kind, $manager)
    {
        $rows = $job['site_part_swaps'][$kind] ?? [];
        if (!$rows) {
            throw new RuntimeException(
                'This import has no previous assignment to restore.',
            );
        }
        self::apply_theme_part_changes($rows, $manager, true);
        unset($job['site_part_swaps'][$kind]);
    }
}
