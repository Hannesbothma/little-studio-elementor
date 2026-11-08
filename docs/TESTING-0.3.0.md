# Version 0.3.0 verification

Headless tests used disposable WordPress 7.1.3, PHP 8.3.33 and Elementor Core 4.3.6.
No live WordPress site or source website project was modified.

- PASS: 11-page website and nine packaged assets imported through compressed REST
  uploads while AJAX page saves were deliberately blocked.
- PASS: mobile keyboard menu, Escape, focus return and phone overflow check.
- PASS: both Google Ads calculators, minimum fee, percentage fee, SEO addition,
  empty state and reset.
- PASS: plan links, local enquiry validation/draft/selection/invalidation and
  handler reinitialisation after replacing the interactive region.
- PASS: actual Elementor editor calculator, native heading edit, draft save and
  fresh frontend calculator/mobile navigation.
- PASS: non-JSON REST block falls back to authenticated AJAX without duplicate
  drafts; structured nonce denial remains 403 without alternate-endpoint retry.
- PASS: valid scroll-behavior accepted; legacy behavior rejected; unsafe markup
  and external form actions removed; labels and constraints retained.
- PASS: gallery images, dialog region, hidden states, tablet typography and CSS
  repetition regressions.
- PASS: packaged installation/activation/version and first-request recovery.
  Published-page and homepage test fixtures remained unchanged.

The final package only corrects one installation sentence in readme.txt after
these tests; executable plugin files are identical to the tested package.

Actual hosting refusal is unverified without a retry on that host. These checks
do not establish universal design fidelity, Elementor Pro compatibility or
backend message delivery. Review imported drafts before publishing.
