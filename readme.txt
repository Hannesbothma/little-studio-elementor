=== Little Studio to Elementor ===
Contributors: littlestudio
Requires at least: 6.8
Tested up to: 7.1
Requires PHP: 8.0
Stable tag: 0.2.0
License: GPL-3.0-or-later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Import one native Little Studio website JSON into editable Elementor draft pages.

== Installation ==

1. Back up WordPress and use staging for the first import.
2. Install and activate Elementor Core. Elementor Pro is optional for importing;
   its commercial features require your own licensed installation.
3. In Plugins > Add New > Upload Plugin, choose this plugin ZIP and activate it.
4. Open Studio to Elementor in the main WordPress sidebar, directly below Plugins.
   You can also use Open converter in the installed Plugins list.
5. Choose your complete Little Studio website JSON. All pages are selected.
6. Review the file, page layout and warnings; keep custom scripts off initially.
7. Import as drafts, then open each page in Elementor and review all screen sizes.

== Updates ==

Use Look for newest update on the converter screen. Update now appears when a
new version is available. Updates come from the public GitHub releases and need
no token, licence key or activation code. Automatic updates are initially enabled;
your later choice in the WordPress Plugins screen is respected. WordPress hosting
update/cron and file-permission settings continue to apply.

== What this first version does ==

* Accepts little-studio-website version 1 and code-canvas version 1 JSON.
* Creates new WordPress drafts, including parent/child relationships.
* Imports packaged raster images, sanitised SVG, fonts and supported media/documents
  into the Media Library. Reuses identical files already imported by this plugin.
* Maps known media references, relative image paths and internal page links.
* Builds native Elementor containers, headings, text, images, links/buttons and
  dividers. Complex regions use small sanitised HTML widgets and are counted.
* Reconstructs responsive settings at 1440, 1024, 768 and 390 pixel references.
* Preserves additional computed styling as page-scoped CSS. Native controls can
  change content and common style settings. Some advanced CSS requires review.
* Links identical header/footer regions through native saved section templates
  and the included Studio shared section widget. Variants remain separate.
* Prepares an unassigned classic WordPress menu when navigation can be identified.
* Stores source and SEO metadata; supplies basic SEO output without an SEO plugin.
* Reports limitations and supports retries of the current unfinished import.
* Removes only unchanged imported drafts on request; keeps edited/published pages,
  media and shared templates. Explicit site setup can restore earlier homepage/menu
  assignments when those settings have not subsequently changed.

== Important limits ==

This is an initial converter, not a promise of lossless design migration.

Little Studio JSON contains HTML/CSS/JS rather than an Elementor widget tree.
Conversion is heuristic. Review typography, spacing, image crops, intermediate
widths, hidden states, navigation, accessibility and interactions before publishing.
Animations, pseudo-elements, complex selector relationships, custom breakpoints,
fluid layout, generated content and third-party applications may need rebuilding.
Small HTML regions require code editing; they do not become native content controls.

Custom JavaScript is retained but disabled by default. Enabling it requires an
administrator with unfiltered HTML permission and trusted reviewed source. It may
need selector changes. Inline handlers and external script tags are removed.
External stylesheets/scripts, npm/PHP dependencies and missing/local-PC files are
not fetched or installed. Package required images/fonts in Little Studio first.
Existing page CSS is converted to computed scoped styles, not copied verbatim.

Forms are disabled, non-submitting markup pending a real integration. Payments,
checkout, accounts, search backends and ecommerce data are not implemented by
importing their visual preview. Configure Elementor Pro Forms, WooCommerce or
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

Only the most recent import can be resumed from the interface. Choose the same
file, selection, name and options to continue it. A new import uses new drafts.
Cross-import updates and arbitrary HTML-file uploads are outside version 0.1.
HTML may be supplied through the existing code-canvas JSON format.

Limits follow the native format: 200 pages, 200 packaged/inline files, 8 MB per
file, 32 MB combined media, 2 MB source code per page, 16 MB total source code,
128 KB shared CSS; 64 MB JSON file, 4,000 generated elements, 2 MB generated CSS
per page. Hosting upload/post limits can be lower. Large websites take several
minutes; leave the import tab open. Retry preserves completed work.

== Privacy and rights ==

No converter service, AI API, CDN library, telemetry or API key is required.
Analysis occurs in your browser; import sends data to your WordPress server.
The source preview blocks scripts and external requests. Imported pages may still
reference external media, fonts or links when those were not packaged; review them.
Elementor itself can make its usual network requests. This plugin does not control
Elementor, WordPress, hosting, theme or third-party plugin network behaviour.
Import only content/assets/software that you have permission to use and distribute.
Elementor and Elementor Pro are separate products, not bundled with this plugin.

== Verification ==

See the accompanying workspace test report and Arena record for exact checks,
versions and remaining limitations. Core compatibility was exercised with
Elementor 4.3.6, PHP 8.3 and WordPress 7.1.3 in a disposable local Playground.
Elementor Pro was not available for direct testing. Test on your own staging
versions before production use. No live website is changed by building this ZIP.

== Changelog ==

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
