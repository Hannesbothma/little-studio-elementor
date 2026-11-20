import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9416";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const tab = await context.newPage();
  const site = "https://example.test";
  const records = [
    [
      "/",
      "Stay here",
      '<nav><a href="/suite/">Suite</a><a href="/suite/view/">View</a></nav>',
    ],
    ["/suite/", "Unconvertible Suite", ""],
    ["/suite/view/", "Suite view", ""],
  ].map(([path, title, nav]) => ({
    url: site + path,
    requested: site + path,
    kind: "page",
    type: "text/html",
    data: Buffer.from(
      "<title>" +
        title +
        "</title>" +
        nav +
        "<main><h1>" +
        title +
        "</h1></main>",
    ).toString("base64"),
  }));
  await tab.route("**/admin-ajax.php", async (route) => {
    const body = route.request().postDataBuffer()?.toString() || "";
    const action = body.match(/name="action"\r?\n\r?\n([^\r\n]+)/)?.[1];
    if (action === "lse_capture_start")
      return route.fulfill({
        json: { success: true, data: { capture: "test-capture" } },
      });
    if (action === "lse_capture_cancel")
      return route.fulfill({ json: { success: true, data: {} } });
    if (action === "lse_capture_batch")
      return route.fulfill({
        json: {
          success: true,
          data: {
            done: true,
            seq: 1,
            records,
            failed_resources: [
              {
                url: site + "/closed/",
                kind: "page",
                status: 404,
                error: "HTTP 404",
              },
            ],
          },
        },
      });
    await route.continue();
  });
  await tab.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor", {
    waitUntil: "domcontentloaded",
  });
  await tab.waitForFunction(() => window.LSECapture && !window.LSEManage?.busy);
  await tab.evaluate(() => {
    const original = LSEConverter.convert;
    LSEConverter.convert = (project, page, options) => {
      if (page.url.endsWith("/suite/"))
        throw Error("Fixture conversion failed.");
      return original(project, page, options);
    };
  });
  let downloaded = false;
  tab.on("download", () => {
    downloaded = true;
  });
  await tab.locator("[data-export-open]").first().click();
  await tab.locator("#lse-capture-url").fill(site + "/");
  await tab.locator("#lse-capture-start").click();
  await tab.locator("#lse-capture-skip").waitFor();
  const status = await tab.locator("#lse-capture-status").textContent();
  assert.match(status, /Unconvertible Suite/);
  assert.match(status, /Fixture conversion failed/);
  await tab.locator("#lse-capture-skip").click();
  await tab.locator("#lse-flow-dialog[open] #lse-import").waitFor();
  assert.equal(downloaded, false);
  const project = await tab.evaluate(() => LSEAdmin.project);
  assert.deepEqual(
    project.pages.map((p) => new URL(p.url).pathname),
    ["/", "/suite/view/"],
  );
  assert.equal(project.pages[1].parent_key, "");
  assert.deepEqual(
    project.site.navigation.map((p) => p.key),
    [project.pages[1].key],
  );
  await tab.locator("dialog[open] [data-lse-copy-report]").click();
  const report = await tab.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /Skipped page · Unconvertible Suite/);
  assert.match(
    report,
    /Skipped unavailable source page · https:\/\/example\.test\/closed\/ · HTTP 404/,
  );
  await tab.locator("#lse-import").click();
  await tab.waitForFunction(
    () => !LSEAdmin.busy && LSEAdmin.job?.state === "ready",
    null,
    { timeout: 90000 },
  );
  assert.equal(
    await tab.evaluate(() => LSEAdmin.job.pages.filter((p) => p.done).length),
    2,
  );
  const unfinished = await tab.evaluate(() =>
    LSEAdmin.request("start", {
      fingerprint: crypto.randomUUID().replaceAll("-", "").repeat(2),
      site_id: "refresh-test",
      title: "Saved unfinished import",
      pages: [
        { key: "home", title: "Unfinished draft", slug: "unfinished-draft" },
      ],
      site: { home_key: "home", navigation: [] },
      layout: "elementor_canvas",
    }),
  );
  const checkedSavedImport = tab.waitForResponse((res) =>
    res.request().postData()?.includes("\r\n\r\nlse_status\r\n"),
  );
  await tab.reload();
  await checkedSavedImport;
  const savedImport = tab.locator('[data-import-id="' + unfinished.id + '"]');
  await savedImport.waitFor();
  assert.equal(
    await tab.locator("#lse-flow-dialog").evaluate((d) => d.open),
    false,
  );
  await savedImport.click();
  await tab
    .locator("#lse-project-title")
    .getByText("Saved unfinished import")
    .waitFor();
  assert.equal(
    await tab.locator("#lse-flow-dialog").evaluate((d) => d.open),
    false,
  );
  console.log(
    "Verified URL conversion skip, source 404 reporting, saved drafts and no reminder on refresh.",
  );
} finally {
  await browser.close();
}
