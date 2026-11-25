import { chromium } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { handleEditorPrompts } from "./editor-prompts.mjs";
import { comparePixels } from "./image-pixels.mjs";
const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9420";
const sourceURL = "https://source.example/transparent-logo.svg";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><circle cx="210" cy="75" r="60" fill="#cc3355"/></svg>';
const data = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
const project = {
  format: "little-studio-website",
  version: 1,
  site_id: "fidelity-" + randomUUID(),
  title: "Fidelity regression",
  site_css: "",
  fonts: [],
  assets: [
    {
      url: sourceURL,
      name: "transparent-logo.svg",
      type: "image/svg+xml",
      data,
    },
  ],
  site: { home_key: "home", navigation: [] },
  pages: [
    {
      key: "home",
      title: "Fidelity regression",
      slug: "fidelity-regression",
      url: "https://source.example/",
      parent_key: "",
      html:
        '<body><header class="replica-sticky" data-settings=\'{"sticky":"top","sticky_on":["desktop","tablet","mobile"],"sticky_offset":12,"sticky_offset_mobile":4,"sticky_effects_offset":120}\'><h1>Replica fixture</h1></header><main><img class="painted" src="' +
        sourceURL +
        '" alt="Decorated photo"><a class="framed" href="#details"><img class="transparent" src="' +
        sourceURL +
        '" alt="Transparent photo"></a><div class="long-content">Page content</div></main></body>',
      css: "html,body{margin:0;background:white;font-family:Arial,sans-serif}*{box-sizing:border-box}.replica-sticky{height:80px;padding:10px;display:flex;align-items:center;background:rgb(20,40,60);color:white;z-index:40}.replica-sticky.elementor-sticky--effects{background:rgb(20,120,60)}h1{margin:0;font-size:20px}main{padding:30px}.painted{display:block;width:220px;height:130px;object-fit:cover;object-position:75% 20%;background:rgb(245,230,215);padding:8px;border:4px solid rgb(40,60,80);border-radius:18px;opacity:.7;filter:saturate(.5)}.framed{display:block;width:300px;padding:12px;border:3px solid rgb(20,30,40);background:rgb(210,230,245)}.transparent{display:block;width:180px;height:120px;object-fit:contain;object-position:right top;background:transparent;opacity:.8}.long-content{height:2400px}@media(max-width:767px){.painted{width:160px;height:90px;object-position:10% 80%;background:rgb(100,125,150);opacity:.5}.framed{width:240px}.transparent{width:100px;height:70px}}",
      js: "",
    },
  ],
};
// Independent static reference for the source builder's background-image gallery.
const gallery =
  '<div class="elementor-widget-gallery" data-widget_type="gallery.default" data-settings=\'{"columns":2,"columns_mobile":1,"gap":{"size":10},"gap_mobile":{"size":5},"aspect_ratio":"3:2","gallery_layout":"grid"}\'><div class="elementor-gallery__container">' +
  [1, 2]
    .map(
      (i) =>
        '<a class="e-gallery-item elementor-gallery-item" href="#gallery"><div class="e-gallery-image elementor-gallery-item__image" data-thumbnail="' +
        sourceURL +
        '" data-width="300" data-height="150" style="background-image:url(' +
        sourceURL +
        ')"></div><div class="elementor-gallery-item__overlay"></div></a>',
    )
    .join("") +
  "</div></div>";
project.pages[0].html = project.pages[0].html.replace(
  '<div class="long-content">',
  gallery + '<div class="long-content">',
);
project.pages[0].css +=
  ".elementor-gallery__container{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.elementor-gallery-item{display:block;position:relative}.e-gallery-image{padding-bottom:66.6666666667%;background-size:cover;background-position:center}.elementor-gallery-item__overlay{position:absolute;inset:0;pointer-events:none;background:rgba(0,0,0,.4);opacity:0}.elementor-gallery-item:hover .elementor-gallery-item__overlay{opacity:1}.elementor-gallery-item:hover .e-gallery-image{filter:brightness(.8)}@media(max-width:767px){.elementor-gallery__container{grid-template-columns:1fr;gap:5px}}";
project.pages[0].html = project.pages[0].html.replace(
  '<div class="long-content">',
  '<section class="e-con e-parent background-fixture" data-settings=\'{"background_background":"classic"}\'></section><div class="long-content">',
);
project.pages[0].css +=
  '.background-fixture{position:relative;width:300px;height:160px;background:rgb(100,160,200) url("' +
  sourceURL +
  '") center/cover no-repeat}.e-con.e-parent:not(.e-lazyloaded){background-image:none!important}.background-fixture::before{content:"";position:absolute;inset:0;background:rgb(0,0,0);opacity:.2}@media(max-width:767px){.background-fixture{background-position:left top}.background-fixture::before{opacity:.5}}';
project.pages[0].html = project.pages[0].html.replace(
  '<div class="long-content">',
  '<a class="inline-logo-link" href="#details"><img class="inline-logo" src="' +
    sourceURL +
    '" alt="Linked logo"></a><div class="long-content" id="details">',
);
project.pages[0].css +=
  ".inline-logo{display:block}@media(max-width:700px){.inline-logo{width:120px}}";
project.pages[0].html = project.pages[0].html.replace(
  '<div class="long-content" id="details">',
  '<section class="layered-fixture"></section><section class="named-grid"><aside id="fixture-rail"><p>Sidebar</p></aside><article id="fixture-article"><p>Article</p></article></section><div class="long-content" id="details">',
);
project.pages[0].html = project.pages[0].html.replace(
  '<div class="long-content" id="details">',
  '<section class="paragraph-fixture"><p>First editable paragraph</p><p>Last editable paragraph</p></section><section class="height-fixture"><div class="height-layer"></div></section><div class="long-content" id="details">',
);
project.pages[0].css +=
  '.layered-fixture{width:300px;height:120px;background-image:url("' +
  sourceURL +
  '"),linear-gradient(45deg,transparent,#fafafa),url("' +
  sourceURL +
  '"),linear-gradient(#123456,#abcdef);background-size:60% auto,auto,120px auto,cover;background-position:right top,center,left bottom,center;background-repeat:no-repeat,no-repeat,repeat-x,no-repeat;background-attachment:scroll,scroll,local,scroll}' +
  '@media(max-width:767px){.layered-fixture{background-image:url("' +
  sourceURL +
  '");background-size:100px auto;background-position:center;background-repeat:repeat-x;background-attachment:local}}' +
  '.named-grid{display:grid;grid-template-areas:"rail article";grid-template-columns:minmax(70px,1fr) minmax(0,2fr);gap:20px}' +
  "#fixture-rail{grid-area:rail}#fixture-article{grid-area:article}" +
  '@media(max-width:767px){.named-grid{grid-template-areas:"article" "rail";grid-template-columns:minmax(0,1fr)}}' +
  ".paragraph-fixture{font-size:16px}.paragraph-fixture p{margin:0;line-height:1.25}.paragraph-fixture p:last-child{font-size:2em;width:75%;min-width:100%}" +
  "@media(max-width:767px){.paragraph-fixture p:last-child{display:none}}" +
  ".height-fixture{--min-height:0px;height:180px}.height-layer{min-height:100%;background:linear-gradient(white,blue)}" +
  "@media(max-width:767px){.height-fixture{height:90px}}";
project.pages[0].html = project.pages[0].html.replace(
  '<div class="long-content" id="details">',
  '<div class="elementor-widget-nav-menu" data-widget_type="nav-menu.default"><nav class="elementor-nav-menu--main" aria-label="Fixture menu"><ul><li class="menu-item-has-children"><a href="#details">Rooms</a><ul class="sub-menu"><li><a href="#details">Family room</a></li></ul></li></ul></nav></div><div class="long-content" id="details">',
);
project.pages[0].html = project.pages[0].html.replace(
  '<div class="long-content" id="details">',
  '<div class="interactive-box" data-lse-interaction><button type="button">Editable controls</button></div><div class="long-content" id="details">',
);
project.pages[0].css = project.pages[0].css.replace(
  "*{box-sizing:border-box}",
  "*:not(.interactive-box){box-sizing:border-box}",
);
project.pages[0].css +=
  ".interactive-box{width:120px;padding:10px;border:2px solid currentColor}";
project.pages[0].html = project.pages[0].html.replace(
  '<div class="long-content" id="details">',
  '<section class="inline-run-fixture">Footer <a href="#details">link</a><br>continued text</section><div class="long-content" id="details">',
);
project.pages[0].css +=
  ".inline-run-fixture{font:14px/16px Arial,sans-serif}.inline-run-fixture p{font:22px/30px Arial,sans-serif}";
const properties = [
  "background-color",
  "object-fit",
  "object-position",
  "opacity",
  "filter",
  "border-radius",
  "border-top",
  "padding",
];
const browser = await chromium.launch({ headless: true });
const errors = [],
  result = { images: [], sticky: [] };
const check = (label, fn) => {
  try {
    fn();
  } catch (e) {
    errors.push(label + ": " + e.message);
  }
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultNavigationTimeout(90000);
  page.on("dialog", (d) => d.accept());
  await page.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor");
  await page.waitForFunction(() => LSEAdmin);
  const usesThemeBuilder = await page.evaluate(() => LSE_CONFIG.pro);
  if (process.env.LSE_DEV_SYNC) {
    await page.evaluate(() => LSEAdmin.request("dev_sync", {}));
    await page.reload();
    await page.waitForFunction(() => LSEAdmin);
  }
  const report = await page.evaluate(() =>
    LSEReports.groups([
      "Could not package https://source.example/missing.css: HTTP 404",
      "A stylesheet could not be packaged: https://source.example/missing.css",
      "The source WordPress/Elementor runtime was omitted; the destination supplies its own runtime.",
      "Connect 1 contact or submission form to a receiving service.",
      "External file needs review: https://source.example/font.eot",
    ]),
  );
  assert.deepEqual(
    report.map((g) => [g.id, g.items.length]),
    [
      ["missing", 1],
      ["review", 1],
      ["features", 1],
      ["notes", 1],
    ],
  );
  assert(
    !(await page.evaluate(() => {
      const host = document.createElement("div");
      host.innerHTML = LSEReports.render([
        'External file needs review: <img src=x onerror="window.reportUnsafe=true">',
      ]);
      return !!host.querySelector("img");
    })),
  );
  result.reportClassification = true;
  const popover = page.locator(".lse-plugin-updates");
  await popover.locator("summary").click();
  assert((await popover.getAttribute("open")) !== null);
  await page.locator(".lse-brand").first().click();
  assert.equal(await popover.getAttribute("open"), null);
  await popover.locator("summary").click();
  await page.keyboard.press("Escape");
  assert.equal(await popover.getAttribute("open"), null);
  result.popupDismissal = true;
  await page.locator("#lse-file").setInputFiles({
    name: "fidelity.website.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(() => LSEAdmin.project && !LSEAdmin.busy);
  await page.evaluate(() => LSEAdmin.run());
  const job = await page.evaluate(() => LSEAdmin.job);
  assert.equal(
    job?.state,
    "ready",
    await page.locator("#lse-status").innerText(),
  );
  assert(!job.scripts, "Fixture must not rely on captured JavaScript");
  console.log(JSON.stringify({ fidelityDraftReady: true }));
  const source = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await source.setContent(
    "<style>" +
      project.pages[0].css.replaceAll(sourceURL, data) +
      "</style>" +
      project.pages[0].html.replaceAll(sourceURL, data),
  );
  // The independent reference represents the source after its lazy loader runs.
  await source
    .locator(".background-fixture")
    .evaluate((n) => n.classList.add("e-lazyloaded"));
  const imageMetrics = async (p) =>
    p
      .locator(
        'img[alt="Decorated photo"],img[alt="Transparent photo"],img[alt="Linked logo"]',
      )
      .evaluateAll(
        (images, properties) =>
          images.map((n) => {
            const s = getComputedStyle(n),
              r = n.getBoundingClientRect();
            return {
              alt: n.alt,
              width: r.width,
              height: r.height,
              style: Object.fromEntries(
                properties.map((k) => [k, s.getPropertyValue(k)]),
              ),
            };
          }),
        properties,
      );
  for (const width of [1440, 1200, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await source.setViewportSize({ width, height: 1000 });
    await page.goto(job.pages[0].preview_url, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        [...document.images].filter(
          (n) => n.alt && n.complete && n.naturalWidth,
        ).length === 3,
    );
    const expected = await imageMetrics(source),
      actual = await imageMetrics(page);
    result.images.push({ width, expected, actual });
    check("images " + width, () => assert.deepEqual(actual, expected));
    assert.equal(
      await page.locator('a:has(img[alt="Linked logo"])').getAttribute("href"),
      "#details",
    );
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    check("linked logo overflow " + width, () =>
      assert.equal(scrollWidth, width),
    );
    const sourceCard = source.locator(".elementor-gallery-item").first();
    const importedCard = page
      .locator(".lse-source-elementor-gallery-item[data-lse-native]")
      .first();
    assert.equal(
      await page
        .locator(".lse-source-elementor-gallery-item__overlay[data-lse-native]")
        .count(),
      2,
      "Gallery overlay elements were discarded",
    );
    await sourceCard.hover();
    await importedCard.hover();
    const expectedOverlay = await sourceCard
      .locator(".elementor-gallery-item__overlay")
      .evaluate((n) => ({
        opacity: getComputedStyle(n).opacity,
        color: getComputedStyle(n).backgroundColor,
        width: n.getBoundingClientRect().width,
        height: n.getBoundingClientRect().height,
      }));
    const actualOverlay = await importedCard
      .locator(".lse-source-elementor-gallery-item__overlay")
      .evaluate((n) => ({
        opacity: getComputedStyle(n).opacity,
        color: getComputedStyle(n).backgroundColor,
        width: n.getBoundingClientRect().width,
        height: n.getBoundingClientRect().height,
      }));
    check("gallery overlay " + width, () => {
      assert.equal(actualOverlay.opacity, expectedOverlay.opacity);
      assert.equal(actualOverlay.color, expectedOverlay.color);
      assert(Math.abs(actualOverlay.width - expectedOverlay.width) < 1);
      assert(Math.abs(actualOverlay.height - expectedOverlay.height) < 1);
    });
    const pixels = comparePixels(
      await sourceCard.screenshot(),
      await importedCard.screenshot(),
    );
    check("gallery pixels " + width, () =>
      assert(
        pixels.meanError < 2,
        "Source/import screenshot difference " + pixels.meanError,
      ),
    );
    (result.galleryPixels ||= []).push({ viewport: width, ...pixels });
    const imagePadding = await importedCard
      .locator("img")
      .evaluate((n) => getComputedStyle(n).padding);
    check("gallery image padding " + width, () =>
      assert.equal(imagePadding, "0px"),
    );
    const hoverFilter = await importedCard
      .locator("img")
      .evaluate((n) => getComputedStyle(n).filter);
    check("gallery image hover " + width, () =>
      assert.equal(hoverFilter, "brightness(0.8)"),
    );
    const backgroundSource = source.locator(".background-fixture"),
      backgroundImport = page.locator(".background-fixture[data-lse-native]");
    for (const locator of [backgroundSource, backgroundImport])
      await locator.evaluate((n) => n.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(100);
    const expectedBackground = await backgroundSource.screenshot(),
      actualBackground = await backgroundImport.screenshot();
    const backgroundPixels = comparePixels(
      expectedBackground,
      actualBackground,
    );
    if (backgroundPixels.meanError >= 2) {
      await writeFile(
        "tests/results/background-source-" + width + ".png",
        expectedBackground,
      );
      await writeFile(
        "tests/results/background-import-" + width + ".png",
        actualBackground,
      );
    }
    check("background pixels " + width, () =>
      assert(
        backgroundPixels.meanError < 2,
        "Background/overlay screenshot difference " +
          backgroundPixels.meanError,
      ),
    );
    (result.backgroundPixels ||= []).push({
      viewport: width,
      ...backgroundPixels,
    });
    const sourceLayers = source.locator(".layered-fixture");
    const importedLayers = page.locator(".layered-fixture[data-lse-native]");
    const backgroundLayers = (locator) =>
      locator.evaluate((node) => {
        const style = getComputedStyle(node);
        return [
          style.backgroundImage.replace(/url\("[^"]*"\)/g, "url(image)"),
          style.backgroundSize,
          style.backgroundPosition,
          style.backgroundRepeat,
          style.backgroundAttachment,
        ];
      });
    const [sourcePaint, importedPaint] = await Promise.all([
      backgroundLayers(sourceLayers),
      backgroundLayers(importedLayers),
    ]);
    check("background layers " + width, () =>
      assert.deepEqual(importedPaint, sourcePaint),
    );
    const layeredPixels = comparePixels(
      await sourceLayers.screenshot(),
      await importedLayers.screenshot(),
    );
    check("layered background pixels " + width, () =>
      assert(layeredPixels.meanError < 2),
    );
    (result.layeredBackgroundPixels ||= []).push({
      viewport: width,
      ...layeredPixels,
    });
    const namedGrid = (p) =>
      p.locator(".named-grid").evaluate((grid) => {
        const root = grid.getBoundingClientRect();
        return {
          areas: getComputedStyle(grid).gridTemplateAreas,
          columns: getComputedStyle(grid).gridTemplateColumns,
          items: [
            ...grid.querySelectorAll("#fixture-rail,#fixture-article"),
          ].map((item) => {
            const bounds = item.getBoundingClientRect();
            return [
              item.id,
              Math.round(bounds.x - root.x),
              Math.round(bounds.y - root.y),
              Math.round(bounds.width),
            ];
          }),
        };
      });
    const [expectedGrid, actualGrid] = await Promise.all([
      namedGrid(source),
      namedGrid(page),
    ]);
    check("named grid " + width, () =>
      assert.deepEqual(actualGrid, expectedGrid),
    );
    const paragraphs = (p) =>
      p.locator(".paragraph-fixture p").evaluateAll((items) =>
        items.map((item) => {
          const bounds = item.getBoundingClientRect();
          return bounds.height
            ? [bounds.height, bounds.width, getComputedStyle(item).fontSize]
            : null;
        }),
      );
    const [sourceParagraphs, draftParagraphs] = await Promise.all([
      paragraphs(source),
      paragraphs(page),
    ]);
    check("editable paragraph styles " + width, () =>
      assert.deepEqual(draftParagraphs, sourceParagraphs),
    );
    const layerHeight = (p) =>
      p
        .locator(".height-layer")
        .evaluate((layer) => layer.getBoundingClientRect().height);
    const [sourceHeight, draftHeight] = await Promise.all([
      layerHeight(source),
      layerHeight(page),
    ]);
    check("percentage minimum height " + width, () =>
      assert.equal(draftHeight, sourceHeight),
    );
    const interactiveBox = (p) =>
      p
        .locator(".interactive-box")
        .last()
        .evaluate((box) => ({
          size: getComputedStyle(box).boxSizing,
          width: box.getBoundingClientRect().width,
        }));
    const [expectedBox, actualBox] = await Promise.all([
      interactiveBox(source),
      interactiveBox(page),
    ]);
    check("interactive source box " + width, () =>
      assert.deepEqual(actualBox, expectedBox),
    );
    const inlineRunHeight = (p) =>
      p
        .locator(".inline-run-fixture")
        .evaluate((run) => run.getBoundingClientRect().height);
    const [expectedRun, actualRun] = await Promise.all([
      inlineRunHeight(source),
      inlineRunHeight(page),
    ]);
    check("inline text inherits its parent typography " + width, () =>
      assert.equal(actualRun, expectedRun),
    );
    if (!usesThemeBuilder && width === 1440) {
      await page.getByRole("link", { name: "Rooms", exact: true }).hover();
      const child = page.getByRole("link", { name: "Family room" });
      await child.waitFor({ state: "visible" });
      await page.locator(".height-layer").hover();
      await child.waitFor({ state: "hidden" });
    }
    if (!usesThemeBuilder && width === 390) {
      const toggle = page.getByRole("button", { name: "Rooms submenu" });
      const child = page.getByRole("link", { name: "Family room" });
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(await child.count(), 0);
      await toggle.focus();
      await toggle.press("Enter");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await child.waitFor({ state: "visible" });
      await toggle.press("Escape");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(await child.count(), 0);
    }
    await page.locator(".replica-sticky[data-lse-native]").hover();
    result.galleryOverlays = true;
    for (const scroll of [0, 400, 1100, 0]) {
      await page.evaluate((y) => scrollTo(0, y), scroll);
      // Older Elementor animates native background colours for 300ms.
      await page.waitForTimeout(450);
      const value = await page
        .locator(".replica-sticky[data-lse-native]")
        .evaluate((n) => {
          const bar = document.getElementById("wpadminbar"),
            r = n.getBoundingClientRect(),
            s = getComputedStyle(n);
          return {
            viewport: innerWidth,
            scroll: scrollY,
            top: r.top,
            width: r.width,
            height: r.height,
            position: s.position,
            background: s.backgroundColor,
            admin: bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0,
            placeholders: document.querySelectorAll(
              "[data-lse-sticky-placeholder]",
            ).length,
          };
        });
      result.sticky.push(value);
      check("sticky " + width + "/" + scroll, () => {
        assert.equal(value.position, "fixed");
        assert(
          Math.abs(value.top - (value.admin + (width === 390 ? 4 : 12))) < 1,
        );
        assert.equal(value.width, width);
        assert.equal(value.height, 80);
        assert.equal(value.placeholders, 1);
        if (scroll >= 400) assert.equal(value.background, "rgb(20, 120, 60)");
      });
    }
    console.log(JSON.stringify({ fidelityViewportChecked: width }));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(job.pages[0].edit_url, { waitUntil: "domcontentloaded" });
  const canvas = page.frameLocator("#elementor-preview-iframe");
  const image = canvas.locator(".painted.elementor-widget-image img");
  await handleEditorPrompts(page, image);
  await image.waitFor({ timeout: 90000 });
  await page
    .locator("#elementor-loading")
    .waitFor({ state: "hidden", timeout: 90000 });
  assert.equal(
    await canvas.locator(".replica-sticky").count(),
    0,
    "The shared header appeared inside the page editor",
  );
  // Select the image through the normal canvas interaction in both editor generations.
  await image.click();
  await page.locator(".elementor-control-image").waitFor();
  await page
    .locator('.elementor-panel-navigation-tab[data-tab="style"]')
    .click();
  const height = page.locator(
    '.elementor-control-height input[data-setting="size"]',
  );
  await height.fill("150px");
  await height.press("Enter");
  await image.evaluate(
    (n) =>
      new Promise((resolve, reject) => {
        const until = performance.now() + 10000;
        const check = () =>
          Math.abs(n.getBoundingClientRect().height - 150) < 1
            ? resolve()
            : performance.now() > until
              ? reject(Error("Native image height did not change"))
              : requestAnimationFrame(check);
        check();
      }),
  );
  result.actualImageEditor = true;
  const header = job.templates["site-header"];
  const headerStatus =
    usesThemeBuilder && !job.site_parts_draft_reason ? "publish" : "draft";
  await page.goto(header.edit_url, { waitUntil: "domcontentloaded" });
  const sticky = canvas.locator(".replica-sticky");
  await sticky.waitFor({ timeout: 90000 });
  await page
    .locator("#elementor-loading")
    .waitFor({ state: "hidden", timeout: 90000 });
  assert.equal(
    await canvas.locator("[data-lse-sticky-placeholder]").count(),
    0,
    "Sticky runtime ran inside the template editor",
  );
  assert.notEqual(
    await sticky.evaluate((n) => getComputedStyle(n).position),
    "fixed",
  );
  await page.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor");
  await page.waitForFunction(() => LSEAdmin);
  for (const [id, control] of [
    [job.pages[0].id, "image"],
    [header.id, "sticky"],
  ]) {
    const edited = await page.evaluate(
      (id) => LSEAdmin.request("fidelity_test", { id }),
      id,
    );
    assert.deepEqual(edited.edited, [control]);
    assert.equal(edited.status, control === "sticky" ? headerStatus : "draft");
  }
  await page.goto(job.pages[0].preview_url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      Math.abs(
        document
          .querySelector('img[alt="Decorated photo"]')
          .getBoundingClientRect().height - 170,
      ) < 1,
  );
  assert.equal(
    await page
      .getByAltText("Decorated photo", { exact: true })
      .evaluate((n) => getComputedStyle(n).backgroundColor),
    "rgb(221, 68, 204)",
  );
  await page.evaluate(() => scrollTo(0, 400));
  await page.waitForTimeout(450);
  const stickyEdit = await page
    .locator(".replica-sticky[data-lse-native]")
    .evaluate((n) => ({
      top: n.getBoundingClientRect().top,
      background: getComputedStyle(n).backgroundColor,
      bar: Math.max(
        0,
        document.getElementById("wpadminbar")?.getBoundingClientRect().bottom ||
          0,
      ),
    }));
  assert.equal(stickyEdit.top, stickyEdit.bar + 26);
  assert.equal(stickyEdit.background, "rgb(187, 119, 51)");
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.waitForTimeout(100);
  assert.notEqual(
    await page
      .locator(".replica-sticky[data-lse-native]")
      .evaluate((n) => getComputedStyle(n).position),
    "fixed",
  );
  assert.equal(await page.locator("[data-lse-sticky-placeholder]").count(), 0);
  result.nativeEditsPersist = true;
  await page.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor");
  await page.waitForFunction(() => LSEAdmin);
  await page.evaluate(async (id) => {
    const status = await LSEAdmin.request("status", { job: id });
    await LSEAdmin.request("remove_import", {
      job: id,
      consent: true,
      expected_stamps: Object.fromEntries(
        status.pages.map((p) => [p.key, p.current_stamp]),
      ),
    });
  }, job.id);
  await writeFile(
    "tests/results/fidelity-regression.json",
    JSON.stringify({ ...result, errors }, null, 2),
  );
  console.log(JSON.stringify({ ...result, errors }));
  assert.equal(errors.length, 0, errors.join("\n"));
} finally {
  await browser.close();
}
