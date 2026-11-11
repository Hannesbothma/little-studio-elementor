# Studio to Elementor 0.6.0 verification

The website capture feature has two entry points: the Linux Desktop HTTrack
exporter and the WordPress plugin's public URL capture. Both create native
`little-studio-website` version 1 JSON and use the existing Elementor converter.

## Desktop capture

Installed Arch `httrack` 3.50.5-1 and retained its original upstream icon and
WebHTTrack launcher. The Desktop source is `/home/hannes/Work/little-studio-desktop`.
The installed app provides File > Website link to JSON. Its optional capture runs
outside the offline editor preview. The Python exporter and backend were built
and installed; installed capture files match the tested source/build.

`python tests/website-capture.py` captured a disposable local two-page HTTP site
through the actual .NET backend/save-dialog protocol and installed HTTrack. It
verified linked navigation, nested CSS imports, packaged/deduplicated media,
classic JavaScript, portable references and unchanged Desktop projects. The
result passed the plugin validator and native Elementor conversion in headless
Chromium. No existing website source or JSON was changed by this test.

The physical desktop portal save picker was not exercised; its backend exchange
was tested without opening or moving desktop windows.

## WordPress capture and regression checks

`node tests/run.mjs` builds and installs the real release ZIP in a disposable
WordPress Playground. Tests cover the URL capture controls, page/depth limits,
portable JSON download, image deduplication, nested CSS imports, classic script
packaging without executing source code, capture warnings, native Elementor
headings and matching Desktop/WordPress capture identities. Retrying the same
resource returns the same response; an invalid acknowledgement is rejected.
Private starting URLs and redirects to private addresses are denied.

The source fixture is intercepted at the WordPress HTTP layer using a public IP
literal because Playground does not provide ordinary hostname DNS resolution.
No private-address bypass is enabled in the plugin. Production hosting still
needs working DNS, outbound public HTTP/HTTPS and PHP DOM.

Verified on WordPress 7.1.4, PHP 8.3.36 and Elementor 4.4.0. The full local run
also validated the current portfolio (15 pages / 22 assets) and Opu export
(38 pages / 116 assets), converting two representative pages from each without
changing their source files.

The same suite checks initial imports, page refresh without changed IDs, native
Elementor edit protection, published-page replacement consent, concurrent edits,
metadata, Trash/restore, whole-import removal, unrelated content retention and
mobile workspace behavior. A disposable next-version ZIP exercises the native
WordPress updater, including checksum verification, API download fallback,
content preservation, activation and the administrator's auto-update preference.
The simulated next version is never published.

## Practical limits

Capture is a bounded public HTML/CSS/media transfer, with classic scripts retained
for review. It does not execute module applications, copy authenticated sessions,
install server backends or guarantee visually exact native widgets for arbitrary
sites. Review imported layouts, navigation, fonts, responsive behavior and forms
before publication. No live WordPress site was changed during local verification.
