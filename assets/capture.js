(() => {
  "use strict";
  const A = window.LSEAdmin,
    M = window.LSEConverter,
    $ = (s) => document.querySelector(s);
  const bytes = (data) =>
    Uint8Array.fromBase64
      ? Uint8Array.fromBase64(data)
      : Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
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
      "application/x-pdf": "application/pdf",
      "application/font-woff": "font/woff",
      "application/x-font-woff": "font/woff",
      "application/font-woff2": "font/woff2",
      "application/x-font-ttf": "font/ttf",
      "application/x-font-opentype": "font/otf",
      "application/vnd.ms-fontobject": "",
    };
    let type = aliases[record.type] ?? record.type;
    if (type === "text/plain" && /\.vtt$/i.test(new URL(url).pathname))
      type = "text/vtt";
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
          pdf: "application/pdf",
          vtt: "text/vtt",
        }[new URL(url).pathname.split(".").pop().toLowerCase()] || type;
    return /^(?:image\/(?:jpeg|png|gif|webp|avif|svg\+xml)|font\/(?:woff2?|ttf|otf)|video\/(?:mp4|webm)|audio\/(?:mpeg|wav|ogg)|application\/pdf|text\/vtt)$/.test(
      type,
    )
      ? type
      : "";
  };
  async function packageWebsite(
    source,
    records,
    warnings = [],
    onStage = () => {},
  ) {
    const pause = M.browserTimeSlice();
    source = absolute(source, source);
    const resources = new Map(),
      assets = [],
      assetMap = new Map(),
      byHash = new Map(),
      notes = new Set(warnings);
    for (const r of records) {
      if (r.kind !== "redirect") resources.set(r.url, r);
      resources.set(r.requested, r);
    }
    const startPage = resources.get(source)?.url || source;
    const pagesByURL = new Map(
      records
        .filter(
          (record) => record.kind === "page" && record.type === "text/html",
        )
        .map((record) => [record.url, record]),
    );
    const queryAliases = new Map();
    const pages = [...pagesByURL.values()].filter((record) => {
      const url = new URL(record.url);
      if (!url.search || record.url === startPage) return true;
      url.search = "";
      const canonical = pagesByURL.get(url.href);
      // Gallery state and tracking links can return exactly the same page.
      // Only collapse a query URL if the capture also has its identical base page.
      if (!canonical || canonical.data !== record.data) return true;
      const aliases = queryAliases.get(canonical.url) || [];
      aliases.push(record.url);
      queryAliases.set(canonical.url, aliases);
      return false;
    });
    const duplicates = pagesByURL.size - pages.length;
    if (duplicates)
      notes.add(
        "Combined " +
          duplicates +
          " query variants with identical captured pages.",
      );
    const startIndex = pages.findIndex((page) => page.url === startPage);
    if (startIndex > 0) pages.unshift(...pages.splice(startIndex, 1));
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
      if (assetsByURL.has(url)) return url + fragment;
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
      let body = bytes(record.data);
      let data = "data:" + type + ";base64," + record.data;
      if (type === "image/svg+xml") {
        const svg = new TextDecoder().decode(body);
        // Discard legacy external SVG DTD identifiers as text, before any
        // browser or WordPress parser sees the document.
        const cleaned = svg.replace(
          /^(\s*(?:<\?xml[^?]*\?>\s*)?)<!DOCTYPE\s+svg(?:\s+PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')|\s+SYSTEM\s+(?:"[^"]*"|'[^']*'))?\s*>/i,
          "$1",
        );
        if (/<!DOCTYPE|<!ENTITY/i.test(cleaned)) {
          notes.add(
            "An SVG with document declarations was left external: " + url,
          );
          return url + fragment;
        }
        if (cleaned !== svg) {
          body = encoder.encode(cleaned);
          data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(new Blob([body], { type }));
          });
        }
      }
      const digest = await hash(body);
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
        data,
      };
      assets.push(item);
      assetsByURL.set(packaged, item);
      nameAsset(item, url, hint);
      assetMap.set(url, packaged);
      byHash.set(type + digest, packaged);
      return packaged + fragment;
    };
    const spriteSheets = new Map();
    async function packageIcons(doc, base) {
      const externalSymbol = (ref) => {
        const url = absolute(ref, base);
        const record = resources.get(url);
        if (
          !ref.includes("#") ||
          !record ||
          mediaType(record, url) !== "image/svg+xml"
        )
          return null;
        if (!spriteSheets.has(url)) {
          const xml = text(record);
          spriteSheets.set(
            url,
            /<!DOCTYPE|<!ENTITY/i.test(xml)
              ? null
              : new DOMParser().parseFromString(xml, "image/svg+xml"),
          );
        }
        return spriteSheets
          .get(url)
          ?.getElementById(new URL(ref, base).hash.slice(1));
      };
      for (const { svg, data } of M.iconSources(doc, externalSymbol)) {
        const encoded = encoder.encode(data);
        const digest = await hash(encoded);
        const url =
          "https://little-studio-assets.invalid/icons/" + digest + ".svg";
        if (!resources.has(url))
          resources.set(url, {
            type: "image/svg+xml",
            data: await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result.split(",")[1]);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(new Blob([encoded]));
            }),
          });
        svg.setAttribute(
          "data-lse-icon-asset",
          await asset(url, base, svg.getAttribute("aria-label") || "Icon"),
        );
      }
    }
    const css = async (input, base, stack = []) => {
      // Yield before recursive imports; valid deep acyclic stylesheets have no arbitrary cutoff.
      await Promise.resolve();
      input = input.replace(/@font-face\s*\{[^{}]*\}/gi, (face) => {
        const sources = M.cssReferences(face);
        if (
          !sources.some((token) => {
            const url = absolute(token.value, base),
              record = resources.get(url);
            return record && mediaType(record, url)?.startsWith("font/");
          })
        )
          return face;
        return face.replace(
          /(\bsrc\s*:)\s*([^;}]+)/gi,
          (decl, prop, values) => {
            const entries = values
              .split(/,(?=\s*(?:url|local)\()/i)
              .filter((value) => {
                const url = M.cssReferences(value)[0]?.value;
                return !url || !/\.(?:eot|svg)(?:[?#]|$)/i.test(url);
              });
            return entries.length ? prop + entries.join(",") : "";
          },
        );
      });
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
      navigation = [];
    let home;
    for (const [index, record] of pages.entries()) {
      onStage("Packaging page " + (index + 1) + " of " + pages.length);
      const turn = pause();
      if (turn) await turn;
      const doc = new DOMParser().parseFromString(text(record), "text/html");
      const pageTitle =
        doc.title.trim() || doc.querySelector("h1")?.textContent.trim();
      contextTitle = pageTitle || new URL(record.url).hostname;
      notesFor(doc);
      function notesFor(document) {
        for (const warning of M.prepareSource(document)) notes.add(warning);
      }
      const base =
        absolute(
          doc.querySelector("base[href]")?.getAttribute("href") || record.url,
          record.url,
        ) || record.url;
      await packageIcons(doc, base);
      if (index === 0) home = { doc, base };
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
        if (
          /^https?:\/\/use\.typekit\.net\//i.test(
            absolute(script.getAttribute("src"), base) || "",
          )
        ) {
          notes.add(
            "The source loads Adobe Fonts through JavaScript. Configure its licensed font families on the destination to match line breaks and spacing.",
          );
          script.remove();
          continue;
        }
        const kind = M.sourceScriptKind({
          id: script.id,
          src: absolute(script.getAttribute("src"), base),
          type: script.getAttribute("type") || "",
          code: script.textContent,
        });
        if (kind === "analytics") {
          notes.add(
            "Source analytics scripts were omitted. Configure analytics on the destination separately.",
          );
        } else if (kind === "framework") {
          notes.add(
            "The source WordPress/Elementor runtime was omitted; the destination supplies its own runtime.",
          );
        } else if (kind === "script") {
          if (script.src) {
            const url = absolute(script.getAttribute("src"), base),
              code = resources.get(url);
            if (code) scripts.push(text(code));
            else notes.add("A script could not be packaged: " + url);
          } else scripts.push(script.textContent);
        } else if (kind === "module")
          notes.add(
            "This site uses JavaScript modules. App behavior needs manual rebuilding.",
          );
        script.remove();
      }
      for (const node of doc.querySelectorAll("base,meta[http-equiv]"))
        node.remove();
      for (const el of doc.querySelectorAll("*")) {
        const turn = pause();
        if (turn) await turn;
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
        // Galleries often keep their next image on a button, rather than an
        // <img>. Package known media records without treating arbitrary data
        // values (API routes, product IDs, etc.) as downloadable files.
        for (const attr of [...el.attributes]) {
          if (!attr.name.startsWith("data-")) continue;
          const url = absolute(attr.value, base);
          const record = url && resources.get(url);
          if (record && mediaType(record, url))
            el.setAttribute(attr.name, await asset(attr.value, base));
        }
        for (const attr of [
          "src",
          "poster",
          "data-src",
          "data-lazy-src",
          "data-original",
          "data-original-src",
          "data-ll-src",
        ]) {
          if (!el.hasAttribute(attr)) continue;
          if (
            ["IMG", "SOURCE", "VIDEO", "AUDIO", "INPUT", "TRACK"].includes(
              el.tagName,
            )
          )
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
        for (const attr of [
          "srcset",
          "data-srcset",
          "data-lazy-srcset",
          "data-original-srcset",
        ])
          if (
            el.hasAttribute(attr) &&
            !el.getAttribute(attr).includes("data:")
          ) {
            const candidates = [];
            for (const candidate of el.getAttribute(attr).split(",")) {
              const [url, ...descriptor] = candidate.trim().split(/\s+/);
              const packaged = url ? await asset(url, base) : "";
              if (packaged)
                candidates.push([packaged, ...descriptor].join(" "));
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
            const value = el.getAttribute(attr).trim();
            if (/^(?:#|mailto:|tel:)/i.test(value)) {
              el.setAttribute(attr, value);
              continue;
            }
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
              if (
                el.tagName === "A" &&
                !resources.has(url) &&
                new URL(url).origin === new URL(base).origin
              ) {
                notes.add(
                  "Link kept on source site (no captured destination): " + url,
                );
              }
              let fragment = "";
              try {
                fragment = new URL(value, base).hash;
              } catch {}
              el.setAttribute(attr, original + fragment);
            } else el.removeAttribute(attr);
          }
      }
      const title = (pageTitle || new URL(record.url).pathname || "Home").slice(
        0,
        300,
      );
      const meta = (selector) =>
        (doc.querySelector(selector)?.getAttribute("content") || "").trim();
      let path = new URL(record.url).pathname;
      try {
        path = decodeURIComponent(path);
      } catch {
        // A malformed URL escape should not discard the rest of the capture.
      }
      const slug =
        path
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
        ...(queryAliases.has(record.url) && {
          url_aliases: queryAliases.get(record.url),
        }),
        html:
          (doc.doctype
            ? new XMLSerializer().serializeToString(doc.doctype)
            : "") + doc.documentElement.outerHTML,
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
          indexing: [...doc.querySelectorAll('meta[name="robots" i]')].some(
            (node) =>
              /(?:^|[\s,])(?:noindex|none)(?:[\s,]|$)/i.test(node.content),
          )
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
      { doc, base } = home,
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
    const menu = M.headerMenu(
      doc.querySelector(
        "header nav.header-nav-list, header nav.elementor-nav-menu--main",
      ),
      base,
    );
    if (menu) {
      const mapItems = (items) =>
        items.map((item) => {
          const target = output.find((p) => p.url === item.url);
          return {
            ...item,
            ...(target && { key: target.key }),
            ...(item.children && { children: mapItems(item.children) }),
          };
        });
      navigation.splice(0, navigation.length, ...mapItems(menu));
    }
    if (output.some((p) => p.js.trim()))
      notes.add(
        "Captured scripts will run on imported pages when Keep website interactions is enabled. Use a source you trust.",
      );
    notes.add(
      "Review the imported layout and behavior. Forms, logins, stores, and JavaScript apps may need rebuilding in WordPress.",
    );
    // Rewrite references discovered on later pages too, including URLs inside
    // source JavaScript and gallery data attributes. Keep these on the same
    // packaged media as the editable native Image widgets.
    onStage("Rewriting packaged media references");
    const packagedMedia = Object.freeze(Object.fromEntries(assetMap));
    for (const page of output) {
      const turn = pause();
      if (turn) await turn;
      for (const field of ["html", "css", "js"])
        page[field] = M.rewrite(page[field], packagedMedia);
    }
    onStage("Validating captured page data");
    return M.validateAsync({
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
  async function websiteDownload(project) {
    const { pages, assets, ...metadata } = project;
    const parts = [JSON.stringify(metadata).slice(0, -1), ',"pages":['];
    for (const [index, page] of pages.entries()) {
      if (index) parts.push(",");
      parts.push(new Blob([JSON.stringify(await M.readCapturePage(page))]));
    }
    parts.push('],"assets":[');
    for (const [index, asset] of assets.entries()) {
      if (index) parts.push(",");
      parts.push(JSON.stringify(asset));
    }
    parts.push("]}");
    return new Blob(parts, { type: "application/json" });
  }
  async function convertWebsite(project, onPage, onFailure, isCancelled) {
    const resources = M.resourceSession(project);
    const large =
      project.pages.reduce((n, p) => n + p.css.length + p.js.length, 0) >
      32 * 1024 * 1024;
    const pages = [];
    try {
      for (const [index, page] of project.pages.entries()) {
        while (!isCancelled()) {
          onPage(page, index + 1, project.pages.length);
          try {
            const {
              elements,
              css,
              warnings,
              layout_review,
              regions,
              structure,
              source,
              emptyBody,
            } = await M.convert(project, page, {
              layout: "elementor_canvas",
              preserveCSS: true,
              resources,
            });
            if (emptyBody) {
              for (const warning of warnings)
                if (!project.capture.warnings.includes(warning))
                  project.capture.warnings.push(warning);
              project.capture.complete = false;
              (project.capture.failed_resources ||= []).push({
                url: page.url,
                kind: "page",
                role: "body",
                error: "No editable body content was present in the source.",
              });
              project.capture.warnings.push(
                "Skipped page with no editable body · " +
                  page.title +
                  " · " +
                  page.url,
              );
              break;
            }
            const elementor = window.LSENative.validateTemplate({
              version: "0.4",
              type: "page",
              title: page.title,
              page_settings: { template: "elementor_canvas" },
              content: elements,
            });
            window.LSENative.requireWidgets(elementor);
            const converted = {
              ...page,
              js: source.js.trim(),
              elementor,
              conversion: {
                version: 1,
                css,
                warnings,
                layout_review,
                regions,
                structure,
              },
            };
            if (large) {
              // Keep the native controls available for review. Park the much larger
              // source and rendered styles outside the JS heap until saving this page.
              converted.capturePayload = new Blob(
                [
                  JSON.stringify({
                    css: page.css,
                    js: converted.js,
                    convertedCSS: css,
                  }),
                ],
                { type: "application/json" },
              );
              converted.captureScripts = Boolean(converted.js);
              converted.css = converted.js = converted.conversion.css = "";
              page.css = page.js = "";
            }
            pages.push(converted);
            break;
          } catch (error) {
            if (isCancelled()) return null;
            const detail =
              page.title + " (" + page.url + ") · " + error.message;
            project.capture.warnings.push("Page conversion failed · " + detail);
            const decision = await onFailure(detail);
            if (decision === "cancel") return null;
            if (decision === "skip") {
              project.capture.complete = false;
              project.capture.warnings.push("Skipped page · " + detail);
              break;
            }
          }
        }
        if (isCancelled()) return null;
      }
      if (!pages.length)
        throw Error(
          "No captured page contained importable body content. " +
            project.capture.warnings.at(-1),
        );
      const included = new Set(pages.map((page) => page.key));
      for (const page of pages) {
        if (!included.has(page.parent_key)) page.parent_key = "";
      }
      const site = {
        ...project.site,
        home_key: included.has(project.site.home_key)
          ? project.site.home_key
          : "",
        navigation: project.site.navigation.flatMap(function keep(item) {
          const children = (item.children || []).flatMap(keep);
          if (included.has(item.key)) return [{ ...item, children }];
          if (item.url) return [{ label: item.label, url: item.url, children }];
          return children;
        }),
      };
      return { ...project, pages, site };
    } finally {
      resources.dispose();
    }
  }
  // Store browser delivery checkpoints before acknowledging the next server batch.
  const checkpointKey = "lse-scan:" + LSE_CONFIG.ajax + ":" + LSE_CONFIG.userId;
  const scanLifetime = 60 * 60 * 1000;
  let checkpointDB;
  function scanState(state) {
    try {
      if (state === null) localStorage.removeItem(checkpointKey);
      if (state) localStorage.setItem(checkpointKey, JSON.stringify(state));
      const saved = JSON.parse(localStorage.getItem(checkpointKey) || "null");
      return saved?.expires > Date.now() ? saved : null;
    } catch {
      return null;
    }
  }
  function scanStorage(mode, work) {
    if (!checkpointDB) {
      checkpointDB = new Promise((resolve, reject) => {
        const open = indexedDB.open(checkpointKey, 1);
        open.onupgradeneeded = () => {
          open.result
            .createObjectStore("batches")
            .createIndex("storedAt", "storedAt");
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }
    return checkpointDB.then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction("batches", mode);
          const result = work(transaction.objectStore("batches"));
          transaction.oncomplete = () =>
            resolve(typeof result === "function" ? result() : result.result);
          transaction.onabort = () => reject(transaction.error);
          transaction.onerror = () => reject(transaction.error);
        }),
    );
  }
  const scanRange = (id) =>
    IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
  function savedRecords(id) {
    return scanStorage("readonly", (store) => {
      const records = [];
      const request = store.openCursor(scanRange(id));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        for (const record of cursor.value.records) records.push(record);
        cursor.continue();
      };
      return () => records;
    });
  }
  async function saveBatch(id, from, step) {
    return scanStorage("readwrite", (store) =>
      store.put({ ...step, storedAt: Date.now() }, [id, from]),
    );
  }
  function pruneScans() {
    return scanStorage("readwrite", (store) => {
      const expired = IDBKeyRange.upperBound(Date.now() - 2 * scanLifetime);
      const request = store.index("storedAt").openKeyCursor(expired);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      return request;
    }).catch(() => {});
  }
  function finalMetadata({ done, failed_resources, truncated, warnings }) {
    return { done, failed_resources, truncated, warnings };
  }
  async function discardScan(id) {
    if (scanState()?.capture === id) scanState(null);
    try {
      await scanStorage("readwrite", (store) => store.delete(scanRange(id)));
    } catch {}
  }
  let busy = false,
    cancelled = false,
    session = null,
    sequence = 0,
    records = [],
    pending = false,
    pageDecision = null,
    failureReport = "",
    capturedCount = 0,
    capturedBytes = 0,
    durable = false,
    finalBatch = null,
    background = false;
  const scanSummary = (phase) =>
    window.LSEReports.checkpoint({
      phase,
      source: $("#lse-capture-url").value,
      records: capturedCount,
      bytes: capturedBytes,
    });
  const dialog = $("#lse-capture-dialog"),
    form = $("#lse-capture-form"),
    status = $("#lse-capture-status"),
    start = $("#lse-capture-start"),
    importWebsite = $("#lse-capture-import"),
    startBackground = $("#lse-capture-background"),
    retry = $("#lse-capture-retry"),
    skipPage = $("#lse-capture-skip"),
    copy = $("#lse-capture-copy"),
    resumeScan = $("#lse-capture-resume");
  let importAfterScan = false;
  async function decidePageFailure(detail) {
    status.textContent =
      "Could not convert " + detail + ". Retry or skip this page.";
    retry.hidden = false;
    skipPage.hidden = false;
    retry.focus();
    try {
      return await new Promise((resolve) => {
        pageDecision = resolve;
      });
    } finally {
      pageDecision = null;
      retry.hidden = true;
      skipPage.hidden = true;
    }
  }
  const buttons = () => {
    start.disabled = startBackground.disabled = importWebsite.disabled = busy;
    form.querySelector("[data-lse-background]").hidden = !busy;
    window.dispatchEvent(new Event("lse:busy-changed"));
    form.querySelectorAll("input,select").forEach((el) => (el.disabled = busy));
    $("#lse-capture-close").textContent = busy ? "Cancel capture" : "Close";
  };
  const cleanup = async () => {
    const old = session;
    session = null;
    records = [];
    finalBatch = null;
    if (old) {
      await discardScan(old);
      try {
        await A.request("capture_cancel", { capture: old });
      } catch {}
    }
  };
  async function run(resume = false, startOnServer = false, importNow = false) {
    if (busy || A.busy || window.LSEManage?.busy) return;
    if (!window.LSE_CONFIG?.elementor) {
      status.textContent = "Activate Elementor before scanning a website.";
      return;
    }
    if (!resume) importAfterScan = importNow;
    busy = true;
    cancelled = false;
    copy.hidden = true;
    resumeScan.hidden = true;
    retry.hidden = true;
    buttons();
    try {
      if (resume && !session) {
        const saved = scanState() || (await A.request("capture_active", {}));
        if (!saved.capture)
          throw Error("The scan checkpoint expired. Scan the website again.");
        session = saved.capture;
        $("#lse-capture-url").value = saved.url;
        sequence = saved.seq ?? 0;
        capturedCount = saved.count ?? 0;
        capturedBytes = saved.bytes ?? 0;
        background = saved.background ?? saved.seq === undefined;
        durable = true;
        importAfterScan = saved.importAfterScan === true;
        if (saved.done) {
          const stored = await scanStorage("readonly", (store) =>
            store.get([session, saved.last]),
          );
          if (!stored)
            throw Error(
              "The saved scan files expired. Scan the website again.",
            );
          finalBatch = finalMetadata(stored);
        }
      }
      if (!resume) {
        await cleanup();
        void pruneScans();
        sequence = capturedBytes = capturedCount = 0;
        finalBatch = null;
        durable = true;
        status.textContent = "Starting website scan…";
        scanSummary(status.textContent);
        const job = await A.request("capture_start", {
          url: $("#lse-capture-url").value,
          background: startOnServer,
        });
        session = job.capture;
        background = !!job.background;
        scanState({
          capture: session,
          background,
          importAfterScan,
          url: $("#lse-capture-url").value,
          seq: 0,
          count: 0,
          bytes: 0,
          expires: Date.now() + scanLifetime,
        });
      }
      if (resume && background && !finalBatch)
        await A.request("capture_restart_worker", { capture: session });
      while (!cancelled) {
        pending = true;
        scanSummary(
          finalBatch
            ? "Preparing captured files"
            : "Waiting for scan batch after record " + sequence,
        );
        const step =
          finalBatch ||
          (await A.request(background ? "capture_delivery" : "capture_batch", {
            capture: session,
            seq: sequence,
          }));
        pending = false;
        if (cancelled) break;
        if (step.waiting) {
          status.textContent =
            step.message +
            " You can close this tab and come back to Resume scan.";
          await new Promise((resolve) => setTimeout(resolve, 2500));
          continue;
        }
        if (!finalBatch) {
          const from = sequence;
          const batchRecords = step.records;
          if (durable) {
            try {
              await saveBatch(session, sequence, step);
            } catch {
              records = await savedRecords(session).catch(() => []);
              if (records.length !== capturedCount)
                throw Error(
                  "The browser could not read the saved scan files. Scan the website again.",
                );
              durable = false;
              await discardScan(session);
            }
          }
          if (!durable) records.push(...batchRecords);
          capturedCount += batchRecords.length;
          capturedBytes += batchRecords.reduce(
            (sum, record) => sum + record.data.length,
            0,
          );
          sequence = step.seq;
          if (durable)
            scanState({
              importAfterScan,
              last: from,
              capture: session,
              background,
              url: $("#lse-capture-url").value,
              seq: sequence,
              count: capturedCount,
              bytes: capturedBytes,
              done: step.done,
              expires: Date.now() + scanLifetime,
            });
        }
        if (step.done) {
          finalBatch = finalMetadata(step);
          if (cancelled) break;
          status.textContent = "Preparing your website for import…";
          scanSummary(status.textContent);
          const notes = Object.values(step.warnings || {});
          if (step.truncated)
            notes.push(
              "The capture reached a page, depth, or resource limit. Some linked content was not included.",
            );
          const raw = durable ? await savedRecords(session) : records;
          if (raw.length !== capturedCount)
            throw Error(
              "Some browser scan files are missing. Scan the website again.",
            );
          const project = await packageWebsite(
            $("#lse-capture-url").value,
            raw,
            notes,
            (phase) => {
              status.textContent = phase;
              scanSummary(phase);
            },
          );
          if (durable) raw.length = 0;
          project.capture.failed_resources = step.failed_resources || [];
          project.capture.complete =
            project.capture.complete !== false &&
            !step.truncated &&
            !project.capture.failed_resources.length;
          if (cancelled) break;
          const converted = await convertWebsite(
            project,
            (page, index, total) => {
              status.textContent =
                "Converting page " +
                index +
                " of " +
                total +
                " · " +
                page.title;
              scanSummary(status.textContent);
            },
            decidePageFailure,
            () => cancelled,
          );
          if (!converted || cancelled) break;
          const filename =
            new URL(project.capture.source).hostname + ".elementor.json";
          dialog.close();
          $("#lse-reset").click();
          window.LSEManage?.scanCompleted();
          scanSummary("Checking captured pages");
          await A.chooseProject(converted, filename, {
            showReview: !importAfterScan,
          });
          if (A.project === converted) {
            await cleanup();
            if (importAfterScan) {
              $("#lse-scripts").checked = false;
              await A.run({ background: true });
            } else {
              scanSummary("Choose the pages to import.");
            }
          }
          return;
        }
        status.textContent = step.message;
        scanSummary(status.textContent);
      }
      await cleanup();
      status.textContent = "Scan cancelled. No WordPress pages were created.";
      scanSummary(status.textContent);
    } catch (error) {
      pending = false;
      if (cancelled) {
        await cleanup();
        status.textContent = "Capture cancelled.";
        scanSummary(status.textContent);
      } else {
        status.textContent = error.message;
        scanSummary(error.message);
        failureReport = [
          "LS Elementor scan report",
          "Plugin " +
            window.LSE_CONFIG.version +
            " · " +
            new Date().toISOString(),
          window.LSEReports.describe({
            ...error.lseDetails,
            phase: "Scanning the source website",
            item: { url: $("#lse-capture-url").value },
            message: error.message,
          }),
        ].join("\n");
        if (
          /source website is under maintenance|capture (?:session )?(?:has )?expired|capture (?:cache )?is unavailable|saved scan files expired|capture sequence changed|invalid capture session|scan files are missing|could not read the saved scan files/i.test(
            error.message,
          )
        )
          await cleanup();
        if (!session) records = [];
        retry.hidden = !session;
        copy.hidden = !!session;
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
      pageDecision?.("cancel");
      status.textContent = pending
        ? "Cancelling after the current request…"
        : "Cancelling…";
    } else {
      cleanup();
      dialog.close();
      window.LSEManage?.scanClosed();
    }
  }
  const rendererButton = $("#lse-render-submit"),
    rendererStatus = $("#lse-render-task");
  let renderTask,
    pollTimer,
    rendererBusy = false;
  function showRenderer(result) {
    const previousState = renderTask?.state;
    renderTask = result.task;
    rendererButton.hidden =
      !result.online ||
      (["working", "waiting", "queued"].includes(renderTask?.state) &&
        Date.now() / 1000 - renderTask.updated < 120);
    importWebsite.hidden = result.online;
    rendererStatus.hidden = !renderTask?.id || renderTask.state === "submitted";
    rendererStatus.querySelector("span").textContent =
      renderTask?.message || "";
    rendererStatus.querySelector("[data-render-copy]").hidden =
      renderTask?.state !== "failed" || !renderTask.report;
    for (const button of rendererStatus.querySelectorAll(
      "[data-render-choice]",
    ))
      button.hidden =
        renderTask?.state !== "waiting" ||
        !renderTask.choices.includes(button.dataset.renderChoice);
    clearTimeout(pollTimer);
    if (["working", "waiting", "queued"].includes(renderTask?.state))
      pollTimer = setTimeout(refreshRenderer, 5000);
    if (
      renderTask?.state === "submitted" &&
      previousState &&
      previousState !== "submitted"
    )
      window.LSEManage?.reload().catch(() => {});
  }
  async function refreshRenderer() {
    if (
      rendererBusy ||
      new URLSearchParams(location.search).has("lse-renderer")
    )
      return;
    try {
      showRenderer(await A.request("renderer", { operation: "status" }));
    } catch {}
  }
  rendererButton.addEventListener("click", async () => {
    if (!form.reportValidity() || rendererBusy) return;
    rendererBusy = true;
    rendererButton.disabled = true;
    try {
      showRenderer(
        await A.request("renderer", {
          operation: "submit",
          url: $("#lse-capture-url").value,
        }),
      );
      dialog.close();
    } catch (e) {
      status.textContent = e.message;
    } finally {
      rendererBusy = false;
      rendererButton.disabled = false;
    }
  });
  rendererStatus.addEventListener("click", async (e) => {
    if (e.target.matches("[data-render-copy]"))
      return A.copyReport(e.target, renderTask.report);
    if (!e.target.dataset.renderChoice) return;
    try {
      await A.request("renderer", {
        operation: "decide",
        id: renderTask.id,
        issue: renderTask.issue,
        choice: e.target.dataset.renderChoice,
      });
      e.target.hidden = true;
    } catch (err) {
      rendererStatus.querySelector("span").textContent = err.message;
    }
  });
  void refreshRenderer();
  function open() {
    if (A.busy || window.LSEManage?.busy) return;
    if (busy) return;
    status.textContent = "";
    copy.hidden = true;
    retry.hidden = true;
    resumeScan.hidden = !scanState();
    if (resumeScan.hidden)
      A.request("capture_active", {})
        .then((active) => {
          if (!busy && dialog.open && active.capture) resumeScan.hidden = false;
        })
        .catch(() => {});
    dialog.showModal();
    refreshRenderer();
    $("#lse-capture-url").focus();
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });
  importWebsite.addEventListener("click", () => {
    if (form.reportValidity()) run(false, true, true);
  });
  startBackground.addEventListener("click", () => {
    if (form.reportValidity()) run(false, true);
  });
  resumeScan.addEventListener("click", () => run(true));
  copy.addEventListener("click", () => A.copyReport(copy, failureReport));
  window.addEventListener("beforeunload", (event) => {
    if (!busy || (background && session && !finalBatch)) return;
    event.preventDefault();
    event.returnValue = "";
  });
  retry.addEventListener("click", () => {
    if (pageDecision) pageDecision("retry");
    else run(true);
  });
  skipPage.addEventListener("click", () => pageDecision?.("skip"));
  $("#lse-capture-close").addEventListener("click", close);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  document
    .querySelectorAll("[data-export-open]")
    .forEach((el) => el.addEventListener("click", open));
  if (new URLSearchParams(location.search).get("export") === "1") open();
  $("#lse-source-download").addEventListener("click", async () => {
    if (!A.project) return;
    const url = URL.createObjectURL(await websiteDownload(A.project)),
      link = document.createElement("a");
    link.href = url;
    link.download = "website.website.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.LSECapture = {
    packageWebsite,
    hasCheckpoint(url) {
      return scanState()?.url === url;
    },
    get busy() {
      return busy;
    },
  };
})();
