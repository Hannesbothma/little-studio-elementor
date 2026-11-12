(() => {
  "use strict";
  const A = window.LSEAdmin,
    M = window.LSEConverter,
    $ = (s) => document.querySelector(s);
  const bytes = (data) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const text = (record) => new TextDecoder().decode(bytes(record.data));
  const hash = async (value) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const encoder = new TextEncoder();
  const absolute = (value, base) => {
    if (!value || !value.trim()) return "";
    try {
      const u = new URL(value, base);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return "";
      u.hash = "";
      return u.href;
    } catch {
      return "";
    }
  };
  const mediaType = (record, url) => {
    const aliases = {
      "image/jpg": "image/jpeg",
      "application/font-woff": "font/woff",
      "application/x-font-woff": "font/woff",
      "application/font-woff2": "font/woff2",
      "application/x-font-ttf": "font/ttf",
      "application/x-font-opentype": "font/otf",
      "application/vnd.ms-fontobject": "",
    };
    let type = aliases[record.type] ?? record.type;
    if (
      [
        "application/octet-stream",
        "font/sfnt",
        "application/font-sfnt",
      ].includes(type)
    )
      type =
        {
          woff: "font/woff",
          woff2: "font/woff2",
          ttf: "font/ttf",
          otf: "font/otf",
          svg: "image/svg+xml",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          avif: "image/avif",
          gif: "image/gif",
          mp4: "video/mp4",
          webm: "video/webm",
          mp3: "audio/mpeg",
          ogg: "audio/ogg",
          wav: "audio/wav",
        }[new URL(url).pathname.split(".").pop().toLowerCase()] || type;
    return /^(?:image\/(?:jpeg|png|gif|webp|avif|svg\+xml)|font\/(?:woff2?|ttf|otf)|video\/(?:mp4|webm)|audio\/(?:mpeg|wav|ogg))$/.test(
      type,
    )
      ? type
      : "";
  };
  async function packageWebsite(source, records, warnings = []) {
    source = absolute(source, source);
    const resources = new Map(),
      assets = [],
      assetMap = new Map(),
      byHash = new Map(),
      notes = new Set(warnings);
    for (const r of records) {
      resources.set(r.url, r);
      resources.set(r.requested, r);
    }
    const pages = [
      ...new Map(
        records
          .filter((r) => r.kind === "page" && r.type === "text/html")
          .map((r) => [r.url, r]),
      ).values(),
    ];
    if (!pages.length)
      throw Error(
        "No HTML pages were captured. Try Desktop capture for this website.",
      );
    const names = new Set(),
      nameRanks = new Map(),
      assetsByURL = new Map();
    let contextTitle = "Website";
    const label = (url, type, hint = "") => {
      let stem = "";
      try {
        stem = decodeURIComponent(new URL(url).pathname.split("/").pop())
          .replace(/\.[a-z0-9]{1,8}$/i, "")
          .replace(/[-_]\d{2,5}x\d{2,5}$/, "")
          .replace(/[-_](?:scaled|optimized|compressed)$/i, "");
      } catch {}
      const generic =
        !stem ||
        /^(?:[a-f0-9]{12,}|(?:img|dsc|image|photo|picture|asset)[-_ .\d]+)$/i.test(
          stem,
        );
      let value = hint || (generic ? contextTitle + " image" : stem),
        rank = hint ? 3 : generic ? 1 : 2;
      value =
        value
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/([a-z])([A-Z])/g, "$1-$2")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 76)
          .replace(/-+$/, "") || "website-image";
      const ext =
        { "image/jpeg": "jpg", "image/svg+xml": "svg", "audio/mpeg": "mp3" }[
          type
        ] || type.split("/")[1];
      return { stem: value, ext, rank };
    };
    const nameAsset = (item, url, hint) => {
      const candidate = label(url, item.type, hint);
      if ((nameRanks.get(item.url) || 0) >= candidate.rank) return;
      names.delete(item.name);
      let name = candidate.stem + "." + candidate.ext,
        index = 2;
      while (names.has(name))
        name = candidate.stem + "-" + index++ + "." + candidate.ext;
      item.name = name;
      names.add(name);
      nameRanks.set(item.url, candidate.rank);
    };
    const asset = async (value, base, hint = "") => {
      if (!value || value.startsWith("#")) return value;
      if (value.startsWith("data:")) return value; // Native validation safely packages embedded media.
      const url = absolute(value, base);
      if (!url) return "";
      const fragment = new URL(value, base).hash;
      if (assets.some((a) => a.url === url)) return url + fragment;
      if (assetMap.has(url)) {
        const mapped = assetMap.get(url);
        nameAsset(assetsByURL.get(mapped), url, hint);
        return mapped + fragment;
      }
      const record = resources.get(url),
        type = record && mediaType(record, url);
      if (!record || !type) {
        notes.add("External file needs review: " + url);
        return url + fragment;
      }
      const body = bytes(record.data),
        digest = await hash(body);
      if (
        type === "image/svg+xml" &&
        /<!DOCTYPE|<!ENTITY/i.test(text(record))
      ) {
        notes.add(
          "An SVG with document declarations was left external: " + url,
        );
        return url;
      }
      if (byHash.has(type + digest)) {
        const existing = byHash.get(type + digest);
        assetMap.set(url, existing);
        nameAsset(assetsByURL.get(existing), url, hint);
        return existing + fragment;
      }
      const ext =
        { "image/jpeg": "jpg", "image/svg+xml": "svg", "audio/mpeg": "mp3" }[
          type
        ] || type.split("/")[1];
      const packaged =
        "https://little-studio-assets.invalid/capture/" + digest + "." + ext;
      const item = {
        url: packaged,
        name: "",
        type,
        data: "data:" + type + ";base64," + record.data,
      };
      assets.push(item);
      assetsByURL.set(packaged, item);
      nameAsset(item, url, hint);
      assetMap.set(url, packaged);
      byHash.set(type + digest, packaged);
      return packaged + fragment;
    };
    const css = async (input, base, stack = []) => {
      // Yield before recursive imports; valid deep acyclic stylesheets have no arbitrary cutoff.
      await Promise.resolve();
      return M.replaceCSSReferences(input, async (token) => {
        if (token.kind === "url")
          return "url(" + JSON.stringify(await asset(token.value, base)) + ")";
        const url = absolute(token.value, base),
          record = resources.get(url);
        if (!record || record.type !== "text/css") {
          notes.add(
            "A stylesheet import could not be packaged: " + (url || base),
          );
          return "";
        }
        if (stack.includes(url)) {
          notes.add("A circular stylesheet import was omitted: " + url);
          return "";
        }
        return M.importConditions(
          await css(text(record), record.url, [...stack, url]),
          token.condition,
        );
      });
    };
    const output = [],
      navigation = [],
      documents = new Map();
    for (const record of pages) {
      const doc = new DOMParser().parseFromString(text(record), "text/html");
      contextTitle = doc.title.trim() || new URL(record.url).hostname;
      notesFor(doc);
      function notesFor(document) {
        for (const warning of M.prepareSource(document)) notes.add(warning);
      }
      const base =
        absolute(
          doc.querySelector("base[href]")?.getAttribute("href") || record.url,
          record.url,
        ) || record.url;
      documents.set(record.url, { doc, base });
      const key =
        "page-" + (await hash(encoder.encode(record.url))).slice(0, 20);
      const styles = [],
        scripts = [];
      for (const node of [
        ...doc.querySelectorAll('style,link[rel~="stylesheet"]'),
      ]) {
        if (node.tagName === "STYLE") {
          const content = await css(node.textContent, base);
          styles.push(
            node.media && node.media !== "all"
              ? "@media " + node.media + "{" + content + "}"
              : content,
          );
        } else {
          const url = absolute(node.getAttribute("href"), base),
            sheet = resources.get(url);
          if (sheet?.type === "text/css") {
            const content = await css(text(sheet), sheet.url, [url]);
            styles.push(
              node.media && node.media !== "all"
                ? "@media " + node.media + "{" + content + "}"
                : content,
            );
          } else notes.add("A stylesheet could not be packaged: " + url);
        }
        node.remove();
      }
      for (const script of [...doc.querySelectorAll("script")]) {
        const type = script.getAttribute("type") || "";
        if (
          !type ||
          /^(?:text|application)\/(?:java|ecma)script$/i.test(type)
        ) {
          if (script.src) {
            const url = absolute(script.getAttribute("src"), base),
              code = resources.get(url);
            if (
              /\/(?:wp-includes\/js\/(?:jquery|dist)|wp-content\/plugins\/elementor(?:-pro)?)\//i.test(
                url,
              )
            ) {
              notes.add(
                "The source WordPress/Elementor runtime was omitted; the destination supplies its own runtime.",
              );
            } else if (code) scripts.push(text(code));
            else notes.add("A script could not be packaged: " + url);
          } else if (
            /(?:elementor(?:Pro)?FrontendConfig|webpackChunk(?:elementor|elementor_pro))/.test(
              script.textContent,
            )
          )
            notes.add(
              "Source Elementor initialization was omitted to keep the destination editor independent.",
            );
          else scripts.push(script.textContent);
        } else if (type === "module")
          notes.add(
            "This site uses JavaScript modules. App behavior needs manual rebuilding.",
          );
        script.remove();
      }
      for (const node of doc.querySelectorAll("base,meta[http-equiv]"))
        node.remove();
      for (const el of doc.querySelectorAll("*")) {
        if (el.hasAttribute("data-settings")) {
          try {
            const settings = JSON.parse(el.getAttribute("data-settings"));
            for (const [name, value] of Object.entries(settings)) {
              if (
                /^background(?:_overlay)?_slideshow_gallery$/.test(name) &&
                Array.isArray(value)
              )
                for (const slide of value)
                  if (typeof slide.url === "string")
                    slide.url = await asset(slide.url, base);
              if (
                /^background(?:_overlay)?_image(?:_tablet|_mobile)?$/.test(
                  name,
                ) &&
                value &&
                typeof value.url === "string"
              )
                value.url = await asset(value.url, base);
            }
            el.setAttribute("data-settings", JSON.stringify(settings));
          } catch (error) {
            notes.add(
              "Builder background settings need review: " + error.message,
            );
          }
        }

        if (el.hasAttribute("style"))
          el.setAttribute("style", await css(el.getAttribute("style"), base));
        for (const attr of [
          "src",
          "poster",
          "data-src",
          "data-lazy-src",
          "data-original",
        ]) {
          if (!el.hasAttribute(attr)) continue;
          if (["IMG", "SOURCE", "VIDEO", "AUDIO", "INPUT"].includes(el.tagName))
            el.setAttribute(
              attr,
              await asset(
                el.getAttribute(attr),
                base,
                el.tagName === "IMG"
                  ? el.getAttribute("alt") ||
                      el.getAttribute("aria-label") ||
                      el
                        .closest("figure")
                        ?.querySelector("figcaption")
                        ?.textContent.trim() ||
                      ""
                  : "",
              ),
            );
          else {
            const url = absolute(el.getAttribute(attr), base);
            if (url) el.setAttribute(attr, url);
            else el.removeAttribute(attr);
          }
        }
        if (el.tagName === "IMG" && !el.getAttribute("src")) {
          const lazy =
            el.getAttribute("data-src") ||
            el.getAttribute("data-lazy-src") ||
            el.getAttribute("data-original");
          if (lazy) el.setAttribute("src", lazy);
        }
        for (const attr of ["srcset", "data-srcset"])
          if (
            el.hasAttribute(attr) &&
            !el.getAttribute(attr).includes("data:")
          ) {
            const candidates = [];
            for (const candidate of el.getAttribute(attr).split(",")) {
              const [url, ...descriptor] = candidate.trim().split(/\s+/);
              if (url)
                candidates.push(
                  [await asset(url, base), ...descriptor].join(" "),
                );
            }
            el.setAttribute(attr, candidates.join(", "));
          }
        if (["use", "image"].includes(el.tagName.toLowerCase()))
          for (const attr of ["href", "xlink:href"])
            if (el.hasAttribute(attr))
              el.setAttribute(attr, await asset(el.getAttribute(attr), base));
        for (const attr of ["href", "action"])
          if (el.hasAttribute(attr)) {
            if (["use", "image"].includes(el.tagName.toLowerCase())) continue;
            const value = el.getAttribute(attr);
            if (/^(?:#|mailto:|tel:)/i.test(value)) continue;
            const url = absolute(value, base);
            if (
              url &&
              el.tagName === "A" &&
              resources.has(url) &&
              mediaType(resources.get(url), url)
            ) {
              el.setAttribute(attr, await asset(value, base));
              continue;
            }
            if (url) {
              const original = resources.get(url)?.url || url;
              let fragment = "";
              try {
                fragment = new URL(value, base).hash;
              } catch {}
              el.setAttribute(attr, original + fragment);
            } else el.removeAttribute(attr);
          }
      }
      const title = (
        doc.title.trim() ||
        new URL(record.url).pathname ||
        "Home"
      ).slice(0, 300);
      const meta = (selector) =>
        (doc.querySelector(selector)?.getAttribute("content") || "").trim();
      const url = new URL(record.url),
        slug =
          decodeURIComponent(url.pathname)
            .toLowerCase()
            .replace(/^\/+|\/+$/g, "")
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 150) || "home";
      output.push({
        key,
        title,
        slug,
        url: record.url,
        parent_key: "",
        html: doc.documentElement.outerHTML,
        css: styles.join("\n"),
        js: scripts.join("\n;\n"),
        seo: {
          title,
          description: meta('meta[name="description"]').slice(0, 1000),
          canonical: absolute(
            doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
              record.url,
            base,
          ),
          indexing: /noindex/i.test(meta('meta[name="robots"]'))
            ? "noindex"
            : "default",
          social_title: meta('meta[property="og:title"]').slice(0, 300),
          social_description: meta('meta[property="og:description"]').slice(
            0,
            1000,
          ),
          social_image: absolute(meta('meta[property="og:image"]'), base),
        },
      });
    }
    for (const item of output) {
      const path =
        new URL(item.url).pathname
          .replace(/\/$/, "")
          .split("/")
          .slice(0, -1)
          .join("/") + "/";
      const parent =
        path !== "/" &&
        output.find((p) => p.url === new URL(path, item.url).href);
      if (parent && parent.key !== item.key) item.parent_key = parent.key;
    }
    const first = output[0],
      { doc, base } = documents.get(first.url),
      seen = new Set();
    for (const link of doc.querySelectorAll("nav a[href]")) {
      const url = absolute(link.getAttribute("href"), base),
        target = output.find((p) => p.url === (resources.get(url)?.url || url));
      if (target && link.textContent.trim() && !seen.has(target.key)) {
        navigation.push({
          key: target.key,
          label: link.textContent.trim().slice(0, 150),
        });
        seen.add(target.key);
      }
    }
    if (output.some((p) => p.js.trim()))
      notes.add(
        "Captured scripts will run on imported pages when Keep website interactions is enabled. Use a source you trust.",
      );
    notes.add(
      "Review the imported layout and behavior. Forms, logins, stores, and JavaScript apps may need rebuilding in WordPress.",
    );
    return M.validate({
      format: "little-studio-website",
      version: 1,
      site_id: "capture-" + (await hash(encoder.encode(source))).slice(0, 24),
      title: first.title,
      site_css: "",
      pages: output,
      assets,
      fonts: [],
      site: { home_key: first.key, navigation },
      capture: {
        source,
        engine: "Little Studio public website capture",
        complete: ![...notes].some((note) =>
          /could not (?:package|be packaged)|left external|External file needs review/i.test(
            note,
          ),
        ),
        warnings: [...notes],
      },
    });
  }
  const serializable = (project) =>
    JSON.stringify(
      project,
      (key, value) =>
        key === "bytes" && value instanceof Uint8Array ? undefined : value,
      2,
    );
  let busy = false,
    cancelled = false,
    session = null,
    sequence = 0,
    records = [],
    pending = false;
  const dialog = $("#lse-capture-dialog"),
    form = $("#lse-capture-form"),
    status = $("#lse-capture-status"),
    start = $("#lse-capture-start"),
    retry = $("#lse-capture-retry");
  const buttons = () => {
    start.disabled = busy;
    form.querySelectorAll("input,select").forEach((el) => (el.disabled = busy));
    $("#lse-capture-close").textContent = busy ? "Cancel capture" : "Close";
  };
  const cleanup = async () => {
    const old = session;
    session = null;
    if (old)
      try {
        await A.request("capture_cancel", { capture: old });
      } catch {}
  };
  async function run(resume = false) {
    if (busy || A.busy || window.LSEManage?.busy) return;
    busy = true;
    cancelled = false;
    retry.hidden = true;
    buttons();
    try {
      if (!resume) {
        records = [];
        sequence = 0;
        status.textContent = "Starting website capture…";
        const job = await A.request("capture_start", {
          url: $("#lse-capture-url").value,
        });
        session = job.capture;
      }
      while (!cancelled) {
        pending = true;
        const step = await A.request("capture_batch", {
          capture: session,
          seq: sequence,
        });
        pending = false;
        if (cancelled) break;
        records.push(...step.records);
        sequence = step.seq;
        if (step.done) {
          status.textContent = "Packaging your website JSON…";
          const notes = Object.values(step.warnings || {});
          if (step.truncated)
            notes.push(
              "The capture reached a page, depth, or resource limit. Some linked content was not included.",
            );
          const project = await packageWebsite(
            $("#lse-capture-url").value,
            records,
            notes,
          );
          project.capture.failed_resources = step.failed_resources || [];
          project.capture.complete =
            project.capture.complete !== false &&
            !step.truncated &&
            !project.capture.failed_resources.length;
          records = [];
          if (cancelled) break;
          await cleanup();
          busy = false;
          buttons();
          dialog.close();
          // Explicitly open a new import so capture cannot silently replace a selected website.
          $("#lse-new-import").click();
          await A.chooseProject(
            project,
            new URL($("#lse-capture-url").value).hostname + ".website.json",
          );
          return;
        }
        status.textContent = step.message;
      }
      await cleanup();
      status.textContent =
        "Capture cancelled. No WordPress pages were created.";
    } catch (error) {
      pending = false;
      if (cancelled) {
        await cleanup();
        records = [];
        status.textContent = "Capture cancelled.";
      } else {
        status.textContent = error.message;
        retry.hidden = !session;
      }
    } finally {
      pending = false;
      busy = false;
      buttons();
    }
  }
  function close() {
    if (busy) {
      cancelled = true;
      status.textContent = pending
        ? "Cancelling after the current request…"
        : "Cancelling…";
    } else {
      cleanup();
      records = [];
      dialog.close();
    }
  }
  function open() {
    if (A.busy || window.LSEManage?.busy) return;
    dialog.showModal();
    $("#lse-capture-url").focus();
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });
  retry.addEventListener("click", () => run(true));
  $("#lse-capture-close").addEventListener("click", close);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  document
    .querySelectorAll("[data-capture-open]")
    .forEach((el) => el.addEventListener("click", open));
  $("#lse-source-download").addEventListener("click", () => {
    if (!A.project) return;
    const url = URL.createObjectURL(
        new Blob([serializable(A.project)], { type: "application/json" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = "website.website.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.LSECapture = {
    packageWebsite,
    get busy() {
      return busy;
    },
  };
})();
