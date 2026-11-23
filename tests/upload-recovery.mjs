import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9416";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const tab = await context.newPage();
  tab.on("pageerror", (error) => console.error(error.message));
  await tab.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  console.log("Opened importer");
  await tab.waitForFunction(() => window.LSEAdmin && !window.LSEManage?.busy);
  const id = randomUUID();
  const assets = ["first", "blocked", "last"].map((name, i) => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><title>' +
      id +
      i +
      '</title><path d="M0 0h4v4H0z"/></svg>';
    return {
      name: name + ".svg",
      url: "https://example.test/" + name + ".svg?signature=PRIVATE",
      type: "image/svg+xml",
      data: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
    };
  });
  const input = {
    format: "little-studio-website",
    version: 1,
    site_id: id,
    title: "Upload recovery",
    site_css: "",
    assets,
    fonts: [],
    pages: [
      {
        key: "home",
        title: "Recovery test",
        slug: "recover",
        url: "",
        parent_key: "",
        html: "<section><h1>Still editable</h1></section>",
        css: "",
        js: "",
      },
    ],
    site: { home_key: "home", navigation: [] },
  };
  input.pages.push({
    ...input.pages[0],
    key: "unreadable",
    slug: "unreadable",
    title: "Unreadable page",
  });
  input.pages.push({
    ...input.pages[0],
    key: "invalid",
    slug: "rejected",
    title: "Invalid page",
  });
  await tab.evaluate(() => {
    const convert = LSEConverter.convert;
    LSEConverter.convert = async (project, page, options) => {
      if (page.key === "unreadable")
        throw Error("Fixture page conversion failed.");
      const result = await convert(project, page, options);
      if (page.key === "invalid") result.elements[0].elType = "invalid";
      return result;
    };
  });
  const refusals = [];
  await tab.route("**/admin-ajax.php", async (route) => {
    const body = route.request().postDataBuffer()?.toString() || "";
    const action = body.match(/name="action"\r?\n\r?\n([^\r\n]+)/)?.[1];
    if (
      action === "lse_assets" ||
      (action === "lse_asset" && body.includes('filename="blocked.svg"'))
    ) {
      refusals.push(action);
      console.log("Refusing", action);
      return route.fulfill({
        status: action === "lse_assets" ? 403 : 504,
        contentType: "text/html",
        headers: { "x-request-id": "qa-refusal" },
        body: "<h1>Forbidden</h1>",
      });
    }
    await route.continue();
  });
  await tab.locator("#lse-file").setInputFiles({
    name: "recovery.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(input)),
  });
  await tab.locator("#lse-import").click();
  console.log("Started upload test");
  await tab.locator("#lse-skip-item").waitFor({ timeout: 90000 });
  assert.match(
    await tab.locator("#lse-error-item-title").textContent(),
    /blocked.svg/,
  );
  assert(await tab.locator("#lse-final-report").isHidden());
  const copied = () => tab.evaluate(() => navigator.clipboard.readText());
  await tab.locator("#lse-skip-item").click();
  await tab
    .getByRole("button", { name: "Skip this page and continue" })
    .click({ timeout: 120000 });
  await tab
    .locator("#lse-error-item-title")
    .filter({ hasText: "Invalid page" })
    .waitFor({
      timeout: 120000,
    });
  await tab
    .getByRole("button", { name: "Skip this page and continue" })
    .click({ timeout: 120000 });
  console.log(
    "Skipped one file, a failed conversion and a server-rejected page",
  );
  await tab.waitForFunction(
    () => window.LSEAdmin.job?.state === "ready" && !LSEAdmin.busy,
    null,
    { timeout: 120000 },
  );
  const job = await tab.evaluate(() => LSEAdmin.job);
  assert.deepEqual(refusals, ["lse_assets", "lse_asset"]);
  assert.equal(job.pages[0].done, true);
  assert.equal(job.pages[1].skipped, true);
  assert.equal(job.pages[1].done, false);
  assert.equal(job.pages[2].skipped, true);
  assert.equal(job.pages[2].done, false);
  assert.deepEqual(
    job.assets.map((v) => v.source).sort(),
    [assets[0].url, assets[2].url].sort(),
  );
  assert.equal(job.skipped_assets[assets[1].url].name, "blocked.svg");
  await tab.waitForFunction(
    async (id) =>
      Object.values(
        (await LSEAdmin.request("status", { job: id })).diagnostics,
      ).some((line) => line.includes("Skipped file")),
    job.id,
    { timeout: 20000 },
  );
  await tab.evaluate(() => localStorage.clear());
  await tab.reload({ waitUntil: "domcontentloaded" });
  await tab.waitForFunction((id) => LSEAdmin.job?.id === id, job.id);
  await tab.locator("#lse-project").waitFor();
  await tab.locator("main [data-lse-copy-report]").click();
  const final = await copied();
  for (const part of [
    "ready",
    "1/3 pages",
    "2 files",
    "Skipped file",
    "Skipped page",
    "403",
    "first.svg",
    "blocked.svg",
    "HTTP 504",
    "one file at a time",
    "qa-refusal",
    "import_validation",
    "HTTP 400",
  ])
    assert(final.includes(part), part);
  assert(!final.includes("PRIVATE"));
  console.log(
    "Verified batch isolation, individual skip, remaining files, saved draft, one-click copy and durable report after reload.",
  );
  // A lost session affects every item. Keep progress, record both refusals
  // and never offer to skip the file that happened to be in flight.
  await tab.unroute("**/admin-ajax.php");
  let denyStatus = false;
  let skipRequests = 0;
  await tab.route("**/admin-ajax.php", async (route) => {
    const body = route.request().postDataBuffer()?.toString() || "";
    const action = body.match(/name="action"\r?\n\r?\n([^\r\n]+)/)?.[1];
    if (action === "lse_assets") {
      denyStatus = true;
      return route.fulfill({
        status: 403,
        contentType: "text/html",
        body: "<h1>Forbidden</h1>",
      });
    }
    if (denyStatus && action === "lse_status")
      return route.fulfill({
        status: 403,
        json: {
          success: false,
          data: { message: "Your WordPress session expired." },
        },
      });
    if (action === "lse_skip_asset") skipRequests++;
    await route.continue();
  });
  input.site_id = randomUUID();
  input.title = "Session refusal";
  input.pages = input.pages.slice(0, 1);
  for (const item of input.assets) {
    item.url = "https://example.test/" + input.site_id + "/" + item.name;
    item.data =
      item.data.split(",")[0] +
      "," +
      Buffer.from(
        Buffer.from(item.data.split(",")[1], "base64")
          .toString()
          .replace(id, input.site_id),
      ).toString("base64");
  }
  await tab.locator("#lse-file").setInputFiles({
    name: "session.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(input)),
  });
  await tab.locator("#lse-import").click();
  await tab.waitForFunction(
    () =>
      document
        .querySelector("#lse-current")
        .textContent.includes("Import paused."),
    null,
    { timeout: 120000 },
  );
  assert(denyStatus);
  assert(await tab.locator("#lse-skip-item").isHidden());
  assert.equal(skipRequests, 0);
  assert(await tab.locator("#lse-final-report").isHidden());
  const paused = await tab.evaluate(() => LSEAdmin.importReport());
  assert(paused.includes("session expired"));
  assert(paused.includes("403"));
  console.log(
    "Verified session-wide refusal records diagnostics and keeps the final report hidden while paused.",
  );
} finally {
  await browser.close();
}
