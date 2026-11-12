(function (root) {
  "use strict";
  const string = (v, n = Infinity) => typeof v === "string" && v.length <= n;
  const decodeCSS = (value) =>
    value.replace(/\\([0-9a-f]{1,6}\s?|[\s\S])/gi, (_, escaped) =>
      /^[0-9a-f]/i.test(escaped)
        ? String.fromCodePoint(
            Math.min(0x10ffff, parseInt(escaped, 16)) || 0xfffd,
          )
        : /[\r\n\f]/.test(escaped)
          ? ""
          : escaped,
    );
  // Tokens are located in the original text; comments/strings cannot invent resources.
  function cssReferences(css) {
    const tokens = [];
    let i = 0;
    const space = () => {
      while (/\s/.test(css[i] || "") && i < css.length) i++;
    };
    function value() {
      space();
      const quote = /["']/.test(css[i] || "") ? css[i++] : "";
      let result = "";
      while (i < css.length) {
        const c = css[i++];
        if (c === "\\" && i < css.length) {
          result += c + css[i++];
          continue;
        }
        if (quote ? c === quote : c === ")") {
          if (!quote) i--;
          break;
        }
        result += c;
      }
      return decodeCSS(result.trim());
    }
    while (i < css.length) {
      if (css.startsWith("/*", i)) {
        const end = css.indexOf("*/", i + 2);
        i = end < 0 ? css.length : end + 2;
        continue;
      }
      const start = i,
        rest = css.slice(i);
      if (/^@import\b/i.test(rest)) {
        i += 7;
        space();
        let url = "";
        const fn = css.slice(i).match(/^url\s*\(/i);
        if (fn) {
          i += fn[0].length;
          url = value();
          space();
          if (css[i] === ")") i++;
        } else if (/["']/.test(css[i] || "")) url = value();
        else {
          i++;
          continue;
        }
        const conditionStart = i;
        let level = 0,
          quote = "";
        while (i < css.length) {
          const c = css[i++];
          if (c === "\\") {
            i++;
            continue;
          }
          if (quote) {
            if (c === quote) quote = "";
            continue;
          }
          if (c === '"' || c === "'") quote = c;
          else if (c === "(") level++;
          else if (c === ")") level--;
          else if (c === ";" && !level) break;
        }
        tokens.push({
          kind: "import",
          start,
          end: i,
          value: url,
          condition: css
            .slice(conditionStart, css[i - 1] === ";" ? i - 1 : i)
            .trim(),
        });
        continue;
      }
      const fn = rest.match(/^url\s*\(/i);
      if (fn && (i === 0 || !/[\w-]/.test(css[i - 1]))) {
        i += fn[0].length;
        const url = value();
        space();
        if (css[i] === ")") i++;
        tokens.push({ kind: "url", start, end: i, value: url });
        continue;
      }
      if (css[i] === '"' || css[i] === "'") {
        value();
        continue;
      }
      i++;
    }
    return tokens;
  }
  async function replaceCSSReferences(css, replace) {
    let cursor = 0,
      result = "";
    for (const token of cssReferences(css)) {
      result += css.slice(cursor, token.start) + (await replace(token));
      cursor = token.end;
    }
    return result + css.slice(cursor);
  }
  function importConditions(css, condition) {
    let rest = condition.trim(),
      layer = null,
      supports = null;
    function functionBody(name) {
      if (!rest.startsWith(name + "(")) return null;
      let level = 1,
        quote = "",
        i = name.length + 1;
      const start = i;
      for (; i < rest.length; i++) {
        const c = rest[i];
        if (c === "\\") {
          i++;
          continue;
        }
        if (quote) {
          if (c === quote) quote = "";
          continue;
        }
        if (c === '"' || c === "'") quote = c;
        else if (c === "(") level++;
        else if (c === ")" && !--level) break;
      }
      if (level) throw Error("Unbalanced CSS import condition.");
      const body = rest.slice(start, i);
      rest = rest.slice(i + 1).trim();
      return body;
    }
    if (/^layer(?:\s|$|\()/.test(rest)) {
      layer = functionBody("layer");
      if (layer === null) {
        layer = "";
        rest = rest.slice(5).trim();
      }
    }
    supports = functionBody("supports");
    if (rest) css = "@media " + rest + "{" + css + "}";
    if (supports !== null)
      css =
        "@supports " +
        (/^(?:\(|not\b|selector\()/i.test(supports)
          ? supports
          : "(" + supports + ")") +
        "{" +
        css +
        "}";
    if (layer !== null)
      css = "@layer" + (layer ? " " + layer : "") + "{" + css + "}";
    return css;
  }

  function validate(input) {
    if (
      !input ||
      input.version !== 1 ||
      !["code-canvas", "little-studio-website"].includes(input.format)
    )
      throw Error(
        "Choose a native Little Studio page or website JSON, version 1.",
      );
    // Copy mutable records only; large embedded media strings can be shared safely.
    const p = {
      ...input,
      pages: input.pages?.map((page) => ({ ...page })),
      assets: input.assets?.map((asset) => ({ ...asset })),
      fonts: input.fonts?.map((font) => ({ ...font })),
      site: input.site
        ? {
            ...input.site,
            navigation: input.site.navigation?.map((item) => ({ ...item })),
          }
        : undefined,
    };
    if (p.format === "code-canvas") {
      p.pages = [{ ...p, key: "page-1", slug: "", url: "", parent_key: "" }];
      p.site_css = "";
      p.site_id = "single-page";
    }
    if (
      !Array.isArray(p.pages) ||
      !p.pages.length ||
      !string(p.site_css) ||
      !string(p.site_id, 100) ||
      !/^[\w-]+$/.test(p.site_id)
    )
      throw Error(
        "The website needs pages, a valid site identity and shared CSS.",
      );
    const keys = new Set();
    for (const page of p.pages) {
      if (
        !page ||
        !["key", "title", "html", "css", "js"].every((k) => string(page[k])) ||
        !page.key ||
        page.key.length > 100 ||
        !page.title.trim() ||
        keys.has(page.key)
      )
        throw Error(
          "Every page needs a unique key, title and HTML/CSS/JavaScript.",
        );
      keys.add(page.key);
      page.slug = typeof page.slug === "string" ? page.slug : "";
      page.url = typeof page.url === "string" ? page.url : "";
      page.parent_key = page.parent_key || "";
    }
    for (const page of p.pages) {
      if (
        /(?:\b(?:src|href|poster)\s*=\s*["']|\burl\s*\(\s*["']?)(?:file:|[A-Za-z]:[\\/])/i.test(
          page.html + page.css + page.js,
        )
      )
        throw Error(
          "Local PC file references are not portable. Package the assets in Little Studio first.",
        );
      if (page.seo !== undefined) {
        if (
          !page.seo ||
          typeof page.seo !== "object" ||
          Array.isArray(page.seo)
        )
          throw Error("Invalid SEO metadata.");
        for (const [k, v] of Object.entries(page.seo))
          if (
            typeof v !== "string" ||
            v.length > (["canonical", "social_image"].includes(k) ? 2048 : 1000)
          )
            throw Error("Invalid SEO " + k);
      }
    }
    const parents = new Map(p.pages.map((x) => [x.key, x.parent_key]));
    for (const [key, parent] of parents) {
      const seen = new Set([key]);
      let next = parent;
      while (next) {
        if (!parents.has(next) || seen.has(next))
          throw Error("Page hierarchy contains a missing parent or cycle.");
        seen.add(next);
        next = parents.get(next);
      }
    }
    p.assets = p.assets || [];
    p.fonts = p.fonts || [];
    if (!Array.isArray(p.assets) || !Array.isArray(p.fonts))
      throw Error("Invalid asset or font list.");
    const inline = new Map(),
      extensions = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/avif": "avif",
        "video/mp4": "mp4",
        "video/webm": "webm",
        "audio/mpeg": "mp3",
        "audio/ogg": "ogg",
        "application/pdf": "pdf",
      };
    for (const page of p.pages)
      for (const field of ["html", "css", "js"])
        for (const m of page[field].matchAll(
          /data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)/gi,
        )) {
          if (extensions[m[1]] && !inline.has(m[0])) {
            const name =
                "embedded-" + (inline.size + 1) + "." + extensions[m[1]],
              url = "https://little-studio-assets.invalid/embedded/" + name;
            inline.set(m[0], url);
            p.assets.push({ url, name, type: m[1], data: m[0] });
          }
        }
    for (const page of p.pages)
      for (const field of ["html", "css", "js"])
        for (const [uri, url] of inline)
          page[field] = page[field].split(uri).join(url);
    const urls = new Set();
    for (const a of p.assets) {
      if (
        !a ||
        !["url", "name", "type", "data"].every((k) => string(a[k]) && a[k]) ||
        a.url.length > 2048 ||
        urls.has(a.url) ||
        !a.data.startsWith("data:" + a.type + ";base64,")
      )
        throw Error("An embedded asset is invalid or duplicated.");
      const payload = a.data.slice(a.data.indexOf(",") + 1);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 === 1)
        throw Error("An asset has invalid base64 encoding.");
      let raw;
      try {
        raw = atob(payload);
      } catch {
        throw Error("An asset could not be decoded.");
      }
      if (btoa(raw).replace(/=+$/, "") !== payload.replace(/=+$/, ""))
        throw Error("An asset has noncanonical base64 encoding.");
      a.bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      if (!a.bytes.length) throw Error("An asset is empty.");
      urls.add(a.url);
    }
    for (const f of p.fonts) {
      if (
        !f ||
        !string(f.family, 100) ||
        !string(f.url, 2048) ||
        !urls.has(f.url)
      )
        throw Error("A font is missing its packaged file.");
    }
    p.site = p.site || {
      home_key: p.pages.find((x) => /^(home|index)$/i.test(x.key))?.key || "",
      navigation: [],
    };
    if (
      !p.site ||
      !Array.isArray(p.site.navigation) ||
      (p.site.home_key && !keys.has(p.site.home_key)) ||
      !p.site.navigation.every(
        (n) => n && keys.has(n.key) && string(n.label, 150) && n.label.trim(),
      )
    )
      throw Error("Invalid homepage or navigation records.");
    return p;
  }
  function rewrite(text, map) {
    let result = String(text || "");
    const pairs = [];
    for (const [a, b] of Object.entries(map || {})) {
      if (a) {
        pairs.push(
          [a, b],
          [a.replaceAll("/", "\\/"), String(b).replaceAll("/", "\\/")],
        );
      }
    }
    pairs.sort((a, b) => b[0].length - a[0].length);
    if (!pairs.length) return result;
    const lookup = new Map(pairs);
    return result.replace(
      new RegExp(
        [...lookup.keys()]
          .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|"),
        "g",
      ),
      (m, offset, source) =>
        /^https?:/i.test(m.replaceAll("\\/", "/")) &&
        /[\\\w./%~-]/.test(source.charAt(offset + m.length))
          ? m
          : lookup.get(m),
    );
  }
  function inspect(page) {
    const d = new DOMParser().parseFromString(page.html, "text/html");
    const warnings = [];
    const count = (s) => d.querySelectorAll(s).length;
    if (
      [...d.querySelectorAll("*")].some((n) =>
        [...n.attributes].some((a) => /^on/i.test(a.name)),
      )
    )
      warnings.push(
        "Inline event handlers are removed; move reviewed behaviour into page JavaScript.",
      );
    const externalForms = [...d.querySelectorAll("form")].filter(
      (n) => !n.matches("[data-fr-cost],[data-lse-local-form]"),
    );
    if (externalForms.length)
      warnings.push(
        "Connect " +
          externalForms.length +
          " contact or submission form" +
          (externalForms.length === 1 ? "" : "s") +
          " to a receiving service.",
      );
    if (d.querySelector('[data-widget_type^="lottie."]'))
      warnings.push(
        "A source Lottie animation needs a destination animation widget. Its drawing runtime is not included in native conversion.",
      );
    if (count("iframe,canvas,object,embed"))
      warnings.push(
        "Embedded applications or canvas output require manual rebuilding.",
      );
    if (
      d.querySelector('link[rel~="stylesheet"]') ||
      [
        page.css,
        ...[...d.querySelectorAll("style")].map((node) => node.textContent),
      ].some((css) =>
        cssReferences(css).some((token) => token.kind === "import"),
      )
    )
      warnings.push(
        "External stylesheets are not fetched. Package their CSS before importing.",
      );
    return {
      warnings,
      headings: count("h1,h2,h3,h4,h5,h6"),
      images: count("img"),
      nodes: count("*"),
    };
  }
  function resolveLinks(project, page, map) {
    const aliases = new Map();
    for (const target of project.pages) {
      const dest = map[target.url];
      if (!dest) continue;
      for (const a of [
        target.url,
        target.slug,
        target.slug + ".html",
        "/" + target.slug + "/",
        "/" + target.slug + ".html",
      ])
        if (a) aliases.set(a, dest);
      try {
        const u = new URL(target.url);
        aliases.set(u.pathname, dest);
      } catch {}
    }
    const doc = new DOMParser().parseFromString(page.html, "text/html"),
      assets = new Map();
    for (const a of project.assets) {
      assets.set(a.url, map[a.url] || a.url);
      try {
        assets.set(
          new URL(a.url, page.url || "https://little-studio.invalid/").href,
          map[a.url] || a.url,
        );
      } catch {}
    }
    const assetURL = (value) => {
      if (assets.has(value)) return assets.get(value);
      try {
        return (
          assets.get(
            new URL(value, page.url || "https://little-studio.invalid/").href,
          ) || value
        );
      } catch {
        return value;
      }
    };
    for (const el of doc.querySelectorAll("[src],[poster],[srcset]")) {
      for (const attr of ["src", "poster"])
        if (el.hasAttribute(attr))
          el.setAttribute(attr, assetURL(el.getAttribute(attr)));
      if (
        el.hasAttribute("srcset") &&
        !el.getAttribute("srcset").includes("data:")
      )
        el.setAttribute(
          "srcset",
          el
            .getAttribute("srcset")
            .split(",")
            .map((part) => {
              const bits = part.trim().split(/\s+/);
              bits[0] = assetURL(bits[0]);
              return bits.join(" ");
            })
            .join(", "),
        );
    }
    for (const el of doc.querySelectorAll("[href]")) {
      const href = el.getAttribute("href");
      if (!href || href.startsWith("#") || /^(mailto:|tel:)/i.test(href))
        continue;
      if (assetURL(href) !== href) {
        el.setAttribute("href", assetURL(href));
        continue;
      }
      let result;
      try {
        const own = new URL(href, page.url || "https://little-studio.invalid/");
        const raw = href.split(/[?#]/)[0],
          relative =
            !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//");
        result =
          aliases.get(own.origin + own.pathname) ||
          (relative ? aliases.get(raw) || aliases.get(own.pathname) : null);
        if (result) {
          const u = new URL(result, location.href);
          if (own.search) {
            for (const [k, v] of own.searchParams) u.searchParams.set(k, v);
          }
          u.hash = own.hash;
          el.setAttribute("href", u.href);
        }
      } catch {}
    }
    return doc.documentElement.outerHTML;
  }
  const px = (v) => ({
    unit: "px",
    size: Number.parseFloat(v) || 0,
    sizes: [],
  });
  function dim(s, kind) {
    const sides = ["top", "right", "bottom", "left"];
    const automatic = sides.some((side) => s[kind + "-" + side] === "auto");
    return {
      unit: automatic ? "custom" : "px",
      ...Object.fromEntries(
        sides.map((side) => {
          const value = s[kind + "-" + side];
          return [
            side,
            automatic
              ? value === "auto"
                ? "auto"
                : (parseFloat(value) || 0) + "px"
              : String(parseFloat(value) || 0),
          ];
        }),
      ),
      isLinked: false,
    };
  }
  function radius(value) {
    const parts = value.split("/")[0].trim().split(/\s+/),
      unit = parts[0]?.match(/(px|%|em|rem)$/)?.[1] || "px";
    const values = parts.map((part) => String(parseFloat(part) || 0));
    return {
      unit,
      top: values[0],
      right: values[1] || values[0],
      bottom: values[2] || values[0],
      left: values[3] || values[1] || values[0],
      isLinked: parts.length === 1,
    };
  }
  const safeValue = (v) =>
    !/[{}<>]|javascript\s*:|expression\s*\(|@import/i.test(v);
  const outerProps = [
    "display",
    "position",
    "flex-direction",
    "flex-wrap",
    "justify-content",
    "align-items",
    "align-self",
    "justify-self",
    "justify-items",
    "align-content",
    "grid-auto-flow",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "grid-template-columns",
    "grid-column",
    "grid-row",
    "column-gap",
    "row-gap",
    "order",
    "overflow",
    "opacity",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-radius",
    "box-shadow",
    "clip-path",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "background-repeat",
    "min-height",
    "max-height",
    "object-fit",
    "aspect-ratio",
    "transform",
    "text-decoration",
    "z-index",
  ];
  const innerProps = [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "text-transform",
    "color",
    "text-align",
    "white-space",
    "text-decoration",
  ];
  const reservedAttribute = (name) =>
    /^(?:data-(?:id|element_type|widget_type|settings|model-cid)|data-elementor-(?:id|type|post-type)|data-e-action-hash)$/i.test(
      name,
    );
  const sourceClass = (name) =>
    name === "elementor-invisible"
      ? ""
      : /^(?:elementor(?:-|$)|e-con(?:-|$)|e-(?:parent|child|flex|grid|gallery)(?:-|$))/.test(
            name,
          )
        ? "lse-source-" + name
        : name;
  const sourceClasses = (value) =>
    String(value || "")
      .split(/\s+/)
      .map(sourceClass)
      .filter(Boolean)
      .join(" ");
  function namespaceCSS(css) {
    return css.replace(
      /(--[\w-]+)(?=\s*:)|\bvar\(\s*(--[\w-]+)/g,
      (match, declaration, reference) =>
        declaration
          ? "--lse-source-" + declaration.slice(2)
          : "var(--lse-source-" + reference.slice(2),
    );
  }
  function backgroundSettings(node) {
    try {
      return JSON.parse(node.getAttribute("data-settings") || "{}");
    } catch {
      return {};
    }
  }
  function sourceHTML(node, inner = false) {
    const clone = node.cloneNode(true);
    for (const el of [clone, ...clone.querySelectorAll("*")]) {
      if (el.nodeType !== 1) continue;
      const builder = el.matches(
        "[data-element_type],[data-widget_type],[data-elementor-id],.elementor,.elementor-element",
      );
      if (el.hasAttribute("style"))
        el.setAttribute("style", namespaceCSS(el.getAttribute("style")));
      if (el.hasAttribute("class"))
        el.setAttribute("class", sourceClasses(el.getAttribute("class")));
      if (builder)
        for (const attr of [...el.attributes])
          if (reservedAttribute(attr.name)) el.removeAttribute(attr.name);
    }
    for (const root of inner ? [...clone.children] : [clone])
      root.setAttribute("data-lse-source-content", "");
    return inner ? clone.innerHTML : clone.outerHTML;
  }
  function prepareSource(doc) {
    const warnings = [];
    let galleryIndex = 0;
    let menuIndex = 0;
    for (const menu of doc.querySelectorAll(".elementor-widget-nav-menu")) {
      const toggle = menu.querySelector(".elementor-menu-toggle");
      const panel = menu.querySelector("nav.elementor-nav-menu--dropdown");
      if (toggle && panel) {
        if (!panel.id) panel.id = "lse-menu-panel-" + ++menuIndex;
        toggle.setAttribute("data-lse-menu-toggle", panel.id);
        toggle.setAttribute("aria-controls", panel.id);
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("role", "button");
        toggle.setAttribute("tabindex", "0");
        panel.setAttribute("data-lse-menu-panel", "");
        panel.hidden = true;
      }
    }

    // Builder slideshow images live in JSON settings, not ordinary image attributes.
    for (const node of doc.querySelectorAll("[data-settings]")) {
      const settings = backgroundSettings(node);
      const slides = settings.background_slideshow_gallery;
      if (
        settings.background_background === "slideshow" &&
        Array.isArray(slides) &&
        slides[0]?.url
      ) {
        node.style.backgroundImage =
          "url(" + JSON.stringify(slides[0].url) + ")";
        node.style.backgroundSize =
          settings.background_slideshow_background_size || "cover";
        node.style.backgroundPosition =
          settings.background_slideshow_background_position || "center center";
      }
    }

    for (const el of doc.querySelectorAll(".elementor-invisible"))
      el.classList.remove("elementor-invisible");
    for (const el of doc.querySelectorAll("[data-e-bg-lazyload]"))
      el.classList.add("e-lazyloaded");
    for (const img of doc.images) {
      const lazy =
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy-src") ||
        img.getAttribute("data-original");
      if (lazy) img.setAttribute("src", lazy);
      img.loading = "eager";
      img.decoding = "sync";
    }
    for (const el of doc.querySelectorAll(
      "[data-bg],[data-background],[data-lazy-background-image]",
    )) {
      const value =
        el.getAttribute("data-bg") ||
        el.getAttribute("data-background") ||
        el.getAttribute("data-lazy-background-image");
      if (value && !/^javascript:/i.test(value))
        el.style.backgroundImage = value.startsWith("url(")
          ? value
          : "url(" + JSON.stringify(value) + ")";
    }
    for (const gallery of doc.querySelectorAll(
      ".elementor-gallery__container",
    )) {
      if (gallery.hasAttribute("data-lse-gallery")) continue;
      const images = [...gallery.querySelectorAll("[data-thumbnail]")];
      if (!images.length) continue;
      let settings = {};
      try {
        settings = JSON.parse(
          gallery
            .closest("[data-widget_type]")
            ?.getAttribute("data-settings") || "{}",
        );
      } catch {}
      const number = (value, fallback, max = 12) =>
        Number.isFinite(Number(value)) && Number(value) > 0
          ? Math.min(max, Number(value))
          : fallback;
      const columns = number(settings.columns, 3),
        tablet = number(settings.columns_tablet, Math.min(columns, 2)),
        mobile = number(settings.columns_mobile, 1);
      const spacing = (value, fallback) =>
        value !== undefined &&
        Number.isFinite(Number(value)) &&
        Number(value) >= 0
          ? Math.min(100, Number(value))
          : fallback;
      const gap = spacing(settings.gap?.size, 10),
        tabletGap = spacing(settings.gap_tablet?.size, gap),
        mobileGap = spacing(settings.gap_mobile?.size, gap);
      const ratio = /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(
        settings.aspect_ratio || "",
      )
        ? settings.aspect_ratio.replace(":", " / ")
        : "3 / 2";
      const key = String(++galleryIndex);
      gallery.setAttribute("data-lse-gallery", key);
      for (const source of images) {
        const img = doc.createElement("img");
        img.src = source.getAttribute("data-thumbnail");
        img.alt =
          source.getAttribute("aria-label") ||
          source
            .closest("a")
            ?.querySelector(".elementor-gallery-item__title")
            ?.textContent?.trim() ||
          "";
        img.loading = "eager";
        img.style.cssText =
          "display:block;position:static;width:100%;height:auto;object-fit:cover;aspect-ratio:" +
          ratio;
        const width = source.getAttribute("data-width"),
          height = source.getAttribute("data-height");
        if (width) img.setAttribute("width", width);
        if (height) img.setAttribute("height", height);
        source.replaceWith(img);
      }
      const style = doc.createElement("style"),
        selector = '[data-lse-gallery="' + key + '"]';
      style.textContent =
        selector +
        "{display:grid!important;position:relative!important;height:auto!important;grid-template-columns:repeat(" +
        columns +
        ",minmax(0,1fr));gap:" +
        gap +
        "px}" +
        selector +
        ">a{display:block;position:relative!important;width:auto!important;height:auto!important;padding:0!important;transform:none!important}" +
        selector +
        " img{position:static!important;width:100%;height:auto;object-fit:cover;aspect-ratio:" +
        ratio +
        "}@media(max-width:1024px){" +
        selector +
        "{grid-template-columns:repeat(" +
        tablet +
        ",minmax(0,1fr));gap:" +
        tabletGap +
        "px}}@media(max-width:767px){" +
        selector +
        "{grid-template-columns:repeat(" +
        mobile +
        ",minmax(0,1fr));gap:" +
        mobileGap +
        "px}}";
      doc.head.append(style);
      for (const overlay of gallery.querySelectorAll(
        ".elementor-gallery-item__overlay,.elementor-gallery-item__content",
      ))
        if (!overlay.textContent.trim()) overlay.remove();
      if (settings.gallery_layout && settings.gallery_layout !== "grid")
        warnings.push(
          "An animated " +
            settings.gallery_layout +
            " gallery was rebuilt as an editable responsive grid. Review its arrangement.",
        );
    }
    return warnings;
  }

  async function convert(project, page, options = {}) {
    const warnings = [...inspect(page).warnings],
      previewMap = {};
    const originalAssets = new Map(),
      blobs = [];
    for (const asset of project.assets) {
      const blob = URL.createObjectURL(
        new Blob([asset.bytes], { type: asset.type }),
      );
      blobs.push(blob);
      previewMap[asset.url] = blob;
      try {
        previewMap[new URL(asset.url).pathname] = blob;
      } catch {}
      if (options.map?.[asset.url]) previewMap[options.map[asset.url]] = blob;
      originalAssets.set(blob, options.map?.[asset.url] || asset.url);
    }
    const restoreRefs = (value) =>
      String(value).replace(
        /blob:[^\s"')<>]+/g,
        (url) => originalAssets.get(url) || url,
      );
    const restore = (value) =>
      typeof value === "string"
        ? restoreRefs(value)
        : Array.isArray(value)
          ? value.map(restore)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, restore(v)]),
              )
            : value;
    const source = resolveLinks(project, page, options.map || {}),
      doc = new DOMParser().parseFromString(source, "text/html");
    warnings.push(...prepareSource(doc));
    const inlineScripts = [...doc.querySelectorAll("script:not([src])")]
      .map((x) => x.textContent)
      .join("\n");
    for (const n of doc.querySelectorAll(
      "script,iframe,object,embed,link,meta,base",
    ))
      n.remove();
    for (const n of doc.querySelectorAll("*")) {
      for (const a of [...n.attributes]) {
        if (
          /^on/i.test(a.name) ||
          /^(javascript|vbscript)\s*:/i.test(a.value) ||
          ["action", "formaction", "srcdoc"].includes(a.name)
        )
          n.removeAttribute(a.name);
      }
    }
    if (options.layout === "elementor_header_footer") {
      const main = doc.querySelector("main,[role=main]");
      if (main) {
        const clone = main.cloneNode(true);
        doc.body.replaceChildren(clone);
      } else
        warnings.push(
          "No main landmark found; source header/footer retained for review.",
        );
    }
    const style = doc.createElement("style");
    let fonts = "";
    for (const f of project.fonts) {
      const a = project.assets.find((a) => a.url === f.url);
      if (a)
        fonts +=
          "@font-face{font-family:" +
          JSON.stringify(f.family) +
          ";src:url(" +
          JSON.stringify(previewMap[a.url]) +
          ");font-display:swap}";
    }
    style.textContent =
      rewrite((project.site_css || "") + "\n" + page.css, previewMap) + fonts;
    doc.head.append(style);
    const csp = doc.createElement("meta");
    csp.httpEquiv = "Content-Security-Policy";
    csp.content =
      "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'";
    doc.head.prepend(csp);
    const base = doc.createElement("style");
    base.textContent = "html,body{margin:0}*{box-sizing:border-box}";
    doc.head.insertBefore(base, style);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    Object.assign(frame.style, {
      position: "fixed",
      left: "-30000px",
      top: "0",
      width: "1440px",
      height: "1000px",
      border: "0",
      visibility: "hidden",
    });
    document.body.append(frame);
    let timer;
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(Error("The source preview took too long.")),
          15000,
        );
        frame.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        frame.srcdoc =
          "<!doctype html>" +
          rewrite(doc.documentElement.outerHTML, previewMap);
      });
      const d = frame.contentDocument,
        w = frame.contentWindow;
      await Promise.race([
        d.fonts.ready,
        new Promise((r) => setTimeout(r, 2000)),
      ]);
      await Promise.all(
        [...d.images].map((img) =>
          Promise.race([
            img.decode().catch(() => {}),
            new Promise((r) => setTimeout(r, 500)),
          ]),
        ),
      );
      const snapshots = new Map(),
        widths = [1440, 1024, 768, 390];
      const elements = [],
        generatedIds = new Set();
      let fallbacks = 0;
      const structural = new Set();
      const islands = new Set();
      for (const n of d.querySelectorAll("header,footer,nav"))
        if (n.querySelector("button,[aria-controls],[aria-expanded]"))
          islands.add(n.closest("header,footer") || n);
      for (const n of d.querySelectorAll("form"))
        islands.add(n.closest(".fr-calculator,[data-lse-interaction]") || n);
      for (const n of d.querySelectorAll("[data-fr-brief]"))
        islands.add(n.closest(".fr-form") || n.parentElement);
      for (const n of d.querySelectorAll(
        "dialog,[data-lse-interaction],.elementor-widget-nav-menu",
      ))
        islands.add(n);
      for (const n of d.querySelectorAll("button[aria-controls]")) {
        const target = d.getElementById(n.getAttribute("aria-controls"));
        if (target) {
          let parent = n.parentElement;
          while (parent && parent !== d.body && !parent.contains(target))
            parent = parent.parentElement;
          if (
            parent &&
            parent !== d.body &&
            !parent.matches("main,[role=main]") &&
            !parent.querySelector("main,[role=main],header,footer")
          )
            islands.add(parent);
        }
      }
      for (const n of [...islands])
        if ([...islands].some((parent) => parent !== n && parent.contains(n)))
          islands.delete(n);
      function create(node, depth = 0) {
        if (node.nodeType === 3) {
          const text = node.textContent.trim();
          if (!text) return null;
          const wrap = d.createElement("p");
          wrap.textContent = text;
          node.replaceWith(wrap);
          node = wrap;
        }
        if (node.nodeType !== 1) return null;
        if (structural.has(node))
          return [...node.childNodes].flatMap((n) => create(n, depth) || []);
        const box = node;
        const tag = node.tagName.toLowerCase();
        if (
          [
            "script",
            "style",
            "link",
            "meta",
            "base",
            "template",
            "noscript",
          ].includes(tag)
        )
          return null;
        let id;
        do {
          id = crypto
            .getRandomValues(new Uint32Array(1))[0]
            .toString(16)
            .padStart(8, "0");
        } while (generatedIds.has(id));
        generatedIds.add(id);
        const settings = {
          _css_classes: sourceClasses(
            (box.className?.baseVal ?? box.className ?? "") +
              " " +
              (box === node
                ? ""
                : (node.className?.baseVal ?? node.className ?? "")),
          ),
        };
        if (box.id || node.id) settings._element_id = box.id || node.id;
        settings.lse_attributes = Object.fromEntries(
          [...box.attributes, ...(box === node ? [] : node.attributes)]
            .filter(
              (a) =>
                /^(data-[a-z0-9_-]+|aria-[a-z0-9_-]+|role)$/i.test(a.name) &&
                !reservedAttribute(a.name) &&
                a.value.length <= 4096,
            )
            .map((a) => [a.name, a.value]),
        );
        let widget = "",
          children = [];
        settings.lse_attributes["data-lse-source-tag"] = tag;
        settings.lse_attributes["data-lse-native"] = "";
        const interactive = islands.has(node);
        if (interactive) {
          fallbacks++;
          widget = "html";
          settings.html =
            '<div data-lse-interactive="">' + sourceHTML(node) + "</div>";
          settings.lse_interactive = "yes";
          settings._title =
            tag === "header"
              ? "Website navigation"
              : node.querySelector("[data-fr-cost]") ||
                  node.matches("[data-fr-cost]")
                ? "Website calculator"
                : "Website interaction";
        } else if (/^h[1-6]$/.test(tag)) {
          widget = "heading";
          settings.title = sourceHTML(node, true);
          settings.header_size = tag;
          settings.size = "default";
        } else if (
          [
            "p",
            "ul",
            "ol",
            "blockquote",
            "pre",
            "figcaption",
            "label",
            "small",
            "strong",
            "em",
          ].includes(tag) ||
          (tag === "span" && !node.querySelector("div,p,h1,h2,img"))
        ) {
          widget = "text-editor";
          settings.editor = sourceHTML(node);
        } else if (tag === "img") {
          widget = "image";
          settings.image = {
            url: rewrite(node.getAttribute("src") || "", options.map || {}),
            id: 0,
          };
          settings.image_size = "full";
          settings.caption_source = "none";
          settings.lse_image_alt = node.getAttribute("alt") || "";
          settings.lse_alt_override = "yes";
        } else if (
          tag === "a" &&
          node.children.length === 1 &&
          node.firstElementChild.tagName === "IMG"
        ) {
          const image = node.querySelector("img");
          widget = "image";
          settings.image = {
            url: rewrite(image.getAttribute("src") || "", options.map || {}),
            id: 0,
          };
          settings.image_size = "full";
          settings.lse_image_alt = image.getAttribute("alt") || "";
          settings.lse_alt_override = "yes";
          settings.link_to =
            node.getAttribute("href") === image.getAttribute("src")
              ? "file"
              : "custom";
          settings.open_lightbox =
            node.getAttribute("data-elementor-open-lightbox") === "no"
              ? "no"
              : "yes";
          settings.link = { url: node.getAttribute("href") || "" };
        } else if (
          tag === "a" &&
          node.children.length <= 1 &&
          !node.querySelector(
            "div,section,article,img,svg,h1,h2,h3,h4,h5,h6,p,ul,ol",
          ) &&
          !w.getComputedStyle(node).display.includes("grid")
        ) {
          widget = "button";
          settings.text = sourceHTML(node, true);
          settings.link = {
            url: node.getAttribute("href") || "",
            is_external: node.target === "_blank" ? "on" : "",
            nofollow: node.rel.includes("nofollow") ? "on" : "",
          };
        } else if (tag === "hr") {
          widget = "divider";
          settings.color = w.getComputedStyle(node).borderTopColor;
        } else if (
          [
            "svg",
            "table",
            "details",
            "dialog",
            "form",
            "button",
            "input",
            "select",
            "textarea",
            "canvas",
            "video",
            "audio",
            "picture",
          ].includes(tag)
        ) {
          widget = "html";
          fallbacks++;
          settings.html = sourceHTML(node);
          if (tag === "canvas")
            warnings.push("Canvas drawing needs its original drawing code.");
        } else {
          if (tag === "a")
            settings.link = {
              url: node.getAttribute("href") || "",
              is_external: node.target === "_blank" ? "on" : "",
            };
          settings.content_width = "full";
          settings.html_tag = [
            "main",
            "header",
            "footer",
            "nav",
            "section",
            "article",
            "aside",
            "a",
          ].includes(tag)
            ? tag
            : "div";
          settings.container_type = w
            .getComputedStyle(node)
            .display.includes("grid")
            ? "grid"
            : "flex";
          settings.flex_direction = w
            .getComputedStyle(node)
            .display.includes("flex")
            ? w.getComputedStyle(node).flexDirection
            : "column";
          children = [...node.childNodes].flatMap(
            (n) => create(n, depth + 1) || [],
          );
        }
        if (!widget) {
          settings.css_classes = settings._css_classes;
          delete settings._css_classes;
        }
        if (widget === "html") {
          settings._css_classes = "";
          delete settings._element_id;
        }
        const element = {
          id,
          elType: widget ? "widget" : "container",
          isInner: false,
          settings,
          elements: children,
        };
        if (widget) element.widgetType = widget;
        elements.push({
          node: box,
          styleNode:
            widget === "image" && node.tagName === "A"
              ? node.querySelector("img")
              : node,
          element,
          widget,
          tag,
          interactive,
        });
        return element;
      }
      d.body.classList.add("lse-imported-site");
      const tree = [create(d.body)].flat().filter(Boolean);
      const snapshotProps = [
        ...outerProps,
        ...innerProps,
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
        "width",
        "max-width",
        "height",
        "top",
        "right",
        "bottom",
        "left",
      ];
      for (const width of widths) {
        frame.style.width = width + "px";
        await new Promise((r) => setTimeout(r, 25));
        const parents = new WeakMap();
        for (const entry of elements) {
          const s = w.getComputedStyle(entry.node),
            content = w.getComputedStyle(entry.styleNode),
            props = {};
          for (const p of snapshotProps)
            props[p] = (
              innerProps.includes(p) ||
              (entry.widget === "image" &&
                ["object-fit", "aspect-ratio"].includes(p))
                ? content
                : s
            ).getPropertyValue(p);
          const parent = entry.node.parentElement;
          if (parent) {
            if (!parents.has(parent)) {
              const ps = w.getComputedStyle(parent);
              parents.set(parent, {
                display: ps.display,
                width: String(
                  Math.max(
                    1,
                    parent.getBoundingClientRect().width -
                      (parseFloat(ps.paddingLeft) || 0) -
                      (parseFloat(ps.paddingRight) || 0),
                  ),
                ),
              });
            }
            const cached = parents.get(parent);
            props.parentDisplay = cached.display;
            props.parentWidth = cached.width;
          }
          props.actualWidth = String(entry.node.getBoundingClientRect().width);
          if (["header", "footer"].includes(entry.tag))
            props.contextVariables = [...s]
              .filter((property) => property.startsWith("--"))
              .map((property) =>
                namespaceCSS(property + ":" + s.getPropertyValue(property)),
              )
              .filter(safeValue);

          const flowChildren = [...entry.node.children].filter(
            (node) => w.getComputedStyle(node).display !== "none",
          );
          props.inlineFlow =
            flowChildren.length > 0 &&
            flowChildren.every((node) =>
              /^inline/.test(w.getComputedStyle(node).display),
            );
          props.sourceMinHeight = s.getPropertyValue("--min-height").trim();
          // Preserve source anchoring: computed left/top can be resolved even when authored auto.
          const typed = entry.node.computedStyleMap?.();
          for (const side of ["left", "right"])
            if (typed?.get("margin-" + side)?.toString() === "auto")
              props["margin-" + side] = "auto";
          props.explicitHeight = Boolean(
            typed && typed.get("height")?.toString() !== "auto",
          );
          props.explicitWidth = Boolean(
            typed && typed.get("width")?.toString() !== "auto",
          );
          for (const side of ["top", "right", "bottom", "left"])
            props[side + "Auto"] = typed?.get(side)?.toString() === "auto";
          if (entry.widget === "image")
            props.contentWidth = String(
              entry.styleNode.getBoundingClientRect().width,
            );
          if (!snapshots.has(entry.element.id))
            snapshots.set(entry.element.id, {});
          snapshots.get(entry.element.id)[width] = props;
        }
      }
      function fontFaces(rules) {
        let result = "";
        for (const rule of rules) {
          if (rule.type === 5) result += rule.cssText + "\n";
          else if (rule.cssRules) result += fontFaces(rule.cssRules);
        }
        return result;
      }
      const sourceSheets = [...d.querySelectorAll("style")]
        .map((node) => node.sheet)
        .filter(Boolean);
      let css = options.preserveCSS
        ? sourceSheets.map((sheet) => fontFaces(sheet.cssRules)).join("")
        : "";
      for (const entry of elements) {
        const { element, widget } = entry;
        const all = snapshots.get(element.id);
        if (widget === "image")
          css +=
            ":where(__LSE_SCOPE__ .elementor-element-" +
            element.id +
            ") > a,:where(__LSE_SCOPE__ .elementor-element-" +
            element.id +
            ") > .elementor-widget-container > a{width:100%}\n";
        if (entry.interactive) {
          element.settings._element_width = "initial";
          element.settings._element_custom_width = { unit: "%", size: 100 };
          element.settings._padding = {
            unit: "px",
            top: "0",
            right: "0",
            bottom: "0",
            left: "0",
            isLinked: true,
          };
          css +=
            "__LSE_SCOPE__ .elementor-element-" +
            element.id +
            " [data-lse-interactive]{font-family:" +
            all[1440]["font-family"] +
            ";font-size:" +
            all[1440]["font-size"] +
            ";line-height:" +
            all[1440]["line-height"] +
            ";color:" +
            all[1440].color +
            "}\n";
          continue;
        }
        let previousOuter = new Map(),
          previousInner = new Map();
        for (const width of widths) {
          const s = all[width];
          const suffix =
            +width === 1440
              ? ""
              : +width === 1024
                ? "_tablet"
                : +width === 390
                  ? "_mobile"
                  : null;
          if (suffix !== null) {
            const target = element.settings;
            const device =
              width === 1440
                ? "desktop"
                : width === 1024
                  ? "tablet"
                  : width === 390
                    ? "mobile"
                    : null;
            if (device && s.display === "none")
              target["hide_" + device] = "hidden-" + device;
            if (widget && !s.parentDisplay?.includes("grid")) {
              target["_element_width" + suffix] = "initial";
              target["_element_custom_width" + suffix] = {
                unit: "%",
                size: Math.min(
                  100,
                  Math.max(
                    0,
                    (100 * parseFloat(s.actualWidth)) /
                      parseFloat(s.parentWidth || 1440),
                  ),
                ),
              };
            }
            if (["absolute", "fixed"].includes(s.position)) {
              target[widget ? "_position" : "position"] = s.position;
              // A positioned node's containing block may be the viewport, not its zero-width DOM parent.
              target[(widget ? "_element_custom_width" : "width") + suffix] =
                px(s.actualWidth);
              if (widget) target["_element_width" + suffix] = "initial";
              for (const [axis, first, last] of [
                ["x", "left", "right"],
                ["y", "top", "bottom"],
              ]) {
                const end = s[first + "Auto"] && !s[last + "Auto"];
                target["_offset_orientation_" + (axis === "x" ? "h" : "v")] =
                  end ? "end" : "start";
                target["_offset_" + axis + (end ? "_end" : "") + suffix] = px(
                  s[end ? last : first],
                );
              }
            }
            target[(widget ? "_" : "") + "padding" + suffix] = dim(
              s,
              "padding",
            );
            target[(widget ? "_" : "") + "margin" + suffix] = dim(s, "margin");
            if (widget === "image") target["align" + suffix] = s["text-align"];
            if (widget === "image" && parseFloat(s.actualWidth) > 0)
              target["width" + suffix] = {
                unit: "%",
                size: Math.min(
                  100,
                  Math.max(
                    0,
                    (100 * parseFloat(s.contentWidth)) /
                      parseFloat(s.actualWidth),
                  ),
                ),
              };
            if (
              widget === "heading" ||
              widget === "text-editor" ||
              widget === "button"
            ) {
              const prefix =
                widget === "heading"
                  ? "typography"
                  : widget === "button"
                    ? "typography"
                    : "typography";
              target[prefix + "_typography"] = "custom";
              target[prefix + "_font_size" + suffix] = px(s["font-size"]);
              if (width === 1440) {
                target[prefix + "_font_family"] = s["font-family"]
                  .split(",")[0]
                  .replace(/["']/g, "");
                target[prefix + "_font_weight"] = s["font-weight"];
              } else {
                if (s["font-family"] !== all[1440]["font-family"])
                  target["lse_font_family" + suffix] = s["font-family"];
                if (s["font-weight"] !== all[1440]["font-weight"])
                  target["lse_font_weight" + suffix] = s["font-weight"];
              }
              if (parseFloat(s["line-height"]) > 0)
                target[prefix + "_line_height" + suffix] = px(s["line-height"]);
              target[prefix + "_letter_spacing" + suffix] = px(
                s["letter-spacing"],
              );
              const colorControl =
                widget === "heading"
                  ? "title_color"
                  : widget === "button"
                    ? "button_text_color"
                    : "text_color";
              if (width === 1440) target[colorControl] = s.color;
              else if (s.color !== all[1440].color)
                target["lse_text_color" + suffix] = s.color;
              target["align" + suffix] = s["text-align"];
              if (widget === "button") {
                target["background_color" + suffix] = s["background-color"];
                if (s.explicitHeight && parseFloat(s.height) > 0)
                  target["lse_button_min_height" + suffix] = px(s.height);
                if (
                  s.explicitWidth &&
                  ["flex", "inline-flex"].includes(s.display)
                )
                  target["align" + suffix] = "justify";
                target["text_padding" + suffix] = dim(s, "padding");
                target["_padding" + suffix] = dim(
                  {
                    "padding-top": "0",
                    "padding-right": "0",
                    "padding-bottom": "0",
                    "padding-left": "0",
                  },
                  "padding",
                );
                target["border_radius" + suffix] = radius(s["border-radius"]);
              }
            }
            if (!widget) {
              target["border_radius" + suffix] = radius(s["border-radius"]);
              if (width === 1440) {
                target.background_background = "classic";
                target.background_color = s["background-color"];
                const image = s["background-image"].match(
                  /^url\(["']?(.*?)["']?\)$/,
                );
                if (image) {
                  target.background_image = {
                    url: restoreRefs(image[1]),
                    id: 0,
                  };
                  target.background_size = s["background-size"];
                  target.background_position = s["background-position"];
                  target.background_repeat = s["background-repeat"];
                }
              }
              if (
                !s.parentDisplay?.includes("grid") &&
                !["absolute", "fixed"].includes(s.position) &&
                parseFloat(s.parentWidth) > 0
              ) {
                target["width" + suffix] = {
                  unit: "%",
                  size: Math.min(
                    100,
                    Math.max(
                      0,
                      (100 * parseFloat(s.actualWidth)) /
                        parseFloat(s.parentWidth),
                    ),
                  ),
                };
              }
              target["flex_direction" + suffix] = s.display.includes("flex")
                ? s["flex-direction"]
                : s.inlineFlow
                  ? "row"
                  : "column";
              const textAlign =
                s["text-align"] === "center"
                  ? "center"
                  : ["right", "end"].includes(s["text-align"])
                    ? "flex-end"
                    : "flex-start";
              target["flex_justify_content" + suffix] =
                !s.display.includes("flex") && s.inlineFlow
                  ? textAlign
                  : s["justify-content"];
              target["flex_align_items" + suffix] =
                !s.display.includes("flex") &&
                !s.display.includes("grid") &&
                !s.inlineFlow
                  ? textAlign
                  : s["align-items"];
              target["flex_wrap" + suffix] =
                !s.display.includes("flex") && s.inlineFlow
                  ? "wrap"
                  : s["flex-wrap"];
              target["flex_gap" + suffix] = {
                unit: "px",
                column: String(parseFloat(s["column-gap"]) || 0),
                row: String(parseFloat(s["row-gap"]) || 0),
                isLinked: false,
              };
              if (s.display.includes("grid")) {
                const cols = s["grid-template-columns"]
                  .split(/\s+/)
                  .map(parseFloat)
                  .filter((x) => x > 0);
                const min = Math.min(...cols);
                if (cols.length)
                  target["grid_columns_grid" + suffix] = {
                    unit: "custom",
                    size: cols
                      .map((n) => (n / min).toFixed(4) + "fr")
                      .join(" "),
                  };
                target["grid_rows_grid" + suffix] = {
                  unit: "custom",
                  size: "auto",
                };
                target["grid_gaps" + suffix] = target["flex_gap" + suffix];
                for (const property of [
                  "align-items",
                  "justify-items",
                  "justify-content",
                  "align-content",
                ])
                  target["grid_" + property.replaceAll("-", "_") + suffix] =
                    s[property];
                target["grid_auto_flow" + suffix] = s["grid-auto-flow"];
              }
              const minHeight =
                parseFloat(s["min-height"]) > 0
                  ? s.sourceMinHeight || s["min-height"]
                  : "";
              if (parseFloat(minHeight) > 0) {
                const unit =
                  minHeight.match(/(px|vh|vw|em|rem|%)$/)?.[1] || "px";
                target["min_height" + suffix] = {
                  unit,
                  size: parseFloat(minHeight),
                  sizes: [],
                };
              } else if (!element.elements.length && parseFloat(s.height) > 0)
                target["min_height" + suffix] = px(s.height);
              if (width === 1440) {
                const sourceBackground = backgroundSettings(entry.node);
                for (const [name, value] of Object.entries(sourceBackground))
                  if (name.startsWith("background_overlay_"))
                    target[name] = value;
                if (
                  sourceBackground.background_background === "slideshow" &&
                  sourceBackground.background_slideshow_gallery?.length
                ) {
                  for (const [name, value] of Object.entries(sourceBackground))
                    if (name.startsWith("background_slideshow_"))
                      target[name] = value;
                  target.background_background = "slideshow";
                  target.background_slideshow_gallery =
                    sourceBackground.background_slideshow_gallery.map(
                      (slide) => ({ id: 0, url: restoreRefs(slide.url) }),
                    );
                  delete target.background_image;
                }
              }
            }
          }
          if (!options.preserveCSS) continue;
          let declarations = [];
          for (const p of outerProps) {
            if (
              widget === "image" &&
              ["aspect-ratio", "object-fit"].includes(p)
            )
              continue;
            const v = s[p];
            if (v && safeValue(v) && !["none", "normal", "auto"].includes(v))
              declarations.push(p + ":" + v);
          }
          if (!widget)
            for (const property of innerProps) {
              const value = s[property];
              if (value && safeValue(value))
                declarations.push(property + ":" + value);
            }
          const target =
              "__LSE_SCOPE__ .elementor-element.elementor-element-" +
              element.id,
            selector =
              ":where(" +
              target +
              (widget === "html"
                ? " > [data-lse-source-content]," +
                  target +
                  " > .elementor-widget-container > [data-lse-source-content]"
                : "") +
              ")";
          if (!widget) {
            if (
              !["flex", "inline-flex", "grid", "inline-grid"].includes(
                s.display,
              )
            )
              declarations.push("display:block");
            declarations.push(
              "--display:" +
                (["flex", "grid"].includes(s.display) ? s.display : "block"),
            );
          }
          declarations.push("box-sizing:border-box");
          if (s["max-width"] !== "none" && safeValue(s["max-width"]))
            declarations.push("max-width:" + s["max-width"]);
          if (widget === "html" && entry.tag === "svg") {
            declarations.push("width:" + s.width, "height:" + s.height);
          }
          for (const p of [
            "clip-path",
            "transform",
            "box-shadow",
            "background-image",
          ])
            if (s[p] === "none" && widths.some((w) => all[w][p] !== "none"))
              declarations.push(p + ":none");
          let inner = [];
          if (widget) {
            for (const p of innerProps) {
              const v = s[p];
              if (v && safeValue(v)) inner.push(p + ":" + v);
            }
            if (widget === "image") {
              inner.push(
                "width:100%;height:auto;object-fit:" + s["object-fit"],
              );
              if (s["aspect-ratio"] && s["aspect-ratio"] !== "auto")
                inner.push("aspect-ratio:" + s["aspect-ratio"]);
            }
          }
          const properties = (list) =>
              new Map(
                list.map((v) => {
                  const i = v.indexOf(":");
                  return [v.slice(0, i), v.slice(i + 1)];
                }),
              ),
            currentOuter = properties(declarations),
            currentInner = properties(inner);
          if (width !== 1440) {
            for (const p of previousOuter.keys())
              if (!currentOuter.has(p) && s[p] && safeValue(s[p]))
                currentOuter.set(p, s[p]);
          }
          const delta = (current, previous) =>
            [...current]
              .filter(([p, v]) => width === 1440 || previous.get(p) !== v)
              .map(([p, v]) => p + ":" + v);
          const changedOuter = delta(currentOuter, previousOuter),
            changedInner = delta(currentInner, previousInner);
          previousOuter = currentOuter;
          previousInner = currentInner;
          if (!changedOuter.length && !changedInner.length) continue;
          const rule =
            (changedOuter.length
              ? selector + "{" + changedOuter.join(";") + "}"
              : "") +
            (changedInner.length
              ? selector +
                (widget === "image"
                  ? " :where(img){"
                  : " :where(.elementor-heading-title,.elementor-button,.elementor-widget-container){") +
                changedInner.join(";") +
                "}"
              : "");
          css +=
            (+width === 1440
              ? rule
              : "@media(max-width:" + width + "px){" + rule + "}") + "\n";
        }
      }
      function selectors(text) {
        let level = 0,
          quote = "",
          part = "",
          out = [];
        for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (quote) {
            part += c;
            if (c === quote && text[i - 1] !== "\\") quote = "";
            continue;
          }
          if (c === '"' || c === "'") {
            quote = c;
            part += c;
            continue;
          }
          if (c === "(" || c === "[") level++;
          if (c === ")" || c === "]") level--;
          if (c === "," && !level) {
            out.push(part.trim());
            part = "";
          } else part += c;
        }
        if (part.trim()) out.push(part.trim());
        return out;
      }
      function groupedRule(list, declarations) {
        if (!declarations || !list.length) return "";
        const compatible = [],
          separate = [];
        for (const selector of list) {
          if (w.CSS.supports("selector(" + selector + ")"))
            compatible.push(selector);
          else separate.push(selector + "{" + declarations + "}");
        }
        return (
          (compatible.length
            ? compatible.join(",") + "{" + declarations + "}"
            : "") +
          separate.join("") +
          "\n"
        );
      }
      function sourceStyles(rules) {
        let result = "";
        for (const rule of rules) {
          if (rule.type === 1) {
            const declarations = namespaceCSS(rule.style.cssText),
              variables = [...rule.style]
                .filter((p) => p.startsWith("--"))
                .map((p) =>
                  namespaceCSS(p + ":" + rule.style.getPropertyValue(p)),
                )
                .join(";"),
              variableSelectors = [],
              stateSelectors = [];
            for (let selector of selectors(rule.selectorText)) {
              selector = selector.replace(
                /\.((?:elementor(?:-[\w-]+)?|e-con(?:-[\w-]+)?|e-(?:parent|child|flex|grid|gallery)(?:-[\w-]+)?))\b/g,
                (_, name) => "." + (sourceClass(name) || "lse-source-entrance"),
              );
              selector = selector.replace(
                /(^|[\s>+~,(])(?:html|body|:root)(?=$|[\s.#:[>+~,])/g,
                "$1.lse-imported-site",
              );
              variableSelectors.push("__LSE_SCOPE__ " + selector);
              const pseudo =
                  selector.match(/::[a-z-]+(?:\([^)]*\))?$/i)?.[0] || "",
                main = pseudo ? selector.slice(0, -pseudo.length) : selector;
              const content = options.preserveCSS
                ? "[data-lse-source-content],[data-lse-source-content] *"
                : "[data-lse-interactive],[data-lse-interactive] *";
              stateSelectors.push(
                "__LSE_SCOPE__ " + main + ":where(" + content + ")" + pseudo,
              );
              if (
                options.preserveCSS &&
                /:(?:hover|focus(?:-within|-visible)?|active|visited|checked|disabled)\b|::/.test(
                  selector,
                )
              ) {
                const native = main.replace(
                  /(^|[\s>+~,(])(h[1-6]|a|p|img|span)(?=$|[\s.#:[>+~,])/g,
                  (_, lead, tag) =>
                    lead +
                    ":is(" +
                    tag +
                    ',[data-lse-source-tag="' +
                    tag +
                    '"])',
                );
                stateSelectors.push(
                  "__LSE_SCOPE__ " +
                    native +
                    ":where([data-lse-native]) :is(.elementor-heading-title,.elementor-button,.elementor-widget-container)" +
                    pseudo,
                );
                if (pseudo)
                  stateSelectors.push(
                    "__LSE_SCOPE__ " +
                      native +
                      ":where([data-lse-native])" +
                      pseudo,
                  );
              }
            }
            result +=
              groupedRule(variableSelectors, variables) +
              groupedRule(stateSelectors, declarations);
          } else if (rule.type === 7) result += rule.cssText + "\n";
          else if (rule.cssRules)
            result +=
              rule.cssText.slice(0, rule.cssText.indexOf("{")) +
              "{" +
              sourceStyles(rule.cssRules) +
              "}\n";
        }
        return result;
      }
      if (options.preserveCSS || islands.size)
        css += sourceSheets
          .map((sheet) => sourceStyles(sheet.cssRules))
          .join("");
      if (/<script[^>]+src=/i.test(page.html))
        warnings.push(
          "External scripts were not downloaded. Their dependencies must be configured separately.",
        );
      const regions = [];
      for (const entry of elements) {
        if (
          ["header", "footer"].includes(entry.tag) &&
          entry.element.elType === "container"
        ) {
          let contextCSS = "",
            previous = new Set();
          for (const width of widths) {
            const current =
              snapshots.get(entry.element.id)[width].contextVariables || [];
            const delta = current.filter((value) => !previous.has(value));
            previous = new Set(current);
            if (delta.length) {
              const rule = ":where(__LSE_SCOPE__){" + delta.join(";") + "}";
              contextCSS +=
                width === 1440
                  ? rule
                  : "@media(max-width:" + width + "px){" + rule + "}";
            }
          }
          const normalized = (node) => ({
            elType: node.elType,
            widgetType: node.widgetType,
            settings: node.settings,
            elements: node.elements.map(normalized),
          });
          const identity = JSON.stringify(
            restore({
              revision: root.LSE_CONFIG?.conversionVersion || "capture-v3",
              source: entry.node.outerHTML,
              native: normalized(entry.element),
              context: contextCSS,
            }),
          );
          const hash = [
            ...new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(identity),
              ),
            ),
          ]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("");
          regions.push({
            hash,
            id: entry.element.id,
            kind: entry.tag,
            context_css: restoreRefs(contextCSS),
          });
        }
      }
      return {
        elements: restore(tree),
        css: restoreRefs(css),
        warnings: [...new Set(warnings)],
        fallbacks,
        regions,
        source: {
          html: page.html,
          css: page.css,
          js: page.js + "\n" + inlineScripts,
        },
        seo: page.seo || {},
        counts: { native: elements.length - fallbacks, fallbacks },
      };
    } finally {
      clearTimeout(timer);
      frame.remove();
      for (const blob of blobs) URL.revokeObjectURL(blob);
    }
  }
  function fromHTML(text, name = "page.html") {
    if (typeof text !== "string" || !text.trim())
      throw Error("The HTML page is empty.");
    const doc = new DOMParser().parseFromString(text, "text/html");
    const title = doc.title.trim() || name.replace(/\.html?$/i, "");
    const css = [...doc.querySelectorAll("style")]
      .map((n) => n.textContent)
      .join("\n");
    const js = [...doc.querySelectorAll("script:not([src])")]
      .map((n) => n.textContent)
      .join("\n");
    for (const node of doc.querySelectorAll("style,script:not([src])"))
      node.remove();
    const slug =
      name
        .replace(/\.html?$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .slice(0, 80) || "page";
    const project = validate({
      format: "little-studio-website",
      version: 1,
      site_id: "html-" + slug,
      title,
      site_css: "",
      pages: [
        {
          key: slug,
          title,
          slug,
          url: "https://little-studio.invalid/" + slug + "/",
          parent_key: "",
          html: doc.documentElement.outerHTML,
          css,
          js,
        },
      ],
      assets: [],
      fonts: [],
      site: { home_key: slug, navigation: [] },
    });
    project.input_kind = "html";
    return project;
  }
  root.LSEConverter = {
    validate,
    fromHTML,
    rewrite,
    inspect,
    convert,
    resolveLinks,
    prepareSource,
    cssReferences,
    replaceCSSReferences,
    importConditions,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
