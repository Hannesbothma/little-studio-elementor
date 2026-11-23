(() => {
  "use strict";
  const config = window.LSE_CONFIG,
    M = window.LSEConverter,
    $ = (s) => document.querySelector(s),
    app = $("#lse-app");
  if (!app) return;
  let operationId = crypto.randomUUID();
  let project = null,
    fingerprint = "",
    job = null,
    busy = false,
    originalFile = "",
    selectionStarted = false,
    pendingFingerprint = "",
    lastError = null,
    failureChoice = null,
    mediaTimer = null,
    mediaRunning = false,
    mediaPaused = false,
    lastRun = {};
  const status = (message, error = false) => {
    for (const element of [$("#lse-status"), $("#lse-dialog-status")]) {
      element.textContent = message;
      element.classList.toggle("is-error", error);
      element.setAttribute("role", error ? "alert" : "status");
      element.setAttribute("aria-live", error ? "assertive" : "polite");
      element.hidden = !message;
    }
  };
  const step = (i) =>
    document.querySelectorAll(".lse-steps li").forEach((n, index) => {
      if (index === i) n.setAttribute("aria-current", "step");
      else n.removeAttribute("aria-current");
    });
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const actionNames = {
    update_check: "Checking for a newer plugin version",
    update_install: "Updating the plugin",
    check: "Checking the WordPress connection",
    start: "Preparing new draft pages",
    asset: "Importing a file",
    page: "Saving a converted draft",
    assets: "Importing files",
    asset_lookup: "Checking reusable files",
    media_process: "Generating image sizes",
    media_skip: "Skipping one image size",
    finish: "Finishing the draft import",
    status: "Checking saved progress",
    undo: "Removing unchanged imported drafts",
    activate: "Applying optional homepage/menu settings",
    restore: "Restoring homepage/menu settings",
  };
  function responseData(res, text, details) {
    const clean = text.replace(/^\uFEFF/, "").trim();
    let data;
    try {
      data = JSON.parse(clean);
    } catch {}
    // Accept a complete JSON confirmation after non-fatal PHP notices, never a login/block page.
    if (data === undefined) {
      const marker = clean.search(/\{\s*"success"\s*:/);
      const prefix = marker > 0 ? clean.slice(0, marker) : "";
      if (
        marker > 0 &&
        /\b(?:Warning|Notice|Deprecated|Strict Standards)\b/i.test(prefix) &&
        !/<(?:html|form)\b|fatal error/i.test(prefix)
      ) {
        try {
          data = JSON.parse(clean.slice(marker));
          details.serverNotice = true;
        } catch {}
      }
    }
    if (
      res.ok &&
      data &&
      typeof data === "object" &&
      data.success === true &&
      Object.hasOwn(data, "data")
    )
      return data.data;
    let message;
    if (data && typeof data === "object" && data.success === false) {
      message =
        typeof data.data?.message === "string"
          ? data.data.message
          : typeof data.data === "string"
            ? data.data
            : "";
    } else if (
      data &&
      typeof data.code === "string" &&
      typeof data.message === "string"
    )
      message = data.message;
    if (!message) {
      if (
        clean === "-1" ||
        res.status === 401 ||
        /wp-login\.php|id=["']loginform["']/i.test(clean)
      )
        message =
          "Your WordPress login expired. Reload the converter page and sign in if needed.";
      else if (clean === "0")
        message =
          "WordPress did not recognise the import request. Reload the page and check that this plugin is active and you are signed in.";
      else if (res.status === 413)
        message =
          "The hosting server rejected the request because it is too large. Check the server request/upload limits.";
      else if (res.status === 403 && details.challenge)
        message =
          details.challenge +
          " interrupted the request. Saved drafts are kept.";
      else if (res.status === 403)
        message =
          "The server refused this request without giving LS Elementor a reason. Saved drafts are kept.";
      else if (res.status >= 500)
        message =
          "WordPress or the hosting server could not complete this request. Check the PHP/server error log; some draft progress may already be saved.";
      else if (!clean)
        message =
          "WordPress returned an empty response. Check saved import progress before retrying.";
      else if (/<!doctype|<html|<body|<form|<br\b/i.test(clean))
        message =
          "WordPress returned an HTML page instead of the import confirmation. Check saved progress and the server/security log.";
      else
        message =
          "WordPress returned an invalid import confirmation. Check saved progress before retrying.";
    }
    const error = Error(
      (actionNames[details.action] || "WordPress request") +
        ": " +
        message +
        " (HTTP " +
        res.status +
        ").",
    );
    // A generic refusal from the HTTP layer carries no file-level diagnosis.
    error.uploadRefused =
      !details.converterHandler &&
      !details.challenge &&
      !data?.message &&
      !data?.data?.message &&
      clean !== "-1" &&
      clean !== "0" &&
      !/wp-login\.php|id=["']loginform["']/i.test(clean) &&
      [403, 413, 415, 422, 502, 503, 504].includes(res.status);
    error.lseMessage = message;
    error.lseDetails = {
      ...details,
      refusal:
        res.status !== 403
          ? ""
          : details.challenge ||
            (clean === "-1" || data?.code === "rest_cookie_invalid_nonce"
              ? "WordPress session check failed"
              : details.converterHandler
                ? "Refused by LS Elementor in WordPress"
                : /^rest_[a-z_]+$/.test(data?.code || "")
                  ? "Refused by the WordPress REST API"
                  : "Unidentified HTTP refusal; correlate this UTC time and request ID with the hosting access log"),
      error: data?.data?.error || (data?.code ? { code: data.code } : null),
      responseKind:
        data === undefined ? (/<[^>]+>/.test(clean) ? "html" : "text") : "json",
    };
    throw error;
  }
  async function request(action, payload, file) {
    if (action === "prepare")
      payload = { converter_version: config.conversionVersion, ...payload };
    if (action === "stage_page") payload = { ...payload, stage_only: true };
    const requestStarted = performance.now();
    const encoded = JSON.stringify(payload),
      bytes = new TextEncoder().encode(encoded).length;
    const files = Array.isArray(file) ? file : file ? [file] : [];
    const pageUpload =
      ["page", "stage_page"].includes(action) &&
      ["json-file-v1", "json-gzip-v1"].includes(config.pageTransport);
    let upload = pageUpload
        ? new Blob([encoded], { type: "application/json" })
        : null,
      compressed = false;
    if (
      pageUpload &&
      config.pageTransport === "json-gzip-v1" &&
      typeof CompressionStream === "function"
    ) {
      upload = await new Response(
        upload.stream().pipeThrough(new CompressionStream("gzip")),
      ).blob();
      compressed = true;
    }
    const transferBytes = upload?.size || bytes;
    const fileBytes = files.reduce((n, f) => n + f.size, 0);
    const limitError = (message, code, limit) => {
      const error = Error(message);
      error.lseDetails = {
        action,
        transport: pageUpload
          ? compressed
            ? "gzip-file"
            : "json-file"
          : "form-field",
        requestBytes: bytes,
        transferBytes,
        fileBytes,
        fileCount: files.length,
        error: {
          code,
          limit,
          recoverable: action === "asset",
          skip: action === "asset" ? { kind: "asset", url: payload.url } : null,
        },
      };
      return error;
    };
    if (config.maxPost && transferBytes + fileBytes + 16384 > config.maxPost)
      throw limitError(
        "This request exceeds the server post_max_size limit. Increase it or skip the affected file.",
        "host_post_limit",
        config.maxPost,
      );
    if (
      config.maxUpload &&
      ((pageUpload && transferBytes > config.maxUpload) ||
        files.some((f) => f.size > config.maxUpload))
    )
      throw limitError(
        "The file exceeds the hosting upload limit. Increase it or skip this file.",
        "host_upload_limit",
        config.maxUpload,
      );
    const form = new FormData();
    form.set("action", "lse_" + action);
    form.set("nonce", config.nonce);
    if (pageUpload)
      form.set(
        "payload_file",
        upload,
        compressed ? "converted-page.json.gz" : "converted-page.json",
      );
    else form.set("payload", encoded);
    if (Array.isArray(file))
      files.forEach((item, index) =>
        form.set("file_" + index, item, item.name),
      );
    else if (file) form.set("file", file, file.name);
    const controller = new AbortController(),
      timeout = {
        check: 30000,
        status: 30000,
        background_status: 30000,
        update_check: 55000,
      }[action],
      timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    let details = {
      action,
      httpStatus: 0,
      contentType: "",
      redirected: false,
      transport: pageUpload
        ? compressed
          ? "gzip-file"
          : "json-file"
        : "form-field",
      requestBytes: bytes,
      transferBytes,
      fileBytes: fileBytes + (upload?.size || 0),
      fileCount: files.length + (pageUpload ? 1 : 0),
    };
    try {
      const target =
        pageUpload && config.pageRest ? config.pageRest : config.ajax;
      let res = await fetch(target, {
        method: "POST",
        credentials: "same-origin",
        headers:
          target === config.pageRest ? { "X-WP-Nonce": config.restNonce } : {},
        body: form,
        signal: controller.signal,
      });
      if (
        target === config.pageRest &&
        [403, 404, 405].includes(res.status) &&
        res.headers.get("cf-mitigated") !== "challenge" &&
        res.headers.get("x-little-studio-handler") !== "converter"
      ) {
        const failure = await res
          .clone()
          .json()
          .catch(() => null);
        if (!failure || failure.code === "rest_no_route") {
          details.restFallback = res.status;
          res = await fetch(config.ajax, {
            method: "POST",
            credentials: "same-origin",
            body: form,
            signal: controller.signal,
          });
        }
      }
      details = {
        ...details,
        durationMs: Math.round(performance.now() - requestStarted),
        httpStatus: res.status,
        endpoint:
          pageUpload && config.pageRest && !details.restFallback
            ? "WordPress REST"
            : "admin-ajax.php",
        contentType: res.headers.get("content-type") || "",
        redirected: res.redirected,
        challenge:
          res.headers.get("cf-mitigated") === "challenge"
            ? "Cloudflare challenge"
            : "",
        requestId:
          res.headers.get("x-request-id") || res.headers.get("cf-ray") || "",
        converterHandler:
          res.headers.get("x-little-studio-handler") === "converter",
        serverOutputCleaned:
          res.headers.get("x-little-studio-output-cleaned") === "1",
      };
      return responseData(res, await res.text(), details);
    } catch (cause) {
      if (cause.lseDetails) throw cause;
      const label = actionNames[action] || "WordPress request";
      let message = cause.message;
      if (cause.name === "AbortError")
        message =
          label +
          ": confirmation timed out. Check saved import progress before retrying.";
      else if (cause instanceof TypeError)
        message =
          label +
          ": the connection to WordPress failed. Reload the page and check your connection and WordPress address.";
      const error = new Error(message, { cause });
      error.lseDetails = {
        ...details,
        durationMs: Math.round(performance.now() - requestStarted),
      };
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  const journal = window.LSEReports.journal(config, (id, events) =>
    request("import_diagnostics", { job: id, events }),
  );
  function recordError(error, phase) {
    lastError = {
      plugin: "Little Studio to Elementor",
      version: config.version || "0.2.0",
      time: new Date().toISOString(),
      phase,
      sourceFile: originalFile,
      message: error.message,
      ...(error.lseDetails || {}),
    };
    if (!error.lseRecorded) {
      error.lseRecorded = true;
      journal.add(window.LSEReports.describe(lastError));
    }
    $("#lse-error-details").hidden = false;
  }
  async function decideFailure(error, context = {}, canSkip = false) {
    error.lseDetails = {
      ...(error.lseDetails || {}),
      item: context,
      job: job?.id,
    };
    recordError(error, $("#lse-current").textContent);
    const issue = error.lseDetails.error || {};
    $("#lse-error-item").hidden = false;
    $("#lse-error-item-title").textContent =
      context.name || context.title || "Import item";
    $("#lse-error-item-location").textContent = [
      issue.reason || error.lseMessage || error.message,
      issue.field,
      issue.selector,
      issue.line ? "Line " + issue.line + ", column " + issue.column : "",
      context.url,
    ]
      .filter(Boolean)
      .join(" · ");
    $("#lse-error-item-snippet").textContent = issue.snippet || "";
    $("#lse-error-item-effect").textContent = canSkip
      ? issue.skip?.kind === "css"
        ? "Skip removes only this flagged CSS item. Other styling stays. The omission is recorded for review."
        : "Skip leaves this file unimported and keeps its source reference. It is recorded for review and can be retried with Update from file."
      : "This failure cannot be isolated safely. Retry this request or pause; completed work is kept.";
    status(error.message, true);
    $("#lse-retry").hidden = false;
    if (canSkip && context.kind === "page" && issue.skip?.kind !== "css")
      $("#lse-error-item-effect").textContent =
        "Skip leaves this page at its last saved content. The other selected pages continue.";
    $("#lse-skip-item").textContent =
      context.kind === "asset"
        ? "Skip this file and continue"
        : context.kind === "page" && issue.skip?.kind !== "css"
          ? "Skip this page and continue"
          : "Skip this item and continue";
    $("#lse-skip-item").hidden = !canSkip;
    $("#lse-pause-import").hidden = false;
    $("#lse-retry").focus();
    const choice = await new Promise((resolve) => {
      failureChoice = resolve;
    });
    failureChoice = null;
    for (const id of [
      "#lse-error-item",
      "#lse-retry",
      "#lse-skip-item",
      "#lse-pause-import",
    ])
      $(id).hidden = true;
    journal.add(
      [
        choice === "skip"
          ? "Skip requested"
          : choice === "pause"
            ? "Paused"
            : "Retry requested",
        context.name || context.title || context.kind || "import request",
      ].join(" · "),
    );
    if (choice === "pause") throw error;
    status(
      choice === "skip"
        ? "Continuing with this item omitted…"
        : "Retrying this item…",
    );
    return choice;
  }
  async function recoverableRequest(action, payload, files, context) {
    const approved = [...(payload.skip_css || [])];
    for (;;) {
      try {
        return await request(
          action,
          { ...payload, ...(action === "page" ? { skip_css: approved } : {}) },
          files,
        );
      } catch (error) {
        const batch = action === "assets";
        const possibleFile =
          error.uploadRefused ||
          ["host_upload_limit", "host_post_limit"].includes(
            error.lseDetails?.error?.code,
          );
        if (
          (batch || ["asset", "page", "stage_page"].includes(action)) &&
          possibleFile
        ) {
          error.lseDetails.item = context;
          recordError(error, $("#lse-current").textContent);
          // An upload may have committed before its response was blocked.
          // Verify the same job and session before replaying or offering Skip.
          const saved = await request("status", { job: payload.job });
          if (saved.state !== "importing")
            throw Error(
              "The import is no longer accepting uploads. Check saved progress.",
            );
          if (batch) {
            journal.add("Trying this batch one file at a time.");
            return { individual: true };
          }
          if (["page", "stage_page"].includes(action)) {
            const page = saved.pages.find((p) => p.key === payload.key);
            if (page?.done)
              return { saved: true, key: page.key, stamp: page.stamp };
            if (!page) throw error;
            if ((await decideFailure(error, context, true)) === "skip")
              return skipPage(context, error);
            continue;
          }
          const existing = saved.assets.find(
            (item) => item.source === payload.url,
          );
          if (existing) {
            journal.add("Already saved · " + context.name);
            return existing;
          }
          error.lseDetails.error = {
            code: "single_upload_refused",
            recoverable: true,
            skip: { kind: "asset" },
          };
        }
        const issue = error.lseDetails?.error;
        const skipCSS = issue?.recoverable && issue.skip?.kind === "css";
        const skipAsset =
          action === "asset" &&
          issue?.recoverable &&
          issue.skip?.kind === "asset";
        const skipRejectedPage =
          ["page", "stage_page"].includes(action) &&
          issue?.stage === action &&
          issue.page_key === payload.key &&
          ["import_validation", "import_conflict", "server_error"].includes(
            issue.code,
          );
        const choice = await decideFailure(
          error,
          context,
          !!(skipCSS || skipAsset || skipRejectedPage),
        );
        if (choice === "skip") {
          if (skipCSS) approved.push(issue.skip.id);
          else if (skipRejectedPage) return skipPage(context, error);
          else {
            const decision = await request("skip_asset", {
              job: job.id,
              url: payload.url,
              name: context.name,
              reason: error.lseMessage || error.message,
            });
            if (decision.saved) return decision.saved;
            journal.add(
              "Skipped file · " +
                context.name +
                " · left its source reference in place.",
            );
            return null;
          }
        }
      }
    }
  }
  async function skipPage(context, error) {
    const result = await request("skip_page", {
      job: job.id,
      key: context.key,
      reason: error.lseMessage || error.message,
    });
    if (result.skipped) journal.add("Skipped page · " + context.title);
    return result;
  }
  function showMedia() {
    const media = job?.media;
    const visible =
      job?.state === "ready" &&
      media &&
      (media.pending || media.skipped?.length);
    $("#lse-media-status").hidden = !visible;
    if (!visible) return;
    const error = media.errors?.[0];
    $("#lse-media-status").setAttribute(
      "role",
      error || mediaPaused ? "alert" : "status",
    );
    $("#lse-media-details").hidden = !(error || mediaPaused);
    $("#lse-media-summary").textContent = media.pending
      ? "Pages ready · image sizes remaining for " + media.pending + " file(s)"
      : "Image processing complete with skipped sizes";
    $("#lse-media-message").textContent = error
      ? error.name +
        (error.size ? " · " + error.size : "") +
        ": " +
        error.message
      : mediaPaused
        ? "Image processing paused after a request failed. Retry to check saved progress. Original images remain available."
        : media.pending
          ? "Original images and pages are available. WordPress is creating the requested image sizes. This work resumes here and through WordPress background tasks."
          : media.skipped
              .map((x) => x.name + " · " + x.size + ": " + x.reason)
              .join("; ");
    $("#lse-media-retry").hidden = !(
      error ||
      mediaPaused ||
      media.skipped?.length
    );
    $("#lse-media-retry").disabled = mediaRunning || busy;
    $("#lse-media-retry").textContent =
      !media.pending && media.skipped?.length
        ? "Retry skipped image sizes"
        : "Retry image sizes";
    $("#lse-media-skip").hidden = !error?.skip;
    $("#lse-media-skip").disabled = mediaRunning || busy;
  }
  function scheduleMedia(delay = 1000) {
    clearTimeout(mediaTimer);
    showMedia();
    const ready = !busy && !mediaRunning && window.LSEReports.finalReady(job);
    $("#lse-final-report").hidden = !ready;
    $("#lse-report-details").hidden = !ready;
    if (
      !busy &&
      !mediaRunning &&
      !mediaPaused &&
      job?.state === "ready" &&
      job.media?.pending &&
      !job.media.errors?.length
    )
      mediaTimer = setTimeout(() => processMedia(), delay);
  }
  async function processMedia(retry = false) {
    if (busy || mediaRunning || !job || job.state !== "ready") return;
    const current = job,
      item = current.media?.items?.[0];
    mediaRunning = true;
    scheduleMedia();
    try {
      const response = await request("media_process", {
        job: current.id,
        ...(item ? { attachment: item.id } : {}),
        retry,
        restore_skipped: retry && !current.media?.pending,
      });
      if (job !== current) return;
      current.media = response.media;
      mediaPaused = false;
      const issue = response.media.errors?.[0];
      if (issue) {
        const error = Error(issue.message);
        error.lseDetails = {
          action: "media_process",
          job: current.id,
          item: { name: issue.name, attachment: issue.id, size: issue.size },
          error: issue,
        };
        recordError(error, "Generating WordPress image sizes");
      }
    } catch (error) {
      if (job !== current) return;
      mediaPaused = true;
      error.lseDetails = { ...(error.lseDetails || {}), job: current.id, item };
      recordError(error, "Generating WordPress image sizes");
    } finally {
      mediaRunning = false;
      scheduleMedia(1500);
    }
  }
  $("#lse-media-details").addEventListener("click", () => {
    const issue = job?.media?.errors?.[0];
    if (issue && !lastError) {
      const error = Error(issue.message);
      error.lseDetails = {
        action: "media_process",
        job: job.id,
        item: { name: issue.name, attachment: issue.id, size: issue.size },
        error: issue,
      };
      recordError(error, "Generating WordPress image sizes");
    }
    if (lastError) $("#lse-error-details").click();
  });
  $("#lse-media-retry").addEventListener("click", () => {
    mediaPaused = false;
    processMedia(true);
  });
  $("#lse-media-skip").addEventListener("click", async () => {
    const current = job,
      issue = current?.media?.errors?.[0];
    if (busy || mediaRunning || !issue?.skip) return;
    mediaRunning = true;
    scheduleMedia();
    try {
      const response = await request("media_skip", {
        job: current.id,
        attachment: issue.id,
        size: issue.skip.size,
        token: issue.skip.token,
      });
      if (job === current) {
        journal.add(
          "Skipped image size · " + issue.name + " · " + issue.skip.size,
        );
        current.media = response.media;
        mediaPaused = false;
      }
    } catch (error) {
      if (job === current) {
        mediaPaused = true;
        recordError(error, "Skipping one WordPress image size");
      }
    } finally {
      mediaRunning = false;
      scheduleMedia();
    }
  });
  function setBusy(value) {
    busy = value;
    scheduleMedia();
    for (const n of app.querySelectorAll(
      "#lse-review input,#lse-review select,#lse-review button,#lse-file",
    ))
      n.disabled = value || n.dataset.lseDisabled === "true";
    if (!config.canScripts) $("#lse-scripts").disabled = true;
    window.onbeforeunload = value ? () => true : null;
    window.dispatchEvent(new Event("lse:busy-changed"));
  }
  function selected() {
    const keys = new Set(
      [...document.querySelectorAll("[data-page-key]:checked")].map(
        (n) => n.dataset.pageKey,
      ),
    );
    const chosen = project.pages
        .filter((p) => keys.has(p.key))
        .map((p) => ({ ...p })),
      all = new Map(project.pages.map((p) => [p.key, p]));
    for (const p of chosen) {
      let parent = p.parent_key;
      while (parent && !keys.has(parent))
        parent = all.get(parent)?.parent_key || "";
      p.parent_key = parent;
    }
    const navigation = (items) =>
      items.flatMap((item) => {
        const children = navigation(item.children || []);
        if (keys.has(item.key)) return [{ ...item, children }];
        if (item.url) {
          return [{ ...item, children }];
        }
        return children;
      });
    return {
      ...project,
      title: $("#lse-name").value.trim() || project.title || "Imported website",
      pages: chosen,
      site: {
        home_key: keys.has(project.site.home_key) ? project.site.home_key : "",
        navigation: navigation(project.site.navigation),
      },
    };
  }
  function refreshSelect() {
    const nodes = [...document.querySelectorAll("[data-page-key]")];
    const checked = nodes.filter((x) => x.checked).length;
    $("#lse-import-background").disabled = $("#lse-import").disabled =
      !checked || !config.elementor || busy;
    $("#lse-all").checked = checked === nodes.length;
    $("#lse-all").indeterminate = checked > 0 && checked < nodes.length;
  }
  async function digest(value) {
    return [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          typeof value === "string" ? new TextEncoder().encode(value) : value,
        ),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  async function capturedFingerprint(project) {
    const { pages, assets, ...metadata } = project;
    const sections = [
      await digest(JSON.stringify([metadata, pages.length, assets.length])),
    ];
    const pause = M.browserTimeSlice();
    for (const entry of [...pages, ...assets]) {
      const turn = pause();
      if (turn) await turn;
      sections.push(
        await digest(JSON.stringify(await M.readCapturePage(entry))),
      );
    }
    return digest(sections.join(""));
  }
  async function choose(file, prepared = null, { showReview = true } = {}) {
    if (
      busy ||
      window.LSEManage?.busy ||
      (!prepared && window.LSECapture?.busy) ||
      !file
    )
      return;
    setBusy(true);
    selectionStarted = true;
    operationId =
      new URLSearchParams(location.search).get("lse-render-task") ||
      crypto.randomUUID();
    journal.reset(operationId);
    originalFile = file.name || "";
    if (!prepared)
      window.LSEReports.checkpoint({
        phase: "Reading the selected file",
        title: originalFile,
      });
    job = null;
    mediaPaused = false;
    scheduleMedia();
    pendingFingerprint = "";
    ((lastError = null), (failureChoice = null));
    $("#lse-error-details").hidden = true;
    $("#lse-check").hidden = true;
    try {
      if (file.length !== undefined && !file.name) {
        const files = [...file];
        if (files.length === 1) file = files[0];
        else {
          const entries = await Promise.all(
            files.map(async (f) => ({
              name: f.name,
              data: JSON.parse((await f.text()).replace(/^\uFEFF/, "")),
            })),
          );
          prepared = M.validate(window.LSENative.fromTemplates(entries));
          file = { name: "elementor-page.json" };
        }
      }
      if (!/\.(json|html?)$/i.test(file.name))
        throw Error("Choose one .json, .html or .htm file.");
      status("Reading and checking your website…");
      if (!prepared)
        window.LSEReports.checkpoint({
          phase: "Reading and checking the selected file",
          title: file.name,
        });
      const text = prepared ? "" : await file.text();
      project =
        prepared ||
        (/\.html?$/i.test(file.name)
          ? M.fromHTML(text, file.name)
          : M.validate(JSON.parse(text.replace(/^\uFEFF/, ""))));
      const pause = M.browserTimeSlice();
      for (const page of project.pages) {
        const turn = pause();
        if (turn) await turn;
        if (page.elementor) window.LSENative.requireWidgets(page.elementor);
      }
      fingerprint = prepared
        ? await capturedFingerprint(project)
        : await digest(text);
      originalFile = file.name;
      // Older native exports can omit navigation; recover known internal links, without inventing pages.
      if (!project.site.navigation.length) {
        const d = new DOMParser().parseFromString(
          project.pages[0].html,
          "text/html",
        );
        const seen = new Set();
        for (const a of d.querySelectorAll("nav a[href]")) {
          const href = a.getAttribute("href");
          let found = project.pages.find((p) => p.url === href);
          try {
            const url = new URL(
              href,
              project.pages[0].url || "https://little-studio.invalid/",
            );
            found =
              found ||
              project.pages.find((p) => {
                try {
                  return new URL(p.url).pathname === url.pathname;
                } catch {
                  return false;
                }
              });
          } catch {}
          if (found && !seen.has(found.key) && a.textContent.trim()) {
            project.site.navigation.push({
              key: found.key,
              label: a.textContent.trim().slice(0, 150),
            });
            seen.add(found.key);
          }
        }
      }
      $("#lse-name").value = project.title || file.name.replace(/\.json$/i, "");
      $("#lse-summary").innerHTML = [
        project.pages.length + " pages",
        project.assets.length + " packaged files",
        project.fonts.length + " fonts",
        (
          project.assets.reduce((n, a) => n + a.byteLength, 0) / 1048576
        ).toFixed(1) + " MB of assets",
      ]
        .map((x) => "<span>" + esc(x) + "</span>")
        .join("");
      const findings = new Set(
        Array.isArray(project.capture?.warnings)
          ? project.capture.warnings.filter(
              (warning) => typeof warning === "string",
            )
          : [],
      );
      const rows = [];
      for (const p of project.pages) {
        const turn = pause();
        if (turn) await turn;
        const x = M.inspect(p);
        for (const warning of x.warnings) findings.add(warning);
        rows.push(
          '<tr><td><input type="checkbox" checked data-page-key="' +
            esc(p.key) +
            '" aria-label="Import ' +
            esc(p.title) +
            '"></td><td><strong>' +
            esc(p.title) +
            "</strong><small>" +
            x.headings +
            " headings · " +
            x.images +
            " images</small></td><td><small>" +
            esc(p.slug || p.key) +
            '</small></td><td><span class="lse-badge ' +
            (x.warnings.length ? "review" : "") +
            '">' +
            (x.warnings.length ? "Needs setup" : "Ready") +
            "</span></td></tr>",
        );
      }
      $("#lse-pages").innerHTML = rows.join("");
      if (
        project.pages.some((p) => p.captureScripts || p.js.trim()) &&
        !config.canScripts
      )
        findings.add(
          "An administrator with script permission must import the interactive pages.",
        );
      $("#lse-setup").hidden = !findings.size;
      $("#lse-findings").innerHTML = window.LSEReports.render([...findings]);
      const hasScripts = project.pages.some(
        (p) => p.captureScripts || p.js.trim() || /<script/i.test(p.html),
      );
      const converted = project.pages.some((p) => p.conversion);
      $("#lse-scripts").checked = hasScripts && config.canScripts && !converted;
      $("#lse-scripts").closest("label").hidden = !hasScripts;
      $("#lse-css").closest("label").hidden = converted;
      $("#lse-layout").closest("label").hidden = converted;
      $("#lse-review").hidden = false;
      $("#lse-choose").hidden = true;
      $("#lse-progress").hidden = true;
      step(1);
      refreshSelect();
      status("Website checked. Review the pages before continuing.");
      if (showReview) window.dispatchEvent(new Event("lse:file-selected"));
    } catch (e) {
      project = null;
      $("#lse-file").value = "";
      recordError(e, "Reading import file");
      window.dispatchEvent(new Event("lse:file-error"));
      status(e.message || "The file could not be read.", true);
    } finally {
      setBusy(false);
      if (project) refreshSelect();
    }
  }
  function result(data) {
    job = data;
    journal.attach(data);
    mediaPaused = false;
    scheduleMedia();
    $("#lse-choose").hidden = true;
    $("#lse-progress").hidden = true;
    $("#lse-review").hidden = true;
    window.dispatchEvent(new CustomEvent("lse:import-saved", { detail: data }));
    status(
      data.state === "ready"
        ? data.media?.pending
          ? "Pages saved. The final report will be available when image processing finishes."
          : data.pages?.some((p) => p.skipped) ||
              Object.keys(data.skipped_assets || {}).length ||
              data.capture?.complete === false
            ? "Import finished with items to review in the final report."
            : data.refreshing
              ? "Pages updated."
              : "Imported. Your pages are ready to edit."
        : "Import progress loaded.",
    );
  }
  function confirmReplacement(count) {
    const dialog = $("#lse-replace-dialog");
    $("#lse-replace-count").textContent = String(count);
    dialog.returnValue = "";
    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => resolve(dialog.returnValue === "replace"),
        { once: true },
      );
      dialog.showModal();
    });
  }
  async function run({ background = false, recovery = null } = {}) {
    if (busy || !project) return;
    lastRun = { background, recovery };
    const audience =
      recovery?.newsletterAudience ||
      $("#lse-newsletter-audience")?.value.trim() ||
      "";
    const source = selected();
    if (!source.pages.length) return;
    const target = recovery?.target || window.LSEManage?.target;
    const converted = source.pages.some((page) => page.conversion);
    const layout = converted ? "elementor_canvas" : $("#lse-layout").value;
    const preserveCSS = converted || $("#lse-css").checked;
    if (converted && target && target.layout !== layout) {
      status(
        "This website export uses the standalone layout. Import it as a new website to keep the converted layout.",
        true,
      );
      return;
    }
    if (
      !recovery &&
      target &&
      $("#lse-overwrite").checked &&
      !(await confirmReplacement(source.pages.length))
    )
      return;
    setBusy(true);
    $("#lse-progress").hidden = false;
    $("#lse-review").hidden = true;
    for (const id of [
      "lse-error-item",
      "lse-retry",
      "lse-skip-item",
      "lse-pause-import",
      "lse-cancel",
    ])
      document.getElementById(id).hidden = true;
    step(2);
    window.dispatchEvent(new Event("lse:import-started"));
    let resources = null,
      currentItem = null,
      localRecovery = false;
    const progress = (n, message) => {
      window.LSEReports.checkpoint({
        phase: message,
        title: source.title,
        source: source.capture?.source,
        job: job?.id,
      });
      $("#lse-meter").value = n;
      $("#lse-current").textContent = message;
      status(message);
    };
    try {
      progress(1, "Preparing your website drafts…");
      const optionKey =
        fingerprint +
        ":" +
        (config.conversionVersion || "legacy") +
        ":" +
        source.title +
        ":" +
        source.pages.map((p) => p.key).join(",") +
        ":" +
        layout +
        ":" +
        preserveCSS +
        ":" +
        $("#lse-scripts").checked +
        ":" +
        (target?.id || "new") +
        (audience ? ":audience:" + audience : "");
      const importIdentity = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(optionKey),
          ),
        ),
      ]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      pendingFingerprint = importIdentity;
      $("#lse-check").hidden = true;
      progress(1, "Preparing your protected WordPress drafts…");
      job = recovery
        ? await request("resume_prepared", {
            job: recovery.id,
            fingerprint: importIdentity,
          })
        : await request("prepare", {
            fingerprint: importIdentity,
            operation_id: operationId,
            site_id: source.site_id,
            target_job: target?.id || "",
            newsletter_audience: audience,
            expected_stamps: target
              ? Object.fromEntries(
                  target.pages.map((p) => [p.key, p.current_stamp]),
                )
              : {},
            overwrite: $("#lse-overwrite").checked,
            title: source.title,
            pages: source.pages.map(
              ({ key, title, slug, url, url_aliases, parent_key }) => ({
                key,
                title,
                slug,
                url,
                url_aliases,
                parent_key,
              }),
            ),
            site: source.site,
            capture: source.capture
              ? {
                  source: source.capture.source,
                  complete: source.capture.complete !== false,
                  failed_resources: source.capture.failed_resources || [],
                  warnings: source.capture.warnings || [],
                }
              : null,
            layout,
            preserve_css: preserveCSS,
            scripts: $("#lse-scripts").checked,
          });
      journal.attach(job, true);
      if (job.state === "ready" || job.background?.phase) {
        result(job);
        return;
      }
      if (
        job.state === "interrupted" ||
        (!target && job.pages.length !== source.pages.length) ||
        job.pages.some((p) => !p.url || !p.edit_url)
      )
        throw Error(
          "Draft preparation stopped early. Remove this import’s unchanged drafts before starting it again.",
        );
      if (!recovery) {
        progress(2, "Saving a browser recovery copy…");
        try {
          await window.LSERecovery.save(job.id, project, {
            id: job.id,
            title: source.title,
            name: originalFile,
            fingerprint,
            keys: source.pages.map((page) => page.key),
            target: target && { id: target.id, layout: target.layout },
            layout,
            preserveCSS,
            scripts: $("#lse-scripts").checked,
            background,
            newsletterAudience: audience,
          });
          localRecovery = true;
        } catch {}
      } else {
        localRecovery = true;
      }
      progress(3, "Reading page image labels and fonts…");
      const imageAlt = new Map(),
        fontFamilies = new Map();
      const pause = M.browserTimeSlice();
      for (const page of source.pages) {
        const turn = pause();
        if (turn) await turn;
        const doc = new DOMParser().parseFromString(page.html, "text/html");
        for (const img of doc.images)
          if (!imageAlt.has(img.getAttribute("src")))
            imageAlt.set(
              img.getAttribute("src"),
              img.getAttribute("alt") || "",
            );
      }
      for (const font of source.fonts) {
        if (!fontFamilies.has(font.url)) fontFamilies.set(font.url, []);
        fontFamilies.get(font.url).push(font.family);
      }
      const uploadName = (asset) => {
        if (
          !/^(?:(?:(?:captured|embedded)-)?(?:[a-f0-9]{16,64}|[0-9]+)|(?:img|dsc|image|photo|picture|asset)[-_ .\d]+)\.[a-z0-9]+$/i.test(
            asset.name,
          )
        )
          return asset.name;
        const extension = asset.name.split(".").pop();
        const label =
          (
            imageAlt.get(asset.url) ||
            fontFamilies.get(asset.url)?.[0] ||
            source.title + " " + asset.type.split("/")[0]
          )
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 76)
            .replace(/-+$/, "") || "website-media";
        return label + "." + extension;
      };
      // Match existing Library files before sending their bytes over the network.
      const knownURLs = new Set(job.assets.map((asset) => asset.source));
      const skipped = new Set(Object.keys(job.skipped_assets || {}));
      const checks = source.assets.filter(
        (asset) => !knownURLs.has(asset.url) && !skipped.has(asset.url),
      );
      for (let offset = 0; offset < checks.length; offset += 128) {
        progress(
          4,
          "Checking existing files " +
            (offset + 1) +
            "–" +
            Math.min(offset + 128, checks.length) +
            " of " +
            checks.length +
            "…",
        );
        const assets = [];
        for (const asset of checks.slice(offset, offset + 128)) {
          assets.push({
            url: asset.url,
            type: asset.type,
            name: uploadName(asset),
            hash: await digest(asset.bytes),
            families: fontFamilies.get(asset.url) || [],
          });
        }
        const reused = await request("asset_lookup", { job: job.id, assets });
        for (const saved of reused.assets) {
          job.map[saved.source] = saved.url;
          job.assets.push(saved);
          knownURLs.add(saved.source);
        }
      }
      const savedURLs = new Set(job.assets.map((asset) => asset.source));
      const pendingAssets = source.assets.filter(
        (asset) => !savedURLs.has(asset.url) && !skipped.has(asset.url),
      );
      let maxBatch = Math.max(1, config.mediaBatchSize || 4);
      let uploaded = 0,
        uploadBatchSize = maxBatch,
        millisecondsPerAsset = 0;
      const batchLimit = Math.max(
        1,
        Math.min(4 * 1048576, (config.maxPost || Infinity) - 16384),
      );
      const inputsByURL = new Map(
        pendingAssets.map((asset) => [
          asset.url,
          {
            url: asset.url,
            families: fontFamilies.get(asset.url) || [],
            alt: imageAlt.get(asset.url) || "",
          },
        ]),
      );
      const metadataBytes = new Map(
        [...inputsByURL].map(([url, input]) => [
          url,
          new TextEncoder().encode(JSON.stringify(input)).length,
        ]),
      );
      for (let i = 0; i < pendingAssets.length; ) {
        const group = [];
        let size = 0,
          metadata = 128;
        while (i < pendingAssets.length && group.length < uploadBatchSize) {
          const asset = pendingAssets[i],
            nextMetadata = metadata + metadataBytes.get(asset.url) + 1;
          if (
            group.length &&
            (size + asset.byteLength > batchLimit ||
              (config.maxPost &&
                size + asset.byteLength + nextMetadata + 16384 >
                  config.maxPost))
          )
            break;
          group.push(asset);
          size += asset.byteLength;
          metadata = nextMetadata;
          i++;
          if (size > batchLimit) break;
        }
        progress(
          5 + (35 * uploaded) / Math.max(1, pendingAssets.length),
          "Importing files " +
            (uploaded + 1) +
            "–" +
            (uploaded + group.length) +
            " of " +
            pendingAssets.length +
            "…",
        );
        const inputs = group.map((asset) => inputsByURL.get(asset.url));
        const files = group.map(
          (asset) =>
            new File([asset.bytes], uploadName(asset), { type: asset.type }),
        );
        let completed = 1,
          savedAssets = [];
        if (group.length === 1)
          savedAssets = [
            await recoverableRequest(
              "asset",
              { job: job.id, ...inputs[0] },
              files[0],
              { kind: "asset", name: group[0].name, url: group[0].url },
            ),
          ];
        else {
          const response = await recoverableRequest(
            "assets",
            { job: job.id, assets: inputs },
            files,
            {
              kind: "media-batch",
              name: group.map((asset) => asset.name).join(", "),
            },
          );
          if (response.individual) {
            i -= group.length;
            uploadBatchSize = maxBatch = 1;
            continue;
          }
          savedAssets = response.assets || [];
          completed = response.assets?.length || 0;
          if (response.failure) {
            const failedIndex = savedAssets.length;
            const batchError = Error(response.failure.message);
            batchError.lseDetails = {
              action: "assets",
              error: response.failure.error,
              item: { name: group[failedIndex].name },
            };
            recordError(
              batchError,
              "Batch reported a file failure; trying that file separately",
            );
            const saved = await recoverableRequest(
              "asset",
              { job: job.id, ...inputs[failedIndex] },
              files[failedIndex],
              {
                kind: "asset",
                name: group[failedIndex].name,
                url: group[failedIndex].url,
              },
            );
            savedAssets.push(saved);
            completed++;
          }
          if (completed < 1 || completed > group.length)
            throw Error(
              "Media batch progress was not confirmed. Retry the saved import.",
            );
        }
        savedAssets = savedAssets.filter(Boolean);
        const timings = savedAssets
          .map((asset) => asset.processing_ms)
          .filter(Number.isFinite);
        if (timings.length) {
          const average =
            timings.reduce((sum, ms) => sum + ms, 0) / timings.length;
          millisecondsPerAsset = millisecondsPerAsset
            ? 0.5 * millisecondsPerAsset + 0.5 * average
            : average;
          // A normal photo taking 500ms should allow a ~3s batch, not remain stuck at one.
          uploadBatchSize = Math.max(
            1,
            Math.min(
              maxBatch,
              Math.floor(
                (config.mediaBatchMilliseconds || 3000) /
                  Math.max(1, millisecondsPerAsset),
              ),
            ),
          );
        } else if (completed < group.length)
          uploadBatchSize = Math.max(1, completed);
        for (const saved of savedAssets) {
          job.map[saved.source] = saved.url;
          if (!savedURLs.has(saved.source)) {
            job.assets.push(saved);
            savedURLs.add(saved.source);
          }
        }
        i -= group.length - completed;
        uploaded += completed;
      }
      const pendingPages = source.pages.filter(
        (page) =>
          (!background || !job.staged_pages?.includes(page.key)) &&
          !job.pages.some((p) => p.key === page.key && (p.done || p.skipped)),
      );
      // Shared site templates use the homepage design when it is selected.
      const homeIndex = pendingPages.findIndex(
        (page) => page.key === source.site.home_key,
      );
      if (homeIndex > 0)
        pendingPages.unshift(...pendingPages.splice(homeIndex, 1));
      if (pendingPages.some((page) => !page.elementor))
        resources = M.resourceSession(source, job.map);
      const prepare = (page) =>
        M.convert(source, page, {
          map: job.map,
          layout: job.layout,
          preserveCSS,
          resources,
        }).then(
          (value) =>
            value.emptyBody
              ? {
                  error: new Error(
                    "The source contains no editable page body. Skip this page to continue the import.",
                  ),
                }
              : { value },
          (error) => ({ error }),
        );
      let prepared = pendingPages.length ? prepare(pendingPages[0]) : null;
      for (let i = 0; i < pendingPages.length; i++) {
        const page = pendingPages[i];
        currentItem = {
          kind: "page",
          key: page.key,
          title: page.title,
          url: page.url,
        };
        progress(
          40 + (55 * i) / Math.max(1, pendingPages.length),
          (background
            ? "Preparing page for background import "
            : page.conversion
              ? "Saving Elementor page "
              : "Converting and saving page ") +
            (i + 1) +
            " of " +
            pendingPages.length +
            ": " +
            page.title,
        );
        let converted = await prepared;
        while (converted.error) {
          const choice = await decideFailure(
            converted.error,
            currentItem,
            true,
          );
          if (choice === "skip") {
            const decision = await skipPage(currentItem, converted.error);
            const entry = job.pages.find((p) => p.key === page.key);
            if (decision.saved) {
              entry.done = true;
              entry.stamp = decision.stamp;
            } else entry.skipped = true;
            break;
          }
          converted = await prepare(page);
        }
        if (converted.error) {
          prepared =
            i + 1 < pendingPages.length ? prepare(pendingPages[i + 1]) : null;
          continue;
        }
        const payload = {
          job: job.id,
          key: page.key,
          ...converted.value,
          compact: true,
        };
        const saving = background
          ? recoverableRequest("stage_page", payload, undefined, currentItem)
          : recoverableRequest("page", payload, undefined, currentItem);
        prepared =
          i + 1 < pendingPages.length ? prepare(pendingPages[i + 1]) : null;
        const saved = await saving;
        if (saved.skipped && saved.key === page.key) {
          job.pages.find((p) => p.key === page.key).skipped = true;
          continue;
        }
        if (background && saved.staged && saved.key === page.key) continue;
        if (!saved.saved || saved.key !== page.key)
          throw Error(
            "The page save was not confirmed. Check saved progress before retrying.",
          );
        const entry = job.pages.find((p) => p.key === page.key);
        entry.done = true;
        entry.stamp = saved.stamp;
      }
      if (background) {
        await request("background_start", { job: job.id });
        job = await request("status", { job: job.id });
        if (localRecovery) void window.LSERecovery.remove(job.id);
        result(job);
        return;
      }
      progress(
        98,
        "Checking pages and preparing shared sections and navigation…",
      );
      do {
        job = await request("finish", { job: job.id, compact: true });
      } while (job.state === "finishing");
      progress(
        100,
        job.media?.pending
          ? "Pages saved; image sizes are processing."
          : "Website import complete.",
      );
      void window.LSERecovery.remove(job.id);
      result(job);
    } catch (e) {
      const phase = $("#lse-current").textContent;
      e.lseDetails = {
        ...(e.lseDetails || {}),
        item: e.lseDetails?.item || currentItem,
        job: job?.id,
      };
      recordError(e, phase);
      window.LSEReports.checkpoint({
        phase: phase + " · " + e.message,
        title: source.title,
        source: source.capture?.source,
        job: job?.id,
      });
      $("#lse-skip-item").hidden = true;
      $("#lse-pause-import").hidden = true;
      $("#lse-retry").hidden = false;
      $("#lse-cancel").hidden = !job;
      $("#lse-check").hidden = !pendingFingerprint;
      status(e.message, true);
      $("#lse-current").textContent =
        "Import paused. Check saved progress before continuing. Completed drafts and uploaded files are kept.";
    } finally {
      resources?.dispose();
      setBusy(false);
    }
  }
  $("#lse-file").addEventListener("change", (e) => choose(e.target.files));
  const drop = $(".lse-drop");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("is-over");
    choose(e.dataTransfer.files);
  });
  $("#lse-all").addEventListener("change", (e) => {
    document
      .querySelectorAll("[data-page-key]:not(:disabled)")
      .forEach((n) => (n.checked = e.target.checked));
    refreshSelect();
  });
  $("#lse-pages").addEventListener("change", refreshSelect);
  $("#lse-import").addEventListener("click", () => run());
  $("#lse-import-background").addEventListener("click", () =>
    run({ background: true }),
  );
  $("#lse-retry").addEventListener("click", () =>
    failureChoice ? failureChoice("retry") : run(lastRun),
  );
  $("#lse-skip-item").addEventListener("click", () => failureChoice?.("skip"));
  $("#lse-pause-import").addEventListener("click", () =>
    failureChoice?.("pause"),
  );
  $("#lse-reset").addEventListener("click", () => {
    if (busy) return;
    project = null;
    $("#lse-file").value = "";
    $("#lse-review").hidden = true;
    $("#lse-choose").hidden = false;
    step(0);
    status("Choose a JSON or HTML file.");
    window.dispatchEvent(new Event("lse:choose-reset"));
  });
  async function copyReport(button, report) {
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      const container = button.closest("dialog") || app;
      let area = container.querySelector("textarea[data-lse-report-text]");
      if (!area) {
        area = document.createElement("textarea");
        area.readOnly = true;
        area.rows = 8;
        area.className = "large-text";
        area.dataset.lseReportText = "";
        area.setAttribute("aria-label", "Import report");
        button.after(area);
      }
      area.value = report;
      area.focus();
      area.select();
      if (!document.execCommand("copy")) return;
      area.remove();
    }
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy report";
    }, 1500);
  }
  const reportButton = $("[data-lse-copy-report]");
  reportButton.addEventListener("click", () => {
    if (!$("#lse-final-report").hidden)
      copyReport(reportButton, journal.report(job, project, originalFile));
  });
  $("#lse-download").addEventListener("click", () => {
    if ($("#lse-final-report").hidden) return;
    const blob = new Blob([journal.report(job, project, originalFile)], {
        type: "text/plain;charset=utf-8",
      }),
      a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "little-studio-elementor-report.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#lse-cancel").addEventListener("click", () =>
    window.LSEManage?.remove(job),
  );
  $("#lse-check").addEventListener("click", async () => {
    const feedback = (message, error = false) => {
      $("#lse-current").textContent = message;
      status(message, error);
    };
    if (busy) {
      feedback(
        "An import request is still running. Wait for it to finish before checking saved progress.",
      );
      return;
    }
    if (!pendingFingerprint && !job?.id) {
      feedback(
        "Choose the same JSON file and options first so saved progress can be matched.",
      );
      return;
    }
    const button = $("#lse-check"),
      label = button.textContent;
    button.disabled = true;
    button.textContent = "Checking saved progress…";
    feedback("Checking saved import progress…");
    try {
      job = pendingFingerprint
        ? (await request("check", { fingerprint: pendingFingerprint })).import
        : await request("status", { job: job.id });
      $("#lse-cancel").hidden = !job;
      if (!job) {
        feedback(
          "No saved import matches this file and these options. Retry can prepare new drafts.",
        );
        return;
      }
      if (job.state === "ready") {
        result(job);
        return;
      }
      feedback(
        "Saved progress: " +
          job.pages.length +
          " drafts prepared, " +
          job.pages.filter((p) => p.done).length +
          " converted, " +
          job.assets.length +
          " files imported. Continue with the same file and options.",
      );
    } catch (e) {
      recordError(e, "Checking saved import progress");
      feedback(e.message, true);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
  $("#lse-error-details").addEventListener("click", () => {
    if (!lastError) return;
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(lastError, null, 2)], {
          type: "application/json",
        }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = "little-studio-import-error.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  async function siteSetup(action) {
    if (busy || window.LSEManage?.busy || !job) return;
    setBusy(true);
    try {
      job = await request(action, {
        job: job.id,
        consent: $("#lse-activate-consent").checked,
      });
      window.dispatchEvent(
        new CustomEvent("lse:import-saved", { detail: job }),
      );
      status(
        action === "activate"
          ? "Reviewed homepage and menu setup applied."
          : "Site setup recovery checked.",
      );
    } catch (error) {
      status(error.message, true);
    } finally {
      setBusy(false);
    }
  }
  $("#lse-activate").addEventListener("click", () => siteSetup("activate"));
  $("#lse-restore").addEventListener("click", () => siteSetup("restore"));
  if (!config.canScripts) {
    $("#lse-scripts").disabled = true;
    $("#lse-scripts").parentElement.title =
      "Your account cannot run unfiltered JavaScript.";
  }
  async function resumeImport(id) {
    const saved = await window.LSERecovery.load(id);
    if (!saved) throw Error("The saved source is unavailable in this browser.");
    const recovery = saved.options;
    await choose({ name: recovery.name }, M.validate(saved.project));
    if (!project) return;
    fingerprint = recovery.fingerprint;
    $("#lse-name").value = recovery.title;
    $("#lse-layout").value = recovery.layout;
    $("#lse-css").checked = recovery.preserveCSS;
    $("#lse-scripts").checked = recovery.scripts && config.canScripts;
    for (const input of document.querySelectorAll("[data-page-key]"))
      input.checked = recovery.keys.includes(input.dataset.pageKey);
    refreshSelect();
    await run({ background: recovery.background, recovery });
  }
  window.LSEAdmin = {
    request,
    resumeImport,
    copyReport,
    importReport: () => journal.report(job, project, originalFile),
    choose,
    chooseProject(project, name, options) {
      return choose({ name }, project, options);
    },
    run,
    setJob(data) {
      job = data;
      if (data) journal.attach(data);
      mediaPaused = false;
      scheduleMedia();
      selectionStarted = true;
    },
    get busy() {
      return busy;
    },
    get project() {
      return project;
    },
    get job() {
      return job;
    },
  };
  if (config.lastJob)
    request("status", { job: config.lastJob })
      .then((data) => {
        if (
          selectionStarted ||
          busy ||
          ["importing", "finishing"].includes(data.state)
        )
          return;
        if (data.engine !== config.conversionVersion) {
          result(data);
          status(
            "This import used an earlier converter. Use Update from file to rebuild its existing pages with reviewed replacement protection.",
          );
          return;
        }
        if (["ready", "interrupted"].includes(data.state)) result(data);
      })
      .catch(() => {});
})();
