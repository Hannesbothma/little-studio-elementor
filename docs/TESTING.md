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
