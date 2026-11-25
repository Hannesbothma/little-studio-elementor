# Verification

## Website fidelity

Run the stable page-context fixture with `LSE_TEST_ONLY=website-fidelity npm test`.
It checks the generated header, page background, footer relationship, dropdown,
and a native heading edit in Elementor. The runner saves full-page source and
draft screenshots and counts every differing pixel, including differences in
page dimensions.

For live URL imports, install the candidate ZIP in a disposable WordPress site
running native PHP, then run the same comparison against the test site.

```sh
LSE_TEST_URL=http://127.0.0.1:9440 \
LSE_TEST_USER=test-admin \
LSE_TEST_PASSWORD_FILE=/path/to/test-password \
node tests/website-fidelity.mjs --live
```

The live run checks mobile, desktop, and both sides of the 767/768px breakpoint.
Use `LSE_FIDELITY_CASES` to select comma-separated cases from `cern`, `books`,
`dropdown`, and `dynamic-controls`. The default output is
`tests/results/website-fidelity`. The comparison JSON records checks and
remaining differences after the run.

### Current issues and improvement plan

Updated 25 November 2026. Use the [tested v0.12.24 ZIP](../dist/little-studio-elementor-0.12.24.zip)
on the SSD as the comparison baseline. The public WordPress updater advertises
[v0.12.22](https://github.com/Hannesbothma/little-studio-elementor/releases/tag/v0.12.22).
The recent live imports used Elementor Core. Evidence is in the
[random-site comparison](../tests/results/random-sites-0.12.24/index.html) and
[baseline comparison](../tests/results/fidelity-0.12.24/index.html).

#### Confirmed on v0.12.24

| Area | Current problem |
| --- | --- |
| IANA linked SVG | A logo with a 234px intrinsic width renders at 23,400px. At 390px the imported page scrolls to 23,425px. A zero-width inline link leaves the importer calculating a percentage against a 1px fallback. |
| CSS Zen Garden | Four header background layers become a single invalid URL. The 390px draft is 8,346px tall versus 4,296px on the source. Section widths and spacing also differ. |
| Wikipedia | At 1280px the sidebar leaves its named grid area and the draft reaches a 2,627px scroll width. The References link is present. Tablet and phone drafts also differ visually. |
| W3C accordion page | The surrounding layout differs even though Enter expands Billing Address and clicking closes it at all three tested widths. The missing icon-font WOFF also returns 404 directly from W3C. |
| Earlier live samples | CERN, Books to Scrape and The Internet still have visual differences. At 390px the full-page comparisons showed 1.70% of pixels differed for CERN, 1.54% for Books, 1.61% for the dropdown and 7.58% for Dynamic Controls. Their tested links, covers and controls worked. The stable page-context fixture matched exactly at all four tested widths. |
| Comparison and reporting | The current full-page runner can produce an impractically large image when a draft overflows. The IANA mobile screenshot exceeded 219 million pixels. The final import report records capture and save diagnostics. Rendered layout and interaction checks come from a separate comparison run. |

#### Green Valley Lodge and Pro

| Area | Evidence and work remaining |
| --- | --- |
| Original room URL | The live `/delux-family-rooms/` returned 404 on 25 November. The [corrected live room URL](https://greenvalleylodge.co.za/deluxe-family-rooms/) returned 200. The old testing-domain URL also returned 404 that day. Capture the corrected live page and verify that Rooms and the header menu open the right WordPress draft. |
| Mobile hero and layout | Earlier Core runs showed crop and slide discrepancies on Home and Deluxe/Family Rooms. A separate Core smoke run reported that the imported homepage fit at 320px, 390px and 430px, so the current overflow status needs a fresh source-and-draft comparison. |
| Accessibility | The sampled W3C keyboard action and earlier room tab behavior passed. Green Valley still needs keyboard navigation, focus, accessible names, alt text, landmarks and a screen-reader check on the current import. |
| Booking | The NightsBridge link was preserved and its destination loaded. Verify that the current draft opens it from mobile and desktop menus, and use an authorized test flow for availability and booking steps. |
| Reviews and forms | An older comparison captured nine review cards in the draft versus 18 on the live homepage, with the live feed script absent from the draft. Verify the intended review presentation and service connection. The Contact Us form still needs an end-to-end check with a test recipient. |
| Elementor Pro stylesheet | The separate stylesheet regression from the handoff needs a reproduction on the current package. Compare the same draft in Core and Pro, and check the loaded styles in both the editor and frontend. |
| Scan and final report | The older scan that paused with four resources queued is a retest case. Run a large foreground scan and a background scan through resume, image processing, and the final report in native PHP. Confirm that a slow resource can be identified and that the report appears after processing ends. |

#### Order of work

1. **Fix linked-image sizing and catch overflow early.** Add a fixture with an
   intrinsic SVG inside an inline link. Use the rendered source width when
   there is no usable containing width for a percentage. Retain authored
   responsive sizes and test a clickable logo. Compare source and draft
   scroll widths before full-page capture. Use viewport screenshots and log
   the offending element when a document exceeds the screenshot budget.
2. **Preserve layered backgrounds.** Rewrite each URL independently and keep
   layer order, size, position, repeat, and attachment. Keep multiple layers
   in CSS when the Elementor media control accepts one image. Verify that
   all four Zen Garden header layers render, then measure the remaining
   height and spacing differences separately.
3. **Preserve named grids.** Retain grid areas, column constraints, and child
   placement when creating editable Elementor containers. Verify the left
   sidebar at 1280px, responsive reflow at narrower widths, and navigation
   to the References section.
4. **Close the remaining visual and compatibility gaps.** Address the W3C
   layout and earlier live samples with their working interactions as
   regression checks. Then run the Green Valley room, mobile, accessibility
   and service checks on the current build. Reproduce the Pro stylesheet
   issue independently to keep its diagnosis clear.
5. **Verify the package and updater.** Use the actual WordPress importer at
   390px, 768px, and 1280px, plus the widths around any affected source
   breakpoint. Compare rendered geometry, links, interactions and Elementor
   editing. Run the exact ZIP in a fresh WordPress test site. Produce one
   report at the end with source/draft screenshots, passed checks, and
   remaining issues. For the release pass, verify that the public updater
   manifest and downloadable ZIP match the tested package.

## Updater verification

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


## 0.7.2 resource-map regression and throughput

The old replacement method was reproduced with 148 synthetic capture URLs. PHP
reported “regular expression is too large” at pattern offset 36,437 and returned
null for a valid, small CSS string. The older large-CSS test used only a few URL
mappings, so it did not exercise this failure. The fix does not cast null to an
empty string or discard styles.

`tests/rewrite-regression.mjs` runs the actual PHP importer in PHP-WASM. It checks
all 148 mappings, 512 long URLs, escaped JSON/JavaScript references, prefix and
longest-match boundaries, non-cascading replacements, nested settings and
cross-expression overlaps. PHP source syntax is checked as well.

`tests/resources.mjs` imports a 19,496,280-byte native website JSON containing
148 distinct fresh 256×128 PNGs through the actual browser import controls. It
requires a successful native draft save, 148 uploaded attachments, all 148 preview
images loaded, a working custom interaction, hover/focus styling and a real
Elementor heading-control edit on that imported page. The fixture is removed
through protected import removal; only its own media is then deleted in this
disposable site. No production content is affected.

An optional `LSE_RESOURCE_BASELINE=/path/to/0.7.1-admin.js node tests/run.mjs`
compares frontend batching on the same repaired backend. It creates fresh media
for each run, cleaning only fixture attachments between runs. Measured import
times: 91,350 ms before and 40,529 ms after (~56% faster); upload requests: 37
before and eight after. The test host allows 20 uploads per request. Capture also
verified delivery and exact replay of a 32-resource batch. These numbers isolate
batching and do not measure a production host, large-photo decoding or full
remote-site network capture. They are not a benchmark of the failing old backend.

The 17 MB CSS/4 MB source/600 KB settings/9 MB media regression and all previous
management, refresh, protection, preview, editor and native-upgrade checks remain.
The simulated next-version upgrade is 0.7.3; that fixture is never published.
The SSD is accessible again, and work continues in its existing canonical checkout.


## 0.7.3 copied-content CSS regression

`tests/css-regression.mjs` imports through the actual browser controls into the
packaged plugin. The 0.7.2 baseline failed because the copied list rendered with
`list-style-type: disc` instead of the source `none`. Its standalone SVG also lost
the source-content marker during SVG sanitization; old generated selectors only
addressed the legacy `.elementor-widget-container` layout.

The fixture includes a converted source Elementor kit class supplying variables,
inline head CSS, a copied list containing SVG/text, a standalone SVG, a copied
paragraph link and an interactive button. Assertions cover list/flex layout,
spacing, SVG width/height/fill, variable inheritance, inline background/radius,
pseudo-element content, link decoration and hover. The same styles are checked in
WordPress Preview at desktop/mobile widths and in the actual Elementor iframe.
The test then changes a heading through Elementor’s real control and removes only
its own disposable import. No source scripts or production site are changed.

CSS is constrained to marked copied content; ancestor variable declarations are
retained under page scope. Native sampled controls remain active. All source
stylesheets participate in document order. Font rules, recursive conditional
rules and keyframes are retained as needed. Existing large-content, 148-resource,
capture/replay, management/protection and native updater checks remain enabled.
The simulated next-version upgrade is 0.7.4 and is never published.

Public Le Petit Paris homepage HTML and its linked stylesheets were inspected
read-only to trace the source theme. A CSS-only diagnostic import in disposable
WordPress confirmed that basic native heading colours/sizes survived while inner
source styling was missing; this was not a complete-site fidelity benchmark.
The affected live import URL was not supplied, so its exact live state remains
unverified. Existing completed imports require Update from file to regenerate
saved CSS; native edit/replacement protections must still be respected.

The first new CSS check also caught Twenty Twenty-Five’s forced 1 px link
underline overriding the source’s 3 px rule. Imported standalone Canvas pages now
dequeue stylesheets located under the active parent/child theme directories at
style-print time. Plugin/Elementor assets stay registered; ordinary pages and the
explicit WordPress-header/footer layout are unaffected. The fixture adds a real
theme-path stylesheet and verifies its absence on the standalone page and its
presence on a second header/footer import. The strict 3 px source assertion is
kept in both Preview and the editor.

The added CSS editor visit exposed Elementor 4.4’s Angie installation promotion
on the third editor visit. Its own promotion code confirms that visit threshold.
`tests/editor-prompts.mjs` uses Playwright’s overlay handler to click only that
promotion’s normal Close button, then restores canvas hover for the edit toolbar.
It never installs the promoted plugin or hides/removes DOM. Native editor loading,
visibility and actual control editing assertions remain strict.


## Local Studio converter acceptance — 18 November 2026

The Hannes Bothma public website was captured read-only and tested in the existing
WordPress Studio **Plugin Testing** site at localhost:8881 (WordPress 7.1.4, PHP
8.3, SQLite, Elementor Core/Pro 4.4.1). The source is currently the OPU Jewelry
site. The capture contains 56 URLs and 143 packaged assets; 36 substantive pages
were selected as local drafts. Twenty unavailable WooCommerce product URLs were
excluded; their actual designed product pages use different addresses. A separate
self-contained home HTML import tests the HTML path. No live site was modified.

Read-only DOM comparisons at 390, 768 and 1280 CSS px check the actual source
input against the imported preview, including fallback fonts, fluid sizes, source
breakpoints, header layout, clipping and image sizing. Home galleries and product
image tabs are exercised through visible controls. An actual native heading edit
was saved as a draft and verified after reopening Elementor, then restored through
the same controls. Screenshots are in the adjacent WordPress Lab project. UI
verification uses a background browser against the same local Studio server; the
screenshots do not depict the desktop application shell.

`tests/imported-controls.php` runs through official `studio wp eval-file` and
checks 17 native save/CSS/render/reload cases, including font editing and fallbacks,
custom responsive variables, image percentage heights, flex basis, clipping,
positioning, stacking, text widths, desktop Grid-to-mobile Flex switches and
non-submit native button containers.
It cleans up its own disposable fixture. `tests/bounded-sharing.php` uses a fresh
PHP process for each finish step and verifies one-page checkpoints, stable stamps,
resume completion, shared native-setting refresh and stable template/element IDs.
Run its stages setup, step until ready, refresh, step until ready, cleanup.

Focused Node/PHP-WASM regressions cover typography/script classification, embedded
SVG packaging, URL rewriting, CSS validation, exact stylesheet caching and safe
public fetching. These and the native Studio tests are distinct from the existing
full browser regression suite, which was not rerun in this session.

Complex forms, dialogs, details and SVG remain editable HTML where native widgets
cannot preserve their semantics. Copied roots own their box styles so their extra
widget wrapper must not duplicate padding/borders. Script-created gallery controls
receive source-content styling without overriding existing native widgets. Main
headings, text, images, action buttons and layout containers use native controls.
Source analytics and WordPress/Elementor runtime scripts are omitted. Store, login,
checkout and form services require separate destination configuration; visible
conversion is not a clone of those backend services. No checkout/form was submitted.
Pro is installed but its licence remains unconnected.

Final representative comparisons pass for home draft 187 at 390/768/1280 px and
collection 189, product 195 and contact 193 at 390 px: same font stack/size,
heading width and height within one pixel, and document scroll width equal to
the viewport. This is a focused geometry/visual check, not a whole-site pixel
diff. Product details match their source 81 px closed height and expand normally;
the Detail image control loads a packaged localhost asset. Home contains native
containers, 16 Headings, 71 Text Editors, 27 Images and 31 Buttons, with 18 HTML
widgets for special content. The separate HTML draft 1108 has the same counts.
Final-build native title edit/save/reopen was verified and its original title
restored. Existing demo draft 22 was preserved. No source or plugin release was
pushed to GitHub.
