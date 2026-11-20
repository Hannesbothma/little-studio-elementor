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
      error.item?.url,
      error.message,
      error.httpStatus && "HTTP " + error.httpStatus,
      issue.code,
      issue.field,
      issue.line
        ? "line " + issue.line + ", column " + (issue.column || 1)
        : "",
      error.endpoint,
      error.durationMs !== undefined ? error.durationMs + " ms" : "",
      error.responseKind,
      error.contentType,
      error.fileCount
        ? error.fileCount + " file(s), " + error.fileBytes + " bytes"
        : "",
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
      const lines = [
        "LS Elementor import report",
        "Generated " + new Date().toISOString(),
        "Plugin " +
          config.version +
          " | Elementor " +
          (config.elementor || "unavailable") +
          " | Pro " +
          (config.pro ? "active" : "inactive"),
        "WordPress " + config.wordpress + " | PHP " + config.php,
        "Server limits (bytes) · file " +
          config.maxUpload +
          " · request " +
          config.maxPost,
        "Site " + location.host,
        "Import " + (job?.id || "before draft creation"),
        "Project " +
          plain(job?.title || project?.title || filename || "(unselected)"),
        "State " +
          (job?.state || "preparation") +
          " | " +
          pages.filter((p) => p.done).length +
          "/" +
          pages.length +
          " pages confirmed | " +
          (job?.assets?.length || 0) +
          " files confirmed",
        "",
        "Events (UTC)",
        ...Object.values(active.entries).sort(),
      ];
      if (!Object.keys(active.entries).length)
        lines.push("No recorded failures or recovery actions.");
      const findings = new Set();
      const addFinding = (s) => findings.add(plain(s));
      const capture = job?.capture || project?.capture;
      for (const warning of capture?.warnings || []) addFinding(warning);
      for (const item of capture?.failed_resources || [])
        addFinding(
          (item.kind === "page"
            ? "Skipped unavailable source page · "
            : "Capture · ") +
            item.url +
            " · " +
            (item.error || item.status || "failed"),
        );
      for (const item of Object.values(job?.skipped_assets || {}))
        addFinding("Skipped file · " + item.name + " · " + item.reason);
      for (const [key, r] of Object.entries(job?.reports || {}))
        for (const warning of r.warnings || [])
          addFinding(key + " · " + warning);
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
      return [
        ...lines,
        "",
        "Import findings",
        ...(findings.size ? findings : ["None recorded."]),
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
    journal,
    groups,
    render,
    needsReview: (messages) =>
      groups(messages).some((group) => group.id !== "notes"),
  };
})();
