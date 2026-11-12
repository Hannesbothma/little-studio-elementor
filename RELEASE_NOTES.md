Restore imported maps and layout alignment, reduce editor styling overhead, and simplify removing an import.

* Replace the browser removal prompt with one compact confirmation inside the plugin. Keep Trash recovery, media preservation, ownership and concurrent-edit protections.
* Convert supported Google Maps address embeds into native, editable Elementor maps, including zoom and responsive height. Unknown or unsafe remote frames remain excluded with a clear report.
* Preserve automatic sizing and alignment in grids, inline content and navigation. Restore full-width mobile dropdown placement and original panel styles when closing.
* Reuse captured page CSS for linked shared sections instead of injecting another full page-sized stylesheet. Deliver eligible CSS as a versioned, cacheable file; preserve inline delivery when URL semantics or hosting require it. Standalone template editing retains its own styling.
* Add checks for native map editing, unsafe frames, desktop/mobile map and navigation geometry, shared styles and in-plugin deletion.

Update using the existing WordPress plugin button. Use **Update from file** on the existing import to rebuild its maps and layouts with the same page IDs, addresses and publication status. Review replacement of edited or published pages. Styling-delivery improvements also apply when viewing existing imports.

The source post-682.css still returns HTTP 404. Lottie animations and application/form backends can require rebuilding. This release does not establish a universal exact replica or instant editor loading. Live destination timing remains unverified where the WordPress connector cannot authenticate.
