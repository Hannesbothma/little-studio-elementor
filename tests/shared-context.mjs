import { chromium } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { handleEditorPrompts } from "./editor-prompts.mjs";
const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9416";
const browser = await chromium.launch({ headless: true });
const source = "https://source.example/shared-icon.svg";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M0 0h20v20H0z"/></svg>';
const project = {
  format: "little-studio-website",
  version: 1,
  site_id: "shared-context-" + randomUUID(),
  title: "Audit regression shared context",
  site_css:
    ".kit{--ink:rgb(18,52,86)}@media(max-width:767px){.kit{--ink:rgb(86,52,18)}}",
  assets: [
    {
      url: source,
      name: "shared-context.svg",
      type: "image/svg+xml",
      data: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
    },
  ],
  fonts: [],
  site: { home_key: "one", navigation: [] },
  pages: ["one", "two"].map((key) => ({
    key,
    title: "Shared context " + key,
    slug: "shared-context-" + key,
    url: "https://source.example/" + key + "/",
    parent_key: "",
    html:
      '<body class="kit"><header><h2>Shared header context</h2><img src="' +
      source +
      '" alt="Context image"><ul><li><span class="context-label">Inherited component color</span></li></ul></header><main><p>Page ' +
      key +
      "</p></main></body>",
    css: "header{padding:12px}header img{width:20px}.context-label{color:var(--ink)}",
    js: "",
  })),
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("dialog", (d) => d.accept());
  const admin = async () => {
    await page.goto(
      origin + "/wp-admin/admin.php?page=little-studio-elementor",
    );
    await page.waitForFunction(() => LSEAdmin);
  };
  await admin();
  const rpc = (action, payload) =>
    page.evaluate(([a, x]) => LSEAdmin.request(a, x), [action, payload]);
  const metadata = project.pages.map(
    ({ key, title, slug, url, parent_key }) => ({
      key,
      title,
      slug,
      url,
      parent_key,
    }),
  );
  const job = await rpc("start", {
    fingerprint: createHash("sha256").update(project.site_id).digest("hex"),
    title: project.title,
    site_id: project.site_id,
    pages: metadata,
    site: project.site,
  });
  const upload = () =>
    page.evaluate(
      async ({ svg, source, job }) =>
        LSEAdmin.request(
          "asset",
          { job, url: source },
          new File([svg], "shared-context.svg", { type: "image/svg+xml" }),
        ),
      { svg, source, job: job.id },
    );
  const save = async () => {
    const asset = await upload();
    const converted = [];
    for (const sourcePage of project.pages) {
      const result = await page.evaluate(
        async ({ project, key, map }) => {
          const p = LSEConverter.validate(project);
          return LSEConverter.convert(
            p,
            p.pages.find((p) => p.key === key),
            { map, preserveCSS: true },
          );
        },
        { project, key: sourcePage.key, map: { [source]: asset.url } },
      );
      converted.push(result);
      await rpc("page", { job: job.id, key: sourcePage.key, ...result });
    }
    assert.equal(
      converted[0].regions[0].hash,
      converted[1].regions[0].hash,
      "Preview blob URLs or random native IDs changed the shared hash",
    );
    let ready;
    do {
      ready = await rpc("finish", { job: job.id });
    } while (ready.state === "finishing");
    return ready;
  };
  let ready = await save();
  assert.equal(Object.keys(ready.templates).length, 1);
  const template = Object.values(ready.templates)[0];
  assert.match(
    (await rpc("test", { id: template.id })).css,
    /--lse-source-ink/,
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(ready.pages[0].preview_url);
    assert.equal(
      await page
        .locator(".context-label")
        .evaluate((n) => getComputedStyle(n).color),
      width === 1440 ? "rgb(18, 52, 86)" : "rgb(86, 52, 18)",
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(template.edit_url, { waitUntil: "domcontentloaded" });
  const canvas = page.frameLocator("#elementor-preview-iframe");
  await handleEditorPrompts(page, canvas.locator(".context-label"));
  await canvas.locator(".context-label").waitFor({ timeout: 90000 });
  await page
    .locator("#elementor-loading")
    .waitFor({ state: "hidden", timeout: 90000 });
  assert.equal(
    await canvas
      .locator(".context-label")
      .evaluate((n) => getComputedStyle(n).color),
    "rgb(18, 52, 86)",
    "Standalone template lost inherited source styles",
  );
  await admin();
  const status = await rpc("status", { job: job.id });
  await rpc("prepare", {
    target_job: job.id,
    operation_id: randomUUID(),
    fingerprint: createHash("sha256").update(randomUUID()).digest("hex"),
    site_id: project.site_id,
    title: project.title,
    pages: metadata,
    site: project.site,
    expected_stamps: Object.fromEntries(
      status.pages.map((p) => [p.key, p.current_stamp]),
    ),
    overwrite: true,
  });
  ready = await save();
  assert.equal(
    Object.values(ready.templates)[0].id,
    template.id,
    "Unchanged shared component was duplicated",
  );
  for (const imported of ready.pages)
    assert.match(
      JSON.stringify((await rpc("test", { id: imported.id })).elements),
      /lse-shared/,
    );
  await page.goto(ready.pages[0].preview_url);
  assert.equal(
    await page
      .locator(".context-label")
      .evaluate((n) => getComputedStyle(n).color),
    "rgb(18, 52, 86)",
  );
  await admin();
  const final = await rpc("status", { job: job.id });
  await rpc("remove_import", {
    job: job.id,
    consent: true,
    expected_stamps: Object.fromEntries(
      final.pages.map((p) => [p.key, p.current_stamp]),
    ),
  });
  const result = {
    stableHashesWithMedia: true,
    sharedResponsiveContext: true,
    standaloneTemplateEditor: true,
    sharedRefresh: true,
  };
  await writeFile(
    "tests/results/shared-context.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
