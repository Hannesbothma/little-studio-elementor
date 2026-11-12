import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { handleEditorPrompts } from "./editor-prompts.mjs";
const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9420";
const map =
  "https://maps.google.com/maps?q=11%20Akademie%20Street%2C%20Franschhoek&t=m&z=16&output=embed&iwloc=near";
const project = {
  format: "little-studio-website",
  version: 1,
  site_id: "map-" + randomUUID(),
  title: "Map and layout regression",
  site_css: "",
  assets: [],
  fonts: [],
  site: { home_key: "one", navigation: [] },
  pages: ["one", "two"].map((key) => ({
    key,
    title: "Map regression " + key,
    slug: "map-regression-" + key,
    url: "https://source.example/" + key + "/",
    parent_key: "",
    html:
      '<body><header><h2>Shared map header</h2></header><main><div class="contact-grid"><div class="map-area"><iframe src="' +
      map +
      '" title="Map"></iframe></div><div class="details"><p>Contact details</p></div></div><div class="icon-grid"><div class="intrinsic"><span>Facebook</span><span>Instagram</span></div></div></main></body>',
    css: "body{margin:0;font-family:Arial}header{background:#e7edf2;padding:10px}.contact-grid{display:grid;grid-template-columns:3fr 1fr}.map-area iframe{display:block;border:0;width:100%;height:300px}.details{display:flex;align-items:center}.icon-grid{display:grid;grid-template-columns:1fr 1fr;justify-items:center}.intrinsic{display:block;grid-column:2;width:auto;align-self:center}.intrinsic span{display:inline-block;width:60px}main{padding:10px}@media(max-width:767px){.map-area iframe{height:220px}.contact-grid{grid-template-columns:1fr}.icon-grid{grid-template-columns:1fr}.intrinsic{grid-column:1}}",
    js: "",
  })),
};
for (const page of project.pages) {
  page.html = page.html.replace(
    "</main>",
    '<div class="navigation-cell"><div class="elementor-widget-nav-menu" data-settings=\'{"full_width":"stretch"}\'><nav class="elementor-nav-menu--main"><a>Home</a><a>Rooms</a><a>Contact</a></nav><div class="elementor-menu-toggle">Menu</div><nav class="elementor-nav-menu--dropdown"><a>Home</a><a>Rooms</a></nav></div></div></main>',
  );
  page.css +=
    ".navigation-cell{display:flex;flex-direction:column;align-items:center}.elementor-widget-nav-menu{position:relative;width:auto}.elementor-nav-menu--main{display:flex}.elementor-nav-menu--main a{padding:12px}.elementor-menu-toggle{display:none}.elementor-nav-menu--dropdown{display:none;position:absolute;top:100%;background:white}@media(max-width:767px){.elementor-nav-menu--main{display:none}.elementor-menu-toggle{display:block;width:40px;height:40px}}";
}
const browser = await chromium.launch({ headless: true });
const result = {};
try {
  const page = await browser.newPage({
    viewport: { width: 1918, height: 1000 },
  });
  page.setDefaultNavigationTimeout(120000);
  await page.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => LSEAdmin);
  if (process.env.LSE_DEV_SYNC) {
    await page.evaluate(() => LSEAdmin.request("dev_sync", {}));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => LSEAdmin);
  }
  const rpc = (action, input) =>
    page.evaluate(([a, x]) => LSEAdmin.request(a, x), [action, input]);
  await page.locator("#lse-file").setInputFiles({
    name: "maps.website.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(() => LSEAdmin.project && !LSEAdmin.busy);
  await page.evaluate(() => LSEAdmin.run());
  const job = await page.evaluate(() => LSEAdmin.job);
  assert.equal(job.state, "ready");
  const tree = (await rpc("test", { id: job.pages[0].id })).elements;
  const flatten = (ns) => ns.flatMap((n) => [n, ...flatten(n.elements || [])]);
  const nativeMap = flatten(tree).filter((n) => n.widgetType === "google_maps");
  assert.equal(nativeMap.length, 1);
  assert.equal(
    nativeMap[0].settings.address,
    "11 Akademie Street, Franschhoek",
  );
  assert.equal(nativeMap[0].settings.zoom.size, 16);
  result.nativeMap = true;
  const invalid = structuredClone(project);
  invalid.pages[0].html =
    '<main><iframe src="https://maps.google.com.evil.example/maps?q=Bad&output=embed"></iframe><iframe src="javascript:alert(1)"></iframe><iframe src="https://maps.google.com/maps?q=Safe&output=embed" srcdoc="<script>alert(1)</script>"></iframe></main>';
  const checked = await page.evaluate(async (p) => {
    const normalized = LSEConverter.validate(p);
    return LSEConverter.convert(normalized, normalized.pages[0], {
      preserveCSS: true,
    });
  }, invalid);
  const safe = flatten(checked.elements).filter(
    (n) => n.widgetType === "google_maps",
  );
  assert.equal(safe.length, 1);
  assert.equal(safe[0].settings.address, "Safe");
  assert(!JSON.stringify(checked.elements).includes("srcdoc"));
  assert(checked.warnings.some((w) => w.includes("remote frame")));
  result.rejectedUnsafeFrames = true;
  const ref = await browser.newPage({
    viewport: { width: 1918, height: 1000 },
  });
  await ref.setContent(
    "<style>" +
      project.pages[0].css +
      "</style>" +
      project.pages[0].html.replaceAll(/src="[^"]*"/g, ""),
  );
  result.viewports = [];
  for (const width of [1918, 1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await ref.setViewportSize({ width, height: 1000 });
    await page.goto(job.pages[0].preview_url, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator("#lse-page-css,#lse-page-inline-css")
      .waitFor({ state: "attached" });
    await page.waitForTimeout(100);
    const iframe = page.locator(".elementor-widget-google_maps iframe");
    await iframe.waitFor();
    assert.equal(
      new URL(await iframe.getAttribute("src")).searchParams.get("q"),
      "11 Akademie Street, Franschhoek",
    );
    const source = await ref.locator(".map-area iframe").boundingBox(),
      actual = await iframe.boundingBox();
    assert(Math.abs(actual.width - source.width) < 1);
    assert.equal(actual.height, source.height);
    const expectedIcons = await ref.locator(".intrinsic").boundingBox(),
      actualIcons = await page
        .locator(".intrinsic[data-lse-native]")
        .boundingBox();
    assert(
      Math.abs(actualIcons.width - expectedIcons.width) < 1,
      "Grid item stretched instead of keeping its intrinsic width",
    );
    assert(
      Math.abs(actualIcons.x - expectedIcons.x) < 1,
      "Grid item horizontal alignment changed",
    );
    assert.equal(
      await page.locator("[data-lse-shared-style]").count(),
      0,
      "Shared styles duplicated page CSS",
    );
    const expectedMenu = await ref
      .locator(".elementor-widget-nav-menu")
      .boundingBox();
    const actualMenu = await page
      .locator(".lse-source-elementor-widget-nav-menu")
      .boundingBox();
    assert(
      Math.abs(actualMenu.width - expectedMenu.width) < 1,
      "Navigation was stretched",
    );
    assert(
      Math.abs(actualMenu.x - expectedMenu.x) < 1,
      "Navigation horizontal alignment changed",
    );
    if (width === 390) {
      const toggle = page.locator("[data-lse-menu-toggle]");
      await toggle.click();
      const panel = page.locator("[data-lse-menu-panel]");
      const expanded = await panel.boundingBox();
      assert.equal(expanded.x, 0);
      assert.equal(expanded.width, width);
      await toggle.click();
      assert.equal(await panel.evaluate((n) => n.style.width), "");
      result.stretchedMobileMenu = true;
    }
    result.viewports.push({
      width,
      mapHeight: actual.height,
      mapWidth: actual.width,
      styleDelivery: await page
        .locator("#lse-page-css,#lse-page-inline-css")
        .evaluate((n) => n.tagName),
      iconWidth: actualIcons.width,
    });
  }
  console.log(JSON.stringify({ mapAndGridViewports: result.viewports }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(job.pages[0].edit_url, { waitUntil: "domcontentloaded" });
  const canvas = page.frameLocator("#elementor-preview-iframe"),
    widget = canvas.locator(".elementor-widget-google_maps");
  await handleEditorPrompts(page, widget);
  await widget.waitFor({ timeout: 120000 });
  await page
    .locator("#elementor-loading")
    .waitFor({ state: "hidden", timeout: 120000 });
  const structure = page.getByRole("button", {
    name: "Close structure",
    exact: true,
  });
  if (await structure.isVisible()) await structure.click();
  await widget.hover();
  await widget.locator('[aria-label="Edit Google Maps"]').click();
  await page
    .locator(".elementor-control-address input")
    .fill("Franschhoek, South Africa");
  await page.locator(".elementor-control-address input").press("Tab");
  await page.waitForFunction(
    () => {
      const n = document
        .querySelector("#elementor-preview-iframe")
        ?.contentDocument?.querySelector(
          ".elementor-widget-google_maps iframe",
        );
      return (
        n &&
        new URL(n.src).searchParams.get("q") === "Franschhoek, South Africa"
      );
    },
    {},
    { timeout: 60000 },
  );
  result.nativeMapEditor = true;
  await page.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor", {
    waitUntil: "domcontentloaded",
  });
  const status = await rpc("status", { job: job.id });
  await rpc("remove_import", {
    job: job.id,
    consent: true,
    expected_stamps: Object.fromEntries(
      status.pages.map((p) => [p.key, p.current_stamp]),
    ),
  });
  await writeFile(
    "tests/results/maps-regression.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
