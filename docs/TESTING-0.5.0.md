# Sidebar workspace verification

The packaged integration run passed with WordPress 7.1.4, PHP 8.3.36, and Elementor Core 4.4.0 in disposable WordPress Playground.

The check covers:

- Website sidebar selection, page search and status filtering.
- The selected-page inspector and its real Elementor link.
- Responsive page selection and inspector dismissal at a 430-pixel viewport.
- Page title/address changes through the metadata dialog.
- Import and update review, with stable WordPress page IDs and reused media.
- Existing native Elementor edits and published pages protected during refresh.
- Recovery before refresh, per-page Trash/restore, and concurrent-edit rejection.
- Whole-import removal, preservation of unrelated imports/media, and homepage/menu cleanup.
- A simulated native upgrade with content, activation, and automatic-update preference preserved.

The upgrade fixture uses version 0.5.1 only inside the test environment and is not released.

The local run also read the existing portfolio and Opu exports and converted representative pages. Portfolio samples produced 120 and 75 native elements. Opu samples produced 341 and 119 native elements, with the existing form-service warnings. Website source files were read without modification. GitHub CI skips these workstation-specific SSD probes.

The approved interface uses the existing authenticated importer and management actions. Elementor Pro and the user's live WordPress host were not exercised by this test.

Run the packaged check with:

```sh
node tests/run.mjs
```
