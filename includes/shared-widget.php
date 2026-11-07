<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
class LSE_Shared_Widget extends \Elementor\Widget_Base {
    public function get_name() { return 'lse-shared'; }
    public function get_title() { return 'Studio shared section'; }
    public function get_icon() { return 'eicon-template'; }
    public function get_categories() { return [ 'general' ]; }
    protected function register_controls() {
        $this->start_controls_section( 'section', [ 'label' => 'Shared section' ] );
        $options = []; foreach ( get_posts( [ 'post_type' => 'elementor_library', 'post_status' => [ 'draft', 'publish' ], 'numberposts' => 100, 'meta_key' => '_lse_shared', 'meta_value' => '1' ] ) as $post ) { $options[$post->ID] = $post->post_title; }
        $this->add_control( 'template_id', [ 'label' => 'Shared template', 'type' => \Elementor\Controls_Manager::SELECT, 'options' => $options ] );
        $this->add_control( 'help', [ 'type' => \Elementor\Controls_Manager::RAW_HTML, 'raw' => 'Edit the source section under Templates → Saved Templates. Its content is native Elementor elements. Changes appear on every linked imported page.' ] );
        $this->end_controls_section();
    }
    protected function render() {
        $id = absint( $this->get_settings_for_display( 'template_id' ) ); if ( ! $id || get_post_meta( $id, '_lse_shared', true ) !== '1' || $id === get_the_ID() ) { return; }
        $job = get_post_meta( $id, '_lse_job', true ); $page_job = get_post_meta( get_queried_object_id(), '_lse_job', true );
        if ( $job !== $page_job && ! current_user_can( 'edit_post', $id ) ) { return; }
        echo \Elementor\Plugin::$instance->frontend->get_builder_content_for_display( $id, true ); // Native Elementor renderer, not arbitrary user HTML.
    }
}
