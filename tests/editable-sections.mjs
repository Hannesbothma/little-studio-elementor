import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const tab = await browser.newPage();
  const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9416";
  await tab.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor");
  await tab.waitForFunction(() => window.LSECapture);
  const result = await tab.evaluate(async () => {
    const home = "https://source.example/";
    const record = (suffix, body) => ({
      url: home + suffix,
      requested: home + suffix,
      kind: "page",
      type: "text/html",
      data: btoa(
        '<title>Test</title><header><p>Brand</p><nav class="header-nav-list"><div><button class="header-nav-folder-title">Work</button><div class="header-nav-folder-content"><a href="/">Home</a></div></div></nav></header><main>' +
          body +
          "</main><footer><p>Credits</p></footer>",
      ),
    });
    const project = await LSECapture.packageWebsite(home, [
      record(
        "",
        `<article><section class="region"><section style="min-height:calc(100vh - 40px)"><h1>Work</h1>
        <svg style="display:none"><symbol id="arrow" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></symbol></svg>
        <svg viewBox="0 0 10 10"><use href="#arrow"/></svg><svg><use href="/social.svg#network"/></svg><div></div>
        <img src="/legacy.svg" alt="Legacy SVG">
        <iframe src="https://player.vimeo.com/video/357581440?background=1"></iframe>
        </section><section><h2>Subscribe</h2><form class="newsletter-form"><div class="newsletter-form-header"><p>Monthly news</p></div>
        <input type="email" name="email" required placeholder="Email"><button type="submit">Sign up</button></form></section></section></article>`,
      ),
      {
        kind: "asset",
        type: "image/svg+xml",
        url: home + "social.svg",
        requested: home + "social.svg",
        data: btoa(
          '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="network" viewBox="0 0 64 64"><path d="M0 0h64v64z"/></symbol></svg>',
        ),
      },
      {
        kind: "asset",
        type: "image/svg+xml",
        url: home + "legacy.svg",
        requested: home + "legacy.svg",
        data: btoa(
          '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "https://example.org/svg.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><rect width="240" height="60"/></svg>',
        ),
      },
      record("cart", '<div id="sqs-cart-root"></div>'),
    ]);
    const converted = await LSEConverter.convert(project, project.pages[0], {
      preserveCSS: true,
    });
    const blank = await LSEConverter.convert(project, project.pages[1], {
      preserveCSS: true,
    });
    const supportsCart = LSE_CONFIG.wooCart;
    let shop;
    try {
      LSE_CONFIG.wooCart = true;
      shop = await LSEConverter.convert(project, project.pages[1], {
        preserveCSS: true,
      });
    } finally {
      LSE_CONFIG.wooCart = supportsCart;
    }
    const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.elements)]);
    const widgets = flat(converted.elements);
    const fixture = {
      ...project.pages[0],
      css: "",
      js: "",
      conversion: { css: "", version: 1 },
      captureScripts: true,
      capturePayload: new Blob([
        JSON.stringify({
          css: "main{}",
          js: "void 0",
          convertedCSS: ".elementor{}",
        }),
      ]),
    };
    const id = "editable-sections-" + crypto.randomUUID();
    let restored;
    try {
      await LSERecovery.save(id, { ...project, pages: [fixture] }, {});
      const checkpoint = await LSERecovery.load(id);
      restored = await LSEConverter.readCapturePage(
        checkpoint.project.pages[0],
      );
    } finally {
      await LSERecovery.remove(id);
    }
    const icon = widgets.find((n) => n.widgetType === "icon");
    return {
      restored: [
        restored.css,
        restored.js,
        restored.conversion.css,
        Object.hasOwn(restored, "capturePayload"),
      ],
      sections: converted.elements
        .filter((n) => n.settings.html_tag === "section")
        .map((n) => n.settings._title),
      regions: converted.regions.map((n) => n.kind),
      blank: blank.emptyBody,
      supportsCart,
      legacySVG: project.assets.find((asset) => asset.name === "legacy-svg.svg")
        ?.data,
      cart: flat(shop.elements).find((n) => n.widgetType === "shortcode")
        ?.settings.shortcode,
      viewportHeight:
        /--lse-source-min-height:\s*calc\((?:100vh\s*-\s*40px|-40px\s*\+\s*100vh)\)/.test(
          converted.css,
        ),
      navInstalled: LSE_CONFIG.widgets.includes("nav-menu"),
      menu: widgets.find((n) => n.widgetType === "nav-menu")?.settings,
      nested:
        project.site.navigation[0]?.children?.[0]?.key === project.pages[0].key,
      form: widgets.find((n) => n.widgetType === "form")?.settings,
      canCollect: LSE_CONFIG.collectSubmissions,
      formInstalled: LSE_CONFIG.widgets.includes("form"),
      video: widgets.find((n) => n.widgetType === "video")?.settings,
      icons: widgets.filter((n) => n.widgetType === "icon").length,
      icon:
        icon &&
        project.assets.find(
          (a) => a.url === icon.settings.selected_icon.value.url,
        )?.type,
    };
  });
  assert.deepEqual(result.restored, [
    "main{}",
    "void 0",
    ".elementor{}",
    false,
  ]);
  assert.deepEqual(result.sections, ["Work", "Subscribe"]);
  assert.deepEqual(result.regions, ["header", "footer"]);
  assert.equal(result.blank, !result.supportsCart);
  assert.equal(result.cart, "[woocommerce_cart]");
  assert(result.viewportHeight, "Retain the authored viewport height");
  assert(result.nested);
  if (result.navInstalled) assert.equal(result.menu?.lse_imported_menu, "yes");
  assert.equal(result.icons, 2);
  assert.equal(result.icon, "image/svg+xml");
  assert(
    result.legacySVG,
    "Package the linked SVG with a legacy document type",
  );
  const legacySVG = Buffer.from(
    result.legacySVG.split(",")[1],
    "base64",
  ).toString();
  assert.match(legacySVG, /width="240" height="60"/);
  assert.doesNotMatch(legacySVG, /<!DOCTYPE|<!ENTITY/i);
  assert.equal(result.video.vimeo_url, "https://vimeo.com/357581440");
  assert.equal(result.video.mute, "yes");
  if (result.formInstalled) {
    assert.equal(result.form.form_fields[0].field_type, "email");
    assert.equal(result.form.button_text, "Sign up");
    if (result.canCollect)
      assert.deepEqual(result.form.submit_actions, ["save-to-database"]);
  }
  console.log(
    "Verified editable sections, shared parts, standalone icons, video, forms and empty-body detection.",
  );
} finally {
  await browser.close();
}
