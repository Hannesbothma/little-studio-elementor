(() => {
  "use strict";
  const escape = (value) =>
    String(value ?? "").replace(
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
  function kind(message) {
    if (/^Skipped /i.test(message)) return "skipped";
    if (
      /could not (?:package|be packaged)|stylesheet.*not fetched|stylesheet.*must be packaged/i.test(
        message,
      )
    )
      return "missing";
    if (
      /external file needs review|left external|circular stylesheet/i.test(
        message,
      )
    )
      return "review";
    if (
      /was omitted|initialization.*omitted|captured scripts will run|review the imported layout and behavio[u]?r/i.test(
        message,
      )
    )
      return "notes";
    if (
      /connect \d+|need(?:s)? (?:a destination|its original|manual)|manual rebuilding|must be configured|not downloaded|event handlers are removed|rebuilt as/i.test(
        message,
      )
    )
      return "features";
    return "review";
  }
  function groups(messages) {
    const result = [
      {
        id: "skipped",
        title: "Skipped items — retry with Update from file",
        items: [],
      },
      { id: "missing", title: "Missing resources", items: [] },
      { id: "review", title: "Resources and styling to review", items: [] },
      {
        id: "features",
        title: "Features needing setup or rebuilding",
        items: [],
      },
      { id: "notes", title: "Capture notes", items: [] },
    ];
    const byKind = new Map(result.map((group) => [group.id, group])),
      seen = new Set();
    for (const message of messages || []) {
      if (typeof message !== "string" || !message.trim()) continue;
      const category = kind(message);
      const url = message
        .match(/https?:\/\/[^\s"'<>]+/)?.[0]
        .replace(/[:.,;]+$/, "");
      // A failed download and its follow-up stylesheet notice describe one resource.
      const key =
        category === "missing" && url ? category + ":" + url : message;
      if (seen.has(key)) continue;
      seen.add(key);
      byKind.get(category).items.push(message);
    }
    return result.filter((group) => group.items.length);
  }
  function render(messages) {
    return groups(messages)
      .map((group) => {
        const content =
          "<ul>" +
          group.items
            .map((message) => "<li>" + escape(message) + "</li>")
            .join("") +
          "</ul>";
        return group.id === "notes"
          ? '<details class="lse-findings-group lse-findings-notes"><summary>' +
              group.title +
              " (" +
              group.items.length +
              ")</summary>" +
              content +
              "</details>"
          : '<section class="lse-findings-group lse-findings-' +
              group.id +
              '"><h4>' +
              group.title +
              "</h4>" +
              content +
              "</section>";
      })
      .join("");
  }
  // Keep only diagnostic metadata in a shareable report. Source markup, request
  // bodies, response bodies and authentication headers never enter the journal.
  function plain(value) {
    return String(value ?? "")
      .replace(/data:[^\s"'<>]+/gi, "[embedded data]")
      .replace(/https?:\/\/[^\s"'<>]+/gi, (s) => {
        try {
          const u = new URL(s);
          return u.origin + u.pathname;
        } catch {
          return "[URL]";
        }
      })
      .replace(/\b(?:Bearer|Basic)\s+[\w+/=.\-]+/gi, "[credential]")
      .replace(/[\r\n\t]+/g, " ")
      .trim();
  }
  function describe(error) {
    const issue = error.error || {};
    return [
      error.phase,
      error.action,
      error.item?.name || error.item?.title,
      error.item?.key && "page key " + error.item.key,
      error.item?.url,
      error.message,
      error.httpStatus &&
        !error.message?.includes("HTTP " + error.httpStatus) &&
        "HTTP " + error.httpStatus,
      issue.code,
      issue.field,
      issue.selector && "selector " + plain(issue.selector).slice(0, 240),
      issue.line
        ? "line " + issue.line + ", column " + (issue.column || 1)
        : "",
      issue.token && "token " + plain(issue.token).slice(0, 100),
      issue.reason && issue.reason !== error.message && issue.reason,
      error.endpoint,
      error.restFallback &&
        "REST returned HTTP " + error.restFallback + " before AJAX retry",
      error.transport,
      error.requestBytes !== undefined &&
        error.requestBytes + " uncompressed bytes",
      error.transferBytes !== undefined &&
        error.transferBytes + " payload bytes",
      error.durationMs !== undefined ? error.durationMs + " ms" : "",
      error.responseKind,
      error.contentType,
      error.fileCount
        ? error.fileCount + " file(s), " + error.fileBytes + " bytes"
        : "",
      error.refusal,
      error.requestId && "request ID " + error.requestId,
      error.httpStatus
        ? error.converterHandler
          ? "converter response"
          : "no converter response marker"
        : "",
    ]
      .filter(Boolean)
      .map(plain)
      .join(" · ");
  }
  function finalReady(job) {
    return job?.state === "ready" && !job.media?.pending;
  }
  function checkpoint(value) {
    const config = window.LSE_CONFIG;
    const key = "lse-progress:" + config.ajax + ":" + config.userId;
    try {
      if (value) {
        localStorage.setItem(
          key,
          JSON.stringify({
            ...value,
            phase: plain(value.phase).slice(0, 1500),
            title: plain(value.title).slice(0, 500),
            source: plain(value.source),
            at: new Date().toISOString(),
          }),
        );
      }
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }
  function journal(config, send) {
    const prefix = "lse-report:" + config.ajax + ":" + config.userId + ":";
    const read = (key) => {
      try {
        return JSON.parse(localStorage.getItem(prefix + key)) || {};
      } catch {
        return {};
      }
    };
    const write = (key, data) => {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(data));
      } catch {}
    };
    function session(key, id = null) {
      return {
        key,
        id,
        entries: read(key),
        pending: {},
        syncing: false,
        confirmed: new Set(),
      };
    }
    let active = session("unassigned");
    async function sync(state) {
      if (!state.id || state.syncing) return;
      state.syncing = true;
      try {
        while (Object.keys(state.pending).length) {
          const batch = Object.fromEntries(
            Object.entries(state.pending).slice(0, 20),
          );
          const reply = await send(state.id, batch);
          for (const id of Object.keys(batch)) {
            if (!reply.recorded?.includes(id)) return;
            state.confirmed.add(id);
            delete state.pending[id];
          }
        }
      } catch {
        /* A blocked server can still be diagnosed from this browser. */
      } finally {
        state.syncing = false;
      }
    }
    function attach(job, carry = false) {
      if (!job?.id) return;
      const unsaved = carry && !active.id ? active.entries : {};
      if (active.id !== job.id) active = session(job.id, job.id);
      const server = job.diagnostics || {};
      Object.assign(active.entries, server, unsaved);
      for (const [id, entry] of Object.entries(active.entries)) {
        if (Object.hasOwn(server, id)) active.confirmed.add(id);
        else if (!active.confirmed.has(id)) active.pending[id] = entry;
      }
      write(active.key, active.entries);
      void sync(active);
    }
    function add(message) {
      const id = crypto.randomUUID();
      const line =
        new Date().toISOString() + "  " + plain(message).slice(0, 1500);
      active.entries[id] = line;
      active.pending[id] = line;
      write(active.key, active.entries);
      void sync(active);
    }
    function report(job, project, filename) {
      const pages = job?.pages || [];
      const skippedPages = pages.filter((page) => page.skipped).length;
      const skippedFiles = Object.values(job?.skipped_assets || {});
      const capture = job?.capture || project?.capture;
      const reports = job?.reports || {};
      const saved = checkpoint();
      const latest =
        saved &&
        (job
          ? saved.job === job.id
          : !project ||
            saved.title === project.title ||
            (saved.source && saved.source === plain(project.capture?.source)))
          ? saved
          : null;
      const lines = [
        "LS Elementor import report",
        "Report format 2",
        "Generated " + new Date().toISOString(),
        "Plugin " +
          config.version +
          " | Elementor " +
          (config.elementor || "unavailable") +
          " | Pro " +
          (config.proVersion || (config.pro ? "active" : "inactive")),
        "WordPress " + config.wordpress + " | PHP " + config.php,
        ...(config.theme
          ? [
              "Theme " +
                plain(
                  [config.theme, config.themeVersion].filter(Boolean).join(" "),
                ),
            ]
          : []),
        "Server limits (bytes) · file " +
          config.maxUpload +
          " · request " +
          config.maxPost,
        "Site " + location.host,
        "Import " + (job?.id || "before draft creation"),
        ...(capture?.source ? ["Source " + plain(capture.source)] : []),
        ...(job?.engine ? ["Converter " + plain(job.engine)] : []),
        ...(job?.layout
          ? [
              "Layout " +
                plain(job.layout) +
                (typeof job.preserve_css === "boolean"
                  ? " | Source styling " + (job.preserve_css ? "kept" : "off")
                  : "") +
                " | Scripts " +
                (job.scripts ? "enabled" : "off") +
                " | Save " +
                (job.background?.phase ? "background" : "foreground"),
            ]
          : []),
        "Project " +
          plain(
            job?.title ||
              project?.title ||
              filename ||
              latest?.title ||
              latest?.source ||
              "(unselected)",
          ),
        "State " +
          (job?.state || "preparation") +
          " | " +
          pages.filter((p) => p.done).length +
          "/" +
          pages.length +
          " pages confirmed | " +
          (job?.assets?.length || 0) +
          " files confirmed",
        ...(skippedPages || skippedFiles.length
          ? [
              "Skipped " +
                skippedPages +
                " page(s) | " +
                skippedFiles.length +
                " file(s)",
            ]
          : []),
        ...(latest
          ? [
              "",
              "Last browser checkpoint (UTC)",
              latest.at + " · " + latest.phase,
              ...(!capture?.source && latest.source
                ? ["Source " + latest.source]
                : []),
              ...(Number.isFinite(latest.records)
                ? [
                    latest.records +
                      " capture records · " +
                      latest.bytes +
                      " encoded bytes",
                  ]
                : []),
            ]
          : []),
        "",
        "Events (UTC)",
        ...[
          ...Object.values(active.entries),
          ...(job?.background?.events || []).map(plain),
        ].sort(),
      ];
      if (job?.background?.error) {
        lines.push(
          "Background import paused · " +
            describe({
              ...job.background.error,
              phase: "Saving a background import",
              item: pages.find(
                (page) => page.key === job.background.error.error?.page_key,
              ),
            }),
        );
      } else if (
        !Object.keys(active.entries).length &&
        !job?.background?.events?.length
      )
        lines.push("No recorded failures or recovery actions.");
      const findings = new Set();
      const addFinding = (s) => findings.add(plain(s));
      const failures = capture?.failed_resources || [];
      const failedURLs = new Set(failures.map((item) => item.url));
      for (const warning of capture?.warnings || []) {
        const omitted = /^Could not package (https?:\/\/\S+): /i.exec(warning);
        if (
          warning.startsWith("Skipped page with no editable body · ") &&
          failures.some(
            (item) =>
              item.role === "body" && warning.endsWith(" · " + item.url),
          )
        )
          continue;
        if (!omitted || !failedURLs.has(omitted[1])) addFinding(warning);
      }
      for (const item of failures)
        addFinding(
          (item.role === "body"
            ? "Skipped page with no editable body · "
            : item.kind === "page"
              ? "Skipped unavailable source page · "
              : "Capture · ") +
            item.url +
            " · " +
            [
              item.kind,
              item.role,
              item.status ? "HTTP " + item.status : "",
              item.error && item.error !== "HTTP " + item.status && item.error,
              item.discovery_base && "discovered from " + item.discovery_base,
              item.attempts && item.attempts + " attempt(s)",
            ]
              .filter(Boolean)
              .join(" · "),
        );
      for (const item of skippedFiles)
        addFinding("Skipped file · " + item.name + " · " + item.reason);
      const pageTitles = new Map(
        pages.map((page) => [
          page.key,
          (page.current_title || page.title) + " [" + page.key + "]",
        ]),
      );
      const affectedPages = new Map();
      for (const [key, result] of Object.entries(reports)) {
        for (const warning of new Set(result.warnings || [])) {
          if (!affectedPages.has(warning)) affectedPages.set(warning, []);
          affectedPages.get(warning).push(key);
        }
        for (const error of result.skipped || [])
          addFinding(
            (pageTitles.get(key) || key) +
              " · Skipped CSS · " +
              describe({ error }),
          );
      }
      for (const [warning, keys] of affectedPages) {
        const labels = keys.map((key) => pageTitles.get(key) || key);
        if (keys.length === 1) addFinding(labels[0] + " · " + warning);
        else if (
          keys.length === pages.length &&
          keys.every((key) => pageTitles.has(key))
        )
          addFinding("All " + keys.length + " pages · " + warning);
        else
          addFinding(
            keys.length + " pages · " + warning + "\n  " + labels.join(" | "),
          );
      }
      for (const issue of [
        ...(job?.media?.errors || []),
        ...(job?.media?.skipped || []),
      ])
        addFinding(
          "Image size · " +
            [issue.name, issue.size, issue.message || issue.reason]
              .filter(Boolean)
              .join(" · "),
        );
      const checked = pages.filter((page) =>
        Array.isArray(reports[page.key]?.layout_review),
      );
      const layoutFindings = checked.flatMap((page) => {
        const issues = reports[page.key].layout_review;
        return issues.length
          ? [
              plain(
                pageTitles.get(page.key) +
                  " · " +
                  (page.source_url || "source URL unavailable"),
              ),
              ...issues.map((issue) => "  " + plain(issue)),
            ]
          : [];
      });
      const pageIndex = pages.map((page) => {
        const result = reports[page.key];
        return [
          pageTitles.get(page.key),
          page.source_url && "source " + page.source_url,
          page.id && "WordPress page " + page.id,
          page.slug && "slug " + page.slug,
          page.skipped
            ? "skipped"
            : [page.done ? "saved" : "pending", page.post_status]
                .filter(Boolean)
                .join(" / "),
          result &&
            Number.isFinite(result.native) &&
            result.native +
              " native elements, " +
              (result.fallbacks || 0) +
              " HTML regions",
        ]
          .filter(Boolean)
          .map(plain)
          .join(" · ");
      });
      return [
        ...lines,
        "",
        "Import findings",
        ...(findings.size ? findings : ["None recorded."]),
        ...(pages.length
          ? [
              "",
              "Layout diagnostics",
              checked.length +
                "/" +
                pages.length +
                " pages checked for source overflow and floated rows at 1440px, 1024px and 390px.",
              "Up to 12 floated rows are recorded per page.",
              "Checks compare source measurements with converter output. Saved Elementor previews were not rendered by this report.",
              ...(layoutFindings.length
                ? layoutFindings
                : [
                    checked.length
                      ? "No issues detected by these checks."
                      : "No conversion measurements available.",
                  ]),
              "",
              "Page index",
              ...pageIndex,
            ]
          : []),
      ].join("\n");
    }
    return {
      attach,
      add,
      report,
      reset() {
        active = session("unassigned");
        active.entries = {};
        write(active.key, {});
      },
    };
  }
  window.LSEReports = {
    describe,
    finalReady,
    checkpoint,
    journal,
    groups,
    render,
    needsReview: (messages) =>
      groups(messages).some((group) => group.id !== "notes"),
  };
})();
