import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9416";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const screen = origin + "/wp-admin/admin.php?page=little-studio-elementor";
  const site = "https://recovery.example.test";
  const records = [
    ["/", "Home"],
    ["/rooms/", "Rooms"],
  ].map(([path, title]) => ({
    url: site + path,
    requested: site + path,
    kind: "page",
    type: "text/html",
    data: Buffer.from(
      `<title>${title}</title><main><h1>${title}</h1></main>`,
    ).toString("base64"),
  }));

  let firstTab;
  const batches = [];
  const blockedBatch = Promise.withResolvers();
  await context.route("**/admin-ajax.php", async (route) => {
    const body = route.request().postDataBuffer()?.toString() || "";
    const action = body.match(/name="action"\r?\n\r?\n([^\r\n]+)/)?.[1];
    if (action === "lse_capture_start")
      return route.fulfill({
        json: { success: true, data: { capture: "recovery-scan" } },
      });
    if (action === "lse_capture_cancel")
      return route.fulfill({ json: { success: true, data: {} } });
    if (action === "lse_capture_batch") {
      const seq = Number(body.match(/"seq":(\d+)/)?.[1]);
      batches.push(seq);
      if (seq === 1 && route.request().frame().page() === firstTab) {
        blockedBatch.resolve();
        return;
      }
      return route.fulfill({
        json: {
          success: true,
          data: {
            done: seq === 1,
            seq: seq + 1,
            message: "Scanning the source website…",
            records: [records[seq]],
          },
        },
      });
    }
    await route.continue();
  });
  firstTab = await context.newPage();
  await firstTab.goto(screen);
  await firstTab.locator("[data-export-open]").first().click();
  await firstTab.locator("#lse-capture-url").fill(site + "/?private=hidden");
  await firstTab.locator("#lse-capture-start").click();
  await Promise.race([
    blockedBatch.promise,
    firstTab
      .locator("#lse-capture-copy")
      .waitFor()
      .then(async () => {
        throw Error(
          await firstTab.locator("#lse-capture-status").textContent(),
        );
      }),
  ]);
  await firstTab.close();

  const tab = await context.newPage();
  await tab.goto(screen);
  assert.equal(await tab.locator("dialog[open]").count(), 0);
  assert(await tab.locator("#lse-final-report").isHidden());
  const checkpoint = await tab.evaluate(() => LSEReports.checkpoint());
  assert.match(checkpoint.phase, /Waiting for scan batch after record 1/);
  assert.equal(checkpoint.source, site + "/");
  assert.equal(checkpoint.records, 1);

  await tab.locator("[data-export-open]").first().click();
  await tab.locator("#lse-capture-resume").click();
  await tab.locator("#lse-flow-dialog[open] #lse-import").waitFor();
  assert.deepEqual(batches, [0, 1, 1]);
  const paths = await tab.evaluate(() =>
    LSEAdmin.project.pages.map((page) => new URL(page.url).pathname),
  );
  assert.deepEqual(paths, ["/", "/rooms/"]);

  await tab.waitForFunction(() => !LSECapture.busy);
  const download = tab.waitForEvent("download");
  await tab.locator("#lse-source-download").click();
  const file = await (await download).createReadStream();
  const chunks = [];
  for await (const chunk of file) chunks.push(chunk);
  assert.deepEqual(
    JSON.parse(Buffer.concat(chunks)).pages.map(
      (page) => new URL(page.url).pathname,
    ),
    paths,
  );
  console.log(
    "Verified a closed scan tab leaves a redacted checkpoint, keeps the final report hidden, and resumes to a complete, exportable project.",
  );
} finally {
  await browser.close();
}
