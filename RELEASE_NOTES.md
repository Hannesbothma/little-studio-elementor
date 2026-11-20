## LS Elementor 0.12.3

Paste a website link and review the captured pages in WordPress. Click **Import** to create editable Elementor drafts. **Download JSON** is available on the review screen for a portable copy.

## LS Elementor 0.12.2

When a media batch is refused, LS Elementor checks saved progress and retries files individually. Choose **Skip this file and continue** to finish the remaining uploads. Individual page conversion failures can also be skipped. Use **Copy report** during an import or reopen the import afterward to copy its errors, skipped items and saved progress. If the WordPress session expires, sign back in to resume.

With Elementor Pro, imported sitewide headers and footers use Theme Builder. Converted pages also have fewer redundant containers.

## Website to Elementor JSON

Paste a public website URL to download an Elementor JSON bundle with its
captured pages and packaged media. Import the bundle through Studio to
Elementor to create editable drafts. Recognized page sections appear as
separate top-level blocks in the editor.

The imported website shares one editable header and one editable footer.
When the homepage is included, it supplies the shared designs. Open either
template from the imported website’s **Edit site header** and **Edit site
footer** links. The templates render on the relevant pages and have their own
Elementor editors.

## Conversion and editing improvements

HTML/website JSON conversion now retains font fallbacks, fluid type sizes,
unitless line heights, relative letter spacing, responsive positioning, flex
sizing and percentage image heights. Header/footer actions use editable native
button containers on supported Elementor versions. Source gallery image changes
reach the actual native Image widget, and known script/data media references use
packaged files. Captured analytics and WordPress/Elementor runtime scripts are
excluded. Embedded SVG/font assets are supported. Complex forms/dialogs still
require HTML editing and destination service setup.

Native stacking order preserves text above campaign gradients. Text maximum
width stays editable on the actual text element, including relative units and
the common 1280px desktop layout. Shared-section finishing now checkpoints one
page per request instead of loading a whole group into Elementor's document
cache; this fixes a PHP memory exhaustion found with the local 36-page import.
Responsive overflow controls retain carousel clipping and prevent sideways mobile
scrolling. Edited-page replacement uses an in-plugin confirmation dialog with
the existing explicit consent and server-side change checks.
Source media-query thresholds now drive scoped native size/spacing/layout
defaults. This fixes tablet headers and typography that differed from the source
between Elementor's standard breakpoints; the native controls remain editable.
Shared refreshes update native settings with stable template/element IDs. Gallery
controls created by source scripts keep their styles, and copied HTML roots no
longer receive duplicate padding/borders from their widget wrappers. Desktop Grid
containers that switch to Flex retain responsive direction and wrapping.

Import native Elementor 0.4 page, section, header and footer JSON directly. Select
header.json, content.json and footer.json together to assemble one draft page.
Native containers, installed widget types, seven/eight-character IDs, nested
structure, responsive controls and page settings are retained. Existing Little
Studio JSON/HTML capture and import remain available.

Missing widgets are named before importing. Foreign media IDs are cleared, custom
CSS stays validated, and source global/dynamic references require explicit
mapping. External images are still external unless packaged. HTML placeholders,
empty map addresses and Pro/breakpoint requirements are reported. These imports
are draft pages; no site-wide Theme Builder locations are assigned.

Imported native menu widgets can bind automatically to one destination WordPress
menu, including nested submenus, external booking links and source-link fallbacks
when only some pages are selected. Menu creation resumes after interruption;
changed definitions preserve the prior menu. Actual Pro interactions still need
verification with Elementor Pro.

Update from the WordPress Plugins screen or install the release ZIP. Existing
imported pages can pick up conversion improvements through **Update from file**
in Studio to Elementor.
