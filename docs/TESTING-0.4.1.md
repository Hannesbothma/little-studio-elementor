# Single workspace and import removal

The packaged integration test covers the existing import/refresh/editing flow plus:

- One visible workspace and no duplicate completion panel.
- Secondary page controls collapsed under More.
- Whole-import removal with edited and published pages.
- Explicit confirmation and per-page change checks before any removal.
- A stale removal request leaves all pages untouched.
- Other imports are preserved, and removed imports disappear from the selector.
- Imported menu/setup cleanup, media retention, and retained native updater behaviour.

Verified with WordPress 7.1.4, PHP 8.3.36 and Elementor Core 4.4.0. The packaged fixture and native-upgrade checks passed. Tests run in disposable WordPress Playground with a headless browser; no live WordPress site is changed. This run skips the SSD-specific export probes. The prior release's portfolio/Opu conversion results remain documented in TESTING-0.4.0.md.
