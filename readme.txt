=== Little Studio to Elementor ===
Contributors: littlestudio
Requires at least: 6.8
Tested up to: 7.1.4
Requires PHP: 8.0
Stable tag: 0.12.17
License: GPL-3.0-or-later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Convert a public website link to a JSON bundle of Elementor templates and media.
Import the bundle into editable Elementor draft pages with this plugin.

== Installation ==

1. Back up WordPress and use staging for the first import.
2. Install and activate Elementor Core. Elementor Pro is optional for importing;
   its commercial features require your own licensed installation.
3. In Plugins > Add New > Upload Plugin, choose this plugin ZIP and activate it.
4. Open Studio to Elementor in the main WordPress sidebar, directly below Plugins.
   You can also use Open converter in the installed Plugins list.
5. Choose Little Studio JSON, native Elementor template JSON, or HTML. For a split
   page, select header.json, content.json and footer.json together. Use extracted
   JSON files rather than a template-parts ZIP. All pages are selected.
6. Review the page list and setup items; enable interactions for a trusted file.
7. Import the pages as drafts. With Elementor Pro, importing the source header or footer publishes a Theme Builder template with the Entire Site condition. Open each page in Elementor to review it.

== Updates ==

Use Look for newest update on the converter screen. Update now appears when a
new version is available. Updates come from the public GitHub releases and need
no token, licence key or activation code. Automatic updates are initially enabled;
your later choice in the WordPress Plugins screen is respected. WordPress hosting
update/cron and file-permission settings continue to apply.

== Imported scrolling and appearance ==

Supported source Elementor sticky menus use native Imported scrolling controls.
They work independently of captured scripts. Review desktop, tablet and mobile.
Image appearance targets the actual image, preserving crop, background, padding,
borders and responsive opacity. Lazy backgrounds and gallery hover overlays are
retained. Reports separate missing files and required setup from capture notes.
Plugin updates closes when clicking outside or pressing Escape.

== What this first version does ==

* Accepts Little Studio version 1 and native Elementor 0.4 page/section/header/footer
  templates. Native imports retain installed widget trees and responsive/page
  settings. Source global/dynamic references need destination mapping. Native
  imports require unfiltered HTML permission. Remote media is not auto-packaged.
* Creates new WordPress drafts, including parent/child relationships.
* Imports packaged raster images, sanitised SVG, fonts and supported media/documents
  into the Media Library. Reuses identical files already imported by this plugin.
* Maps known media references, relative image paths and internal page links.
* Builds native Elementor containers, headings, text, images, links/buttons and
  dividers. Complex regions use small sanitised HTML widgets and are counted.
* Reconstructs responsive settings at 1440, 1024, 768 and 390 pixel references.
* Preserves additional computed styling as page-scoped CSS. Native controls can
  change content and common style settings. Some advanced CSS requires review.
* Publishes one header and one footer in Elementor Pro Theme Builder when the source contains those regions. Each has its own editor and Entire Site display condition. Elementor Free uses shared saved templates for imported pages.
* Prepares an unassigned classic WordPress menu when navigation can be identified.
* Stores source and SEO metadata; supplies basic SEO output without an SEO plugin.
* Preserves interactive navigation, local calculators and enquiry controls.
* Shows a short setup summary and supports retries of the current unfinished import.
* Removes an import after confirmation. Pages and owned templates go to Trash,
  and plugin-created files used only by that import are deleted. Explicit site
  setup can restore earlier homepage/menu assignments when those settings have
  not subsequently changed.

== Important limits ==

This is an initial converter, not a promise of lossless design migration.

Little Studio JSON contains HTML/CSS/JS rather than an Elementor widget tree.
Conversion is heuristic. Review typography, spacing, image crops, intermediate
widths, hidden states, navigation, accessibility and interactions before publishing.
Animations, pseudo-elements, complex selector relationships, custom breakpoints,
fluid layout, generated content and third-party applications may need rebuilding.
Small HTML regions require code editing; they do not become native content controls.

Website interactions are enabled during import for administrators with
unfiltered HTML permission. The single interactions checkbox states that code
from the selected file will run on imported drafts. Source analysis never runs
that code. Keep interactions off for a file you do not trust. Inline handlers and external script tags are removed.
File imports do not fetch missing external files or install npm/PHP dependencies.
Website link capture packages supported public files before the import review.
Ordinary content uses computed native styles; interactive sections retain scoped
source styles, attributes, breakpoints and state selectors.

Local calculators and browser-only controls retain real form semantics and
working inputs. Imported form actions and inline event handlers are removed; a
small runtime prevents accidental form submissions. Contact submission, payments,
checkout, accounts, search backends and ecommerce data still need real integrations. Configure Elementor Pro Forms, WooCommerce or
another appropriate integration separately.

Shared sections are saved Elementor sections, not Pro Theme Builder assignments.
Colours and typography are applied per element; the existing Elementor global kit
is not replaced. A block theme may require manual navigation setup. The optional
site setup assigns a classic menu only if the theme exposes a menu location.

SEO fields are retained. Basic title, description, robots and Open Graph fallback
output is supplied. Yoast/Rank Math metadata bridges need project-specific review;
SEO plugin compatibility and Pro-only workflows have not been fully certified.

Keep this plugin active for scoped CSS, font faces, page-specific image alt text,
shared-section rendering, SEO fallback and enabled custom scripts. Deactivation
does not delete imported content, but those supporting features stop rendering.
There is no destructive uninstall routine or automatic media deletion.

Open an unfinished import and choose Resume import to recover its source and
options from the same browser. Browser storage can be cleared or unavailable.
If the checkpoint is gone, use the original file and options to continue the
most recent matching import. A new import uses new drafts.
Select an existing import and Update from file to refresh its pages.
Native JSON and self-contained HTML files can be imported.

The plugin imposes no fixed content-size, page/file-count or generated-element
quota on imports. CSS, source code, shared styles, element settings, native JSON
and converted draft payloads are accepted without the old plugin size caps.
WordPress/Elementor, PHP memory/execution, browser storage/memory and hosting
upload/post limits still apply. Large websites can take time; leave the tab open.
Retry preserves completed drafts and media. Type, file, permission, content-safety
and concurrent-edit validation remain active.

Converted pages use authenticated WordPress REST uploads, compressed when
supported, with a protected AJAX fallback if that route is unavailable. Original
HTML/CSS/JavaScript is not put in a form argument. Page uploads use the hosting
upload/post limits; the plugin does not impose a separate decoded-payload cap. This can avoid form-field
false positives on some security layers; it does not disable security rules or
guarantee acceptance by every host. Nonces, permissions and content checks remain.

== Privacy and rights ==

No converter service, AI API, CDN library, telemetry or API key is required.
Analysis occurs in your browser; import sends data to your WordPress server.
Website link capture makes public HTTP requests from your WordPress host to the
source site and linked file hosts. Captured files are held in your browser and in a temporary host checkpoint for
reliable batch retries. Cancelling clears that scan's stored files. Background
scan batches remain available for up to a day after the last crawl step. Prepared
page payloads are removed after job completion or removal. The browser stores
an unfinished import's source for use by Resume import.
The source preview blocks scripts and external requests. Imported pages may still
reference external media, fonts or links when those were not packaged; review them.
Elementor itself can make its usual network requests. This plugin does not control
Elementor, WordPress, hosting, theme or third-party plugin network behaviour.
Import only content/assets/software that you have permission to use and distribute.
Elementor and Elementor Pro are separate products, not bundled with this plugin.

== Verification ==

See the accompanying workspace test report and Arena record for exact checks,
versions and remaining limitations. Core compatibility was exercised with
Elementor 4.4.0, PHP 8.3 and WordPress 7.1.4 in a disposable local Playground.
Elementor Pro was not available for direct testing. Test on your own staging
versions before production use. No live website is changed by building this ZIP.

== Website link capture ==

Choose Import website link and paste a public HTTP/HTTPS address. Capture follows
linked pages automatically without a plugin page-count or link-depth quota. Small
resources are batched per request. No HTTrack or external service is required.
Scan in background uses WordPress scheduled tasks to crawl when the browser
is closed. Use Resume scan to collect and convert the saved capture in the
browser. On hosts that disable WP-Cron, a host cron schedule must be configured.
For background imports, leave the page open while it prepares and uploads the
source. After the queue confirms, WordPress can save pages without the browser.
Linked pages stay on the same origin. Capture has no fixed resource-count,
response-size or combined-byte quota. Per-request work remains checkpointed in
small batches; cancellation and hosting/network resource limits still apply.
Only public addresses on ports 80/443 are accepted. Linked CDN assets may be
packaged. Logins, browser-rendered module apps and server behavior are not cloned.

Review capture warnings and download the website JSON from the review dialog.
Import then creates ordinary protected Elementor drafts using the existing flow.
Captured classic JavaScript can run on imported pages when Keep website
interactions is enabled; only use trusted sources. The capture preview itself
does not execute it. Source WordPress/Elementor framework scripts are omitted;
custom imported scripts pause inside the Elementor editor. A capture does not publish or replace an existing import.

Alternatively use Little Studio Desktop > File > Website link to JSON. Desktop
uses the installed HTTrack engine and saves the same native JSON format.
The WordPress capture engine fetches public pages on request; no source scripts,
PHP files, account data or application backends are installed by capture.

== Changelog ==

= 0.12.17 =
* Pair a local Chromium renderer to convert an entire URL import after closing the admin tab. Convert supported gallery wrappers, flat section dividers, WooCommerce carts and destination newsletter forms. Identify additional HTTP 403 causes in the report.

= 0.12.16 =
* Recover missing background scan and import events on the next WP-Cron run.

= 0.12.15 =
* Promote page sections into the editor, convert supported vector icons, signup forms and embedded videos, and report empty application pages.

= 0.12.14 =
* Bound PHP memory use while checking large imports and finishing background jobs.

= 0.12.13 =
* Keep the browser responsive while checking the identity of a large capture before review.

= 0.12.12 =
* Break up large capture packaging and validation, reuse the media URL lookup, and release preview media after each page.
* Combine query URLs with their base page when both returned identical HTML.

= 0.12.11 =
* Give the browser time to respond during complex layout conversion and large recovery reads and writes.

= 0.12.10 =
* Schedule background website crawling and prepared page saves in WordPress.
* Resume an interrupted import from its saved browser source and options.
* Assign imported headers and footers sitewide with a restore action.
* Rebuild simple Elementor Pro contact forms as native editable widgets.

= 0.12.9 =
* Keep a browser checkpoint in the copied report when a scan or import is interrupted.
* Resume a recent unfinished website scan from its last stored batch.
* Decode media as needed and check file hashes one at a time to reduce memory use on large imports.

= 0.12.8 =
* Label the website capture action Scan website and stop on source maintenance pages.
* Hide a running scan or import and keep working in another WordPress tab. Leave the task tab open and use View progress to return.
* Remove files created for an import, keeping existing uploads and media still used elsewhere.

= 0.12.7 =
* Capture more lazy media and PDF links, handle redirects and broken URL escapes, and retain robots directives.
* Build editable image captions and simple self-hosted videos, preserve link behavior, and keep slider framing and controls.
* Improve recovery after request failures and make copied reports easier to read.

= 0.12.6 =
* Convert source Elementor Pro sliders into editable Slides widgets with their backgrounds, height, text and buttons.
* Open the dashboard directly when an unfinished import exists.

= 0.12.5 =
* Offer Retry or Skip this page and continue when a captured page fails conversion before import review. Report unavailable source pages as skipped.

= 0.12.4 =
* Continue importing when Elementor Pro already has a sitewide header or footer. Keep the imported templates with their own pages.
* Offer Skip this page and continue for page-specific save errors.

= 0.12.3 =
* Open the import review directly after capturing a website link. Downloading JSON is optional on the review screen.

= 0.12.2 =
* Isolate a refused media batch, skip a failed file and copy a persistent import diagnostic report.

= 0.12.1 =
* With Elementor Pro, publish source headers and footers as Theme Builder templates assigned to the entire site. Preserve existing assignments when another import conflicts.
* Keep source layout wrappers out of the editable page sections and recover native Reviews and Media Carousel widgets from supported Elementor markup.


= 0.12.0 =
* Convert a public website URL into a downloadable Elementor JSON bundle with
  packaged media.
* Import recognized page sections as separate editable blocks with one shared
  header and footer per imported website.
* Import native Elementor 0.4 template JSON with its widget tree and page settings.
* Select header.json, content.json and footer.json together to assemble one draft page.
* Accept native seven/eight-character IDs and installed Elementor widgets; report missing dependencies and template gaps.
* Bind marked native menu widgets to a resumable nested WordPress menu, preserving external links and unselected-page source links.


= 0.11.0 =
Identify CSS errors by field, selector, line and snippet; accept harmless selector
text and retain executable-CSS checks. Offer explicit single-item Skip, Retry and
Pause with durable omission reports. Preserve inline/full-width and boxed layouts,
automatic widths, source box sizing and normal line height. Verify reusable media
before uploading. Share conversion resources and safely prefetch public capture
files. Persist derived image-size work separately from ready drafts, show progress,
and support file/size retry and explicit skip without losing existing metadata.
Cache individual CSS rules to avoid retaining accumulated styles across pages.


= 0.10.0 =
* Use a compact in-plugin import removal confirmation with existing protections.
* Convert supported Google Maps embeds into editable native maps.
* Keep intrinsic grid sizing, navigation alignment and mobile dropdown placement.
* Cache supporting CSS when safe and avoid duplicate shared-section page CSS.
* Keep inline fallback and independent shared-template editing.

= 0.9.0 =
* Close Plugin updates on outside clicks and Escape.
* Convert supported sticky menus with editable device, offset and effect settings.
* Preserve image appearance, lazy backgrounds, responsive paint and gallery overlays.
* Apply image hover filters once in both Elementor widget wrapper layouts.
* Separate missing resources and required setup from informational capture notes.

= 0.7.3 =
* Preserve scoped source CSS for copied text, lists, SVG and HTML content, including variables, pseudo-elements, states and responsive rules.
* Retain inline source stylesheets and safely preserved SVG styles/IDs; support both Elementor widget wrapper layouts.
* Keep native controls editable and retain the faster resource batches and resumable imports.

= 0.7.2 =
* Fix URL replacement failing on large resource maps and returning null instead of CSS.
* Preserve complete styles, escaped JavaScript URLs and longest-match boundaries.
* Process up to 32 capture resources per request and use host-sized media groups.
* Reuse one job lock/load per media group, cache attachment IDs and rewrite CSS once.
* Verify a 19.5 MB JSON with 148 fresh images, native editing, preview and interactions.

= 0.7.1 =
* Remove fixed plugin content quotas, including generated CSS and converted-draft payload caps.
* Remove automatic website-capture page, depth, resource and byte quotas.
* Keep host limits, validation, resumable progress and small request batches.
* Group shared selector declarations without changing responsive or state styles.
* Reuse verified media previously imported by the Suite builder.
* Increase upload groups again after temporary slow processing recovers.

= 0.7.0 =
* Include lazy/gallery images and backgrounds, and retain captured font rules in saved previews.
* Isolate source Elementor identities/runtime and pause imported scripts in the editor.
* Populate native image sizing and editable responsive photo grids.
* Use readable media filenames/titles, preserving reused URLs and custom titles.
* Remove redundant preparation/status requests and cache recursive URL rewrites.
* Recapture old sources and use Update from file to repair previously missing files.

= 0.6.2 =
* Simplify URL capture to one website address and fix dialog/sidebar spacing.
* Batch captures and media uploads, adapt to slow hosts, and overlap conversion with saves.
* Reuse parsed metadata and avoid repeated checks of all pages after each save.
* Accept deeply nested source layouts up to 128 editable container levels.
* Keep source preview protections, media validation, saved-progress retries and edit protection.


= 0.6.0 =
* Capture a public website link directly in the plugin and review it before importing.
* Package linked styles, images, fonts and classic scripts into portable website JSON.
* Download source JSON and review capture limits or missing resources.
* Keep bounded, administrator-only captures separate from page and media imports.


= 0.5.0 =
* Navigate imported websites from a dedicated sidebar.
* Search and filter pages, then preview or edit them from the selected-page inspector.
* Review imports and updates in a focused dialog, with responsive controls on smaller screens.
* Edit page details, restore content, and manage Trash through the existing protected actions.

= 0.4.1 =
* Use one simple workspace for each import; secondary page actions are under More.
* Remove a whole import, including edited or published pages, with one confirmation.
* Move removed pages to Trash, keep shared media, and retain sections used elsewhere.
* Hide removed imports and return completed imports to the same page list.


= 0.4.0 =
* Manage all of your saved imports from one list, including older imports.
* Refresh selected existing pages from JSON or self-contained HTML without creating replacement posts.
* Edit imported page titles and addresses; open Elementor or preview directly.
* Move individual imported pages to Trash and restore them as drafts.
* Protect concurrent edits and require explicit replacement of edited or published content.
* Keep a recoverable copy before each page refresh; restore it while the refreshed page is unchanged.
* Preserve JavaScript backslashes and respect disabled WordPress Trash.


= 0.3.1 =
Discover releases and download verified packages through GitHub's public API,
with the release-download route retained as a fallback. Respect API rate limits,
bound streamed downloads and show one clear error instead of stacked HTTP codes.

= 0.3.0 =
Preserve interactive controls and state CSS. Start and reinitialise page scripts
across Elementor renders without duplicate handlers. Enable interactions with
clear import controls. Replace repeated notices with a brief setup summary. Use
authenticated compressed REST saves with an AJAX fallback; retain real permission
failures and completed-page retry safety. Older imports require reimporting.

= 0.2.1 =
Transfer converted pages as validated temporary JSON uploads. Show immediate
saved-progress feedback beside the recovery button. Include transport, byte count
and converter-handler presence in redacted diagnostics. Keep legacy requests
compatible and preserve nonce, permissions, content and resumable-draft checks.

= 0.2.0 =
Public GitHub releases, automatic WordPress updates and simple check/update buttons.

= 0.1.2 =
Own top-level sidebar menu directly below Plugins, plus an Open converter link
in the Plugins list. Previous Tools bookmarks redirect to the new screen.

= 0.1.1 =
Read-only connection/status checks before preparing drafts. Recover a saved import
when the first confirmation is lost. Clear HTTP/session/hosting error messages,
local error reports and clean JSON despite incidental server output. Clarified
that imports add drafts/media; homepage/menu changes are a separate opt-in action.

= 0.1.0 =
Initial whole-website JSON importer and native Elementor conversion.

== Background conversion on your computer ==

The optional local renderer prepares URL imports while the WordPress tab is closed.
On the computer that will do the conversion, open the matching release of the
LS Elementor GitHub repository. From its directory run:

    npm ci
    npx playwright install chromium
    node scripts/local-renderer.mjs https://your-wordpress-site.example --login

Sign in with your WordPress administrator account and keep Remember Me selected.
Then run the worker and leave it running while imports are in progress:

    node scripts/local-renderer.mjs https://your-wordpress-site.example

In LS Elementor, open the website URL importer, paste the source address and
choose “Import all pages on my computer”. You can close the WordPress tab as
soon as it shows the job is queued. Open LS Elementor again for progress,
Skip, Retry or Copy report. WordPress saves the prepared drafts with WP-Cron.
Each WordPress installation uses a separate local browser sign-in.
