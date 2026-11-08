Fix update checks and installation when GitHub's standard release-download route
returns HTTP 504.

* Discover published releases and download packages through GitHub's public API.
  No token or activation setup is needed.
* Verify package identity, size and SHA-256 before replacing plugin files.
* Keep the validated standard manifest and download route as a fallback.
* Cache checks, respect GitHub rate limits and display one clear error message.
* Retain all 0.3.0 interaction and converter improvements.

If your installed updater already reports HTTP 504, use Plugins → Add New →
Upload Plugin to replace it with the attached little-studio-elementor-0.3.1.zip
once. The old updater cannot reliably download its own repair through that failed
route. Pages do not need reimporting solely for this updater patch.

The updater preserves imported content and existing update preferences. This
release does not change hosting security settings or publish website pages.
