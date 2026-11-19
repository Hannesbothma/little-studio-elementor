import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { handleEditorPrompts } from "./editor-prompts.mjs";
const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9424";
const flatten = (ns) => ns.flatMap((n) => [n, ...flatten(n.elements || [])]);
const widget = (id, type, settings) => ({
  id,
  elType: "widget",
  isInner: false,
  settings,
  widgetType: type,
  elements: [],
});
const native = {
  title: "Native template check",
  type: "page",
  version: "0.4",
  page_settings: {
    background_background: "classic",
    background_color: "#f0f2f4",
    hide_title: "yes",
  },
  content: [
    {
      id: "abcdef1",
      elType: "container",
      isInner: false,
      settings: {
        content_width: "full",
        flex_direction: "column",
        padding: {
          unit: "px",
          top: "20",
          right: "20",
          bottom: "20",
          left: "20",
          isLinked: true,
        },
      },
      elements: [
        widget("abcdef2", "heading", {
          title: "Native template heading",
          header_size: "h1",
          title_color: "#123456",
          typography_typography: "custom",
          typography_font_size: { size: 40, unit: "px" },
          typography_font_size_mobile: { size: 24, unit: "px" },
        }),
        widget("abcdef3", "icon-list", {
          icon_list: [
            {
              _id: "item01",
              text: "Telephone",
              link: { url: "tel:+27123456789" },
              selected_icon: { value: "fas fa-phone", library: "fa-solid" },
            },
          ],
        }),
        widget("abcdef4", "icon-box", {
          title_text: "Native icon box",
          description_text: "Editable native description",
          selected_icon: { value: "fas fa-star", library: "fa-solid" },
        }),
        widget("abcdef5", "image-box", {
          title_text: "Native image box",
          description_text: "Native text",
          image: { id: 8765, url: "" },
        }),
      ],
    },
  ],
};
const browser = await chromium.launch({ headless: true });
const result = {};
try {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  await page.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => window.LSEAdmin && window.LSEManage && !LSEManage.busy,
  );
  const rpc = (a, x) =>
    page.evaluate(([a, x]) => LSEAdmin.request(a, x), [a, x]);
  const load = async (files) => {
    await page.evaluate(() => document.querySelector("#lse-reset").click());
    await page.locator("#lse-file").setInputFiles(files);
    await page.waitForFunction(() => !LSEAdmin.busy);
  };
  await load({
    name: "native.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(native)),
  });
  assert(await page.evaluate(() => !!LSEAdmin.project));
  await page.evaluate(() => LSEAdmin.run());
  const job = await page.evaluate(() => LSEAdmin.job);
  assert.equal(job.state, "ready");
  const saved = await rpc("test", { id: job.pages[0].id });
  const nodes = flatten(saved.elements);
  assert.equal(nodes.length, 5);
  for (const type of ["heading", "icon-list", "icon-box", "image-box"])
    assert(nodes.some((n) => n.widgetType === type));
  assert.equal(
    nodes.find((n) => n.widgetType === "heading").settings
      .typography_font_size_mobile.size,
    24,
  );
  assert.equal(
    nodes.find((n) => n.widgetType === "image-box").settings.image.id,
    0,
  );
  result.nativeTreeSaved = true;
  console.log("Native tree saved");
  await assert.rejects(
    rpc("test", {
      operation: "native-validation",
      settings: { custom_css: "selector{background:url(javascript:bad)}" },
    }),
    /CSS|Executable/i,
  );
  await assert.rejects(
    rpc("test", {
      operation: "native-validation",
      settings: { __globals__: { title_color: "globals/colors?id=primary" } },
    }),
    /Destination mapping/,
  );
  result.nativeValidationRetained = true;
  await page.goto(job.pages[0].preview_url, { waitUntil: "domcontentloaded" });
  assert.equal(await page.locator(".elementor-widget-icon-list").count(), 1);
  assert.equal(await page.locator(".elementor-widget-icon-box").count(), 1);
  assert.equal(await page.locator(".elementor-widget-image-box").count(), 1);
  assert.equal(
    await page.getByRole("link", { name: "Telephone" }).getAttribute("href"),
    "tel:+27123456789",
  );
  const color = await page
    .locator("body")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(color, "rgb(240, 242, 244)");
  for (const [width, size] of [
    [1440, 40],
    [390, 24],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page
        .locator("h1.elementor-heading-title")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      size,
    );
  }
  result.frontendAndResponsiveControls = true;
  console.log("Native frontend and responsive controls passed");
  await page.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => window.LSEAdmin && window.LSEManage && !LSEManage.busy,
  );
  const missing = structuredClone(native);
  missing.content[0].elements[0].widgetType = "lse-missing-pro-widget";
  await load({
    name: "missing.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(missing)),
  });
  assert.equal(await page.evaluate(() => LSEAdmin.project), null);
  assert.match(
    await page.locator("#lse-status").innerText(),
    /lse-missing-pro-widget/,
  );
  result.missingDependencyReported = true;
  if (!(await page.evaluate(() => LSE_CONFIG.pro))) {
    const locked = structuredClone(native);
    locked.content[0].elements[0].widgetType = "slides";
    await load({
      name: "locked-pro.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(locked)),
    });
    assert.equal(await page.evaluate(() => LSEAdmin.project), null);
    assert.match(await page.locator("#lse-status").innerText(), /slides/);
    result.lockedProWidgetRejectedBeforeDrafts = true;
  }

  const legacy = structuredClone(native);
  legacy.title = "Legacy section";
  legacy.content = [
    {
      id: "9999999",
      elType: "section",
      isInner: false,
      settings: [],
      elements: [
        {
          id: "8888888",
          elType: "column",
          isInner: true,
          settings: { _column_size: 100 },
          elements: [
            widget("7777777", "heading", { title: "Legacy editable heading" }),
          ],
        },
      ],
    },
  ];
  await load({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await page.evaluate(() => LSEAdmin.run());
  const legacyJob = await page.evaluate(() => LSEAdmin.job);
  assert.equal(legacyJob.state, "ready");
  const legacyTree = (await rpc("test", { id: legacyJob.pages[0].id }))
    .elements;
  assert.equal(legacyTree[0].elType, "section");
  assert.equal(legacyTree[0].elements[0].isInner, true);
  result.legacySectionAndColumn = true;
  const recoverable = structuredClone(native);
  recoverable.title = "Native custom CSS recovery";
  recoverable.content[0].settings.custom_css =
    "selector{color:red;background:url(javascript:bad);padding:4px}";
  recoverable.page_settings.custom_css =
    "selector{color:blue;background:url(javascript:other);margin:3px}";
  await load({
    name: "native-recovery.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recoverable)),
  });
  const recovering = page.evaluate(() => LSEAdmin.run());
  for (const field of [
    "elements.abcdef1.settings.custom_css",
    "page_settings.custom_css",
  ]) {
    await page.waitForFunction(
      (field) =>
        document
          .querySelector("#lse-error-item-location")
          .textContent.includes(field),
      field,
      { timeout: 120000 },
    );
    assert.equal(await page.locator("#lse-skip-item").isVisible(), true);
    await page.locator("#lse-skip-item").click();
  }
  await recovering;
  const recovered = await page.evaluate(() => LSEAdmin.job);
  assert.equal(recovered.state, "ready");
  assert.equal(recovered.reports.page.skipped.length, 2);
  assert.deepEqual(
    recovered.reports.page.skipped.map((x) => x.field),
    ["elements.abcdef1.settings.custom_css", "page_settings.custom_css"],
  );
  result.nativeCustomCSSGranularRecovery = true;
  if (process.env.LSE_NATIVE_PARTS || process.env.LSE_NATIVE_ARCHIVE) {
    const names = ["footer", "content", "header"];
    const inputs = await Promise.all(
      names.map(async (name) => ({
        name: name + ".json",
        mimeType: "application/json",
        buffer: process.env.LSE_NATIVE_ARCHIVE
          ? execFileSync("unzip", [
              "-p",
              process.env.LSE_NATIVE_ARCHIVE,
              "free/" + name + ".json",
            ])
          : await readFile(process.env.LSE_NATIVE_PARTS + "/" + name + ".json"),
      })),
    );
    const originals = inputs.map((f) => JSON.parse(f.buffer.toString("utf8")));
    await load(inputs);
    assert.equal(await page.evaluate(() => LSEAdmin.project.pages.length), 1);
    await page.evaluate(() => LSEAdmin.run());
    const actual = await page.evaluate(() => LSEAdmin.job);
    assert.equal(actual.state, "ready");
    const persisted = flatten(
      (await rpc("test", { id: actual.pages[0].id })).elements,
    );
    const expected = originals.flatMap((t) => flatten(t.content));
    assert.equal(persisted.length, expected.length);
    assert.deepEqual(
      persisted.map((n) => n.id).sort(),
      expected.map((n) => n.id).sort(),
    );
    for (const node of expected) {
      const out = persisted.find((n) => n.id === node.id);
      assert.equal(out.widgetType, node.widgetType);
      assert.equal(out.elType, node.elType);
      assert.deepEqual(
        out.elements.map((n) => n.id),
        node.elements.map((n) => n.id),
      );
      if (["section", "column"].includes(node.elType))
        assert.equal(!!out.isInner, !!node.isInner);
      for (const key of Object.keys(node.settings).filter((k) =>
        /_(mobile|tablet|laptop)$/.test(k),
      ))
        assert.deepEqual(out.settings[key], node.settings[key]);
    }
    assert(actual.reports.home.warnings.some((w) => w.includes("placeholder")));
    assert(actual.reports.home.warnings.some((w) => w.includes("no address")));
    result.actualParts = {
      elements: persisted.length,
      native: actual.reports.home.native,
      html: actual.reports.home.fallbacks,
    };
    console.log("Supplied 73-element page saved; opening Elementor editor");
    // One actual native editor behavior check on the supplied content.
    const editor = await browser.newPage();
    editor.setDefaultNavigationTimeout(120000);
    await editor.goto(actual.pages[0].edit_url, {
      waitUntil: "domcontentloaded",
    });
    const frame = editor.frameLocator("#elementor-preview-iframe");
    await handleEditorPrompts(
      editor,
      frame.locator(".elementor-widget-heading").first(),
    );
    await editor.waitForFunction(
      () => window.elementor?.loaded && window.elementor?.previewLoadedOnce,
      {},
      { timeout: 120000 },
    );
    await editor
      .locator("#elementor-loading")
      .waitFor({ state: "hidden", timeout: 120000 });
    const structure = editor.getByRole("button", {
      name: "Close structure",
      exact: true,
    });
    if (await structure.isVisible()) await structure.click();
    const heading = frame.locator(
      '.elementor-widget-heading[data-id="7b80e270"]',
    );
    await heading.hover();
    await heading.locator('[aria-label="Edit Heading"]').click();
    const control = editor.locator(".elementor-control-title textarea").first();
    await control.fill("Native reference edit verified");
    await frame
      .getByRole("heading", {
        name: "Native reference edit verified",
        exact: true,
      })
      .waitFor({ state: "visible", timeout: 15000 });
    await control.fill("Welcome to Green Valley Lodge");
    result.actualElementorEditorEdited = true;
    await editor.close();
  }
  console.log(JSON.stringify(result, null, 2));
  await writeFile(
    process.env.LSE_NATIVE_RESULT || "tests/results/native-elementor.json",
    JSON.stringify(result, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
