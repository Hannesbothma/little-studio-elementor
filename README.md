# Little Studio to Elementor

A standalone WordPress plugin that imports a whole Little Studio website JSON as
new Elementor draft pages, including packaged media, fonts and internal links.

The plugin has its own **Studio to Elementor** sidebar entry below **Plugins**.
Headings, text, images, buttons and supported layouts become native Elementor
elements. Complex regions are reported and may use small editable HTML widgets.
Imports do not replace existing page content or publish the new drafts.

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

## Supported inputs and limits

Accepts `little-studio-website` version 1 and `code-canvas` version 1 JSON.
Packaged images, sanitised SVG, supported media/documents and font files are
registered in the Media Library. Identical imported files are reused.
Original source JavaScript is retained but disabled by default.

Conversion from HTML/CSS is heuristic. Exact appearance and arbitrary interactions
are not guaranteed. Review responsive layouts, typography, cropping, navigation,
animations and accessibility before publishing. Forms need a real submission
integration; checkout/account previews do not create ecommerce backends.
Shared imported sections are native saved sections, not Pro Theme Builder rules.
Keep the converter active for its supporting styles, fonts and shared sections.

Elementor Pro was not available for direct certification. The conversion base was
tested with Elementor Core 4.3.6, PHP 8.3 and WordPress 7.1.3. See `readme.txt` for
full import limits, behaviour and licensing considerations.

## Development and releases

No Composer or npm packages are required. PHP and ordinary browser JavaScript run
the plugin. Node 24 builds the distributable with built-in modules:

```sh
node scripts/package.mjs . dist
```

The package builder emits the WordPress ZIP and `update.json` together. It includes
only plugin files, never test fixtures, website projects or credentials.
Future version tags trigger the release workflow. The tag, plugin header and
version constant must agree. Release assets are attached to a draft before it is
published, so an unfinished package is not offered to WordPress.

## Licence

GPL-3.0-or-later. Elementor and Elementor Pro are separate products and are not
bundled. Import only assets and content you have permission to use.
