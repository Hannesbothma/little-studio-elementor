# Verification

The updater was tested headlessly against disposable WordPress 7.1.3, PHP 8.3.33
and Elementor Core 4.3.6. Plugin files were installed from the distributable ZIP
inside the virtual installation; the development source directory was not mounted
as the installed plugin and could not be overwritten by the upgrade.

The test used a simulated next release, 0.2.1, to exercise the actual WordPress
`Plugin_Upgrader` from the published-code candidate 0.2.0. It verified:

* The check button reports an up-to-date installation and hides Update now.
* A newer release reveals Update now.
* A single click downloads, upgrades, retains activation and reloads the new version.
* An existing published page, homepage assignment and imported Elementor data survive.
* Initial native automatic-update enablement and later user preferences are respected.
* Other plugins’ update entries and translations are retained.
* Offline checks, unrelated package addresses and incomplete downloads fail without
  replacing the installed plugin.

The simulated 0.2.1 package is a test fixture, not a published release. Background
cron was disabled in the test; the automatic-update preference and native update
provider integration were verified, rather than claiming a timed cron run occurred.

The conversion base was separately exercised with 2-page, 9-page/7-file and
38-page/116-file native exports, native Elementor editing/saving, first-request
recovery and conservative cleanup. Those tests do not guarantee arbitrary HTML
fidelity, Pro-only features, production hosting performance or real ecommerce/form
backends. Staging acceptance and manual review remain necessary.

The updater uses the documented [WordPress Update URI provider hook](https://developer.wordpress.org/reference/hooks/update_plugins_hostname/)
and [native plugin upgrader](https://developer.wordpress.org/reference/classes/plugin_upgrader/upgrade/).
Packages and the small update file are served as public GitHub release assets.


## 0.6.1 performance and nesting regression coverage

The URL capture fixture now includes 80 nested layout wrappers. The integration
check captures it, saves native Elementor content, edits its heading through
Elementor's own document API, and verifies the edit. Converter nesting supports
128 levels; server validation and the JSON transport have matching headroom.
The 4,000-element, media and payload safeguards remain enabled.

Capture tests exercise the simpler URL-only form at a 958-pixel window width,
private-address and redirect rejection, batch replay, source JSON download and
image deduplication. Media tests submit four source references to identical image
bytes, verify batch handling and confirm one reused attachment. Existing refresh,
concurrent-edit, Trash, recovery and native updater tests remain in the suite.

An isolated before/after comparison of the converter on the Opu homepage produced
identical output (341 native elements, 20 existing fallback regions, 475,514 CSS
characters). Its timings were 1,233 and 1,248 ms: no meaningful converter-only
speedup was demonstrated in that run. The import optimizations primarily reduce
WordPress round trips and overlap conversion with saves; they do not skip layout
sampling, native Elementor saves or image processing.

For a local full-flow comparison, save the old `assets/admin.js` from commit
`a8fe262c96fcb7f20198d0433f05e20d7c0e8071` to a temporary file and run:

```
LSE_SKIP_SSD=1 LSE_BENCH_BASELINE=/path/to/old-admin.js node tests/run.mjs
```

The optional benchmark compares old/new frontend request paths against the same
disposable server using two pages and four small, already available media
references. It records per-run duration and requests in
`tests/results/performance.json`. General integration timings and request counts
are in `tests/results/integration.json`. Timings depend on the host and source;
request-count reductions must not be presented as universal timing guarantees.

Capture batches retain a temporary host checkpoint for response replay. Completion
or cancellation removes it; abandoned checkpoints are cleaned through WordPress
cron. Captured source code remains unexecuted during analysis. No live WordPress
site is modified by these tests.


### 0.6.2 adaptive media batches

When a host stops a media batch early, the next upload group is reduced to the
number it actually processed. Remaining files are uploaded individually if the
host processed only one, rather than repeatedly sending four files. A disposable
fixture delays the first media lookup inside a batch and verifies that the
remaining three files are still imported using individual uploads.

The same-server frontend benchmark recorded 18,495 ms before and 13,237 ms after
for two pages and four small media references: approximately 28% faster in that
fixture. Four media-upload requests became one. This uses already available
media and isolates request overhead; it is not a benchmark of real-site network
capture, large fresh uploads or every hosting environment.


## 0.7.0 preview, editor and media coverage

The 0.7.0 package was exercised with WordPress 7.1.4, PHP 8.3.36 and
Elementor Core 4.4.0. The URL fixture includes source Elementor identity attributes, a lazy gallery
whose image lives in `data-thumbnail`, a real WOFF2 font, source framework scripts
and a custom interaction. It still contains 80 nested wrappers. Tests verify
local media, readable filenames and Media Library titles, preserved font-face
rules, native heading typography, isolated destination IDs and a linked SVG
rendered at gallery-cell width rather than Elementor's 48-pixel icon default.
The file-import fixture also checks that a legacy hash filename becomes a name
based on its alt text.

The actual Elementor editor is opened headlessly for a captured page. After its
preview is ready and its loading overlay is gone, its floating Structure panel
is closed so it does not cover the toolbar. The native Edit Heading toolbar is
clicked. The native title textarea is filled and its
visible canvas text is checked. Imported custom scripts must be absent from the
editor iframe. This checks editor loading and native control editing; it does
not certify the inaccessible live WordPress installation or
interaction with every editor toolbar.

The full suite retains refresh/recovery, concurrent-edit protection, published
replacement consent, adaptive media uploads and a simulated native upgrade to
0.7.1. That upgrade fixture is never published. The Desktop HTTrack-to-JSON
integration test also passes with the current standalone converter.

Performance work combines draft preparation and applies acknowledged media
mappings without another status request. The optional same-server benchmark uses
`assets/admin.js` from release 0.6.2 as its baseline. It isolates frontend request
overhead on two pages with four small reused media references; it does not measure
real-site crawling or fresh large media processing.

The source site inspected for diagnosis was the public Le Petit Paris homepage.
No production drafts or editor were accessible through the available connection,
and no live WordPress content was changed. Old incomplete captures need recapture
and Update from file before missing files can appear. Exact arbitrary-site
appearance, Pro features and instant imports remain unproven.

The current Opu export still validates with 38 pages and 116 assets. Its homepage
converts to 341 native elements and 20 reported HTML regions (1,566 ms in the
isolated check). This is compatibility evidence, not an Elementor load-time
measurement or a fidelity guarantee.

The 0.6.2-to-0.7.0 same-server frontend benchmark recorded 11,954 ms before
and 9,101 ms after (about 24% faster for that fixture). Eight requests became
six: `check` plus `start` became `prepare`, and the post-media `status` request
was removed. These timings use small reused files and do not predict a live
website's total capture/import duration.


## 0.7.1 large-content regression

The final package is tested in disposable WordPress with PHP memory 1 GB and
upload/post settings 64 MB. These are test-host resources, not plugin quotas.
`tests/large-import.mjs` validates 201 pages and 201 packaged files, converts
4,144 native elements including 140 nested source wrappers, and uploads a 9 MB
PNG. It verifies reuse using the Suite builder's fingerprint only.

The authenticated page-save path receives and saves 17 MB of generated CSS,
4 MB of source CSS and an HTML widget with settings over 512 KB. Gzip transfer
must pass the old 16 MB decoded-payload threshold; stored lengths are checked to
reject silent truncation. A real frontend preview must render its final color
rule. Unsafe CSS must still fail before a draft save.

Capture tests discover 803 resources in a single page without the previous
200-page/600-resource quotas, then cancel without fetching that queue. Existing
explicit programmatic page/depth selections remain supported. Full management,
preview/editor, adaptive-upload and simulated native upgrade tests remain active.
The next-version upgrade fixture is 0.7.2 and is never published.

The SSD was mounted read-only by a separate security scan and its canonical
checkout/index could not be read or edited. Work uses the established fallback
`/tmp/lse-layout-work` and publishes through the connected GitHub release workflow.
No scan mounts or historical files are changed. Sync the clean canonical checkout
and website index later when the SSD is accessible; do not overwrite local work.
