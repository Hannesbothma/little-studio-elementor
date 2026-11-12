import { handleEditorPrompts } from "./editor-prompts.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const head = Buffer.from(type),
    body = Buffer.concat([head, data]),
    out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length);
  body.copy(out, 4);
  let crc = 0xffffffff;
  for (const b of body) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}
function png(index) {
  const width = 256,
    height = 128,
    raw = Buffer.alloc(height * (1 + width * 3));
  let seed = index + 1;
  for (let y = 0; y < height; y++)
    for (let x = 1; x <= width * 3; x++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      raw[y * (1 + width * 3) + x] = seed & 255;
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const assets = Array.from({ length: 148 }, (_, i) => {
  const body = png(i);
  return {
    url:
      "https://little-studio-assets.invalid/capture/" +
      createHash("sha256").update(body).digest("hex") +
      ".png",
    name: "resource-" + String(i).padStart(3, "0") + ".png",
    type: "image/png",
    data: "data:image/png;base64," + body.toString("base64"),
  };
});
const origin = process.env.LSE_TEST_URL,
  browser = await chromium.launch({ headless: true });
const measurements = [];
try {
  for (const version of process.env.LSE_RESOURCE_BASELINE
    ? ["before", "after"]
    : ["after"]) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    if (version === "before")
      await page.route("**/assets/admin.js*", async (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: await readFile(process.env.LSE_RESOURCE_BASELINE, "utf8"),
        }),
      );
    await page.addInitScript(() => {
      window.resourceRequests = {};
      const original = fetch;
      window.fetch = function (url, options) {
        const action =
          options?.body instanceof FormData ? options.body.get("action") : null;
        if (action?.startsWith("lse_")) {
          const key = action.slice(4);
          resourceRequests[key] = (resourceRequests[key] || 0) + 1;
        }
        return original.call(this, url, options);
      };
    });
    await page.goto(
      origin + "/wp-admin/admin.php?page=little-studio-elementor",
    );
    await page.waitForFunction(() => window.LSEAdmin && window.LSEManage);
    const project = {
      format: "little-studio-website",
      version: 1,
      site_id: "resources-" + version,
      title: "148 resource regression " + version,
      site_css: "",
      assets,
      fonts: [],
      pages: [
        {
          key: "home",
          title: "148 resource import",
          slug: "resources-" + version,
          url: "https://source.example/" + version + "/",
          parent_key: "",
          html:
            '<main><h1>148 resource import</h1><div class="resources">' +
            assets
              .map(
                (a, i) => '<img src="' + a.url + '" alt="Resource ' + i + '">',
              )
              .join("") +
            '</div><div data-lse-interaction><button id="resource-toggle">Toggle</button></div></main>',
          css: "main{padding:40px}h1{margin:0}.resources{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px}.resources img{width:100%;height:auto}#resource-toggle{color:rgb(1,2,3)}#resource-toggle:hover,#resource-toggle:focus{color:rgb(4,5,6)}@media(max-width:767px){.resources{grid-template-columns:repeat(2,minmax(0,1fr))}}",
          js:
            'window.resourceExample="' +
            assets[0].url.replaceAll("/", "\\/") +
            '";document.getElementById("resource-toggle").addEventListener("click",function(){this.textContent="Done";});',
        },
      ],
      site: { home_key: "home", navigation: [] },
    };
    const json = JSON.stringify(project);
    await page.locator("#lse-file").setInputFiles({
      name: "148-resources.website.json",
      mimeType: "application/json",
      buffer: Buffer.from(json),
    });
    await page.waitForFunction(() => LSEAdmin.project && !LSEAdmin.busy);
    const result = await page.evaluate(async () => {
      resourceRequests = {};
      const started = performance.now();
      await LSEAdmin.run();
      return {
        ms: Math.round(performance.now() - started),
        state: LSEAdmin.job?.state,
        job: LSEAdmin.job,
        requests: resourceRequests,
        batchSize: LSE_CONFIG.mediaBatchSize,
      };
    });
    assert.equal(
      result.state,
      "ready",
      await page.locator("#lse-status").innerText(),
    );
    assert.equal(result.job.assets.length, 148);
    assert(
      result.job.assets.every((a) => !a.reused),
      "Benchmark files were reused rather than imported fresh",
    );
    assert(result.job.reports.home.native >= 148);
    if (version === "after") {
      assert(
        result.requests.assets < 37,
        "The media queue still sends four files per request",
      );
    }
    await page.goto(result.job.pages[0].preview_url, {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate(() => {
      for (const img of document.querySelectorAll(".resources img"))
        img.loading = "eager";
    });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".resources img")].filter(
          (img) => img.complete && img.naturalWidth === 256,
        ).length === 148,
      {},
      { timeout: 90000 },
    );
    await page.waitForFunction(
      () => typeof window.resourceExample === "string",
    );
    assert.equal(
      await page.evaluate(() => window.resourceExample),
      result.job.assets[0].url,
      "JavaScript URL references were corrupted",
    );
    await page.getByRole("button", { name: "Toggle", exact: true }).hover();
    assert.equal(
      await page
        .getByRole("button", { name: "Toggle", exact: true })
        .evaluate((n) => getComputedStyle(n).color),
      "rgb(4, 5, 6)",
    );
    await page.getByRole("button", { name: "Toggle", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).waitFor();
    if (version === "after") {
      await page.goto(result.job.pages[0].edit_url, {
        waitUntil: "domcontentloaded",
      });
      const canvas = page.frameLocator("#elementor-preview-iframe");
      await handleEditorPrompts(
        page,
        canvas.locator(".elementor-widget-heading").first(),
      );
      await canvas
        .getByRole("heading", { name: "148 resource import", exact: true })
        .waitFor({ timeout: 90000 });
      await page
        .locator("#elementor-loading")
        .waitFor({ state: "hidden", timeout: 90000 });
      const close = page.getByRole("button", {
        name: "Close structure",
        exact: true,
      });
      if (await close.isVisible()) await close.click();
      const heading = canvas.locator(".elementor-widget-heading").first();
      await heading.hover();
      await heading.locator('[aria-label="Edit Heading"]').click();
      await page
        .locator(".elementor-control-title textarea")
        .first()
        .fill("Edited 148 resource website");
      await canvas
        .getByRole("heading", {
          name: "Edited 148 resource website",
          exact: true,
        })
        .waitFor({ timeout: 15000 });
    }
    const measurement = {
      version,
      ms: result.ms,
      jsonBytes: Buffer.byteLength(json),
      freshFiles: 148,
      requests: result.requests,
      hostBatchSize: result.batchSize,
      imagesLoaded: 148,
      interactions: true,
      editableNativeHeading: version === "after",
    };
    measurements.push(measurement);
    console.log(
      JSON.stringify({ resourceImportRegression: true, ...measurement }),
    );
    if (version === "after") {
      await page.goto(
        origin + "/wp-admin/admin.php?page=little-studio-elementor",
      );
      await page.waitForFunction(
        () => window.LSEAdmin && window.LSEManage && !LSEManage.busy,
      );
      await page.locator("#lse-new-import").click();
      const reuse = structuredClone(project);
      reuse.site_id += "-reuse";
      reuse.title = "148 resource reuse check";
      reuse.pages[0].slug += "-reuse";
      await page.locator("#lse-file").setInputFiles({
        name: "148-reused.website.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(reuse)),
      });
      await page.waitForFunction(() => LSEAdmin.project && !LSEAdmin.busy);
      const reused = await page.evaluate(async () => {
        resourceRequests = {};
        const started = performance.now();
        await LSEAdmin.run();
        return {
          ms: Math.round(performance.now() - started),
          job: LSEAdmin.job,
          requests: resourceRequests,
        };
      });
      assert.equal(reused.job.state, "ready");
      assert.equal(reused.job.assets.length, 148);
      assert(reused.job.assets.every((a) => a.reused));
      assert.equal(
        (reused.requests.assets || 0) + (reused.requests.asset || 0),
        0,
        "Unchanged files were transmitted again",
      );
      const reuseMeasurement = {
        version: "reused",
        ms: reused.ms,
        files: 148,
        requests: reused.requests,
        imageUploadBytes: 0,
      };
      measurements.push(reuseMeasurement);
      console.log(
        JSON.stringify({ resourceReuseRegression: true, ...reuseMeasurement }),
      );
      await page.evaluate(async (id) => {
        const job = await LSEAdmin.request("status", { job: id });
        await LSEAdmin.request("remove_import", {
          job: id,
          consent: true,
          expected_stamps: Object.fromEntries(
            job.pages.map((p) => [p.key, p.current_stamp]),
          ),
        });
      }, reused.job.id);
    }
    await page.goto(
      origin + "/wp-admin/admin.php?page=little-studio-elementor",
    );
    await page.waitForFunction(() => window.LSEAdmin);
    await page.evaluate(async (id) => {
      const job = await LSEAdmin.request("status", { job: id });
      await LSEAdmin.request("remove_import", {
        job: id,
        consent: true,
        expected_stamps: Object.fromEntries(
          job.pages.map((p) => [p.key, p.current_stamp]),
        ),
      });
      await LSEAdmin.request("test", {
        operation: "purge-resource-fixture",
        job: id,
      });
    }, result.job.id);
    await context.close();
  }
  await writeFile(
    "tests/results/resources.json",
    JSON.stringify(
      {
        fixture:
          "148 fresh 256×128 PNGs in an approximately 20 MB native website JSON; same backend, frontend batching comparison",
        measurements,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
