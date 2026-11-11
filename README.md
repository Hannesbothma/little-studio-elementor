# Little Studio to Elementor

A standalone WordPress plugin that imports a whole Little Studio website JSON as
new Elementor draft pages, including packaged media, fonts and internal links.

The plugin has its own **Studio to Elementor** sidebar entry below **Plugins**.
Headings, text, images, buttons and supported layouts become native Elementor
elements. Complex regions are reported and may use small editable HTML widgets.
Imports do not replace existing page content or publish the new drafts.

## Website link capture

Use **Import from website link** in the plugin sidebar. Paste a public URL. Linked pages are followed automatically without a plugin page-count or depth quota. Keep the tab open, review capture warnings, download the
native JSON if needed, and import to editable Elementor drafts. Capture itself
creates no posts or media. The host needs PHP DOM and public outbound HTTP/HTTPS;
HTTrack is not required on WordPress. Captures have no fixed resource-count or byte quota; public ports 80/443, redirect
validation and small checkpointed requests remain in place.

Alternatively use **Little Studio Desktop > File > Website link to JSON…** for
the local HTTrack route. Both routes require review; server behavior and JavaScript
module apps may need rebuilding.

## Manage imported websites

Choose an imported website from the sidebar, then search or filter its pages. Select a page to open its inspector with **Edit in Elementor**, **Preview page**, title/address editing, Trash/restore, and recovery before the last update. New imports and page updates are reviewed in a dialog. Reports, shared sections, and homepage/menu setup are under **Import details**. On smaller screens, use the website selector and tap a page to open its inspector.

Use **Update from file** to update selected existing pages. Their WordPress IDs, addresses and publication status stay the same. Unselected pages are kept. Edited and published pages are initially deselected; replacing them requires the explicit checkbox and confirmation. A page changed after review is rejected. New page keys must be imported separately. Deleted pages must be restored before refreshing them.

A single HTML file can be imported as a new page or targeted at a selected existing page. Include inline CSS/JavaScript and embedded assets; external dependencies are not fetched during analysis. This does not accept arbitrary file types.

**Remove import** moves every page in the selected import to WordPress Trash, including edited and published pages, after one confirmation. It removes the import from the list, removes its own menu, and moves its own unused shared sections to Trash. Media files and shared sections referenced elsewhere are kept. A changed page stops removal before any pages are touched. Restore pages later through WordPress Trash.

A recoverable copy is kept before refreshing each page. **Restore before last update** in the page inspector is available until the page is edited again. It restores the previous page data and supporting metadata while keeping the current publication status. Existing WordPress revisions are also retained. The bulk remove-unedited-drafts action cannot delete pages as an undo of a refresh.

Older imports use an earlier change fingerprint. The first refresh may conservatively require replacement consent, even if you have not edited them. Subsequent refreshes use the current fingerprint.

## Updates

Updates come from this public repository’s releases. No GitHub token, licence key
or activation code is needed in WordPress.

* **Look for newest update** checks the published release.
* **Update now** appears when a newer version is available.

Native WordPress automatic updates are initially enabled for this plugin. A later
choice to disable them in the Plugins screen is respected. WordPress cron, file
permissions and host-wide update settings continue to apply.

## Installation

Install the attached plugin ZIP from the [latest release](https://github.com/Hannesbothma/little-studio-elementor/releases/latest)
through WordPress’s normal plugin uploader. Elementor Core must be active.
Then open **Studio to Elementor** and choose the existing Little Studio JSON.

Use the attached `little-studio-elementor-VERSION.zip`, which has the correct
WordPress directory structure. GitHub’s automatically generated source archives
are intended for developers.

## Supported inputs and hosting resources

Accepts `little-studio-website` version 1 and `code-canvas` version 1 JSON.
Packaged images, sanitised SVG, supported media/documents and font files are
registered in the Media Library. Identical imported files are reused.
Custom source JavaScript is retained; URL capture omits the source WordPress/Elementor framework runtime. Imported scripts pause inside the Elementor editor to keep its controls independent. Interactions default on when the importing
administrator has the required permission; enable them only for a trusted file.
Navigation and calculator regions retain their structure and responsive state
styles in HTML widgets, while ordinary content remains native Elementor elements.

Version 0.3.0 adds compressed authenticated REST saves with an AJAX fallback and a
shorter review screen. After updating, choose the same website JSON to rebuild
working drafts. Existing pages are preserved; old conversions are not rewritten.

Version 0.3.1 repairs update discovery and downloads through GitHub's public
release API, retaining verified standard downloads as an alternate route. If
your older updater reports HTTP 504, replace it once through WordPress's ZIP
uploader; its failing download route cannot reliably fetch this repair itself.
There is no need to reimport pages solely for the updater fix.

Conversion from HTML/CSS is heuristic. Exact appearance and arbitrary interactions
are not guaranteed. Review responsive layouts, typography, cropping, navigation,
animations and accessibility before publishing. Forms need a real submission
integration; checkout/account previews do not create ecommerce backends.
Shared imported sections are native saved sections, not Pro Theme Builder rules.
Keep the converter active for its supporting styles, fonts and shared sections.

Elementor Pro was not available for direct certification. The conversion base was
tested with Elementor Core 4.4.0, PHP 8.3 and WordPress 7.1.4. See `readme.txt` for
hosting constraints, behaviour and licensing considerations.

## Development and releases

No Composer or npm packages are required. PHP and ordinary browser JavaScript run
the plugin. Node 24 builds the distributable with built-in modules:

```sh
node scripts/package.mjs . dist
```

The package builder emits the WordPress ZIP and `update.json` together. It includes
only plugin files, never test fixtures, website projects or credentials.
A plugin version change on main or a version tag triggers validation and the release workflow. The tag, plugin header and
version constant must agree. Release assets are attached to a draft before it is
published, so an unfinished package is not offered to WordPress.

## Licence

GPL-3.0-or-later. Elementor and Elementor Pro are separate products and are not
bundled. Import only assets and content you have permission to use.

## Repeatable testing

Install development tools with `npm install --no-save --no-package-lock @wp-playground/cli@3.1.63 playwright@1.65.0`, then `npx playwright install chromium` and `node tests/run.mjs`. The runner builds the actual plugin ZIP, installs it into an isolated WordPress Playground site (not over the development source), exercises import management and uses a simulated next-version package to test the native updater. On this workstation it also reads the current portfolio and Opu JSON for validation and representative conversion checks. The simulated package is never released. See `docs/TESTING.md` and `docs/TESTING-0.6.0.md`.

## Resource-map save repair and batching (0.7.2)

With 148 captured resource URLs, the old combined replacement expression could
exceed PHP's regex compilation limit. Replacement returned null, so valid CSS
was rejected at the end of the upload. The matcher now uses small expressions
across the complete map, merges matches against the original text, preserves
longest-match/URL boundaries and escaped JavaScript, and reports actual remapping
errors. It never substitutes an empty stylesheet to bypass validation.

Capture can deliver up to 32 small resources per request. Media groups follow
PHP's upload-count setting (20 on the test host, up to 32), with a host-aware work
budget and a soft 4 MB grouping target. Large individual files remain supported
within host resources. Every completed file/record retains its checkpoint.
Media groups share one job load/lock, attachment IDs use a cached lookup, and CSS
is rewritten once per save. Existing import identity is retained for retries.

A same-server batching comparison used 148 fresh 256×128 PNGs in a 19.5 MB native
website JSON. Import time was 91,350 ms with the old frontend queue and 40,529 ms
with the new queue; media requests fell from 37 to eight. Both used the fixed
backend to isolate batching. All 148 images loaded, custom interaction/state CSS
worked, and the resulting native heading was edited in Elementor. This is not a
claim of instant imports or universal conversion fidelity.

## Content-size repair and media imports (0.7.1)

The importer no longer imposes fixed CSS, source-code, shared-style, element-settings,
JSON-file, converted-payload, element-count, page-count or asset-count/byte quotas.
The website-link crawler also removes its automatic page/depth/resource/byte quotas.
WordPress/Elementor and hosting upload, memory and execution constraints still apply.
Metadata shape, permissions, file-type/content checks, safe public capture URLs and
concurrent-edit protection remain enforced. Work is checkpointed in small batches.

A failed 0.7.0 import can resume from the same JSON, selection and options after
updating; the conversion identity is retained, so confirmed uploads/pages are kept.
CSS selector lists now share declarations instead of repeating the complete block.
Media imported by the Suite builder can be reused after verifying its file hash.
Uploads can grow back to batches after temporary slow processing recovers.

## Preview, editor and media repairs (0.7.0)

Capture includes lazy images, gallery thumbnails and backgrounds. Source Elementor
photo grids become responsive native image widgets; captured font-face rules are
retained in saved previews. Source builder IDs/classes and framework scripts are
isolated from the destination Elementor runtime. Custom interactions still run
on the ordinary frontend when enabled, and pause in the editor iframe.

Images receive readable filenames and Media Library titles from alt text,
captions or meaningful source filenames, with page-name fallbacks. Identical
files are still reused. Custom attachment titles and existing media URLs are kept.
Combined draft preparation and acknowledged media mappings remove two redundant
WordPress requests per new import; URL rewriting also reuses compiled patterns.

To repair previously missing files, capture the source again, download its JSON,
select the existing website and use **Update from file**. Review the selected
pages and replacement consent. Their WordPress IDs and addresses are retained;
updating the plugin alone cannot recover media absent from an older capture.

## Faster capture and import (0.6.2)

Small captures and media uploads are batched to reduce WordPress bootstrap and
network overhead. Batches stop early when work is slow, preserving hosting time
budgets. Slow media processing automatically reduces subsequent upload groups,
so unfinished files are not repeatedly sent in large batches. Capture checkpoints are replayed after a lost response; successful
media uploads remain resumable. Large files use the existing individual upload.
Source metadata is parsed once per page, page conversion overlaps the preceding
save, and saves return compact acknowledgements. Final status, protections,
shared sections and native Elementor saving remain in place.

The converter caches source-asset lookups and parent geometry within each
viewport. All four responsive samples are retained. Version 0.6.2 supported 128 editable container levels. Version 0.7.1 removes
that plugin nesting cutoff and the fixed element/payload quotas. Native runtime
resource constraints still apply. Website-link capture uses a
short-lived temporary host file for its last batch checkpoint; normal completion
or cancellation removes it, and WordPress cron cleans abandoned checkpoints.


## Source CSS preservation (0.7.3)

Copied text, lists, SVG icons and other HTML content retain their scoped source
rules, variables, pseudo-elements, hover/focus and responsive styling. Every inline
source stylesheet participates, alongside packaged page/shared CSS. SVG IDs,
sanitized inline styles and source-content markers survive the import. Generated
HTML content selectors support both Elementor widget-wrapper layouts. Standalone
imported Canvas pages omit destination-theme stylesheets that would override the
source CSS; the WordPress-header/footer layout retains them. Native
headings and other supported controls remain editable.

After updating an existing installation, select the affected website and use
**Update from file** with its existing JSON. This rebuilds the saved CSS on the same
page IDs, with the normal review/backup and edited/published-page protections.
Updating the plugin or retrying an already completed import alone does not
reconvert it. If a stylesheet was absent from the captured JSON, capture again.
