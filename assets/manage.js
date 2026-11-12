(() => {
  "use strict";

  const A = window.LSEAdmin;
  const $ = (selector) => document.querySelector(selector);
  if (!A || !$("#lse-managed")) return;

  let imports = [];
  let next = null;
  let current = null;
  let target = null;
  let loading = false;
  let selectedKey = null;
  let currentTab = "pages";
  let inspectorOpen = false;
  let metadataContext = null;
  const flowDialog = $("#lse-flow-dialog");
  const pageDialog = $("#lse-page-dialog");
  const removeDialog = $("#lse-remove-dialog");
  const statusLabels = {
    draft: "Draft",
    publish: "Published",
    pending: "Pending review",
    private: "Private",
    trash: "In Trash",
    missing: "Missing",
  };
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  const locked = () => A.busy || loading;
  const selectedPage = () =>
    current?.pages.find((page) => page.key === selectedKey);

  function message(text, error = false) {
    const element = $("#lse-manage-message");
    element.textContent = text;
    element.classList.toggle("is-error", error);
    element.setAttribute("role", error ? "alert" : "status");
  }

  function dateLabel(value, unix = false) {
    if (!value) return "—";
    const date = new Date(unix ? value * 1000 : value);
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
  }

  function statusChip(page) {
    return (
      '<span class="lse-chip lse-status-' +
      escapeHtml(page.post_status) +
      '">' +
      escapeHtml(statusLabels[page.post_status] || page.post_status) +
      "</span>"
    );
  }

  function syncControls() {
    const disabled = locked();
    for (const element of document.querySelectorAll(
      "#lse-new-import,#lse-import-list,#lse-more-imports,[data-import-id],#lse-choose-file," +
        "#lse-page-search,#lse-page-filter,[data-managed-key],#lse-page-inspector button," +
        "#lse-remove-import,#lse-download,#lse-activate,#lse-restore,#lse-page-form input," +
        "#lse-page-save,#lse-page-close,#lse-page-cancel,#lse-flow-close",
    )) {
      element.disabled = disabled;
    }
    $("#lse-refresh-import").disabled =
      disabled ||
      (["importing", "finishing"].includes(current?.state) &&
        current?.engine === window.LSE_CONFIG.conversionVersion);
  }

  function setLoading(value) {
    loading = value;
    syncControls();
  }

  function view(mode) {
    $("#lse-managed").dataset.mode = mode;
    $("#lse-choose").hidden = !!current || mode !== "choose";
    $("#lse-project").hidden = !current;
    $("#lse-review").hidden = mode !== "review";
    $("#lse-progress").hidden = mode !== "progress";
    if (mode === "review" || mode === "progress") {
      $("#lse-flow-title").textContent =
        mode === "review"
          ? target
            ? "Review page updates"
            : "Review new import"
          : target
            ? "Updating pages"
            : "Importing website";
      if (!flowDialog.open) flowDialog.showModal();
    } else if (flowDialog.open) {
      flowDialog.close();
    }
  }

  function renderSites() {
    // A saved import may be outside the first page of older import records.
    const listed =
      current && !imports.some((item) => item.id === current.id)
        ? [current, ...imports]
        : imports;
    $("#lse-import-list").innerHTML =
      '<option value="">New import</option>' +
      listed
        .map(
          (item) =>
            '<option value="' +
            escapeHtml(item.id) +
            '">' +
            escapeHtml(item.title) +
            "</option>",
        )
        .join("");
    $("#lse-import-list").value = current?.id || "";
    $("#lse-import-nav").innerHTML = listed
      .map((item) => {
        const count = Array.isArray(item.pages)
          ? item.pages.length
          : item.pages;
        const initials = item.title
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
          .toUpperCase();
        return (
          '<button type="button" class="lse-site" data-import-id="' +
          escapeHtml(item.id) +
          '" aria-current="' +
          (item.id === current?.id) +
          '"><span class="lse-site-icon" aria-hidden="true">' +
          escapeHtml(initials) +
          '</span><span class="lse-site-text"><strong>' +
          escapeHtml(item.title) +
          "</strong><small>" +
          count +
          (count === 1 ? " page" : " pages") +
          "</small></span></button>"
        );
      })
      .join("");
    $("#lse-more-imports").hidden = next === null;
    syncControls();
  }

  async function list(more = false) {
    const data = await A.request("imports", { offset: more ? next || 0 : 0 });
    const rows = more ? imports.concat(data.imports) : data.imports;
    imports = [...new Map(rows.map((item) => [item.id, item])).values()];
    next = data.next;
    renderSites();
  }

  function renderTabs() {
    for (const tab of document.querySelectorAll(".lse-tab")) {
      const active = tab.dataset.tab === currentTab;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    $("#lse-managed-pages").hidden = currentTab !== "pages";
    $("#lse-import-details").hidden = currentTab !== "details";
  }

  function renderPages() {
    if (!current) return;
    const query = $("#lse-page-search").value.trim().toLocaleLowerCase();
    const filter = $("#lse-page-filter").value;
    const pages = current.pages.filter(
      (page) =>
        (filter === "all" || page.post_status === filter) &&
        (page.current_title + " " + page.slug)
          .toLocaleLowerCase()
          .includes(query),
    );
    if (!pages.some((page) => page.key === selectedKey)) {
      selectedKey = pages[0]?.key || null;
      inspectorOpen = false;
    }
    $("#lse-page-rows").innerHTML = pages.length
      ? pages
          .map(
            (page) =>
              '<button type="button" class="lse-page-row" data-managed-key="' +
              escapeHtml(page.key) +
              '" aria-pressed="' +
              (page.key === selectedKey) +
              '"><span class="lse-page-name">' +
              '<span class="lse-doc-icon" aria-hidden="true"></span><span><strong>' +
              escapeHtml(page.current_title) +
              "</strong><small>" +
              escapeHtml(page.slug ? "/" + page.slug + "/" : "—") +
              "</small></span></span>" +
              statusChip(page) +
              '<span class="lse-row-arrow" aria-hidden="true">›</span></button>',
          )
          .join("")
      : '<p class="lse-empty-list">No pages match these filters.</p>';
    $("#lse-list-footer").textContent =
      pages.length + " of " + current.pages.length + " pages";
    renderInspector();
    syncControls();
  }

  function renderInspector() {
    const page = selectedPage();
    const panel = $("#lse-page-inspector");
    panel.hidden = !page;
    panel.classList.toggle("is-open", inspectorOpen);
    if (!page) return;
    const trashed = page.post_status === "trash";
    const active = !["trash", "missing"].includes(page.post_status);
    let actions = "";
    if (page.can_edit && active) {
      actions =
        '<a class="button button-primary" target="_blank" rel="noopener" href="' +
        escapeHtml(page.edit_url) +
        '">Edit in Elementor <span aria-hidden="true">↗</span></a>' +
        '<a class="button" target="_blank" rel="noopener" href="' +
        escapeHtml(page.preview_url) +
        '">Preview page</a>';
    } else if (page.can_edit && trashed) {
      actions =
        '<button type="button" class="button button-primary" data-operation="untrash">Restore as draft</button>';
    }
    panel.innerHTML =
      '<div class="lse-inspector-body"><div class="lse-inspector-head"><h2>Selected page</h2>' +
      statusChip(page) +
      '<button type="button" class="button lse-subtle lse-icon-button lse-inspector-close" ' +
      'data-operation="close" aria-label="Close page inspector">×</button></div><h3>' +
      escapeHtml(page.current_title) +
      '</h3><p class="lse-inspector-path">' +
      escapeHtml(page.slug ? "/" + page.slug + "/" : "—") +
      "</p>" +
      '<div class="lse-inspector-actions">' +
      actions +
      '</div><dl class="lse-inspector-meta">' +
      "<div><dt>Layout</dt><dd>" +
      (current.layout === "elementor_canvas"
        ? "Elementor Canvas"
        : "Theme header and footer") +
      "</dd></div><div><dt>Last updated</dt><dd>" +
      escapeHtml(dateLabel(page.modified)) +
      '</dd></div></dl></div><div class="lse-inspector-secondary">' +
      (page.can_edit && active
        ? '<button type="button" class="button lse-subtle" data-operation="metadata">Edit page details</button>'
        : "") +
      (page.can_delete && active
        ? '<button type="button" class="button lse-subtle lse-danger" data-operation="trash">Move to Trash</button>'
        : "") +
      (page.can_edit && page.can_restore_refresh && active
        ? '<button type="button" class="button lse-subtle" data-operation="restore_refresh">Restore before last update</button>'
        : "") +
      "</div>";
  }

  function renderDetails() {
    const templates = Object.values(current.templates || {});
    $("#lse-import-summary").innerHTML = [
      ["Imported", dateLabel(current.created, true)],
      ["Pages", current.pages.length],
      [
        "Published",
        current.pages.filter((page) => page.post_status === "publish").length,
      ],
      ["Media files", current.assets.length],
    ]
      .map(
        ([label, value]) =>
          '<div class="lse-detail-pair"><span>' +
          label +
          "</span><strong>" +
          escapeHtml(value) +
          "</strong></div>",
      )
      .join("");
    $("#lse-report").innerHTML =
      templates
        .map(
          (template) =>
            '<p><a href="' +
            escapeHtml(template.edit_url) +
            '">Edit shared ' +
            escapeHtml(template.kind) +
            "</a></p>",
        )
        .join("") +
      window.LSEReports.render([
        ...(current.capture?.warnings || []),
        ...(current.capture?.failed_resources || []).map(
          (resource) =>
            "Could not package " +
            resource.url +
            ": " +
            (resource.error ||
              (resource.status
                ? "HTTP " + resource.status
                : "Unavailable resource")),
        ),
      ]) +
      Object.entries(current.reports || {})
        .map(([key, report]) => {
          const title =
            current.pages.find((page) => page.key === key)?.current_title ||
            key;
          const warnings = report.warnings || [];
          return (
            '<details class="lse-report-page"><summary>' +
            escapeHtml(title) +
            "</summary><p>" +
            report.native +
            " native elements · " +
            report.fallbacks +
            " HTML regions</p>" +
            window.LSEReports.render(warnings) +
            "</details>"
          );
        })
        .join("");
    $("#lse-restore").hidden = !current.activated;
    $("#lse-restoration").textContent = (current.restoration || []).join(" ");
  }

  function render() {
    A.setJob(current);
    view(current ? "manage" : "choose");
    renderSites();
    if (!current) return;
    $("#lse-project-title").textContent = current.title;
    $("#lse-project-meta").textContent =
      "Imported " +
      dateLabel(current.created, true) +
      " · " +
      current.assets.length +
      (current.assets.length === 1 ? " media file" : " media files");
    $("#lse-page-count").textContent = current.pages.length;
    renderTabs();
    renderPages();
    renderDetails();
    syncControls();
  }

  function clearTarget() {
    target = null;
    $("#lse-layout").disabled = false;
    delete $("#lse-layout").dataset.lseDisabled;
  }

  async function select(id) {
    if (locked()) return;
    A.setJob(current);
    setLoading(true);
    try {
      const data = id ? await A.request("status", { job: id }) : null;
      clearTarget();
      current = data;
      selectedKey = current?.pages[0]?.key || null;
      currentTab = "pages";
      inspectorOpen = false;
      $("#lse-page-search").value = "";
      $("#lse-page-filter").value = "all";
      render();
      message("");
    } catch (error) {
      renderSites();
      message(error.message, true);
    } finally {
      setLoading(false);
    }
  }

  async function remove(imported = current) {
    if (!imported || locked()) return;
    setLoading(true);
    try {
      const latest = await A.request("status", { job: imported.id });
      const published = latest.pages.filter(
        (page) => page.post_status === "publish",
      ).length;
      $("#lse-remove-name").textContent = latest.title;
      $("#lse-remove-count").textContent =
        latest.pages.length +
        (latest.pages.length === 1 ? " page" : " pages") +
        (published ? " · " + published + " published" : "");
      removeDialog.returnValue = "cancel";
      const confirmed = new Promise((resolve) =>
        removeDialog.addEventListener(
          "close",
          () => resolve(removeDialog.returnValue === "remove"),
          { once: true },
        ),
      );
      removeDialog.showModal();
      if (!(await confirmed)) return;
      const result = await A.request("remove_import", {
        job: latest.id,
        expected_stamps: Object.fromEntries(
          latest.pages.map((page) => [page.key, page.current_stamp]),
        ),
        consent: true,
      });
      clearTarget();
      current = result.state === "removed" ? null : result;
      selectedKey = current?.pages[0]?.key || null;
      render();
      await list();
      message(
        result.state === "removed"
          ? "Import removed. Pages are in WordPress Trash; media files were kept."
          : "Some pages could not be removed. Review the import and try again.",
        result.state !== "removed",
      );
    } catch (error) {
      message(error.message, true);
    } finally {
      setLoading(false);
    }
  }

  function newImport() {
    if (locked()) return;
    $("#lse-reset").click();
    $("#lse-file").click();
  }

  async function refreshImport() {
    if (!current || locked()) return;
    setLoading(true);
    try {
      $("#lse-reset").click();
      target = await A.request("status", { job: current.id });
      $("#lse-file").click();
      message("");
    } catch (error) {
      message(error.message, true);
    } finally {
      setLoading(false);
    }
  }

  function editMetadata(page) {
    metadataContext = {
      job: current.id,
      key: page.key,
      expected_stamp: page.current_stamp,
    };
    $("#lse-page-title").value = page.current_title;
    $("#lse-page-slug").value = page.slug;
    $("#lse-page-error").hidden = true;
    pageDialog.showModal();
  }

  async function operate(operation, page) {
    if (locked() || !page) return;
    if (operation === "metadata") {
      editMetadata(page);
      return;
    }
    if (
      operation === "trash" &&
      !confirm(
        "Move “" +
          page.current_title +
          "” to WordPress Trash? A published page will disappear from the site.",
      )
    )
      return;
    if (
      operation === "restore_refresh" &&
      !confirm(
        "Restore “" +
          page.current_title +
          "” to its content before the last update?",
      )
    )
      return;
    setLoading(true);
    try {
      current = await A.request(
        operation === "restore_refresh" ? "restore_refresh" : "manage_page",
        {
          job: current.id,
          key: page.key,
          operation,
          expected_stamp: page.current_stamp,
          consent: true,
        },
      );
      render();
      message(
        operation === "trash" ? "Page moved to Trash." : "Page restored.",
      );
    } catch (error) {
      message(error.message, true);
    } finally {
      setLoading(false);
    }
  }

  function review(project) {
    const context = $("#lse-refresh-context");
    context.hidden = !target;
    $("#lse-overwrite-option").hidden = !target;
    $("#lse-overwrite").checked = false;
    $("#lse-import").textContent = target
      ? "Update selected pages"
      : "Import selected pages";
    $("#lse-import-scope").textContent = target
      ? "Selected existing pages are replaced after your confirmation."
      : "New pages are saved as drafts.";
    if (!target) return;
    context.textContent =
      "Updating " +
      target.title +
      ". Existing page IDs, addresses and publication status are kept. Pages absent from this file stay unchanged.";
    if (project.input_kind === "html") {
      const label = document.createElement("label");
      const destination = document.createElement("select");
      label.textContent = " Replace this imported page: ";
      for (const page of target.pages.filter(
        (page) => !["trash", "missing"].includes(page.post_status),
      )) {
        const option = document.createElement("option");
        option.value = page.key;
        option.textContent = page.current_title;
        destination.append(option);
      }
      destination.value =
        project.htmlDestination ||
        (target.pages.some(
          (page) =>
            page.key === selectedKey &&
            !["trash", "missing"].includes(page.post_status),
        )
          ? selectedKey
          : destination.options[0]?.value) ||
        "";
      const remap = () => {
        const key = destination.value;
        project.htmlDestination = key;
        project.pages[0].key = key;
        project.site.home_key = key;
        project.site_id = target.site_id || project.site_id;
        document
          .querySelector("[data-page-key]")
          ?.setAttribute("data-page-key", key);
      };
      remap();
      destination.onchange = () => {
        remap();
        review(project);
      };
      label.append(destination);
      context.append(label);
    }
    $("#lse-layout").value = target.layout;
    $("#lse-layout").disabled = true;
    $("#lse-layout").dataset.lseDisabled = "true";
    for (const checkbox of document.querySelectorAll("[data-page-key]")) {
      const page = target.pages.find(
        (page) => page.key === checkbox.dataset.pageKey,
      );
      const valid = page && !["trash", "missing"].includes(page.post_status);
      checkbox.disabled = !valid;
      checkbox.dataset.lseDisabled = String(!valid);
      checkbox.checked =
        !!valid && !page.changed && page.post_status === "draft";
      const cell = checkbox.closest("tr").querySelector("td:last-child");
      cell.textContent = !page
        ? "New page — import separately"
        : !valid
          ? "Restore before refreshing"
          : page.changed || page.post_status !== "draft"
            ? "Edited / " + page.post_status + " — replacement requires consent"
            : "Ready to refresh";
    }
    $("#lse-pages").dispatchEvent(new Event("change"));
  }

  $("#lse-import-list").addEventListener("change", (event) =>
    select(event.target.value),
  );
  $("#lse-import-nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-import-id]");
    if (button) select(button.dataset.importId);
  });
  $("#lse-new-import").addEventListener("click", newImport);
  $("#lse-choose-file").addEventListener("click", newImport);
  $("#lse-more-imports").addEventListener("click", async () => {
    if (locked()) return;
    setLoading(true);
    try {
      await list(true);
    } catch (error) {
      message(error.message, true);
    } finally {
      setLoading(false);
    }
  });
  $("#lse-remove-import").addEventListener("click", () => remove());
  $("#lse-refresh-import").addEventListener("click", refreshImport);
  $("#lse-page-search").addEventListener("input", renderPages);
  $("#lse-page-filter").addEventListener("change", renderPages);
  $("#lse-page-rows").addEventListener("click", (event) => {
    const row = event.target.closest("[data-managed-key]");
    if (!row || locked()) return;
    selectedKey = row.dataset.managedKey;
    inspectorOpen = true;
    renderPages();
    const close = $(".lse-inspector-close");
    if (close && getComputedStyle(close).display !== "none") close.focus();
    else
      document
        .querySelector('[data-managed-key][aria-pressed="true"]')
        ?.focus();
  });
  $("#lse-page-inspector").addEventListener("click", (event) => {
    if (locked()) {
      event.preventDefault();
      return;
    }
    const button = event.target.closest("[data-operation]");
    if (!button) return;
    if (button.dataset.operation === "close") {
      inspectorOpen = false;
      renderInspector();
      document
        .querySelector('[data-managed-key][aria-pressed="true"]')
        ?.focus();
      return;
    }
    operate(button.dataset.operation, selectedPage());
  });
  $(".lse-tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab) return;
    currentTab = tab.dataset.tab;
    renderTabs();
  });
  $(".lse-tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    currentTab =
      event.key === "Home"
        ? "pages"
        : event.key === "End"
          ? "details"
          : currentTab === "pages"
            ? "details"
            : "pages";
    renderTabs();
    $("#lse-" + currentTab + "-tab").focus();
  });
  $("#lse-flow-close").addEventListener("click", () => {
    if (!locked()) $("#lse-reset").click();
  });
  flowDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!locked()) $("#lse-reset").click();
  });
  for (const id of ["lse-page-close", "lse-page-cancel"]) {
    $("#" + id).addEventListener("click", () => {
      if (!locked()) pageDialog.close();
    });
  }
  pageDialog.addEventListener("cancel", (event) => {
    if (locked()) event.preventDefault();
  });
  $("#lse-page-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (locked() || !metadataContext) return;
    const title = $("#lse-page-title").value.trim();
    const slug = $("#lse-page-slug").value.trim();
    if (!title || !slug) {
      $("#lse-page-error").textContent =
        "A page title and address are required.";
      $("#lse-page-error").hidden = false;
      return;
    }
    setLoading(true);
    try {
      current = await A.request("manage_page", {
        ...metadataContext,
        operation: "metadata",
        title,
        slug,
        consent: true,
      });
      pageDialog.close();
      render();
      message("Page details saved.");
      await list();
    } catch (error) {
      $("#lse-page-error").textContent = error.message;
      $("#lse-page-error").hidden = false;
    } finally {
      setLoading(false);
    }
  });

  document.addEventListener("click", (event) => {
    const menu = $("#lse-import-menu");
    if (
      !event.target.closest("#lse-import-menu") ||
      event.target.closest("#lse-import-menu button")
    )
      menu.open = false;
  });
  window.addEventListener("lse:file-selected", () => {
    review(A.project);
    view("review");
  });
  window.addEventListener("lse:import-started", () => {
    view("progress");
    message("");
  });
  window.addEventListener("lse:busy-changed", syncControls);
  window.addEventListener("lse:choose-reset", () => {
    clearTarget();
    render();
    message("");
  });
  window.addEventListener("lse:file-error", () => {
    clearTarget();
    render();
  });
  window.addEventListener("lse:import-saved", async (event) => {
    const changedImport = event.detail.id !== current?.id;
    current = event.detail;
    if (changedImport) {
      selectedKey = current.pages[0]?.key || null;
      currentTab = "pages";
      $("#lse-page-search").value = "";
      $("#lse-page-filter").value = "all";
    }
    clearTarget();
    render();
    message("");
    try {
      await list();
    } catch (error) {
      message(error.message, true);
    }
  });
  window.addEventListener("lse:resume-progress", () => {
    view("progress");
    syncControls();
  });

  window.LSEManage = {
    get busy() {
      return loading;
    },
    get target() {
      return target;
    },
    get current() {
      return current;
    },
    review,
    remove,
    clear: clearTarget,
    async reload() {
      await list();
      if (current) await select(current.id);
    },
  };
  list().catch((error) => message(error.message, true));
})();
