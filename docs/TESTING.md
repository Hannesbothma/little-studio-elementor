# Verification

The updater was tested headlessly against disposable WordPress 7.1.3, PHP 8.3.33
and Elementor Core 4.3.6. Plugin files were installed from the distributable ZIP
inside the virtual installation; the development source directory was not mounted
as the installed plugin and could not be overwritten by the upgrade.

The test used a simulated next release, 0.2.1, to exercise the actual WordPress
`Plugin_Upgrader` from the published-code candidate 0.2.0. It verified:

* The check button reports an up-to-date installation and hides Update now.
* A newer release reveals Update now.
* A single click downloads, upgrades, retains activation and reloads the new version.
* An existing published page, homepage assignment and imported Elementor data survive.
* Initial native automatic-update enablement and later user preferences are respected.
* Other plugins’ update entries and translations are retained.
* Offline checks, unrelated package addresses and incomplete downloads fail without
  replacing the installed plugin.

The simulated 0.2.1 package is a test fixture, not a published release. Background
cron was disabled in the test; the automatic-update preference and native update
provider integration were verified, rather than claiming a timed cron run occurred.

The conversion base was separately exercised with 2-page, 9-page/7-file and
38-page/116-file native exports, native Elementor editing/saving, first-request
recovery and conservative cleanup. Those tests do not guarantee arbitrary HTML
fidelity, Pro-only features, production hosting performance or real ecommerce/form
backends. Staging acceptance and manual review remain necessary.

The updater uses the documented [WordPress Update URI provider hook](https://developer.wordpress.org/reference/hooks/update_plugins_hostname/)
and [native plugin upgrader](https://developer.wordpress.org/reference/classes/plugin_upgrader/upgrade/).
Packages and the small update file are served as public GitHub release assets.
