Preserve working website interactions when converting to Elementor, and improve
converted-page saves on hosts that reject the previous request format.

* Keep responsive navigation, calculator inputs, state styles and local enquiry
  controls working. Reinitialise handlers after Elementor replaces their region.
* Keep ordinary headings, copy, prices and images editable with native controls.
* Replace repeated per-page notices with a short setup summary and one clear
  interactions option for trusted source files.
* Save bounded compressed JSON uploads through authenticated REST, with protected
  AJAX fallback for unavailable routes. Keep permission and nonce checks intact.
* Make completed-page retries safe and accept valid scroll-behavior CSS.

After updating, reload Studio to Elementor and choose the same website JSON to
create rebuilt drafts. Existing pages are preserved. Keep interactions enabled
for your trusted file and keep this converter active.

Verified with an 11-page website in disposable WordPress and actual Elementor Core
editor save tests, using headless browsers. Both calculators, mobile navigation,
local enquiry interactions and simulated 403 fallback passed. The actual hosting
403 still requires a retry; this release does not disable hosting security rules.
Enquiry drafts do not send messages without a real receiving integration.
Elementor Pro and arbitrary third-party scripts are not certified.
