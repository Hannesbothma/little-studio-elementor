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

  function validNavigation(items, keys) {
    return (
      Array.isArray(items) &&
      items.every((item) => {
        if (!item || !string(item.label, 150) || !item.label.trim())
          return false;
        const url = item.url;
        const safeURL =
          string(url, 2048) &&
          /^(?:https?:\/\/|mailto:|tel:|#)/i.test(url) &&
          !/[\u0000-\u001f]/.test(url);
        return (
          ((item.key && keys.has(item.key)) || safeURL) &&
          (!url || safeURL) &&
          validNavigation(item.children || [], keys)
        );
      })
    );
  }

  function validate(input) {
    if (root.LSENative?.isTemplate(input))
      return root.LSENative.fromTemplates([
        { name: "template.json", data: input },
      ]);
    if (
      !input ||
      input.version !== 1 ||
      !["code-canvas", "little-studio-website"].includes(input.format)
    )
      throw Error(
        "Choose Little Studio version 1 or native Elementor 0.4 template JSON.",
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
      if (page.elementor !== undefined)
        root.LSENative.validateTemplate(page.elementor);
      if (
        page.conversion !== undefined &&
        (!page.elementor ||
          !page.conversion ||
          page.conversion.version !== 1 ||
          !string(page.conversion.css) ||
          !Array.isArray(page.conversion.warnings) ||
          !page.conversion.warnings.every((warning) => string(warning, 1500)) ||
          (page.conversion.structure !== undefined &&
            !Array.isArray(page.conversion.structure)) ||
          !Array.isArray(page.conversion.regions) ||
          !page.conversion.regions.every(
            (region) =>
              region &&
              /^[a-f0-9]{8}$/.test(region.id) &&
              /^[a-f0-9]{64}$/.test(region.hash) &&
              ["header", "footer"].includes(region.kind) &&
              string(region.context_css),
          ))
      )
        throw Error(
          "The preconverted Elementor page has invalid styles or metadata.",
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
        "image/svg+xml": "svg",
        "font/woff": "woff",
        "font/woff2": "woff2",
        "font/ttf": "ttf",
        "font/otf": "otf",
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
      const start = a.data.indexOf(",") + 1;
      const payload = a.data.slice(start);
      const padding = payload.endsWith("==")
        ? 2
        : payload.endsWith("=")
          ? 1
          : 0;
      const length = payload.length - padding;
      const remainder = length % 4;
      if (
        remainder === 1 ||
        (padding && payload.length % 4 !== 0) ||
        /[^A-Za-z0-9+/]/.test(padding ? payload.slice(0, length) : payload)
      )
        throw Error("An asset has invalid base64 encoding.");
      const alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const last = alphabet.indexOf(payload[length - 1]);
      if ((remainder === 2 && last % 16) || (remainder === 3 && last % 4))
        throw Error("An asset has noncanonical base64 encoding.");
      const byteLength = Math.floor((length * 3) / 4);
      if (!byteLength) throw Error("An asset is empty.");
      // Decode only when a preview or upload actually needs the file.
      Object.defineProperties(a, {
        byteLength: { value: byteLength },
        bytes: {
          get() {
            const encoded = a.data.slice(start);
            return Uint8Array.fromBase64
              ? Uint8Array.fromBase64(encoded)
              : Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
          },
        },
      });
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
      !validNavigation(p.site.navigation, keys)
    )
      throw Error("Invalid homepage or navigation records.");
    return p;
  }
  const rewriteCache = new WeakMap();
  function rewrite(text, map) {
    const cached = map && rewriteCache.get(map);
    if (cached)
      return String(text || "").replace(cached.expression, cached.replace);
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
    const expression = new RegExp(
      [...lookup.keys()]
        .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|"),
      "g",
    );
    const replace = (m, offset, source) =>
      /^https?:/i.test(m.replaceAll("\\/", "/")) &&
      /[\\\w./%~-]/.test(source.charAt(offset + m.length))
        ? m
        : lookup.get(m);
    if (map && typeof map === "object" && Object.isFrozen(map))
      rewriteCache.set(map, { expression, replace });
    return result.replace(expression, replace);
  }
  function inspect(page) {
    if (page.elementor) {
      const summary = root.LSENative.inspect(page.elementor);
      if (page.conversion)
        summary.warnings = [
          ...new Set([...page.conversion.warnings, ...summary.warnings]),
        ];
      return summary;
    }
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
    if (
      count("canvas,object,embed") ||
      [...d.querySelectorAll("iframe")].some((node) => !mapSettings(node))
    )
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
    "box-sizing",
    "position",
    "top",
    "right",
    "bottom",
    "left",
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
    "min-width",
    "min-height",
    "max-height",
    "object-fit",
    "aspect-ratio",
    "transform",
    "text-decoration",
    "z-index",
  ];
  const imagePaint = [
    "box-sizing",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "background-repeat",
    "background-attachment",
    "background-origin",
    "background-clip",
    "background-blend-mode",
    "object-fit",
    "object-position",
    "aspect-ratio",
    "opacity",
    "filter",
    "mix-blend-mode",
    "border-radius",
    "box-shadow",
    "vertical-align",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "overflow",
    "min-height",
    "max-height",
    "max-width",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
  ];
  function sourceSize(value) {
    const match = String(value)
      .trim()
      .match(/^(-?[\d.]+)(px|%|vh|vw|em|rem)$/);
    return match
      ? { unit: match[2], size: Number(match[1]) }
      : { unit: "custom", size: value };
  }
  function fontStack(value) {
    const match = String(value)
      .trim()
      .match(
        /^(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^,]+))(?:,\s*([\s\S]*))?$/,
      );
    return match
      ? {
          family: decodeCSS(match[1] ?? match[2] ?? match[3]).trim(),
          fallbacks: (match[4] || "").trim(),
        }
      : { family: String(value).trim(), fallbacks: "" };
  }
  function sourceScriptKind({ id = "", src = "", type = "", code = "" }) {
    type = type.trim().toLowerCase();
    if (
      /^wp-emoji(?:-|$)/i.test(id) ||
      code.includes("script#wp-emoji-settings") ||
      /\/(?:wp-includes\/js\/(?:jquery|dist)|wp-content\/plugins\/elementor(?:-pro)?)\//i.test(
        src,
      ) ||
      /(?:elementor(?:Pro)?FrontendConfig|webpackChunk(?:elementor|elementor_pro))/.test(
        code,
      )
    )
      return "framework";
    if (
      /^(?:lsa-(?:tracker|elite-tracking)|google-analytics|gtag|google-tag-manager|gtm|facebook-pixel)(?:-|$)/i.test(
        id,
      ) ||
      /(?:google-analytics\.com|googletagmanager\.com|connect\.facebook\.net)\//i.test(
        src,
      )
    )
      return "analytics";
    if (type === "module") return "module";
    return !type || /^(?:text|application)\/(?:java|ecma)script$/i.test(type)
      ? "script"
      : "data";
  }
  // Project authored typography into temporary custom properties. The browser
  // still resolves specificity, !important, media queries, layers and variables.
  // Unlike getComputedStyle(fontSize), these retain viewport expressions.
  function measureTypography(doc) {
    const prefix = "--lse-measure-";
    const owners = new Map(),
      changes = [];
    let sequence = 0;
    const project = (style, owner) => {
      for (const property of ["font-size", "line-height", "letter-spacing"]) {
        // A font shorthand containing var() has pending-substitution longhands
        // in CSSOM. It still resets earlier font-size/line-height declarations.
        // Clear their projections instead of reviving an overridden fluid h2.
        const longhand = style.getPropertyValue(property);
        const resetsFont =
          property !== "letter-spacing" && style.getPropertyValue("font");
        const value = longhand || (resetsFont ? "initial" : "");
        if (!value) continue;
        const id = String(++sequence);
        owners.set(id, owner);
        for (const [name, content] of [
          [prefix + property, value],
          [prefix + property + "-owner", id],
        ]) {
          changes.push([
            style,
            name,
            style.getPropertyValue(name),
            style.getPropertyPriority(name),
          ]);
          style.setProperty(
            name,
            content,
            style.getPropertyPriority(longhand ? property : "font"),
          );
        }
      }
    };
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.type === 1) project(rule.style, rule.selectorText);
        else if (rule.cssRules) walk(rule.cssRules);
      }
    };
    for (const node of doc.querySelectorAll("style")) {
      if (node.sheet) walk(node.sheet.cssRules);
    }
    for (const node of doc.querySelectorAll("[style]"))
      project(node.style, node);
    return {
      read(node, computed) {
        const value = computed.getPropertyValue(prefix + "font-size").trim();
        const owner = owners.get(
          computed.getPropertyValue(prefix + "font-size-owner").trim(),
        );
        let own = owner === node;
        if (typeof owner === "string") {
          try {
            own = node.matches(owner);
          } catch {}
        }
        // Inherited viewport sizes remain valid when the child inherits the same
        // font size. Do not mistake a parent's size for a UA-scaled heading.
        const inherited =
          node.parentElement &&
          doc.defaultView.getComputedStyle(node.parentElement).fontSize ===
            computed.fontSize;
        return {
          fontSize:
            (own || inherited) &&
            /\b[\d.]+(?:[dsl]?v[whib]|vmin|vmax)\b/i.test(value) &&
            doc.defaultView.CSS.supports("font-size", value)
              ? value
              : "",
          lineHeight: computed.getPropertyValue(prefix + "line-height").trim(),
          letterSpacing: (() => {
            const value = computed
              .getPropertyValue(prefix + "letter-spacing")
              .trim();
            const owner = owners.get(
              computed.getPropertyValue(prefix + "letter-spacing-owner").trim(),
            );
            let own = owner === node;
            if (typeof owner === "string") {
              try {
                own = node.matches(owner);
              } catch {}
            }
            return (own || inherited) &&
              /(?:em|rem|v[whib]|vmin|vmax)\b/i.test(value) &&
              doc.defaultView.CSS.supports("letter-spacing", value)
              ? value
              : "";
          })(),
        };
      },
      restore() {
        for (const [style, name, value, priority] of changes.reverse()) {
          if (value) style.setProperty(name, value, priority);
          else style.removeProperty(name);
        }
      },
    };
  }
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
  function mapSettings(node) {
    try {
      const url = new URL(node.getAttribute("src"));
      if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        !["maps.google.com", "www.google.com", "google.com"].includes(
          url.hostname,
        ) ||
        url.pathname !== "/maps" ||
        url.searchParams.get("output") !== "embed"
      )
        return null;
      const address = url.searchParams.get("q");
      if (!address?.trim()) return null;
      const zoom = Number(url.searchParams.get("z") || 10);
      return {
        address,
        zoom: Number.isFinite(zoom)
          ? Math.max(1, Math.min(20, Math.round(zoom)))
          : 10,
      };
    } catch {
      return null;
    }
  }
  function stickySettings(node) {
    const source = backgroundSettings(node);
    let existing;
    try {
      existing = JSON.parse(node.getAttribute("data-lse-sticky") || "null");
    } catch {}
    const edge = source.sticky || existing?.edge;
    if (!["top", "bottom"].includes(edge)) return null;
    const devices = source.sticky_on ??
      existing?.devices ?? ["desktop", "tablet", "mobile"];
    const offsets = {};
    for (const [device, suffix] of [
      ["desktop", ""],
      ["tablet", "_tablet"],
      ["mobile", "_mobile"],
    ]) {
      const value =
        source["sticky_offset" + suffix] ?? existing?.offsets?.[device];
      if (value !== undefined && Number.isFinite(Number(value?.size ?? value)))
        offsets[device] = Number(value?.size ?? value);
    }
    const effects = Number(
      source.sticky_effects_offset ?? existing?.effects ?? 0,
    );
    return {
      edge,
      devices: Array.isArray(devices)
        ? devices.filter((d) => ["desktop", "tablet", "mobile"].includes(d))
        : [],
      offsets,
      effects: Number.isFinite(effects) ? effects : 0,
      parent: source.sticky_parent === "yes" || existing?.parent === true,
    };
  }
  function sourceHTML(node, inner = false) {
    const clone = node.cloneNode(true);
    for (const el of [clone, ...clone.querySelectorAll("*")]) {
      if (el.nodeType !== 1) continue;
      const sticky = stickySettings(el);
      if (sticky && el !== clone)
        el.setAttribute("data-lse-sticky", JSON.stringify(sticky));
      else if (sticky) el.removeAttribute("data-lse-sticky");
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
  function slideKey(item, index) {
    return (
      [...item.classList]
        .find((name) => /^elementor-repeater-item-[a-f0-9]{7,8}$/.test(name))
        ?.split("-")
        .pop() || (index + 1).toString(16).padStart(7, "0")
    );
  }
  function sourceSlides(node) {
    return node.querySelectorAll(
      ".elementor-slides-wrapper .swiper-wrapper > .swiper-slide:not(.swiper-slide-duplicate)",
    );
  }
  function contactForm(node) {
    if (
      !root.LSE_CONFIG?.widgets?.includes("form") ||
      !node.matches('.elementor-form,[data-widget_type^="form."]')
    )
      return null;
    const form = node.matches("form") ? node : node.querySelector("form");
    if (
      !form ||
      form.matches("[data-fr-cost],[data-lse-local-form]") ||
      form.closest("[data-lse-interaction]")
    )
      return null;
    const fields = [];
    const seen = new Set();
    for (const field of form.querySelectorAll("input,textarea,select")) {
      if (
        field.disabled ||
        field.matches(
          'input:is([type="hidden"],[type="submit"],[type="button"],[type="reset"])',
        )
      )
        continue;
      const type =
        field.tagName === "INPUT" ? field.type : field.tagName.toLowerCase();
      if (
        !["text", "email", "tel", "url", "number", "textarea"].includes(type) ||
        !field.name ||
        seen.has(field.name)
      )
        return null;
      seen.add(field.name);
      const wrapper = field.closest(".elementor-field-group");
      const match = field.name.match(/^form_fields\[([a-zA-Z0-9_-]+)\]$/);
      const width = wrapper?.className.match(
        /(?:^|\s)elementor-col-(\d+)(?:\s|$)/,
      )?.[1];
      fields.push({
        _id: fields.length.toString(16).padStart(7, "0"),
        custom_id: match?.[1] || "field_" + (fields.length + 1),
        field_type: type,
        field_label: (
          field.labels?.[0]?.textContent ||
          field.getAttribute("aria-label") ||
          field.placeholder ||
          ""
        )
          .trim()
          .slice(0, 150),
        required: field.required ? "true" : "",
        placeholder: (field.placeholder || "").slice(0, 200),
        width:
          width && Number(width) <= 100 && Number(width) > 0 ? width : "100",
        ...(type === "textarea" && { rows: field.rows }),
      });
    }
    if (
      !fields.some((field) => field.field_type === "email") ||
      !fields.some((field) => field.field_type === "textarea")
    )
      return null;
    const button = form.querySelector(
      'button[type="submit"],input[type="submit"]',
    );
    return {
      _title: "Contact form",
      form_name: (form.getAttribute("name") || "Contact form").slice(0, 150),
      form_fields: fields,
      button_text: (
        button?.textContent?.trim() ||
        button?.value ||
        "Send"
      ).slice(0, 100),
      submit_actions: [],
    };
  }
  function slidesSettings(node, w) {
    const wrapper = node.querySelector(".elementor-slides-wrapper");
    const items = sourceSlides(node);
    if (!items.length) return null;
    const slides = [];
    const seen = new Set();
    for (const [index, item] of items.entries()) {
      const key = slideKey(item, index);
      if (seen.has(key)) continue;
      seen.add(key);
      const bg = item.querySelector(".swiper-slide-bg");
      const inner = item.querySelector(".swiper-slide-inner");
      if (!bg || !inner) return null;
      const heading = item.querySelector(".elementor-slide-heading");
      const description = item.querySelector(".elementor-slide-description");
      const button = item.querySelector(".elementor-slide-button");
      const link = inner.matches("a[href]")
        ? inner
        : button?.closest("a[href]");
      const style = w.getComputedStyle(bg);
      const image = style.backgroundImage.match(
        /^url\(["']?(.*?)["']?\)$/,
      )?.[1];
      const overlay = item.querySelector(".elementor-background-overlay");
      slides.push({
        _id: key,
        heading: heading ? sourceHTML(heading, true) : "",
        description: description ? sourceHTML(description, true) : "",
        button_text: button?.textContent.trim() || "",
        link: {
          url: link?.getAttribute("href") || "",
          is_external: link?.target === "_blank" ? "on" : "",
          nofollow: link?.relList.contains("nofollow") ? "on" : "",
        },
        link_click: link === inner ? "slide" : "button",
        background_image: { url: image || "", id: 0 },
        background_color: style.backgroundColor,
        background_size: ["cover", "contain", "auto"].includes(
          style.backgroundSize,
        )
          ? style.backgroundSize
          : "cover",
        background_ken_burns: bg.classList.contains("elementor-ken-burns")
          ? "yes"
          : "",
        zoom_direction: bg.classList.contains("elementor-ken-burns--out")
          ? "out"
          : "in",
        background_overlay: overlay ? "yes" : "",
        ...(overlay
          ? {
              background_overlay_color:
                w.getComputedStyle(overlay).backgroundColor,
            }
          : {}),
      });
    }
    const arrows = !!wrapper.querySelector(
      ".elementor-swiper-button, .swiper-button-next",
    );
    const dots = !!wrapper.querySelector(".swiper-pagination");
    const settings = {
      slides,
      navigation: arrows ? (dots ? "both" : "arrows") : dots ? "dots" : "",
    };
    for (const [key, value] of Object.entries(backgroundSettings(node) || {}))
      if (
        /^(?:navigation|autoplay|autoplay_speed|transition|transition_speed|infinite|pause_on_hover|pause_on_interaction)$/.test(
          key,
        )
      )
        settings[key] = value;
    const sample = items[0];
    const heading = sample.querySelector(".elementor-slide-heading");
    const description = sample.querySelector(".elementor-slide-description");
    const button = sample.querySelector(".elementor-slide-button");
    settings.slides_name = wrapper.getAttribute("aria-label") || "Slides";
    settings.content_animation = wrapper.getAttribute("data-animation") || "";
    settings.slides_horizontal_position =
      node.className.match(/elementor--h-position-(left|center|right)/)?.[1] ||
      "center";
    settings.slides_vertical_position =
      node.className.match(/elementor--v-position-(top|middle|bottom)/)?.[1] ||
      "middle";
    settings.button_size =
      button?.className.match(/elementor-size-(xs|sm|md|lg|xl)/)?.[1] || "sm";
    for (const [type, element] of [
      ["heading", heading],
      ["description", description],
    ])
      if (element && /^(?:h[1-6]|div|span|p)$/i.test(element.tagName))
        settings["slides_" + (type === "heading" ? "title" : type) + "_tag"] =
          element.tagName.toLowerCase();
    return settings;
  }
  function slideAppearance(node, w) {
    const items = sourceSlides(node);
    const slide = items[0];
    const inner = slide.querySelector(".swiper-slide-inner");
    const content = slide.querySelector(".swiper-slide-contents");
    const parts = {};
    for (const [name, selector] of [
      ["heading", ".elementor-slide-heading"],
      ["description", ".elementor-slide-description"],
      ["button", ".elementor-slide-button"],
    ]) {
      const part = slide.querySelector(selector);
      if (!part) continue;
      const style = w.getComputedStyle(part);
      parts[name] = {
        color: style.color,
        font: style.fontFamily,
        size: style.fontSize,
        weight: style.fontWeight,
        lineHeight: style.lineHeight,
        spacing: style.marginBottom,
        background: style.backgroundColor,
        border: style.borderTopWidth,
        borderColor: style.borderTopColor,
        radius: style.borderTopLeftRadius,
      };
    }
    const innerStyle = w.getComputedStyle(inner);
    const contentStyle = content ? w.getComputedStyle(content) : innerStyle;
    const height = slide.computedStyleMap?.().get("height")?.toString();
    return {
      height:
        height && height !== "auto" ? height : w.getComputedStyle(slide).height,
      width: contentStyle.maxWidth,
      align: innerStyle.textAlign,
      padding: dim(innerStyle, "padding"),
      parts,
      backgroundPositions: Object.fromEntries(
        [...items].flatMap((item, index) => {
          const image = item.querySelector(".swiper-slide-bg");
          return image
            ? [
                [
                  slideKey(item, index),
                  w.getComputedStyle(image).backgroundPosition,
                ],
              ]
            : [];
        }),
      ),
      overlay: {
        "background-color": contentStyle.backgroundColor,
        width: content?.computedStyleMap?.().get("width")?.toString() || "",
        "padding-top": contentStyle.paddingTop,
        "padding-right": contentStyle.paddingRight,
        "padding-bottom": contentStyle.paddingBottom,
        "padding-left": contentStyle.paddingLeft,
      },
    };
  }
  function applySlideAppearance(settings, appearance, suffix) {
    settings["slides_height" + suffix] = sourceSize(appearance.height);
    if (appearance.width !== "none")
      settings["content_max_width" + suffix] = sourceSize(appearance.width);
    settings["slides_padding" + suffix] = appearance.padding;
    if (!suffix) settings.slides_text_align = appearance.align;
    for (const [part, style] of Object.entries(appearance.parts)) {
      const typography = part + "_typography_";
      settings[typography + "font_size" + suffix] = sourceSize(style.size);
      if (style.lineHeight !== "normal")
        settings[typography + "line_height" + suffix] = sourceSize(
          style.lineHeight,
        );
      if (suffix) continue;
      settings[typography + "typography"] = "custom";
      settings[typography + "font_family"] = fontStack(style.font).family;
      settings[typography + "font_weight"] = style.weight;
      if (part === "button") {
        settings.button_text_color = style.color;
        settings.button_border_width = sourceSize(style.border);
        settings.button_border_color = style.borderColor;
        settings.button_border_radius = sourceSize(style.radius);
        settings.button_background_background = "classic";
        settings.button_background_color = style.background;
      } else {
        settings[part + "_color"] = style.color;
        settings[part + "_spacing"] = sourceSize(style.spacing);
      }
    }
  }
  // Recover editable slide records from Elementor's public carousel markup.
  function carouselSettings(node) {
    const type = node.getAttribute("data-widget_type")?.split(".")[0];
    if (
      !["reviews", "media-carousel"].includes(type) ||
      !root.LSE_CONFIG?.widgets?.includes(type)
    )
      return null;
    const wrapper = node.querySelector(
      ".elementor-main-swiper .swiper-wrapper",
    );
    if (!wrapper) return null;
    const slides = [];
    for (const slide of wrapper.querySelectorAll(
      ":scope > .swiper-slide:not(.swiper-slide-duplicate)",
    )) {
      const anchor = slide.querySelector("a[href]");
      const link = {
        url: anchor?.getAttribute("href") || "",
        is_external: anchor?.target === "_blank" ? "on" : "",
      };
      const item = { _id: (slides.length + 1).toString(16).padStart(7, "0") };
      if (type === "media-carousel") {
        const image = slide.querySelector(".elementor-carousel-image");
        const url = image?.style.backgroundImage.match(
          /^url\(["']?(.*?)["']?\)$/,
        )?.[1];
        if (
          !url ||
          slide.querySelector("video,iframe,.elementor-custom-embed-play")
        )
          return null;
        Object.assign(item, {
          type: "image",
          image: { url, id: 0 },
          image_link_to_type:
            anchor?.hasAttribute("data-elementor-open-lightbox") &&
            anchor.getAttribute("data-elementor-open-lightbox") !== "no"
              ? "file"
              : link.url
                ? "custom"
                : "",
          image_link_to: link,
        });
      } else {
        const name = slide.querySelector(".elementor-testimonial__name");
        if (!name) return null;
        const icon = slide.querySelector(".elementor-testimonial__icon svg");
        const brand = [...(icon?.classList || [])]
          .find((c) => c.startsWith("e-fab-"))
          ?.slice(6);
        Object.assign(item, {
          name: name.textContent.trim(),
          title:
            slide
              .querySelector(".elementor-testimonial__title")
              ?.textContent.trim() || "",
          content:
            slide
              .querySelector(".elementor-testimonial__text")
              ?.textContent.trim() || "",
          image: {
            url:
              slide
                .querySelector(".elementor-testimonial__image img")
                ?.getAttribute("src") || "",
            id: 0,
          },
          rating:
            slide.querySelectorAll(".elementor-star-full").length +
            slide.querySelectorAll(".elementor-star-half").length / 2,
          selected_social_icon: brand
            ? { value: "fab fa-" + brand, library: "fa-brands" }
            : { value: "", library: "" },
          link,
        });
      }
      slides.push(item);
    }
    if (!slides.length) return null;
    let config = {};
    try {
      config = JSON.parse(node.getAttribute("data-settings") || "{}") || {};
    } catch {}
    const settings = { slides };
    for (const [key, value] of Object.entries(config))
      if (
        /^(?:(?:slides_per_view|slides_to_scroll|space_between)(?:_(?:tablet|mobile|laptop|widescreen|tablet_extra|mobile_extra))?|skin|show_arrows|pagination|speed|autoplay|autoplay_speed|loop|pause_on_hover|pause_on_interaction)$/.test(
          key,
        )
      )
        settings[key] = value;
    return { type, settings };
  }
  function prepareLazyMedia(doc) {
    for (const image of doc.querySelectorAll("img")) {
      const source = image.getAttribute("src")?.trim();
      const lazy = [
        "data-src",
        "data-lazy-src",
        "data-original",
        "data-original-src",
        "data-ll-src",
      ]
        .map((name) => image.getAttribute(name)?.trim())
        .find(Boolean);
      if (
        lazy &&
        (!source || /^data:image\/(?:gif|svg\+xml)[;,]/i.test(source))
      )
        image.setAttribute("src", lazy);
    }
    for (const node of doc.querySelectorAll("img, picture source")) {
      const srcset = node.getAttribute("srcset")?.trim();
      if (srcset && !/^data:/i.test(srcset)) continue;
      const lazy = ["data-srcset", "data-lazy-srcset", "data-original-srcset"]
        .map((name) => node.getAttribute(name)?.trim())
        .find(Boolean);
      if (lazy) node.setAttribute("srcset", lazy);
    }
  }
  function sourceLink(node) {
    return {
      url: node.getAttribute("href") || "",
      is_external: node.target === "_blank" ? "on" : "",
      nofollow: node.relList.contains("nofollow") ? "on" : "",
    };
  }
  function hostedVideo(node, restoreURL) {
    if (
      node.querySelector("track") ||
      node.querySelectorAll("source").length > 1
    )
      return null;
    const source = node.querySelector("source");
    const url = node.getAttribute("src") || source?.getAttribute("src");
    const original = url && restoreURL(url);
    if (
      !original ||
      !/^https?:\/\//i.test(original) ||
      !/\.(?:mp4|webm)(?:[?#]|$)/i.test(original)
    )
      return null;
    const poster = node.getAttribute("poster");
    const preload = node.getAttribute("preload");
    return {
      video_type: "hosted",
      hosted_url: { url, id: 0 },
      ...(poster ? { poster: { url: poster, id: 0 } } : {}),
      ...(preload && ["auto", "metadata", "none"].includes(preload)
        ? { preload }
        : {}),
      controls: node.hasAttribute("controls") ? "yes" : "",
      autoplay: node.hasAttribute("autoplay") ? "yes" : "",
      loop: node.hasAttribute("loop") ? "yes" : "",
      mute: node.hasAttribute("muted") ? "yes" : "",
    };
  }
  function prepareSource(doc) {
    prepareLazyMedia(doc);
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
        if (backgroundSettings(menu).full_width === "stretch")
          panel.setAttribute("data-lse-menu-stretch", "");
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
    for (const el of doc.querySelectorAll(
      "[data-e-bg-lazyload],.e-con.e-parent",
    ))
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
      let settings = {};
      try {
        settings = JSON.parse(
          gallery
            .closest("[data-widget_type]")
            ?.getAttribute("data-settings") || "{}",
        );
      } catch {}
      if (gallery.hasAttribute("data-lse-gallery")) {
        // Upgrade JSON produced by older captures without duplicating its gallery.
        for (const card of gallery.querySelectorAll(":scope > a")) {
          const image = card.querySelector("img");
          if (image) {
            image.classList.add(
              "e-gallery-image",
              "elementor-gallery-item__image",
            );
            Object.assign(image.style, {
              padding: "0",
              border: "0",
              backgroundImage: "none",
            });
          }
          if (
            settings.overlay_background === "yes" &&
            !card.querySelector(".elementor-gallery-item__overlay")
          ) {
            const overlay = doc.createElement("div");
            overlay.className = "elementor-gallery-item__overlay";
            card.append(overlay);
          }
        }
        continue;
      }
      const images = [...gallery.querySelectorAll("[data-thumbnail]")];
      if (!images.length) continue;
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
        img.className = source.getAttribute("class") || "";
        img.alt =
          source.getAttribute("aria-label") ||
          source
            .closest("a")
            ?.querySelector(".elementor-gallery-item__title")
            ?.textContent?.trim() ||
          "";
        img.loading = "eager";
        img.style.cssText =
          "display:block;position:static;width:100%;height:auto;padding:0;border:0;background-image:none;object-fit:cover;aspect-ratio:" +
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
      // Empty overlay/content elements still carry visible backgrounds, hover effects and pseudo-elements.
      if (settings.gallery_layout && settings.gallery_layout !== "grid")
        warnings.push(
          "An animated " +
            settings.gallery_layout +
            " gallery was rebuilt as an editable responsive grid. Review its arrangement.",
        );
    }
    return warnings;
  }

  function browserTimeSlice() {
    let deadline = performance.now() + 24;
    return () => {
      if (performance.now() < deadline) return null;
      const turn =
        typeof root.scheduler?.yield === "function"
          ? root.scheduler.yield()
          : new Promise((resolve) => setTimeout(resolve, 0));
      return turn.then(() => {
        deadline = performance.now() + 24;
      });
    };
  }

  function resourceSession(project, map = {}) {
    const previewMap = {},
      originalAssets = new Map(),
      blobs = [];
    const styles = new Map();
    const destMap = Object.freeze({ ...map });
    let users = 0,
      disposed = false;
    const cleanup = () => {
      if (disposed && !users) {
        for (const url of blobs) URL.revokeObjectURL(url);
        blobs.length = 0;
        styles.clear();
      }
    };
    let previews;
    async function preparePreviews() {
      const pause = browserTimeSlice();
      for (const asset of project.assets) {
        const turn = pause();
        if (turn) await turn;
        const blob = URL.createObjectURL(
          new Blob([asset.bytes], { type: asset.type }),
        );
        blobs.push(blob);
        previewMap[asset.url] = blob;
        try {
          previewMap[new URL(asset.url).pathname] = blob;
        } catch {}
        if (map[asset.url]) previewMap[map[asset.url]] = blob;
        originalAssets.set(blob, map[asset.url] || asset.url);
      }
      return Object.freeze(previewMap);
    }
    return {
      prepare() {
        return (previews ??= preparePreviews());
      },
      originalAssets,
      destMap,
      styles,
      retain() {
        if (disposed) throw Error("The conversion resource session is closed.");
        users++;
      },
      release() {
        users--;
        cleanup();
      },
      dispose() {
        disposed = true;
        cleanup();
      },
    };
  }
  async function convert(project, page, options = {}) {
    if (page.conversion) {
      const template = root.LSENative.validateTemplate(page.elementor);
      root.LSENative.requireWidgets(template);
      const { warnings, nodes, fallbacks } = inspect(page);
      // The normal converted-page writer remaps bundled media and validates
      // settings, styles and script permissions on the destination.
      return {
        elements: template.content,
        css: page.conversion.css,
        regions: page.conversion.regions,
        warnings,
        fallbacks,
        source: {
          html: page.html,
          css: page.css,
          js: page.js,
          structure: page.conversion.structure || [],
        },
        seo: page.seo || {},
        counts: { native: nodes - fallbacks, fallbacks },
      };
    }
    if (page.elementor) return root.LSENative.convert(page, options.map || {});
    const resources =
      options.resources || resourceSession(project, options.map);
    resources.retain();
    try {
      return await convertDocument(
        project,
        page,
        { ...options, map: resources.destMap },
        resources,
      );
    } finally {
      resources.release();
      if (!options.resources) resources.dispose();
    }
  }
  async function convertDocument(project, page, options, resources) {
    const warnings = [...inspect(page).warnings];
    const previewMap = await resources.prepare();
    const { originalAssets } = resources;
    const pause = browserTimeSlice();
    const restoreRefs = (value) =>
      String(value).replace(/blob:[^\s"')<>]+/g, (url) => {
        const hash = url.indexOf("#");
        const base = hash < 0 ? url : url.slice(0, hash);
        return originalAssets.has(base)
          ? originalAssets.get(base) + (hash < 0 ? "" : url.slice(hash))
          : url;
      });
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
      .filter(
        (node) =>
          sourceScriptKind({
            id: node.id,
            type: node.type,
            code: node.textContent,
          }) === "script",
      )
      .map((x) => x.textContent)
      .join("\n");
    for (const node of doc.querySelectorAll("iframe")) {
      const map = mapSettings(node);
      if (map) {
        node.setAttribute("data-lse-map", JSON.stringify(map));
        // Measure the original iframe's CSS without running the remote document.
        node.removeAttribute("src");
        node.removeAttribute("srcdoc");
      } else {
        warnings.push(
          "An embedded application needs rebuilding; its remote frame was not imported.",
        );
        node.remove();
      }
    }
    for (const n of doc.querySelectorAll("script,object,embed,link,meta,base"))
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
    base.textContent = "";
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
        widths = [1440, 1280, 1024, 768, 767, 390];
      // Source breakpoints need not coincide with Elementor's three devices.
      // Capture each CSS transition instead of stretching a phone measurement
      // across the entire tablet/mobile range.
      const boundaries = new Set(widths);
      const collectBoundaries = (rules) => {
        for (const rule of rules) {
          if (rule.type === 4)
            for (const match of rule.conditionText.matchAll(
              /\b(min|max)-width\s*:\s*([\d.]+)px/gi,
            )) {
              const edge = Number(match[2]);
              for (const value of match[1].toLowerCase() === "min"
                ? [edge, edge - 0.02]
                : [edge])
                if (value >= 390 && value <= 1440) boundaries.add(value);
            }
          if (rule.cssRules) collectBoundaries(rule.cssRules);
        }
      };
      for (const style of d.querySelectorAll("style"))
        if (style.sheet) collectBoundaries(style.sheet.cssRules);
      widths.splice(0, widths.length, ...[...boundaries].sort((a, b) => b - a));
      const typography = measureTypography(d);
      const elements = [],
        generatedIds = new Set();
      let fallbacks = 0;
      const structural = new Set();
      const islands = new Set();
      const nativeInteractions = new Set();
      const nativeButtons = root.LSE_CONFIG?.nativeButtonContainers === true;
      for (const n of d.querySelectorAll("header,footer,nav"))
        if (n.querySelector("button,[aria-controls],[aria-expanded]")) {
          const region = n.closest("header,footer") || n;
          if (nativeButtons) nativeInteractions.add(region);
          else islands.add(region);
        }
      const formWidgets = new Map();
      for (const n of d.querySelectorAll("form")) {
        const block = n.closest('[data-widget_type^="form."]') || n;
        const settings = contactForm(block);
        if (settings) formWidgets.set(block, settings);
        else
          islands.add(n.closest(".fr-calculator,[data-lse-interaction]") || n);
      }
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
          const wrap = d.createElement(
            node.parentElement?.tagName === "BUTTON" ? "span" : "p",
          );
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
        const sticky = stickySettings(node);
        if (sticky) {
          delete settings.lse_attributes["data-lse-sticky"];
          settings.lse_sticky = sticky.edge;
          settings.lse_sticky_devices = sticky.devices;
          settings.lse_sticky_effects_offset = sticky.effects;
          settings.lse_sticky_parent = sticky.parent ? "yes" : "";
          for (const [device, suffix] of [
            ["desktop", ""],
            ["tablet", "_tablet"],
            ["mobile", "_mobile"],
          ])
            if (Object.hasOwn(sticky.offsets, device))
              settings["lse_sticky_offset" + suffix] = {
                unit: "px",
                size: sticky.offsets[device],
              };
        }
        let widget = "",
          children = [];
        settings.lse_attributes["data-lse-source-tag"] = tag;
        settings.lse_attributes["data-lse-native"] = "";
        if (nativeInteractions.has(node))
          settings.lse_attributes["data-lse-interactive"] = "";
        const interactive = islands.has(node);
        const slides =
          node.getAttribute("data-widget_type")?.startsWith("slides.") &&
          root.LSE_CONFIG?.widgets?.includes("slides") &&
          slidesSettings(node, w);
        const carousel = carouselSettings(node);
        const video = tag === "video" && hostedVideo(node, restoreRefs);
        const figureImage =
          tag === "figure" &&
          node.children.length === 2 &&
          node.querySelector(":scope > img") &&
          node.querySelector(":scope > figcaption");
        if (formWidgets.has(node)) {
          widget = "form";
          Object.assign(settings, formWidgets.get(node));
        } else if (slides) {
          widget = "slides";
          Object.assign(settings, slides);
        } else if (carousel) {
          widget = carousel.type;
          Object.assign(settings, carousel.settings);
        } else if (interactive) {
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
        } else if (tag === "iframe" && node.hasAttribute("data-lse-map")) {
          const map = JSON.parse(node.getAttribute("data-lse-map"));
          widget = "google_maps";
          settings.address = map.address;
          settings.zoom = { size: map.zoom, unit: "px" };
          delete settings.lse_attributes["data-lse-map"];
        } else if (video) {
          widget = "video";
          Object.assign(settings, video);
        } else if (tag === "img" || figureImage) {
          const image = figureImage ? node.querySelector(":scope > img") : node;
          widget = "image";
          settings.image = {
            url: rewrite(image.getAttribute("src") || "", options.map || {}),
            id: 0,
          };
          settings.image_size = "full";
          settings.caption_source = figureImage ? "custom" : "none";
          if (figureImage) settings.caption = sourceHTML(figureImage, true);
          settings.lse_image_alt = image.getAttribute("alt") || "";
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
          settings.link = sourceLink(node);
        } else if (
          tag === "a" &&
          node.hasAttribute("href") &&
          node.children.length <= 1 &&
          !node.querySelector(
            "div,section,article,img,svg,h1,h2,h3,h4,h5,h6,p,ul,ol",
          ) &&
          !w.getComputedStyle(node).display.includes("grid")
        ) {
          widget = "button";
          settings.text = sourceHTML(node, true);
          settings.link = sourceLink(node);
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
          ].includes(tag) &&
          !(tag === "button" && nativeButtons)
        ) {
          widget = "html";
          fallbacks++;
          settings.html = sourceHTML(node);
          if (tag === "canvas")
            warnings.push("Canvas drawing needs its original drawing code.");
        } else {
          if (tag === "a" && node.hasAttribute("href"))
            settings.link = sourceLink(node);
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
            ...(nativeButtons ? ["button"] : []),
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
              : figureImage
                ? node.querySelector(":scope > img")
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
        "overflow-x",
        "overflow-y",
        "height",
        "top",
        "right",
        "bottom",
        "left",
      ];
      for (const width of widths) {
        frame.style.width = width + "px";
        await new Promise((r) => setTimeout(r, 25));
        const parents = new WeakMap(),
          inlineBoxes = new WeakMap();
        const atomicInline = (node) => {
          if (inlineBoxes.has(node)) return inlineBoxes.get(node);
          const style = w.getComputedStyle(node);
          let value = /^inline/.test(style.display);
          if (style.display === "inline") {
            value = [...node.children].every((child) => {
              const c = w.getComputedStyle(child);
              return (
                c.display === "none" ||
                ["absolute", "fixed"].includes(c.position) ||
                atomicInline(child)
              );
            });
          }
          inlineBoxes.set(node, value);
          return value;
        };
        for (const entry of elements) {
          const turn = pause();
          if (turn) await turn;
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
          if (entry.widget === "slides")
            props.slides = slideAppearance(entry.node, w);
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
                      (parseFloat(ps.paddingRight) || 0) -
                      (parseFloat(ps.borderLeftWidth) || 0) -
                      (parseFloat(ps.borderRightWidth) || 0),
                  ),
                ),
              });
            }
            const cached = parents.get(parent);
            props.parentDisplay = cached.display;
            props.parentWidth = cached.width;
          }
          props.actualWidth = String(entry.node.getBoundingClientRect().width);
          props.typography = typography.read(entry.styleNode, content);
          props.textMaxWidth =
            entry.styleNode.computedStyleMap?.().get("max-width")?.toString() ||
            content.maxWidth;
          if (["header", "footer"].includes(entry.tag))
            props.contextVariables = [...s]
              .filter(
                (property) =>
                  property.startsWith("--") &&
                  !property.startsWith("--lse-measure-"),
              )
              .map((property) =>
                namespaceCSS(property + ":" + s.getPropertyValue(property)),
              )
              .filter(safeValue);

          const flowChildren = [...entry.node.children].filter(
            (node) => w.getComputedStyle(node).display !== "none",
          );
          props.inlineFlow =
            flowChildren.length > 1 && flowChildren.every(atomicInline);
          props.inlineGap = 0;
          if (props.inlineFlow) {
            const gaps = [];
            for (let i = 1; i < flowChildren.length; i++) {
              const a = flowChildren[i - 1].getBoundingClientRect(),
                b = flowChildren[i].getBoundingClientRect();
              if (Math.abs(a.top - b.top) < 1)
                gaps.push(
                  Math.max(
                    0,
                    b.left -
                      a.right -
                      (parseFloat(
                        w.getComputedStyle(flowChildren[i - 1]).marginRight,
                      ) || 0) -
                      (parseFloat(
                        w.getComputedStyle(flowChildren[i]).marginLeft,
                      ) || 0),
                  ),
                );
            }
            if (gaps.length) props.inlineGap = Math.min(...gaps);
          }
          props.sourceMinHeight = s.getPropertyValue("--min-height").trim();
          if (!entry.widget && entry.node.matches(".e-con")) {
            const overlay = w.getComputedStyle(entry.node, "::before");
            if (
              !["none", "normal"].includes(overlay.content) &&
              (overlay.backgroundColor !== "rgba(0, 0, 0, 0)" ||
                overlay.backgroundImage !== "none")
            )
              props.overlay = {
                color: overlay.backgroundColor,
                image: overlay.backgroundImage,
                opacity: Number(overlay.opacity),
                size: overlay.backgroundSize,
                position: overlay.backgroundPosition,
                repeat: overlay.backgroundRepeat,
              };
          }
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
          props.specifiedWidth = typed?.get("width")?.toString();
          props.specifiedHeight = typed?.get("height")?.toString();
          props.specifiedGridColumns = typed
            ?.get("grid-template-columns")
            ?.toString();
          props.specifiedGridRows = typed
            ?.get("grid-template-rows")
            ?.toString();
          props.sourceOffsets = {};
          for (const side of ["top", "right", "bottom", "left"]) {
            props.sourceOffsets[side] =
              typed?.get(side)?.toString() || props[side];
            props[side + "Auto"] = props.sourceOffsets[side] === "auto";
          }
          props.fillHeight =
            ["absolute", "fixed"].includes(props.position) &&
            !props.explicitHeight &&
            !props.topAuto &&
            !props.bottomAuto;
          if (entry.widget === "image") {
            const imageStyle = w.getComputedStyle(entry.styleNode);
            props.image = Object.fromEntries(
              imagePaint.map((p) => [p, imageStyle.getPropertyValue(p)]),
            );
            props.image.height = imageStyle.height;
            props.image.specifiedHeight = entry.styleNode
              .computedStyleMap?.()
              .get("height")
              ?.toString();
            for (const side of ["top", "right", "bottom", "left"])
              for (const part of ["width", "style", "color"])
                props.image["border-" + side + "-" + part] =
                  imageStyle.getPropertyValue("border-" + side + "-" + part);
            props.image.explicitHeight =
              entry.styleNode.computedStyleMap?.().get("height")?.toString() !==
              "auto";
            props.contentWidth = String(
              imageStyle.boxSizing === "content-box"
                ? parseFloat(imageStyle.width)
                : entry.styleNode.getBoundingClientRect().width,
            );
            props.imageBoxWidth =
              entry.node === entry.styleNode
                ? props.actualWidth
                : String(
                    Math.max(
                      1,
                      entry.node.clientWidth -
                        (parseFloat(s.paddingLeft) || 0) -
                        (parseFloat(s.paddingRight) || 0),
                    ),
                  );
          }
          if (!snapshots.has(entry.element.id))
            snapshots.set(entry.element.id, {});
          snapshots.get(entry.element.id)[width] = props;
        }
      }
      typography.restore();
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
      const structure = [];
      const byId = new Map(elements.map((entry) => [entry.element.id, entry]));
      const layoutNodes = new Set();
      const regionKind = (entry) => {
        const node = entry.node;
        if (
          node.parentElement?.closest(
            'main,[role=main],article,aside,nav,section,header,footer,[data-elementor-type="header"],[data-elementor-type="footer"]',
          )
        )
          return "";
        if (node.matches('header,[role=banner],[data-elementor-type="header"]'))
          return "header";
        if (
          node.matches(
            'footer,[role=contentinfo],[data-elementor-type="footer"]',
          )
        )
          return "footer";
        return "";
      };
      const sectionSelector =
        "section,article,.e-con.e-parent,.elementor-top-section";
      function stackedBlocks(entry, children) {
        if (
          children.length < 2 ||
          !children.every((child) => {
            const dom = byId.get(child.id).node;
            return (
              dom.matches(sectionSelector) ||
              (dom.tagName === "DIV" && dom.querySelector("h1,h2,h3"))
            );
          })
        )
          return false;
        return widths.every((width) => {
          const style = snapshots.get(entry.element.id)[width];
          if (style.display.includes("flex"))
            return style["flex-direction"].startsWith("column");
          if (style.display.includes("grid"))
            return (
              style["grid-template-columns"].trim().split(/\s+/).length === 1
            );
          return ["block", "contents", "none"].includes(style.display);
        });
      }
      function hasDesignControls(entry) {
        if (backgroundSettings(entry.node).background_slideshow_gallery?.length)
          return true;
        return widths.some((width) => {
          const style = snapshots.get(entry.element.id)[width];
          return (
            style.display.includes("grid") ||
            (style.display.includes("flex") &&
              ["align-items", "justify-content"].some((prop) =>
                /center|end|baseline|space-/.test(style[prop]),
              )) ||
            ["absolute", "fixed", "sticky"].includes(style.position) ||
            (style["background-image"] &&
              style["background-image"] !== "none") ||
            (style["background-color"] &&
              !["transparent", "rgba(0, 0, 0, 0)"].includes(
                style["background-color"],
              )) ||
            (style["box-shadow"] && style["box-shadow"] !== "none") ||
            (style.specifiedWidth &&
              !["auto", "100%"].includes(style.specifiedWidth)) ||
            style.explicitHeight
          );
        });
      }
      function pageBlocks(node, parent = null, keepBlock = false) {
        const entry = byId.get(node.id);
        const { tag, node: dom } = entry;
        const children = node.elements;
        if (!children.length) return [node];
        const section = dom.matches(sectionSelector);
        const kind = regionKind(entry);
        const isLayout =
          !entry.widget &&
          !entry.interactive &&
          !nativeInteractions.has(dom) &&
          !node.settings.lse_sticky;
        const stack = !parent && !section && stackedBlocks(entry, children);
        const pageFrame =
          !parent &&
          (dom.matches(
            'main,[role=main],[data-elementor-type="wp-page"],[data-elementor-type="single-page"],.elementor',
          ) ||
            dom.querySelector(
              'main,[role=main],header,footer,[role=banner],[role=contentinfo],[data-elementor-type="header"],[data-elementor-type="footer"]',
            ));
        const builderWrapper = dom.matches(
          ".e-con-inner,.elementor-widget-wrap,.elementor-widget-container,.elementor-container,.elementor-column-wrap,.elementor-element-populated,.elementor-section-wrap",
        );
        const removableWrapper =
          (builderWrapper || children.length === 1) &&
          !hasDesignControls(entry) &&
          !dom.matches("[role],[tabindex]") &&
          ![...dom.attributes].some((attribute) =>
            attribute.name.startsWith("aria-"),
          );
        const shell =
          isLayout &&
          !kind &&
          !keepBlock &&
          !section &&
          (tag === "body" ||
            (!parent && dom.matches("main,[role=main]")) ||
            (tag === "div" && (pageFrame || stack || removableWrapper)));
        if (shell) {
          const record = {
            id: node.id,
            parent,
            tag: tag === "main" ? "main" : "div",
            classes: node.settings.css_classes || "",
            anchor: node.settings._element_id || "",
            attributes: node.settings.lse_attributes || {},
            members: [],
          };
          structure.push(record);
          layoutNodes.add(node.id);
          const promoted = children.flatMap((child) =>
            pageBlocks(child, parent, stack),
          );
          record.members = promoted.map((child) => child.id);
          return promoted;
        }
        node.elements = children.flatMap((child) => pageBlocks(child, node.id));
        const heading = dom.querySelector("h1,h2,h3,h4,h5,h6");
        const label =
          kind ||
          dom.getAttribute("aria-label") ||
          heading?.textContent.trim() ||
          dom.id ||
          [...dom.classList].find((c) => !/^(?:e-|elementor)/.test(c)) ||
          (section ? "Section" : "");
        if (label && !node.settings._title)
          node.settings._title = (
            label[0].toUpperCase() + label.slice(1)
          ).slice(0, 100);
        return [node];
      }
      const blocks = tree.flatMap((node) => pageBlocks(node));
      if (structure.length && options.preserveCSS) {
        const shellProps = [
          ...new Set([...outerProps, ...innerProps, ...snapshotProps]),
        ];
        for (const shell of structure) {
          const all = snapshots.get(shell.id);
          let previous = {};
          for (const width of widths) {
            const current = {
              ...all[width],
              width: all[width].specifiedWidth,
              height: all[width].specifiedHeight,
            };
            const declarations = shellProps
              .filter(
                (name) =>
                  current[name] &&
                  current[name] !== previous[name] &&
                  safeValue(current[name]),
              )
              .map((name) => name + ":" + current[name]);
            previous = current;
            if (!declarations.length) continue;
            const selector =
              '__LSE_SCOPE__ [data-lse-layout-shell="' +
              shell.id +
              '"]' +
              (!shell.parent &&
              (shell === structure[0] ||
                (!shell.anchor &&
                  shell.tag === "div" &&
                  shell.members.length === blocks.length))
                ? ",__LSE_SCOPE__ [data-lse-editor-context]"
                : "");
            const rule = selector + "{" + declarations.join(";") + "}";
            css +=
              width === 1440
                ? rule
                : "@media(max-width:" + width + "px){" + rule + "}";
          }
        }
      }
      for (const entry of elements) {
        const turn = pause();
        if (turn) await turn;
        const { element, widget } = entry;
        if (layoutNodes.has(element.id)) continue;
        const all = snapshots.get(element.id);
        if (widget === "slides") {
          for (const [width, suffix] of [
            [1440, ""],
            [1024, "_tablet"],
            [390, "_mobile"],
          ])
            applySlideAppearance(element.settings, all[width].slides, suffix);
          if (options.preserveCSS) {
            let previous = "";
            const previousPositions = new Map();
            const scope = "__LSE_SCOPE__ .elementor-element-" + element.id;
            for (const width of widths) {
              const { overlay, backgroundPositions } = all[width].slides;
              const declarations = Object.entries(overlay)
                .filter(([, value]) => value && safeValue(value))
                .map(([key, value]) => key + ":" + value)
                .join(";");
              let rules = "";
              if (declarations !== previous && declarations) {
                rules +=
                  scope + " .swiper-slide-contents{" + declarations + "}";
                previous = declarations;
              }
              for (const [id, position] of Object.entries(
                backgroundPositions,
              )) {
                if (
                  !position ||
                  !safeValue(position) ||
                  position === (previousPositions.get(id) || "50% 50%")
                )
                  continue;
                previousPositions.set(id, position);
                rules +=
                  scope +
                  " .elementor-repeater-item-" +
                  id +
                  " .swiper-slide-bg{background-position:" +
                  position +
                  "}";
              }
              if (rules)
                css +=
                  width === 1440
                    ? rules
                    : "@media(max-width:" + width + "px){" + rules + "}";
            }
          }
        }
        if (widget === "image")
          css +=
            ":where(__LSE_SCOPE__ .elementor-element-" +
            element.id +
            ") > a,:where(__LSE_SCOPE__ .elementor-element-" +
            element.id +
            ") > .elementor-widget-container > a{width:100%}\n";
        if (
          entry.interactive ||
          (widget === "html" && entry.tag !== "svg" && options.preserveCSS)
        ) {
          // Copied roots keep their own box styles. Sampling those styles onto
          // the extra widget wrapper doubles padding/borders on details, forms
          // and tables; native sizing only belongs on the neutral wrapper.
          element.settings._element_width = "initial";
          element.settings._element_custom_width = { unit: "%", size: 100 };
          for (const [width, suffix] of [
            [1440, ""],
            [1024, "_tablet"],
            [390, "_mobile"],
          ]) {
            const s = all[width];
            if (
              (s.parentDisplay?.includes("grid") ||
                s.parentDisplay?.includes("flex")) &&
              s.specifiedWidth === "auto" &&
              !["absolute", "fixed"].includes(s.position) &&
              Number(s.actualWidth) < Number(s.parentWidth) - 1
            )
              element.settings["_element_custom_width" + suffix] =
                sourceSize("auto");
            element.settings["_flex_align_self" + suffix] = s["align-self"];
          }
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
            (entry.interactive
              ? " [data-lse-interactive]"
              : " [data-lse-source-content]") +
            "{font-family:" +
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
        const clipped =
          !widget &&
          widths.some((width) =>
            ["overflow-x", "overflow-y"].some(
              (name) => all[width][name] !== "visible",
            ),
          );
        for (const width of widths) {
          const s = all[width];
          const textWidget = ["heading", "text-editor", "button"].includes(
            widget,
          );
          const sourceValues = {};
          const sourceVariable = (name) => "var(--lse-source-" + name + ")";
          if (textWidget)
            sourceValues["font-size"] = s.typography.fontSize || s["font-size"];
          if (!widget || widget !== "html") {
            sourceValues.display = widget
              ? s.display === "inline"
                ? "inline-block"
                : s.display
              : !s.display.includes("flex") &&
                  !s.display.includes("grid") &&
                  s.inlineFlow
                ? "flex"
                : s.display;
            sourceValues.width = s.specifiedWidth || "auto";
            sourceValues.height = s.specifiedHeight || "auto";
            for (const part of ["padding", "margin"])
              for (const side of ["top", "right", "bottom", "left"])
                sourceValues[part + "-" + side] = s[part + "-" + side];
          }
          if (widget === "image")
            sourceValues["image-height"] =
              s.image.specifiedHeight || s.image.height;
          if (!widget) {
            sourceValues["flex-direction"] = s["flex-direction"];
            sourceValues["flex-wrap"] = s["flex-wrap"];
            sourceValues["row-gap"] = (parseFloat(s["row-gap"]) || 0) + "px";
            sourceValues["column-gap"] =
              (parseFloat(s["column-gap"]) || s.inlineGap || 0) + "px";
            sourceValues["grid-columns"] =
              s.specifiedGridColumns || s["grid-template-columns"];
            sourceValues["grid-rows"] =
              s.specifiedGridRows || s["grid-template-rows"];
            for (const name of [
              "justify-content",
              "align-items",
              "justify-items",
              "align-content",
            ])
              sourceValues[name] = s[name];
            sourceValues["min-height"] =
              parseFloat(s["min-height"]) > 0
                ? s.sourceMinHeight || s["min-height"]
                : (!element.elements.length ||
                      (s.inlineFlow &&
                        !s.display.includes("flex") &&
                        !s.display.includes("grid"))) &&
                    !s.fillHeight &&
                    !s.explicitHeight
                  ? s.height
                  : "0px";
          }
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
            if (/^-?\d+$/.test(s["z-index"]))
              target[(widget ? "_z_index" : "z_index") + suffix] = Number(
                s["z-index"],
              );
            target["lse_position" + suffix] = s.position;
            if (clipped) {
              target["lse_overflow_x" + suffix] = s["overflow-x"];
              target["lse_overflow_y" + suffix] = s["overflow-y"];
            }
            for (const side of ["top", "right", "bottom", "left"])
              target["lse_offset_" + side + suffix] = sourceSize(
                s.sourceOffsets[side] || s[side],
              );
            target["lse_box_sizing" + suffix] =
              widget === "image" ? "border-box" : s["box-sizing"];
            if (widget && widget !== "html")
              target["lse_widget_display" + suffix] =
                s.display === "inline" ? "inline-block" : s.display;
            target["_flex_align_self" + suffix] = s["align-self"];
            if (s.parentDisplay?.includes("flex")) {
              target["_flex_size" + suffix] = "custom";
              target["_flex_grow" + suffix] = Number(s["flex-grow"]);
              target["_flex_shrink" + suffix] = Number(s["flex-shrink"]);
              target["lse_flex_basis" + suffix] = sourceSize(s["flex-basis"]);
            }
            if (widget && s.explicitHeight)
              target["lse_height" + suffix] = sourceSize(
                s.specifiedHeight || s.height,
              );
            if (!widget)
              target["lse_justify_self" + suffix] = s["justify-self"];
            if (s.parentDisplay?.includes("grid")) {
              target[(widget ? "_element_custom_width" : "width") + suffix] =
                sourceSize(s.specifiedWidth || "auto");
              if (widget) target["_element_width" + suffix] = "initial";
            }
            const device =
              width === 1440
                ? "desktop"
                : width === 1024
                  ? "tablet"
                  : width === 390
                    ? "mobile"
                    : null;
            if (!options.preserveCSS && device && s.display === "none")
              target["hide_" + device] = "hidden-" + device;
            if (widget && !s.parentDisplay?.includes("grid")) {
              target["_element_width" + suffix] = "initial";
              target["_element_custom_width" + suffix] = s.specifiedWidth
                ? sourceSize(s.specifiedWidth)
                : {
                    unit: "%",
                    size: Math.max(
                      0,
                      (100 * parseFloat(s.actualWidth)) /
                        parseFloat(s.parentWidth || 1440),
                    ),
                  };
            }
            if (["absolute", "fixed"].includes(s.position)) {
              target[widget ? "_position" : "position"] = s.position;
              // A positioned node's containing block may be the viewport, not its zero-width DOM parent.
              const fillWidth =
                s.specifiedWidth === "auto" && !s.leftAuto && !s.rightAuto;
              const sourceWidth = fillWidth
                ? "calc(100% - " +
                  s.sourceOffsets.left +
                  " - " +
                  s.sourceOffsets.right +
                  ")"
                : s.specifiedWidth && s.specifiedWidth !== "auto"
                  ? s.specifiedWidth
                  : s.actualWidth + "px";
              target[(widget ? "_element_custom_width" : "width") + suffix] =
                sourceSize(sourceWidth);
              if (widget) target["_element_width" + suffix] = "initial";
              for (const [axis, first, last] of [
                ["x", "left", "right"],
                ["y", "top", "bottom"],
              ]) {
                const end = s[first + "Auto"] && !s[last + "Auto"];
                target["_offset_orientation_" + (axis === "x" ? "h" : "v")] =
                  end ? "end" : "start";
                target["_offset_" + axis + (end ? "_end" : "") + suffix] =
                  sourceSize(
                    s.sourceOffsets[end ? last : first] ||
                      s[end ? last : first],
                  );
              }
            }
            target[(widget ? "_" : "") + "padding" + suffix] = dim(
              s,
              "padding",
            );
            target[(widget ? "_" : "") + "margin" + suffix] = dim(s, "margin");
            if (widget === "image") {
              const image = s.image;
              target["lse_image_box_sizing" + suffix] = image["box-sizing"];
              if (
                entry.node === entry.styleNode &&
                image["box-sizing"] === "content-box"
              ) {
                const extra = ["left", "right"].reduce(
                  (n, side) =>
                    n +
                    (parseFloat(image["padding-" + side]) || 0) +
                    (parseFloat(image["border-" + side + "-width"]) || 0),
                  0,
                );
                if (extra && s.specifiedWidth && s.specifiedWidth !== "auto")
                  target["_element_custom_width" + suffix] = sourceSize(
                    "calc(" + s.specifiedWidth + " + " + extra + "px)",
                  );
              }
              target["align" + suffix] = s["text-align"];
              if (parseFloat(s.imageBoxWidth) > 0)
                target["width" + suffix] = {
                  unit: "%",
                  size:
                    (100 * parseFloat(s.contentWidth)) /
                    parseFloat(s.imageBoxWidth),
                };
              target["height" + suffix] = image.explicitHeight
                ? sourceSize(image.specifiedHeight || image.height)
                : { unit: "custom", size: "auto" };
              target["object-fit" + suffix] = image["object-fit"];
              target["object-position" + suffix] = image["object-position"];
              target["space" + suffix] = sourceSize(image["max-width"]);
              target["image_border_radius" + suffix] = radius(
                image["border-radius"],
              );
              const sides = ["top", "right", "bottom", "left"];
              const borderStyles = sides.map(
                (side) => image["border-" + side + "-style"],
              );
              const borderColors = sides.map(
                (side) => image["border-" + side + "-color"],
              );
              if (
                width === 1440 &&
                borderStyles.every((value) => value === borderStyles[0])
              )
                target.image_border_border = borderStyles[0];
              target["image_border_width" + suffix] = {
                unit: "px",
                ...Object.fromEntries(
                  sides.map((side) => [
                    side,
                    String(parseFloat(image["border-" + side + "-width"]) || 0),
                  ]),
                ),
                isLinked: false,
              };
              if (
                width === 1440 &&
                borderColors.every((value) => value === borderColors[0])
              )
                target.image_border_color = borderColors[0];
              target["lse_image_padding" + suffix] = dim(image, "padding");
              target.lse_image_background_background = "classic";
              target["lse_image_background_color" + suffix] =
                image["background-color"];
              const background = image["background-image"].match(
                /^url\(["']?(.*?)["']?\)$/,
              );
              if (background) {
                target["lse_image_background_image" + suffix] = {
                  url: restoreRefs(background[1]),
                  id: 0,
                };
                target["lse_image_background_size" + suffix] =
                  image["background-size"];
                target["lse_image_background_position" + suffix] =
                  image["background-position"];
                target["lse_image_background_repeat" + suffix] =
                  image["background-repeat"];
              }
              if (width === 1440)
                target.opacity = { unit: "px", size: Number(image.opacity) };
              else if (image.opacity !== all[1440].image.opacity)
                target["lse_image_opacity" + suffix] = {
                  unit: "px",
                  size: Number(image.opacity),
                };
              if (entry.node === entry.styleNode)
                target["_padding" + suffix] = {
                  unit: "px",
                  top: "0",
                  right: "0",
                  bottom: "0",
                  left: "0",
                  isLinked: true,
                };
            }
            if (widget === "google_maps")
              target["height" + suffix] = sourceSize(s.height);
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
              target["lse_text_max_width" + suffix] = sourceSize(
                options.preserveCSS
                  ? "var(--lse-text-max-width)"
                  : s.textMaxWidth,
              );
              target[prefix + "_font_size" + suffix] = s.typography.fontSize
                ? sourceSize(s.typography.fontSize)
                : px(s["font-size"]);
              if (width === 1440) {
                const font = fontStack(s["font-family"]);
                target[prefix + "_font_family"] = font.family;
                if (font.fallbacks) target.lse_font_fallbacks = font.fallbacks;
                target[prefix + "_font_weight"] = s["font-weight"];
              } else {
                if (s["font-family"] !== all[1440]["font-family"])
                  target["lse_font_family" + suffix] = s["font-family"];
                if (s["font-weight"] !== all[1440]["font-weight"])
                  target["lse_font_weight" + suffix] = s["font-weight"];
              }
              if (
                s["line-height"] === "normal" ||
                all[1440]["line-height"] === "normal"
              )
                target["lse_line_height" + suffix] = s["line-height"];
              if (parseFloat(s["line-height"]) > 0)
                target[prefix + "_line_height" + suffix] = /^\d*\.?\d+$/.test(
                  s.typography.lineHeight,
                )
                  ? { unit: "em", size: Number(s.typography.lineHeight) }
                  : px(s["line-height"]);
              target[prefix + "_letter_spacing" + suffix] = s.typography
                .letterSpacing
                ? sourceSize(s.typography.letterSpacing)
                : px(s["letter-spacing"]);
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
                // Older Elementor keeps an extra widget container. Let its native
                // justified button fill the imported width in either markup layout.
                target["lse_button_container_width" + suffix] = s.explicitWidth
                  ? "100%"
                  : "auto";
                target["background_color" + suffix] = s["background-color"];
                if (
                  (s.explicitHeight && parseFloat(s.height) > 0) ||
                  parseFloat(s["min-height"]) > 0
                )
                  target["lse_button_min_height" + suffix] = sourceSize(
                    s.explicitHeight
                      ? s.specifiedHeight || s.height
                      : s["min-height"],
                  );
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
              target["lse_display" + suffix] =
                !s.display.includes("flex") &&
                !s.display.includes("grid") &&
                s.inlineFlow
                  ? "flex"
                  : s.display;
              target["lse_text_align" + suffix] = s["text-align"];
              if (s.explicitHeight || s.fillHeight)
                target["lse_height" + suffix] = sourceSize(
                  s.fillHeight
                    ? "calc(100% - " +
                        s.sourceOffsets.top +
                        " - " +
                        s.sourceOffsets.bottom +
                        ")"
                    : s.specifiedHeight || s.height,
                );
              else if (all[1440].explicitHeight)
                target["lse_height" + suffix] = {
                  unit: "custom",
                  size: "auto",
                };
              target["border_radius" + suffix] = radius(s["border-radius"]);
              if (width === 1440) target.background_background = "classic";
              if (width === 1440)
                target.background_color = s["background-color"];
              else if (s["background-color"] !== all[1440]["background-color"])
                target["lse_background_color" + suffix] = s["background-color"];
              {
                const image = s["background-image"].match(
                  /^url\(["']?(.*?)["']?\)$/,
                );
                if (image) {
                  target["background_image" + suffix] = {
                    url: restoreRefs(image[1]),
                    id: 0,
                  };
                  target["background_size" + suffix] = s["background-size"];
                  target["background_position" + suffix] =
                    s["background-position"];
                  target["background_repeat" + suffix] = s["background-repeat"];
                }
              }
              if (s.overlay) {
                target.background_overlay_background = "classic";
                if (width === 1440) {
                  target.background_overlay_color = s.overlay.color;
                  const image = s.overlay.image.match(
                    /^url\(["']?(.*?)["']?\)$/,
                  );
                  if (image)
                    target.background_overlay_image = {
                      id: 0,
                      url: restoreRefs(image[1]),
                    };
                } else if (s.overlay.color !== all[1440].overlay?.color)
                  target["lse_overlay_color" + suffix] = s.overlay.color;
                target["background_overlay_opacity" + suffix] = {
                  size: s.overlay.opacity,
                  unit: "px",
                };
              }
              if (
                !s.parentDisplay?.includes("grid") &&
                !["absolute", "fixed"].includes(s.position) &&
                parseFloat(s.parentWidth) > 0
              ) {
                target["width" + suffix] = s.specifiedWidth
                  ? sourceSize(s.specifiedWidth)
                  : {
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
                  : !s.display.includes("flex") &&
                      !s.display.includes("grid") &&
                      s.inlineFlow
                    ? "baseline"
                    : s["align-items"];
              target["flex_wrap" + suffix] =
                !s.display.includes("flex") && s.inlineFlow
                  ? "wrap"
                  : s["flex-wrap"];
              target["flex_gap" + suffix] = {
                unit: "px",
                column: String(parseFloat(s["column-gap"]) || s.inlineGap || 0),
                row: String(parseFloat(s["row-gap"]) || 0),
                isLinked: false,
              };
              // Elementor keeps a container's desktop Grid/Flex class at
              // smaller widths. Keep both sets of native alignment values in
              // sync when the source switches layout mode at a breakpoint.
              target["grid_gaps" + suffix] = target["flex_gap" + suffix];
              for (const property of [
                "align-items",
                "justify-items",
                "justify-content",
                "align-content",
              ])
                target["grid_" + property.replaceAll("-", "_") + suffix] =
                  s[property];
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
                target["grid_auto_flow" + suffix] = s["grid-auto-flow"];
              } else if (target.container_type === "grid") {
                // Core gates responsive grid alignment on a custom column
                // unit, even while our responsive Display control is Flex.
                target["grid_columns_grid" + suffix] = target.grid_columns_grid;
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
              } else if (
                (!element.elements.length ||
                  (s.inlineFlow &&
                    !s.display.includes("flex") &&
                    !s.display.includes("grid"))) &&
                !s.fillHeight &&
                !s.explicitHeight &&
                parseFloat(s.height) > 0
              )
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
          if (
            suffix !== null &&
            !widget &&
            element.settings.container_type === "grid"
          ) {
            // Core's Flex direction controls only emit selectors for .e-flex.
            // A desktop Grid keeps .e-grid when the source becomes Flex later.
            for (const property of ["direction", "wrap"])
              element.settings["lse_flex_" + property + suffix] =
                options.preserveCSS
                  ? sourceVariable("flex-" + property)
                  : s["flex-" + property];
          }
          if (!options.preserveCSS) continue;
          if (suffix !== null && widget !== "html") {
            const target = element.settings;
            if (textWidget)
              target["typography_font_size" + suffix] = sourceSize(
                sourceVariable("font-size"),
              );
            const displayControl = widget
              ? "lse_widget_display"
              : "lse_display";
            if (Object.hasOwn(target, displayControl + suffix))
              target[displayControl + suffix] = sourceVariable("display");
            for (const [control, name] of [
              [widget ? "_element_custom_width" : "width", "width"],
              ["lse_height", "height"],
              ["min_height", "min-height"],
            ])
              if (Object.hasOwn(target, control + suffix))
                target[control + suffix] = sourceSize(sourceVariable(name));
            for (const part of ["padding", "margin"]) {
              if (
                part === "padding" &&
                (widget === "button" ||
                  (widget === "image" && entry.node === entry.styleNode))
              )
                continue;
              const control = (widget ? "_" : "") + part + suffix;
              if (Object.hasOwn(target, control))
                target[control] = {
                  unit: "custom",
                  isLinked: false,
                  ...Object.fromEntries(
                    ["top", "right", "bottom", "left"].map((side) => [
                      side,
                      sourceVariable(part + "-" + side),
                    ]),
                  ),
                };
            }
            if (
              widget === "button" &&
              Object.hasOwn(target, "text_padding" + suffix)
            )
              target["text_padding" + suffix] = {
                unit: "custom",
                isLinked: false,
                ...Object.fromEntries(
                  ["top", "right", "bottom", "left"].map((side) => [
                    side,
                    sourceVariable("padding-" + side),
                  ]),
                ),
              };
            if (widget === "image")
              target["height" + suffix] = sourceSize(
                sourceVariable("image-height"),
              );
            if (!widget) {
              target["flex_gap" + suffix] = target["grid_gaps" + suffix] = {
                unit: "custom",
                row: sourceVariable("row-gap"),
                column: sourceVariable("column-gap"),
                isLinked: false,
              };
              for (const name of [
                "justify-content",
                "align-items",
                "justify-items",
                "align-content",
              ]) {
                target["grid_" + name.replaceAll("-", "_") + suffix] =
                  sourceVariable(name);
                if (["justify-content", "align-items"].includes(name))
                  target["flex_" + name.replaceAll("-", "_") + suffix] =
                    sourceVariable(name);
              }
              if (target.container_type === "grid") {
                target["grid_columns_grid" + suffix] = sourceSize(
                  sourceVariable("grid-columns"),
                );
                target["grid_rows_grid" + suffix] = sourceSize(
                  sourceVariable("grid-rows"),
                );
              }
            }
          }
          let declarations = [];
          for (const [name, value] of Object.entries(sourceValues))
            if (value && safeValue(value))
              declarations.push("--lse-source-" + name + ":" + value);
          if (["heading", "text-editor", "button"].includes(widget))
            declarations.push("--lse-text-max-width:" + s.textMaxWidth);
          for (const p of outerProps) {
            if (
              widget === "image" &&
              (["aspect-ratio", "object-fit"].includes(p) ||
                (entry.node === entry.styleNode && imagePaint.includes(p)))
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
            const display =
              s.inlineFlow &&
              !s.display.includes("flex") &&
              !s.display.includes("grid")
                ? "flex"
                : s.display;
            declarations.push("display:" + display, "--display:" + display);
          }

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
              inner.push("width:100%;height:auto");
              for (const property of imagePaint) {
                const value = s.image[property];
                if (value && safeValue(value))
                  inner.push(property + ":" + value);
              }
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
                  ? " img{"
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
      async function sourceStyles(rules) {
        const fragments = [];
        for (const rule of rules) {
          const turn = pause();
          if (turn) await turn;
          const key = String(!!options.preserveCSS) + rule.cssText;
          if (resources.styles.has(key)) {
            fragments.push(resources.styles.get(key));
            continue;
          }
          let fragment = "";
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
                /:(?:hover|focus(?:-within|-visible)?|active|visited|checked|disabled)\b|::|\.lse-source-elementor-sticky--(?:active|effects)\b/.test(
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
                    ":where([data-lse-native].elementor-widget:not(.elementor-widget-image)) :is(.elementor-heading-title,.elementor-button,.elementor-widget-container,img)" +
                    pseudo,
                );
                stateSelectors.push(
                  "__LSE_SCOPE__ " +
                    native +
                    ":where([data-lse-native].elementor-widget-image) img" +
                    pseudo,
                );
                stateSelectors.push(
                  "__LSE_SCOPE__ " +
                    native +
                    ":is(.elementor-element[data-lse-native]):where(:not(.elementor-widget))" +
                    pseudo,
                );
              }
            }
            fragment =
              groupedRule(variableSelectors, variables) +
              groupedRule(stateSelectors, declarations);
          } else if (rule.type === 7) fragment = rule.cssText + "\n";
          else if (rule.cssRules)
            fragment =
              rule.cssText.slice(0, rule.cssText.indexOf("{")) +
              "{" +
              (await sourceStyles(rule.cssRules)) +
              "}\n";
          resources.styles.set(key, fragment);
          fragments.push(fragment);
        }
        return fragments.join("");
      }
      if (options.preserveCSS || islands.size)
        for (const sheet of sourceSheets)
          css += await sourceStyles(sheet.cssRules);
      if (/<script[^>]+src=/i.test(page.html))
        warnings.push(
          "External scripts were not downloaded. Their dependencies must be configured separately.",
        );
      const regions = [];
      for (const entry of elements) {
        const kind = regionKind(entry);
        if (kind) {
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
            kind,
            context_css: restoreRefs(contextCSS),
            separate: true,
          });
        }
      }
      return {
        elements: restore(blocks),
        css: restoreRefs(css),
        warnings: [...new Set(warnings)],
        fallbacks,
        regions,
        structure,
        source: {
          html: page.html,
          css: page.css,
          js: page.js + "\n" + inlineScripts,
          structure,
        },
        seo: page.seo || {},
        counts: { native: elements.length - fallbacks, fallbacks },
      };
    } finally {
      clearTimeout(timer);
      frame.remove();
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
    const scripts = [],
      warnings = new Set();
    for (const node of doc.querySelectorAll("script")) {
      const kind = sourceScriptKind({
        id: node.id,
        src: node.getAttribute("src") || "",
        type: node.type,
        code: node.textContent,
      });
      if (kind === "analytics")
        warnings.add(
          "Source analytics scripts were omitted. Configure analytics on the destination separately.",
        );
      else if (kind === "module")
        warnings.add(
          "JavaScript modules need their destination dependencies configured.",
        );
      else if (kind === "script" && !node.hasAttribute("src"))
        scripts.push(node.textContent);
    }
    const js = scripts.join("\n;\n");
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
      capture: { warnings: [...warnings] },
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
    resourceSession,
    resolveLinks,
    prepareSource,
    cssReferences,
    replaceCSSReferences,
    importConditions,
    fontStack,
    sourceScriptKind,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
