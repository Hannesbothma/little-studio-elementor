(function (root) {
  "use strict";
  const object = (v) =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  const settings = (v) => object(v) || (Array.isArray(v) && !v.length);
  const flatten = (nodes) => nodes.flatMap((n) => [n, ...flatten(n.elements)]);
  function isTemplate(input) {
    return (
      object(input) && input.version === "0.4" && Array.isArray(input.content)
    );
  }
  function validateTemplate(input) {
    if (
      !isTemplate(input) ||
      !["page", "section", "container", "header", "footer"].includes(
        input.type,
      ) ||
      typeof input.title !== "string" ||
      !input.title.trim() ||
      !settings(input.page_settings) ||
      !input.content.length
    )
      throw Error(
        "Choose a nonempty Elementor 0.4 page, section, header or footer template JSON.",
      );
    const ids = new Set();
    function walk(nodes) {
      for (const n of nodes) {
        if (
          !object(n) ||
          !/^[a-f0-9]{7,8}$/.test(n.id) ||
          ids.has(n.id) ||
          !["container", "section", "column", "widget"].includes(n.elType) ||
          !settings(n.settings) ||
          !Array.isArray(n.elements) ||
          (n.elType === "widget" &&
            (typeof n.widgetType !== "string" || !n.widgetType))
        )
          throw Error(
            "Invalid or duplicate native Elementor element: " +
              (n?.id || "missing ID"),
          );
        ids.add(n.id);
        walk(n.elements);
      }
    }
    walk(input.content);
    return input;
  }
  function requireWidgets(template) {
    const installed = root.LSE_CONFIG?.widgets;
    if (!Array.isArray(installed)) return;
    const missing = [
      ...new Set(
        flatten(template.content)
          .filter(
            (n) => n.elType === "widget" && !installed.includes(n.widgetType),
          )
          .map((n) => n.widgetType),
      ),
    ];
    if (missing.length)
      throw Error(
        "Install and activate the Elementor Pro or add-on widgets required by this template: " +
          missing.join(", "),
      );
  }
  function fromTemplates(entries) {
    let template, key;
    if (entries.length === 1) {
      template = structuredClone(validateTemplate(entries[0].data));
      key = "page";
    } else {
      const parts = new Map(entries.map((e) => [e.name.toLowerCase(), e.data]));
      if (
        entries.length !== 3 ||
        !["header.json", "content.json", "footer.json"].every((n) =>
          parts.has(n),
        )
      )
        throw Error(
          "Choose one JSON, or select header.json, content.json and footer.json together to assemble one page.",
        );
      for (const t of parts.values()) validateTemplate(t);
      template = structuredClone(parts.get("content.json"));
      template.title = "Home";
      template.type = "page";
      template.content = structuredClone([
        ...parts.get("header.json").content,
        ...template.content,
        ...parts.get("footer.json").content,
      ]);
      validateTemplate(template);
      key = "home";
    }
    return root.LSEConverter.validate({
      format: "little-studio-website",
      version: 1,
      site_id: "elementor-native",
      title: template.title,
      site_css: "",
      assets: [],
      fonts: [],
      input_kind: "elementor",
      pages: [
        {
          key,
          title: template.title,
          slug: key,
          url: "",
          parent_key: "",
          html: "",
          css: "",
          js: "",
          elementor: template,
        },
      ],
      site: { home_key: key, navigation: [] },
    });
  }
  function inspect(template) {
    const nodes = flatten(template.content),
      warnings = [];
    const count = (type) => nodes.filter((n) => n.widgetType === type).length;
    const fallbacks = count("html");
    if (JSON.stringify(template).match(/https?:\/\//))
      warnings.push(
        "Review external media and page links. Files packaged in a Little Studio website JSON are remapped during import; unbundled resources remain external.",
      );
    if (fallbacks)
      warnings.push(
        "This template includes " +
          fallbacks +
          " HTML widget(s). These regions are not native editable components.",
      );
    if (
      nodes.some(
        (n) =>
          n.widgetType === "html" &&
          /w2e-unsupported-widget|Unsupported third-party widget/i.test(
            n.settings.html || "",
          ),
      )
    )
      warnings.push(
        "The supplied template contains an unsupported-widget placeholder. The missing feature must be rebuilt from the source.",
      );
    if (
      nodes.some(
        (n) => n.widgetType === "google_maps" && !n.settings.address?.trim(),
      )
    )
      warnings.push(
        "A native Google Maps widget has no address in the supplied JSON.",
      );
    if (
      nodes.some(
        (n) =>
          /\bsticky\b/.test(JSON.stringify(n.settings)) ||
          Object.keys(n.settings).some((k) => k.startsWith("motion_fx")),
      )
    )
      warnings.push(
        "Sticky and motion settings require verification with Elementor Pro enabled.",
      );
    if (
      nodes.some((n) =>
        Object.keys(n.settings).some((k) =>
          /_(?:laptop|widescreen|tablet_extra|mobile_extra)$/.test(k),
        ),
      )
    )
      warnings.push(
        "Additional responsive breakpoint settings are preserved; enable matching breakpoints in the destination Elementor site if needed.",
      );
    return {
      warnings,
      headings: count("heading"),
      images: count("image") + count("image-box"),
      nodes: nodes.length,
      fallbacks,
    };
  }
  function convert(page, map) {
    const template = validateTemplate(page.elementor);
    requireWidgets(template);
    const restore = (v) =>
      typeof v === "string"
        ? root.LSEConverter.rewrite(v, map)
        : Array.isArray(v)
          ? v.map(restore)
          : object(v)
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, restore(x)]),
              )
            : v;
    const elements = restore(template.content),
      nodes = flatten(elements),
      fallbacks = nodes.filter((n) => n.widgetType === "html").length;
    return {
      native_elementor: true,
      elements,
      page_settings: restore(template.page_settings),
      css: "",
      warnings: inspect(template).warnings,
      fallbacks,
      regions: [],
      source: {
        html: "",
        css: "",
        js: "",
        elementor: structuredClone(template),
      },
      seo: page.seo || {},
      counts: { native: nodes.length - fallbacks, fallbacks },
    };
  }
  root.LSENative = {
    isTemplate,
    validateTemplate,
    fromTemplates,
    requireWidgets,
    inspect,
    convert,
  };
})(globalThis);
