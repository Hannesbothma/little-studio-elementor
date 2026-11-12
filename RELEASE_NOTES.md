Improve import accuracy, identify individual failures, and make usable drafts available sooner.

* Report CSS failures with the page, CSS field, selector, line, column, reason and a bounded source snippet. Accept harmless selector/string text such as the Green Valley print selector containing `javascript:`; keep checks for executable CSS and unbundled imports.
* Add Retry, Skip this item and continue, and Pause. Skip only an identified CSS declaration/rule or individual failed file. Keep completed work and a durable skipped-items report. Unknown, permission and save-conflict failures remain non-skippable.
* Preserve inline layout, authored automatic widths, source box sizing and normal line height. Full-width galleries stay full width while intentionally boxed content retains its width.
* Check verified Media Library hashes before uploading unchanged files. Share conversion resource blobs and compiled URL maps across pages. Cache each CSS rule independently to keep whole-site conversion memory bounded. Fetch up to four independent public capture resources together where the host supports it, with safe redirect checks and a normal WordPress fallback.
* Make original images and pages available before derived image sizes finish. Persist the requested sizes, resume core metadata checkpoints, and show remaining work separately. Image-size failures identify the file/size and support explicit Retry or Skip; skipped sizes can be retried later. Custom remote/offloaded storage keeps synchronous processing.

Update through the existing WordPress plugin button. Rebuild affected existing pages with **Update from file**, using the same JSON and reviewing replacement of edited or published pages. Capture again if the old JSON omitted source resources. CSS/file omissions remain listed for review.

Draft readiness and completed image processing are separate states. Network transfers, source failures, image processing and host capacity still take time. Review responsive layouts and interactions before publishing; universal exact replication is not established.
