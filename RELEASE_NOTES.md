Repair website-link layouts and make imports safer to refresh and resume.

* Isolate copied source CSS variables from Elementor's layout controls; preserve responsive colours, positioning, image sizing, automatic margins, grid alignment and supported source states.
* Capture Elementor background/slideshow files and rebuild supported native backgrounds. Preserve source selector wrappers and add an independent toggle for captured navigation.
* Distinguish explicit refreshes from retries, version converted output, reject stale browser tabs and allow reviewed rebuilding of imports started with an older converter.
* Recover interrupted native saves without overwriting a newer edit. Read job state after acquiring owned locks, and preserve shared sections and their supporting responsive styles during refresh.
* Accept valid signature-checked font MIME aliases, parse quoted/escaped CSS URLs correctly, preserve stylesheet import conditions and retry temporary resource failures. Report missing capture resources explicitly.
* Use measured upload times for batching, append resource checkpoints, avoid repeated queue shifts and hashes, release raw capture buffers and use lightweight blob URLs during conversion.
* Preserve SEO indexing intent through supported providers, paginate owned imports correctly and obtain updater compatibility requirements from the release manifest.
* Add regressions for the audited failures, lock test dependencies and check both the minimum and current supported platform combinations.

Update through the plugin's existing WordPress update button. Updating the plugin does not rebuild saved page content. For missing background files, capture the source again and download its JSON; then select the existing import and use **Update from file**. Review replacement of edited or published pages. Their IDs, addresses and publication status are retained.

Supported content remains editable through native Elementor controls. Complex HTML regions, source-only runtimes, Lottie animations and form/application backends can require rebuilding. This release does not claim universal pixel-perfect or instant website migration.
