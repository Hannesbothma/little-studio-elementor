Restore missing source CSS in imported content.

The converter previously sampled basic native styles but only retained full source rules for explicitly detected interaction regions. Copied text/list markup, SVG icons and other HTML widgets lost descendant rules, CSS variables, pseudo-elements, hover/focus and responsive styling. Inline source stylesheets were also omitted from that retained CSS. These rules now stay scoped to the copied source content while native Elementor controls remain editable.

* Preserve styles from every inline/packaged source stylesheet in document order.
* Retain source variables on converted ancestors and source rules inside copied content.
* Preserve SVG IDs, sanitized inline styles and the marker used to apply scoped CSS.
* Target HTML content in both Elementor widget-wrapper layouts.
* Keep destination-theme stylesheets off imported standalone Canvas pages so their forced rules do not override source CSS; preserve them for WordPress header/footer layouts.
* Keep the faster host-sized batches, resumable uploads, validation and edit protections.

For an existing import, update the plugin, select that website and use **Update from file** with its same JSON to rebuild the saved CSS. Review edited/published page replacement before applying. Updating the plugin alone does not reconvert completed pages. Files whose capture omitted a stylesheet need a fresh capture.

Regression coverage checks actual rendered desktop/mobile lists, inline styles, SVG sizing/colour, inherited variables, pseudo-elements, link hover and the Elementor editor, followed by a native heading edit. Universal exact conversion of arbitrary websites remains unproven.
