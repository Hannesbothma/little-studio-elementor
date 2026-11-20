import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { chromium } from "playwright";

const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9416";
const screen = origin + "/wp-admin/admin.php?page=little-studio-elementor";

async function wait(check) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await check();
    if (result) return result;
    await setTimeout(500);
  }
  throw Error("Background step did not finish");
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  let tab = await context.newPage();
  const request = (action, data) =>
    tab.evaluate(
      ([op, payload]) => LSEAdmin.request(op, payload),
      [action, data],
    );

  const token = async () =>
    tab.evaluate(() => ({
      nonce: LSE_CONFIG.nonce,
      endpoint: LSE_CONFIG.ajax,
    }));
  async function tick(auth, kind, queue) {
    const response = await context.request.post(auth.endpoint, {
      multipart: {
        action: "lse_test",
        nonce: auth.nonce,
        payload: JSON.stringify({ operation: "background-cron", kind, queue }),
      },
      timeout: 15000,
    });
    const result = await response.json();
    assert.equal(result.success, true, JSON.stringify(result));
    return result.data;
  }
  await tab.goto(screen);
  await tab.locator("[data-export-open]").first().click();
  await tab
    .locator("#lse-capture-url")
    .fill("https://93.184.216.34/lse-capture/background/");
  const started = tab.waitForResponse((response) =>
    response.request().postData()?.includes("\r\n\r\nlse_capture_start\r\n"),
  );
  await tab.locator("#lse-capture-background").click();
  const scan = (await (await started).json()).data;
  assert.equal(scan.background, true);
  const scanAuth = await token();
  await tab.close();
  assert(await tick(scanAuth, "scan", scan.capture));

  tab = await context.newPage();
  await tab.goto(screen);
  const collected = await wait(async () => {
    const batch = await request("capture_delivery", {
      capture: scan.capture,
      seq: 0,
    });
    return batch.done && batch.records;
  });
  assert.equal(
    collected[0].url,
    "https://93.184.216.34/lse-capture/background/",
  );
  await tab.locator("[data-export-open]").first().click();
  await tab.locator("#lse-capture-resume").click();
  await tab.locator("#lse-flow-dialog[open] #lse-import-background").waitFor();
  await tab.locator("#lse-import-background").click();
  await tab
    .locator("#lse-saved-status")
    .getByText(/You can close this tab/)
    .waitFor();
  const id = await tab.evaluate(() => LSEAdmin.job.id);
  const importAuth = await token();
  await tab.close();

  assert(await tick(importAuth, "import", id));
  assert(await tick(importAuth, "import", id));
  tab = await context.newPage();
  await tab.goto(screen);
  const imported = await wait(async () => {
    const saved = await request("status", { job: id });
    if (saved.background.phase === "paused")
      throw Error(JSON.stringify(saved.background));
    return saved.state === "ready" && saved;
  });
  assert.equal(imported.background.phase, "ready");
  assert.equal(imported.pages[0].done, true);

  const errors = await request("prepare", {
    fingerprint: "4".repeat(64),
    site_id: "queued-errors",
    title: "Queued errors",
    pages: [
      { key: "home", title: "Home" },
      { key: "other", title: "Other" },
    ],
    site: { home_key: "home" },
    layout: "elementor_canvas",
  });
  await request("stage_page", { job: errors.id, key: "home", elements: [] });
  await request("stage_page", {
    job: errors.id,
    key: "other",
    elements: [
      {
        id: "aabb0001",
        elType: "widget",
        widgetType: "heading",
        settings: { title: "Saved after skipping" },
        elements: [],
      },
    ],
  });
  await request("background_start", { job: errors.id });
  assert(await tick(await token(), "import", errors.id));
  await tab.reload();
  await tab.locator('[data-import-id="' + errors.id + '"]').click();
  await tab.locator("#lse-worker-skip").click();
  assert(await tick(await token(), "import", errors.id));
  assert(await tick(await token(), "import", errors.id));
  assert.equal(
    (await request("status", { job: errors.id })).pages[1].done,
    true,
  );

  const held = Promise.withResolvers();
  const handler = async (route) => {
    const body = route.request().postData()?.slice(0, 1800) || "";
    if (
      route.request().url().includes("converted-page") ||
      body.includes("\r\n\r\nlse_page\r\n")
    ) {
      held.resolve();
      return;
    }
    await route.continue();
  };
  await tab.route("**/*", handler);
  await tab.locator("#lse-file").setInputFiles({
    name: "resume-without-file.html",
    mimeType: "text/html",
    buffer: Buffer.from("<main><h1>Resume without a file</h1></main>"),
  });
  await tab.locator("#lse-flow-dialog[open] #lse-import").click();
  await Promise.race([
    held.promise,
    tab
      .locator("#lse-error-details:visible")
      .waitFor()
      .then(() => {
        throw Error("The test file could not be prepared");
      }),
  ]);
  const resumable = await tab.evaluate(() => LSEAdmin.job.id);
  await tab.close();

  tab = await context.newPage();
  await tab.goto(screen);
  await tab.locator('[data-import-id="' + resumable + '"]').click();
  await tab.locator("#lse-resume-import").click();
  await tab.waitForFunction(
    (id) => LSEAdmin.job?.id === id && LSEAdmin.job.state === "ready",
    resumable,
  );
  assert.equal(await tab.evaluate(() => LSEAdmin.job.pages[0].done), true);
  console.log(
    "Verified WordPress cron scan and page saves with closed tabs, explicit skip, and file-free resume.",
  );
} finally {
  await browser.close();
}
