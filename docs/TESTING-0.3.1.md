# Updater repair 0.3.1

The earlier updater depended on the standard GitHub release-download URL. That
route returned HTTP 504 in the reported installation and in release verification;
the public API route returned HTTP 200 with matching release asset bytes.

The repair discovers the latest published, non-prerelease tag through the fixed
repository API and downloads its exact package with a binary Accept header.
Package name, repository URLs, uploaded state, size and SHA-256 are checked. Older
assets lacking a digest use their same-release manifest. Validated standard
downloads remain an alternate route. Caching and rate-limit cooldown reduce API
requests. The UI shows one error rather than stacked upstream/AJAX HTTP codes.

Verified headlessly with WordPress 7.1.3, PHP 8.3.33 and Elementor Core 4.3.6:

- PASS: actual native upgrade from the packaged 0.3.1 build to a simulated 0.3.2
  fixture, while all standard release URLs returned 504. The test installed files
  in virtual WordPress; the development source was not mounted as the plugin.
- PASS: current-release UI, native provider and cache; other providers unaffected.
- PASS: malformed metadata, foreign URLs, oversized assets, draft/prerelease and
  mismatched manifest versions fail closed.
- PASS: corrupt download leaves the original plugin active and unchanged.
- PASS: missing digest uses its manifest; API download failure uses verified ZIP
  fallback; API outage can use the validated legacy manifest.
- PASS: retry headers prevent immediate API retries, including manual checks.
- PASS: concise offline error without stacked HTTP 504/400 text.
- PASS: activation, imported content, published page/homepage and automatic-update
  preference preserved; other update entries and translations retained.
- PASS: separate anonymous public API metadata and asset download with the exact
  HTTP headers; published checksum matched the downloaded bytes.

The simulated 0.3.2 fixture is not published. No live WordPress installation was
changed. A one-time manual ZIP replacement is needed if an older updater's only
download route is already failing. No page reimport is needed solely for this
updater patch. Runtime conversion behaviour remains the 0.3.0 implementation.

Primary sources, accessed 8 November 2026:

- [Latest release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
- [Binary asset API and anonymous public access](https://docs.github.com/en/rest/releases/assets)
- [API limits and retry headers](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [WordPress temporary HTTP download implementation](https://developer.wordpress.org/reference/functions/download_url/)
