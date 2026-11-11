Repair draft saving after large website captures and increase resource throughput.

After 148 uploads, the old URL-replacement expression could exceed PHP's regex compilation limit and return null, making valid CSS fail with “Generated styles must be CSS text.” Replacement now processes the full resource map through bounded expressions while preserving original text, longest matches, URL boundaries and escaped JavaScript. CSS remapping failures are reported explicitly before the native draft save.

* Capture up to 32 small resources per request with replay checkpoints.
* Upload in groups sized to the host's file-count limit, with adaptive work budgets.
* Share a job load/lock across each media group, cache attachment IDs and avoid rewriting CSS twice.
* Preserve the previous content-quota removal, native saves, media validation, retries and edit protection.

A 19.5 MB JSON with 148 fresh PNGs completed in 40.5 seconds versus 91.4 seconds with the old frontend queue on the same fixed backend. Upload requests fell from 37 to eight. Preview images, interactions/state CSS and native Elementor editing were verified. These are fixture timings, not a live-site or universal fidelity guarantee.

Update, then retry the same JSON and options. Confirmed uploads and completed drafts are kept.
