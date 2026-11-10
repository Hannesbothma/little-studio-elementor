# Import management 0.4.0

Verified 10 November 2026 using WordPress 7.1.4, PHP 8.3.36 and Elementor Core 4.4.0. `node tests/run.mjs` built the distributable ZIP and installed it into a disposable WordPress Playground site. Development source was not installed by mounting it over the plugin directory, so the native updater could not overwrite the source checkout. All browsers ran headlessly; no physical desktop window or live WordPress site was used.

The final integration check passed:

- JSON draft import and saved-import discovery.
- Native headings remain editable when a header control targets a distant dialog; only the interactive regions use HTML widgets.
- Original data attributes render on native Elementor wrappers.
- Embedded media upload and reuse of the same attachment during refresh.
- Refresh retains the original page IDs and publication status.
- Content edited through Elementor's document API is protected unless replacement is explicitly allowed.
- Published pages require explicit replacement consent; stale review fingerprints are rejected.
- The pre-refresh content can be restored while newer page edits are protected.
- Page title/address editing and Trash/restore work. Pages from a different import or account are rejected.
- Source JavaScript backslashes survive storage.
- Plain HTML file input converts through the normal import UI.
- A simulated upgrade from the packaged 0.4.0 build to 0.4.1 runs the actual WordPress Plugin_Upgrader through the public API download transport while the standard release route is unavailable. Imported data, activation and the user's disabled automatic-update preference survive.

The simulated 0.4.1 package is a local test fixture, not a release.

The user's current exports were read without changing their files:

| Website | Whole-file validation | Representative conversion |
|---|---|---|
| Hannes Bothma portfolio | 15 pages, 22 assets | Home: 120 native elements / 1 HTML region; Video editing: 75 / 1 |
| Opu Jewelry | 38 pages, 116 assets | Home: 341 native elements / 20 HTML regions; Gold snake chain: 119 / 14 |

These checks do not claim that every page of either real website was imported, visually compared, or tested on a live host. Opu's form-related warnings remain visible; imported frontend forms do not create their own receiving service. Elementor Pro, payment/account backends, arbitrary third-party scripts, and exact visual fidelity are unverified. New page keys are imported separately; a refresh updates selected existing pages and keeps absent pages.

CI runs the generic fixture and native updater checks. It does not have access to the user's SSD exports. Both pull requests and a release run the tests; a changed plugin version on main creates its version tag and publishes the ZIP/update.json only after checks succeed. Existing published release assets are not replaced.

Implementation references: [Elementor frontend render hooks](https://developers.elementor.com/docs/hooks/render-frontend-elements.html), [Elementor data structure](https://developers.elementor.com/docs/data-structure/), [WordPress Trash behaviour](https://developer.wordpress.org/reference/functions/wp_trash_post/).
