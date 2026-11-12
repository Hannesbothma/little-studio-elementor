<?php
if (!defined('ABSPATH')) {
    exit();
}

/** Provider fallbacks preserve imported metadata without duplicating provider output. */
final class LSE_SEO
{
    public static function fields()
    {
        $fields = [];
        foreach (
            [
                '_yoast_wpseo_' => [
                    'title',
                    'metadesc',
                    'canonical',
                    'opengraph-title',
                    'opengraph-description',
                    'opengraph-image',
                    'meta-robots-noindex',
                ],
                'rank_math_' => [
                    'title',
                    'description',
                    'canonical_url',
                    'facebook_title',
                    'facebook_description',
                    'facebook_image',
                    'facebook_image_id',
                    'robots',
                ],
            ]
            as $prefix => $names
        ) {
            foreach ($names as $name) {
                $fields[] = $prefix . $name;
            }
        }
        return $fields;
    }
    public static function snapshot($id)
    {
        $values = [];
        foreach (self::fields() as $field) {
            $value = get_post_meta($id, $field, true);
            if ($value !== '' && $value !== []) {
                $values[$field] = $value;
            }
        }
        return $values;
    }
    private static function current()
    {
        return is_singular()
            ? (array) get_post_meta(get_queried_object_id(), '_lse_seo', true)
            : [];
    }
    public static function init()
    {
        foreach (['wpseo_robots_array', 'rank_math/frontend/robots'] as $hook) {
            add_filter($hook, static function ($robots) use ($hook) {
                $seo = self::current();
                $id = get_queried_object_id();
                $explicit =
                    $hook === 'wpseo_robots_array'
                        ? get_post_meta(
                            $id,
                            '_yoast_wpseo_meta-robots-noindex',
                            true,
                        )
                        : get_post_meta($id, 'rank_math_robots', true);
                if (($seo['indexing'] ?? '') === 'noindex' && !$explicit) {
                    $robots['index'] = 'noindex';
                }
                return $robots;
            });
        }
        // Rank Math's native selector needs an attachment ID. Retain external-only
        // imported images when no provider image has been selected.
        add_action(
            'rank_math/opengraph/facebook/add_additional_images',
            static function ($image) {
                $seo = self::current();
                $id = get_queried_object_id();
                $selected = get_post_meta(
                    $id,
                    'rank_math_facebook_image',
                    true,
                );
                if (
                    !$image->has_images() &&
                    !empty($seo['social_image']) &&
                    (!$selected || $selected === $seo['social_image']) &&
                    !get_post_meta($id, 'rank_math_facebook_image_id', true)
                ) {
                    $image->add_image_by_url($seo['social_image']);
                }
            },
        );
        // AIOSEO's documented model hook: fill defaults; explicit provider settings win.
        add_filter('aioseo_get_post', static function ($post) {
            $seo = (array) get_post_meta(
                (int) ($post->post_id ?? 0),
                '_lse_seo',
                true,
            );
            foreach (
                [
                    'title' => 'title',
                    'description' => 'description',
                    'canonical' => 'canonical_url',
                    'social_title' => 'og_title',
                    'social_description' => 'og_description',
                    'social_image' => 'og_image_custom_url',
                ]
                as $key => $field
            ) {
                if (!empty($seo[$key]) && empty($post->$field)) {
                    $post->$field = $seo[$key];
                }
            }
            if (
                !empty($seo['social_image']) &&
                $post->og_image_custom_url === $seo['social_image'] &&
                in_array((string) $post->og_image_type, ['', 'default'], true)
            ) {
                $post->og_image_type = 'custom_image';
            }
            if (
                ($seo['indexing'] ?? '') === 'noindex' &&
                $post->robots_default
            ) {
                $post->robots_default = false;
                $post->robots_noindex = true;
            }
            return $post;
        });
    }
}
