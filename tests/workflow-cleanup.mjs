import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  release = new Promise((resolve) => {
    proceed = resolve;
  });
  await tab.locator("#lse-import").click();
  await tab.locator("#lse-progress [data-lse-background]").click();
  assert(await tab.locator("#lse-flow-dialog").isHidden());
  await dashboard.bringToFront();
  proceed();
  await tab.waitForFunction(
    () => LSEAdmin.job?.state === "ready" && !LSEAdmin.busy,
    null,
    { timeout: 90000 },
  );
  assert.equal(await tab.evaluate(() => LSEAdmin.job.pages[0].done), true);
  assert(await tab.locator("#lse-background-task").isHidden());

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
  const remove = async (job) => {
    const fresh = await rpc("status", { job: job.id });
    return rpc("remove_import", {
      job: job.id,
      consent: true,
      expected_stamps: Object.fromEntries(
        fresh.pages.map((page) => [page.key, page.current_stamp]),
      ),
    });
  };
  const fileExists = (asset) =>
    rpc("test", { operation: "attachment-exists", id: asset.id });
  const gone = await remove(a);
  assert.equal(gone.state, "removed");
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
  const last = await remove(b);
  assert.deepEqual(last.cleanup.assets_removed, [shared.id]);
  assert(!(await fileExists(shared)));
  assert(await fileExists(gallery));
  console.log(
    "Verified maintenance detection and copy report, non-modal scan and import, and exclusive image/font cleanup with shared gallery media protected.",
  );
} finally {
  await browser.close();
}
