Remove fixed plugin content limits that could reject valid converted drafts after media uploads.

* Remove generated CSS, source, settings, decoded payload, JSON, page/file, element and nesting caps.
* Remove automatic website-capture page, depth, resource-count and byte quotas.
* Retain hosting/native resource limits, permission/content validation and resumable small batches.
* Compact repeated selector declarations while preserving responsive/state styles.
* Reuse verified media imported by Little Studio Suite and recover upload batch size after temporary slow processing.

After updating, retry the same JSON with the same page selection and options. Confirmed media and drafts remain available; missing work continues. The release does not make network transfer, image processing or native Elementor conversion instantaneous.
