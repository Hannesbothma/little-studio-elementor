import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9416";
const browser = await chromium.launch({ headless: true });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const assetURL = "https://source.example/slide.svg";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#123456"/></svg>';
const project = {
  format: "little-studio-website",
  version: 1,
  site_id: "audit-regression-" + randomUUID(),
  title: "Audit regression native styles",
  site_css:
    ".elementor-element{--flex-direction:row}:root{--source-ink:rgb(18,52,86)}",
  assets: [
    {
      url: assetURL,
      name: "audit-slide.svg",
      type: "image/svg+xml",
      data: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
    },
  ],
  fonts: [],
  site: { home_key: "home", navigation: [] },
  pages: [
    {
      key: "home",
      title: "Audit regression native styles",
      slug: "audit-native-styles",
      url: "https://source.example/audit/",
      parent_key: "",
      html:
        '<body><header class="elementor-element"><div class="logo"><a href="#home"><img src="' +
        assetURL +
        '" alt="Logo"></a></div><h1>Responsive heading</h1></header><main><div class="inherited-color"><svg aria-label="Inherited icon" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M0 0h20v20H0z"></path></svg></div><div class="boxed"><p>Auto-centered box</p></div><a class="fixed-circle" href="#book" style="position:fixed;left:20px;bottom:20px;width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center">Book circle</a><div class="hero" data-settings=\'{"background_background":"slideshow","background_slideshow_gallery":[{"url":"' +
        assetURL +
        '"}]}\'><div class="child"><p>Hero text</p></div></div><div class="positioned"><p>Offset text</p></div><a class="native-link" href="#details">Native hover</a></main></body>',
      css: ".inherited-color{color:rgb(12,34,56)}.boxed{width:600px;max-width:100%;margin:0 auto}header{display:flex;flex-direction:column}.logo{width:120px}.logo a{display:inline-block;width:100%}.logo img{width:35%;height:auto}h1{color:rgb(255,0,0);margin:0}.hero{--min-height:100vh;min-height:var(--min-height);display:flex;flex-direction:column}.child{min-height:0}.positioned{position:absolute;left:120px;top:80px;width:50px;height:30px}.native-link{color:rgb(255,0,0)}.native-link:hover{color:rgb(0,0,255)}@media(max-width:767px){h1{color:rgb(0,0,255)}}",
      js: "window.auditScriptRuns=(window.auditScriptRuns||0)+1;",
    },
  ],
};
const result = new Proxy(
  {},
  {
    set(target, key, value) {
      target[key] = value;
      console.log("PASS", key);
      return true;
    },
  },
);
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultNavigationTimeout(90000);
  page.on("dialog", (dialog) => dialog.accept());
  const admin = async () => {
    await page.goto(
      origin + "/wp-admin/admin.php?page=little-studio-elementor",
    );
    await page.waitForFunction(() => window.LSEAdmin);
  };
  const rpc = (action, payload) =>
    page.evaluate(
      ([action, payload]) => LSEAdmin.request(action, payload),
      [action, payload],
    );
  const audit = (payload) => rpc("audit_test", payload);
  await admin();
  assert.equal((await audit({ operation: "syntax" })).syntax, true);
  const compatibility = await audit({ operation: "compatibility" });
  assert.equal(compatibility.requires, "6.9");
  assert.equal(compatibility.requires_php, "8.1");
  result.compatibility = true;
  assert.deepEqual((await audit({ operation: "css-parser" })).queued, [
    "https://source.example/css/photo%20(1).jpg",
    "https://source.example/css/icon(2).svg",
    "https://source.example/css/nested%20(3).css",
  ]);
  result.quotedCSSURLs = true;
  const packageProbe = await page.evaluate(async () => {
    const encode = (value) => btoa(value),
      records = [
        {
          url: "https://source.example/",
          requested: "https://source.example/",
          kind: "page",
          type: "text/html",
          data: encode(
            '<html><head><title>Deep CSS</title><style>@import "sheet0.css" layer(source) supports(display:grid) screen;</style></head><body><h1>Deep import</h1></body></html>',
          ),
        },
      ];
    for (let i = 0; i < 24; i++)
      records.push({
        url: "https://source.example/sheet" + i + ".css",
        requested: "https://source.example/sheet" + i + ".css",
        kind: "asset",
        type: "text/css",
        data: encode(
          i === 23
            ? "h1{color:rgb(1,2,3)}"
            : '@import "sheet' + (i + 1) + '.css";',
        ),
      });
    const packed = await LSECapture.packageWebsite(
      "https://source.example/",
      records,
    );
    return { css: packed.pages[0].css, warnings: packed.capture.warnings };
  });
  assert.match(
    packageProbe.css,
    /@layer source\{@supports \(display:grid\)\{@media screen\{/,
  );
  assert.match(packageProbe.css, /rgb\(1,2,3\)/);
  assert(
    !packageProbe.warnings.some((w) =>
      /flattened|stylesheet import needs/.test(w),
    ),
  );
  result.deepConditionalCSS = true;
  await audit({ operation: "capture-reset" });
  const capture = await rpc("capture_start", {
    url: "https://93.184.216.34/lse-audit/",
  });
  let seq = 0,
    records = [],
    captureDone;
  for (let i = 0; i < 12; i++) {
    const step = await rpc("capture_batch", { capture: capture.capture, seq });
    if (i === 0)
      assert.deepEqual(
        await rpc("capture_batch", { capture: capture.capture, seq }),
        step,
        "Capture response replay changed",
      );
    records.push(...step.records);
    seq = step.seq;
    if (step.done) {
      captureDone = step;
      break;
    }
  }
  assert(captureDone, "Capture did not finish");
  assert(
    records.some((r) => r.url.endsWith("/retry.css")),
    "Transient stylesheet was not retried",
  );
  assert(
    records.some((r) => r.url.endsWith("/slide.svg")),
    "Builder background not captured",
  );
  assert(
    captureDone.failed_resources.some(
      (r) =>
        r.url.endsWith("/missing.css") &&
        r.status === 404 &&
        r.role === "stylesheet",
    ),
  );
  assert.equal((await audit({ operation: "capture-count" })).attempts, 2);
  await rpc("capture_cancel", { capture: capture.capture });
  result.captureRetryAndReview = true;
  await assert.rejects(
    () =>
      rpc("prepare", {
        fingerprint: digest("stale"),
        converter_version: "capture-v2",
      }),
    /converter changed/,
  );
  result.staleClientRejected = true;
  const metadata = project.pages.map(
    ({ key, title, slug, url, parent_key }) => ({
      key,
      title,
      slug,
      url,
      parent_key,
    }),
  );
  const identity = digest(project.site_id);
  const job = await rpc("start", {
    fingerprint: identity,
    site_id: project.site_id,
    title: project.title,
    pages: metadata,
    site: project.site,
    layout: "elementor_canvas",
    scripts: true,
  });
  const upload = await page.evaluate(
    async ({ svg, assetURL, job }) =>
      LSEAdmin.request(
        "asset",
        { job, url: assetURL },
        new File([svg], "audit-slide.svg", { type: "image/svg+xml" }),
      ),
    { svg, assetURL, job: job.id },
  );
  const font = await audit({ operation: "font" });
  const fontSaved = await page.evaluate(
    async ({ data, job }) =>
      LSEAdmin.request(
        "asset",
        {
          job,
          url: "https://source.example/audit-font.ttf",
          families: ["Audit font"],
        },
        new File(
          [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
          "audit-font.ttf",
          { type: "font/ttf" },
        ),
      ),
    { data: font.data, job: job.id },
  );
  assert(fontSaved.font);
  result.validTTF = true;
  const converted = await page.evaluate(
    async ({ project, map }) => {
      const p = LSEConverter.validate(project);
      return LSEConverter.convert(p, p.pages[0], {
        preserveCSS: true,
        layout: "elementor_canvas",
        map,
      });
    },
    { project, map: { [assetURL]: upload.url } },
  );
  const nodes = [];
  const walk = (tree) => {
    for (const node of tree) {
      nodes.push(node);
      walk(node.elements || []);
    }
  };
  walk(converted.elements);
  const heading = nodes.find((n) => n.widgetType === "heading");
  assert.equal(heading.settings.title_color, "rgb(255, 0, 0)");
  assert.equal(heading.settings.lse_text_color_mobile, "rgb(0, 0, 255)");
  assert(
    !/(?<!lse-source-)--flex-direction\s*:/.test(converted.css),
    "Source layout variable leaked",
  );
  const hero = nodes.find((n) =>
    n.settings.css_classes?.split(" ").includes("hero"),
  );
  const child = nodes.find((n) =>
    n.settings.css_classes?.split(" ").includes("child"),
  );
  assert.equal(hero.settings.background_background, "slideshow");
  assert.equal(hero.settings.min_height.unit, "vh");
  assert(
    !child.settings.min_height,
    "Inherited source variable became child minimum height",
  );
  const payload = { job: job.id, key: "home", ...converted };
  await rpc("page", payload);
  let ready = await rpc("finish", { job: job.id });
  await page.goto(ready.pages[0].preview_url, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.auditScriptRuns === 1);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => auditScriptRuns), 1);
  result.scriptsWithoutRegions = true;
  assert.equal(
    await page.locator("h1").evaluate((n) => getComputedStyle(n).color),
    "rgb(255, 0, 0)",
  );
  assert.equal(
    await page
      .locator("header[data-lse-native]")
      .evaluate((n) => getComputedStyle(n).flexDirection),
    "column",
  );
  assert.equal(
    await page.locator(".positioned").evaluate((n) => getComputedStyle(n).left),
    "120px",
  );
  assert.equal(
    await page.locator(".positioned").evaluate((n) => getComputedStyle(n).top),
    "80px",
  );
  assert.equal(
    await page
      .locator('svg[aria-label="Inherited icon"] path')
      .evaluate((node) => getComputedStyle(node).fill),
    "rgb(12, 34, 56)",
  );
  assert.equal(
    await page
      .locator(".boxed")
      .evaluate((node) => Math.round(node.getBoundingClientRect().left)),
    420,
  );
  const circle = await page
    .getByRole("link", { name: "Book circle", exact: true })
    .evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
      radius: getComputedStyle(node).borderRadius,
    }));
  assert.deepEqual(circle, { width: 80, height: 80, radius: "50%" });
  const geometry = await page
    .locator(".elementor-widget-image")
    .first()
    .evaluate((n) => ({
      outer: n.getBoundingClientRect().height,
      image: n.querySelector("img").getBoundingClientRect().height,
    }));
  assert(
    Math.abs(geometry.outer - geometry.image) < 2,
    JSON.stringify(geometry),
  );
  assert.equal(
    await page
      .locator(".hero")
      .evaluate((n) => n.getBoundingClientRect().height),
    1000,
  );
  await page.getByRole("link", { name: "Native hover", exact: true }).hover();
  await page.waitForFunction(
    () =>
      getComputedStyle(
        [...document.querySelectorAll("a")].find(
          (n) => n.textContent.trim() === "Native hover",
        ),
      ).color === "rgb(0, 0, 255)",
  );
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(
    await page.locator("h1").evaluate((n) => getComputedStyle(n).color),
    "rgb(0, 0, 255)",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  result.nativeResponsiveGeometry = true;
  await admin();
  const nativeSave = await audit({ operation: "native-color", job: job.id });
  assert(nativeSave.savedGreen, "The native edit was not persisted");
  await page.goto(ready.pages[0].preview_url);
  if (
    (await page
      .locator("h1")
      .evaluate((node) => getComputedStyle(node).color)) !== "rgb(0, 128, 0)"
  ) {
    await writeFile(
      "tests/results/native-color-diagnostic.json",
      JSON.stringify(
        await page.locator("h1").evaluate((node) => {
          let rules = [];
          function walk(list) {
            for (const rule of list) {
              if (rule.selectorText) {
                try {
                  if (node.matches(rule.selectorText) && rule.style.color)
                    rules.push(rule.cssText);
                } catch {}
              } else if (
                rule.cssRules &&
                (!rule.media || matchMedia(rule.conditionText).matches)
              )
                walk(rule.cssRules);
            }
          }
          for (const sheet of document.styleSheets) {
            try {
              walk(sheet.cssRules);
            } catch {}
          }
          return {
            native: node.outerHTML,
            color: getComputedStyle(node).color,
            styleURLs: [...document.styleSheets].map((s) => s.href),
            rules,
          };
        }),
        null,
        2,
      ),
    );
  }
  assert.equal(
    await page.locator("h1").evaluate((n) => getComputedStyle(n).color),
    "rgb(0, 128, 0)",
  );
  result.nativeColorEdit = true;
  await admin();
  const lease = await audit({ operation: "lease", job: job.id });
  assert(lease.successorRetained);
  result.ownedLocks = true;
  const operation = randomUUID();
  const refresh = async () => {
    const status = await rpc("status", { job: job.id });
    return rpc("prepare", {
      fingerprint: identity,
      operation_id: operation,
      target_job: job.id,
      site_id: project.site_id,
      title: project.title,
      pages: metadata,
      site: project.site,
      layout: "elementor_canvas",
      scripts: true,
      overwrite: true,
      expected_stamps: { home: status.pages[0].current_stamp },
    });
  };
  let refreshed = await refresh();
  assert.equal(refreshed.state, "importing");
  await rpc("page", payload);
  await rpc("finish", { job: job.id });
  assert.equal(
    (await refresh()).state,
    "ready",
    "Same-operation response replay must be idempotent",
  );
  let status = await rpc("status", { job: job.id });
  refreshed = await rpc("prepare", {
    fingerprint: identity,
    operation_id: randomUUID(),
    target_job: job.id,
    site_id: project.site_id,
    title: project.title,
    pages: metadata,
    site: project.site,
    overwrite: true,
    expected_stamps: { home: status.pages[0].current_stamp },
  });
  assert.equal(
    refreshed.state,
    "importing",
    "New explicit same-file refresh skipped",
  );
  assert(!refreshed.pages[0].done);
  await rpc("page", payload);
  await rpc("finish", { job: job.id });
  result.refreshOperationIdentity = true;
  await audit({ operation: "old-engine", job: job.id });
  status = await rpc("status", { job: job.id });
  const upgraded = await rpc("prepare", {
    fingerprint: digest(randomUUID()),
    operation_id: randomUUID(),
    target_job: job.id,
    site_id: project.site_id,
    title: project.title,
    pages: metadata,
    site: project.site,
    expected_stamps: { home: status.pages[0].current_stamp },
  });
  assert.equal(upgraded.id, job.id);
  assert.equal(upgraded.state, "importing");
  await rpc("page", payload);
  await rpc("finish", { job: job.id });
  result.pendingConverterUpgrade = true;
  assert((await audit({ operation: "race", job: job.id })).retained);
  result.concurrentState = true;
  const interruptedRefresh = await audit({
    operation: "partial-refresh-backup",
    job: job.id,
    page: converted,
  });
  assert(
    interruptedRefresh.injected &&
      interruptedRefresh.retry &&
      interruptedRefresh.backupPreservedOnFailure,
    JSON.stringify(interruptedRefresh),
  );
  await rpc("finish", { job: job.id });
  result.refreshBackupRecovery = true;

  const partial = await rpc("start", {
    fingerprint: digest(randomUUID()),
    title: "Audit regression partial save",
    site_id: "audit-partial",
    pages: [{ ...metadata[0], title: "Audit regression partial save" }],
    site: project.site,
  });
  const recovery = await audit({
    operation: "partial-save",
    job: partial.id,
    page: { ...converted },
  });
  assert(recovery.injected && recovery.retry && recovery.journalRemoved);
  await rpc("finish", { job: partial.id });
  result.partialSaveRecovery = true;
  const listed = await audit({ operation: "pagination" });
  assert(listed.imports.some((item) => item.id === partial.id));
  assert(
    !listed.imports.some((item) =>
      /Foreign|Removed pagination/.test(item.title),
    ),
  );
  result.ownerPagination = true;
  // Shared templates must retain CSS and reconnect on refresh. Different page IDs have distinct native element IDs.
  const sharedPages = ["one", "two"].map((key, i) => ({
    key,
    title: "Audit regression shared " + key,
    slug: "audit-shared-" + key,
    url: "https://source.example/shared/" + key + "/",
    parent_key: "",
  }));
  const shared = await rpc("start", {
    fingerprint: digest(randomUUID()),
    title: "Audit regression shared",
    site_id: "audit-shared",
    pages: sharedPages,
    site: { home_key: "one", navigation: [] },
  });
  const sharedPayload = (key, i) => {
    const root = (100 + i).toString(16).padStart(8, "0");
    return {
      job: shared.id,
      key,
      elements: [
        {
          id: root,
          elType: "container",
          settings: { html_tag: "header" },
          elements: [
            {
              id: (200 + i).toString(16).padStart(8, "0"),
              elType: "widget",
              widgetType: "heading",
              settings: { title: "Shared section" },
              elements: [],
            },
          ],
        },
      ],
      css:
        "__LSE_SCOPE__ .elementor-element-" +
        root +
        "{background-color:rgb(1,2,3)}",
      source: { html: "<header>Shared section</header>", css: "", js: "" },
      regions: [{ id: root, hash: "c".repeat(64), kind: "header" }],
    };
  };
  for (let i = 0; i < 2; i++)
    await rpc("page", sharedPayload(sharedPages[i].key, i));
  let sharedReady;
  do {
    sharedReady = await rpc("finish", { job: shared.id });
  } while (sharedReady.state === "finishing");
  const template = Object.values(sharedReady.templates)[0];
  assert((await rpc("test", { id: template.id })).css.length);
  status = await rpc("status", { job: shared.id });
  await rpc("prepare", {
    fingerprint: digest(randomUUID()),
    target_job: shared.id,
    site_id: "audit-shared",
    title: shared.title,
    pages: sharedPages,
    site: { home_key: "one", navigation: [] },
    expected_stamps: Object.fromEntries(
      status.pages.map((p) => [p.key, p.current_stamp]),
    ),
    overwrite: true,
  });
  for (let i = 0; i < 2; i++)
    await rpc("page", sharedPayload(sharedPages[i].key, i));
  do {
    sharedReady = await rpc("finish", { job: shared.id });
  } while (sharedReady.state === "finishing");
  for (const p of sharedReady.pages)
    assert.match(
      JSON.stringify((await rpc("test", { id: p.id })).elements),
      /lse-shared/,
    );
  result.sharedRefreshAndCSS = true;
  for (const id of [job.id, partial.id, shared.id]) {
    const status = await rpc("status", { job: id });
    await rpc("remove_import", {
      job: id,
      consent: true,
      expected_stamps: Object.fromEntries(
        status.pages.map((p) => [p.key, p.current_stamp]),
      ),
    });
  }
  await writeFile(
    "tests/results/audit-regression.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (error) {
  if (page)
    await page
      .screenshot({ path: "tests/results/audit-failure.png", fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
