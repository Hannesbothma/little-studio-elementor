import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9416";
const source = "https://93.184.216.34/lse-capture/";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const tab = await context.newPage();
  await tab.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor", {
    waitUntil: "domcontentloaded",
  });
  await tab.waitForFunction(() => window.LSECapture && !LSEManage.busy);
  const finalReport = tab.locator("#lse-final-report");
  assert(await finalReport.isHidden());
  const rpc = (action, input) =>
    tab.evaluate(([a, x]) => LSEAdmin.request(a, x), [action, input]);
  const scan = async (url) => {
    await tab.locator("[data-export-open]").first().click();
    await tab.locator("#lse-capture-url").fill(url);
    await tab
      .getByRole("button", { name: "Scan website", exact: true })
      .click();
  };
  await scan(source + "maintenance/");
  await tab
    .locator("#lse-capture-status")
    .getByText(/source website is under maintenance/)
    .waitFor();
  assert(await tab.locator("#lse-flow-dialog").isHidden());
  await tab.locator("#lse-capture-copy").click();
  assert.match(
    await tab.evaluate(() => navigator.clipboard.readText()),
    /under maintenance/,
  );
  await tab.getByRole("button", { name: "Close", exact: true }).click();

  let release;
  await tab.route("**/admin-ajax.php", async (route) => {
    const body = route.request().postData() || "";
    if (
      release &&
      /name="action"\r?\n\r?\nlse_(capture_batch|prepare)\r?\n/.test(body)
    )
      await release;
    await route.continue();
  });
  let proceed;
  release = new Promise((resolve) => {
    proceed = resolve;
  });
  await scan(source + "background/");
  await tab.locator("#lse-capture-dialog [data-lse-background]").click();
  assert(await tab.locator("#lse-capture-dialog").isHidden());
  const workTab = context.waitForEvent("page");
  await tab.getByRole("link", { name: "Keep working in WordPress" }).click();
  const dashboard = await workTab;
  await dashboard.waitForURL(origin + "/wp-admin/index.php");
  proceed();
  await tab.locator("#lse-background-view").getByText("Review pages").waitFor();
  assert(await tab.locator("#lse-flow-dialog").isHidden());
  await tab.locator("#lse-background-view").click();
  assert(await finalReport.isHidden());
  release = new Promise((resolve) => {
    proceed = resolve;
  });
  await tab.locator("#lse-import").click();
  await tab.locator("#lse-progress [data-lse-background]").click();
  assert(await tab.locator("#lse-flow-dialog").isHidden());
  assert(await finalReport.isHidden());
  await dashboard.bringToFront();
  proceed();
  await tab.waitForFunction(
    () => LSEAdmin.job?.state === "ready" && !LSEAdmin.busy,
    null,
    { timeout: 90000 },
  );
  assert.equal(await tab.evaluate(() => LSEAdmin.job.pages[0].done), true);
  assert(await tab.locator("#lse-background-task").isHidden());
  await finalReport.waitFor();
  await finalReport.getByRole("button", { name: "Copy report" }).click();
  const report = await tab.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /Report format 2/);
  assert.match(report, /Source styling kept/);
  assert.match(
    report,
    /missing-report-font\.woff2 · asset · HTTP 404 · discovered from https:\/\/93\.184\.216\.34\/lse-capture\/background\/ · 1 attempt/,
  );
  assert.match(
    report,
    /1\/1 pages checked for source overflow and floated rows/,
  );
  assert.doesNotMatch(report, /Floated row conversion: div\.report-row/);
  assert.match(report, /Source horizontal overflow: 390px/);
  assert.match(
    report,
    /source https:\/\/93\.184\.216\.34\/lse-capture\/background\/ · WordPress page \d+/,
  );
  const pendingDownload = tab.waitForEvent("download");
  await finalReport.getByRole("button", { name: "Download report" }).click();
  const reportFile = await pendingDownload;
  assert.equal(
    reportFile.suggestedFilename(),
    "little-studio-elementor-report.txt",
  );
  const downloaded = await readFile(await reportFile.path(), "utf8");
  assert.equal(
    downloaded.replace(/^Generated .*$/m, ""),
    report.replace(/^Generated .*$/m, ""),
  );
  const preview = await context.newPage();
  const previewUrl = await tab.evaluate(
    () => LSEAdmin.job.pages[0].preview_url,
  );
  await preview.goto(previewUrl);
  for (const width of [1440, 992, 991, 390]) {
    await preview.setViewportSize({ width, height: 720 });
    const boxes = await preview.locator(".report-row").evaluate((row) => {
      const { x, width } = row.getBoundingClientRect();
      const box = (selector) => {
        const bounds = row.querySelector(selector).getBoundingClientRect();
        return { x: bounds.x, top: bounds.top, width: bounds.width };
      };
      return {
        x,
        width,
        main: box(".report-main"),
        sidebar: box(".report-sidebar"),
      };
    });
    if (width >= 992) {
      assert(
        Math.abs(boxes.main.top - boxes.sidebar.top) < 2,
        JSON.stringify(boxes),
      );
      assert(
        Math.abs(boxes.main.width - 0.66 * boxes.width) < 2,
        JSON.stringify(boxes),
      );
      assert(
        Math.abs(boxes.sidebar.x - boxes.main.x - boxes.main.width) < 2,
        JSON.stringify(boxes),
      );
    } else {
      assert(boxes.sidebar.top > boxes.main.top, JSON.stringify(boxes));
      assert(
        Math.abs(boxes.main.x - boxes.sidebar.x) < 2,
        JSON.stringify(boxes),
      );
    }
  }
  await preview.close();

  const start = (title) =>
    rpc("start", {
      fingerprint: randomUUID().replaceAll("-", "").repeat(2),
      site_id: randomUUID(),
      title,
      pages: [
        { key: "home", title, slug: title.toLowerCase().replaceAll(" ", "-") },
      ],
      site: { home_key: "home", navigation: [] },
      layout: "elementor_canvas",
    });
  const a = await start("Clean up first import");
  const b = await start("Clean up second import");
  const put = (job, name, id) =>
    rpc("test", {
      operation: "seed-cleanup-attachment",
      job: job.id,
      name,
      id,
    });
  const shared = await put(a, "shared.svg");
  const reused = await put(b, "reused.svg", shared.id);
  assert.equal(shared.id, reused.id);
  const exclusive = await put(a, "exclusive.svg");
  const font = await put(a, "exclusive.woff2");
  assert(font.font);
  const gallery = await put(a, "external-gallery.svg");
  await rpc("test", { operation: "external-gallery", id: gallery.id });
  const remove = async (job, permanent = false) => {
    const fresh = await rpc("status", { job: job.id });
    return rpc("remove_import", {
      job: job.id,
      consent: true,
      permanent,
      expected_stamps: Object.fromEntries(
        fresh.pages.map((page) => [page.key, page.current_stamp]),
      ),
    });
  };
  const fileExists = (asset) =>
    rpc("test", { operation: "attachment-exists", id: asset.id });
  const gone = await remove(a);
  assert.equal(gone.state, "removed");
  assert.equal(gone.pages[0].post_status, "trash");
  assert.deepEqual(
    new Set(gone.cleanup.assets_removed),
    new Set([exclusive.id, font.id]),
  );
  assert.deepEqual(
    new Set(gone.cleanup.assets_kept),
    new Set([shared.id, gallery.id]),
  );
  assert(!(await fileExists(exclusive)));
  assert(!(await fileExists(font)));
  assert(await fileExists(shared));
  assert(await fileExists(gallery));
  const last = await remove(b, true);
  assert.equal(last.state, "removed");
  assert.equal(last.pages[0].post_status, "missing");
  assert.deepEqual(last.cleanup.assets_removed, [shared.id]);
  assert(!(await fileExists(shared)));
  assert(await fileExists(gallery));
  console.log(
    "Verified maintenance detection and copy report, non-modal scan and import, and exclusive image/font cleanup with shared gallery media protected.",
  );
} finally {
  await browser.close();
}
