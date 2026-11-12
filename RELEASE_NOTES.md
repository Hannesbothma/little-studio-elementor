Improve imported scrolling and image fidelity, and make capture reports easier to review.

* Close the Plugin updates popover when clicking outside it or pressing Escape.
* Convert supported source Elementor sticky menus into independent scrolling behavior, including device selection, responsive offsets, effects and the WordPress toolbar. Imported scrolling stays editable in Elementor and works without the captured source runtime.
* Preserve image paint on the actual image: crop, position, background, padding, borders, radius and responsive opacity. Keep fixed dimensions and positioned overlays consistent between screen sizes.
* Reveal source lazy backgrounds before measuring them, retain responsive backgrounds and native slideshow overlays, and preserve block layout instead of imposing flex layout on every wrapper.
* Retain gallery photos, empty hover overlays and source hover effects. Apply image filters once in both Elementor wrapper layouts. Upgrade previously prepared gallery markup when rebuilding an import.
* Group missing resources, styling reviews and features requiring setup separately from informational capture notes. Deduplicate repeated missing-file warnings without hiding failures.
* Add headless screenshot comparisons and real Elementor editing checks for image appearance, galleries, backgrounds, popup dismissal and scrolling.

Update through the existing WordPress plugin update button. Updating the plugin does not rebuild saved pages. Capture the website again if the earlier capture omitted background files, download its JSON, then select the existing import and use **Update from file**. Review replacement of edited or published pages; page IDs, addresses and publication status are retained.

A source file returning HTTP 404 remains unavailable. Lottie animations, source-only applications and form backends can still require rebuilding. This update improves supported conversion; it does not promise universal pixel-perfect or instant migration.
