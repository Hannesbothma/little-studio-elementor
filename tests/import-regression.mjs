import { chromium } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9420",
  b = await chromium.launch({ headless: true });
const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=";
const html =
  '<main><h1>Layout import check</h1><div class="inline-outer"><div class="inline-wrap"><div class="gallery">' +
  Array.from({ length: 5 }, () => '<div class="cell"></div>').join("") +
  '</div></div></div><div class="boxed"><p>Boxed content stays boxed</p></div><div class="skip-test">Safe styling survives</div></main>';
const css =
  'body{margin:0}main{width:100%}.inline-outer{display:inline;max-width:64rem;width:100%}.inline-wrap{display:inline;width:100%;max-width:720px}.gallery{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}.cell{height:120px;background:#64777e}.boxed{max-width:64rem;width:calc(100% - 40px);margin:20px auto;padding:10px;background:#ddd}.skip-test{color:rgb(12,34,56)}a[href^="javascript:"]::after{content:""}@media(max-width:767px){.gallery{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.boxed{width:calc(100% - 24px);padding:6px}}';
const fixture = () => ({
  format: "little-studio-website",
  version: 1,
  site_id: "precise-" + randomUUID(),
  title: "Precise import regression",
  site_css: "",
  pages: ["one", "two"].map((key) => ({
    key,
    title: "Layout " + key,
    slug: "layout-" + key,
    url: "https://source.example/" + key + "/",
    html,
    css,
    js: "",
  })),
  assets: [
    {
      url: "https://source.example/pixel.png",
      name: "valid-pixel.png",
      type: "image/png",
      data: "data:image/png;base64," + pixel,
    },
  ],
  fonts: [],
  site: { home_key: "one", navigation: [] },
});
try {
  const p = await b.newPage({ viewport: { width: 1918, height: 1000 } });
  p.setDefaultNavigationTimeout(120000);
  const browserErrors = [];
  p.on("pageerror", (e) => browserErrors.push(e.message));
  await p.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor", {
    waitUntil: "domcontentloaded",
  });
  await p.waitForFunction(
    () => window.LSEAdmin && window.LSEManage && !LSEManage.busy,
  );
  if (process.env.LSE_DEV_SYNC) {
    await p.evaluate(() => LSEAdmin.request("dev_sync", {}));
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForFunction(
      () => window.LSEAdmin && window.LSEManage && !LSEManage.busy,
    );
  }
  const rpc = (a, x) => p.evaluate(([a, x]) => LSEAdmin.request(a, x), [a, x]);
  const load = async (project) => {
    await p.evaluate(() => document.querySelector("#lse-reset").click());
    await p.locator("#lse-file").setInputFiles({
      name: "precise.website.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await p.waitForFunction(() => LSEAdmin.project && !LSEAdmin.busy);
  };
  const first = fixture();
  await load(first);
  await p.evaluate(() => {
    const convert = LSEConverter.convert;
    let injected = false;
    LSEConverter.convert = async (...args) => {
      const out = await convert(...args);
      if (!injected) {
        injected = true;
        out.css +=
          "\n.skip-test{background:url(javascript:unsafe);border:3px solid red}";
      }
      return out;
    };
  });
  const running = p
    .evaluate(() => LSEAdmin.run())
    .catch((e) => ({ error: e.message }));
  await p
    .locator("#lse-error-item")
    .waitFor({ state: "visible", timeout: 120000 });
  assert.match(
    await p.locator("#lse-error-item-location").innerText(),
    /Executable URL.*css.*Line/,
  );
  assert.match(
    await p.locator("#lse-error-item-snippet").innerText(),
    /javascript:unsafe/,
  );
  assert.equal(await p.locator("#lse-skip-item").isVisible(), true);
  const download = p.waitForEvent("download");
  await p.locator("#lse-error-details").click();
  const file = await download;
  const path = await file.path();
  const { readFile } = await import("node:fs/promises");
  const report = JSON.parse(await readFile(path));
  assert.equal(report.error.code, "css_unsafe");
  assert.equal(report.item.key, "one");
  assert.equal(report.item.title, "Layout one");
  assert(
    report.error.line > 0 && report.error.column > 0 && report.durationMs >= 0,
  );
  await p.locator("#lse-skip-item").click();
  await running;
  const job = await p.evaluate(() => LSEAdmin.job);
  assert.equal(job.state, "ready");
  const saved = await rpc("test", { id: job.pages[0].id });
  assert(!saved.css.includes("javascript:unsafe"));
  assert(saved.css.includes("border:3px solid red"));
  assert.equal(job.reports.one.skipped.length, 1);
  const ref = await b.newPage();
  await ref.setContent("<!doctype html><style>" + css + "</style>" + html);
  for (const width of [1918, 1440, 390]) {
    await p.setViewportSize({ width, height: 1000 });
    await ref.setViewportSize({ width, height: 1000 });
    await p.goto(job.pages[0].preview_url, { waitUntil: "domcontentloaded" });
    for (const selector of [".gallery", ".boxed"]) {
      const actual = await p
          .locator(selector + "[data-lse-native]")
          .boundingBox(),
        expected = await ref.locator(selector).boundingBox();
      const bar = await p.locator("#wpadminbar").boundingBox();
      assert(
        Math.abs(actual.y - (bar?.height || 0) - expected.y) < 1,
        selector +
          " vertical spacing changed at" +
          width +
          ": " +
          JSON.stringify({ actual, expected, bar }),
      );
      assert(
        Math.abs(actual.height - expected.height) < 1,
        selector + " height changed at" + width,
      );
      assert(
        Math.abs(actual.width - expected.width) < 1,
        selector +
          " width changed at" +
          width +
          ": " +
          JSON.stringify({ actual, expected }),
      );
      assert(
        Math.abs(actual.x - expected.x) < 1,
        selector + " position changed at" + width,
      );
    }
  }
  await p.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor", {
    waitUntil: "domcontentloaded",
  });
  await p.waitForFunction(() => window.LSEManage && !LSEManage.busy);
  let uploads = 0;
  await p.route("**/wp-admin/admin-ajax.php", async (route) => {
    const body = route.request().postData() || "";
    if (/name="action"\r\n\r\nlse_assets?\r\n/.test(body)) uploads++;
    await route.continue();
  });
  const reused = fixture();
  await load(reused);
  await p.evaluate(() => LSEAdmin.run()).catch((e) => ({ error: e.message }));
  const second = await p.evaluate(() => LSEAdmin.job);
  assert.equal(second.state, "ready");
  assert.equal(uploads, 0, "Existing file bytes were uploaded again");
  assert.equal(second.assets[0].id, job.assets[0].id);
  // A bad optional file is isolated without dropping the good file or whole page.
  const invalid = fixture();
  invalid.assets.push({
    url: "https://source.example/bad.png",
    name: "broken-photo.png",
    type: "image/png",
    data:
      "data:image/png;base64," + Buffer.from("not an image").toString("base64"),
  });
  await load(invalid);
  const pending = p
    .evaluate(() => LSEAdmin.run())
    .catch((e) => ({ error: e.message }));
  await p
    .locator("#lse-error-item")
    .waitFor({ state: "visible", timeout: 120000 });
  assert.equal(
    await p.locator("#lse-error-item-title").innerText(),
    "broken-photo.png",
  );
  await p.locator("#lse-skip-item").click();
  await pending;
  const third = await p.evaluate(() => LSEAdmin.job);
  assert.equal(third.state, "ready");
  assert(
    third.reports.one.warnings.some((x) =>
      x.includes("Skipped file broken-photo.png"),
    ),
  );
  assert.equal(third.assets.length, 1);
  assert.deepEqual(browserErrors, []);
  const result = {
    preciseCSSDiagnostics: true,
    greenValleySelectorAccepted: true,
    skipOneDeclaration: true,
    skipOneFile: true,
    layouts: [1918, 1440, 390],
    preflightReusedWithoutUpload: true,
  };
  await writeFile(
    "tests/results/import-regression.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await b.close();
}
