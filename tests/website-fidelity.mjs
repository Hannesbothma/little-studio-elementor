import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { handleEditorPrompts } from "./editor-prompts.mjs";
import { compareFullPages } from "./image-pixels.mjs";

const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9416";
const live = process.argv.includes("--live");
const only = process.env.LSE_FIDELITY_CASES?.split(",");
const widthOverride = process.env.LSE_FIDELITY_WIDTHS;
const widths = widthOverride
  ? widthOverride.split(",").map(Number)
  : [390, 767, 768, 1280];
const output =
  process.env.LSE_FIDELITY_OUTPUT || "tests/results/website-fidelity";
const fixture = {
  key: "page-context",
  url: "https://fixture.example/",
  ready: "h1",
  html: `<!doctype html><html><head><title>Page context</title></head><body>
    <a class="site-home" href="#content" aria-label="Start"></a>
    <main id="content"><h1>Page context</h1><label for="size">Size</label>
    <select id="size"><option value="">Choose a size</option><option value="small">Small</option></select></main>
    <footer class="site-footer"><p>End of page</p></footer>
    </body></html>`,
  css: `
    html,body{margin:0;background:#eaeee7;color:#18271f;font:16px Arial,sans-serif}
    body:has(> .site-footer)::before{content:"";display:block;height:56px;background:#183526}
    body:has(> .site-footer) > a.site-home{position:absolute;left:12px;top:16px;color:white}
    a.site-home::before{content:"Start"}
    main{background:white;padding:16px}
    h1,p{margin:0}
    h1{font-size:24px;line-height:32px}
    label{display:block}
    footer{padding:16px}
  `,
};
const cases = live
  ? [
      {
        key: "iana",
        url: "https://www.iana.org/domains/reserved",
        ready: "h1",
        pages: 1,
        depth: 0,
        linkedImage: "Homepage",
      },
      {
        key: "zen",
        url: "https://www.csszengarden.com/214/",
        ready: "h1",
        pages: 1,
        depth: 0,
        background: "header[role=banner]",
      },
      {
        key: "wiki",
        url: "https://en.wikipedia.org/wiki/Programmer%27s_Day",
        ready: "h1",
        pages: 1,
        depth: 0,
        sidebar: ".vector-column-start",
      },
      {
        key: "accordion",
        url: "https://www.w3.org/WAI/ARIA/apg/patterns/accordion/examples/accordion/",
        ready: '[aria-controls="sect2"]',
        pages: 1,
        depth: 0,
        scripts: true,
      },
      {
        key: "cern",
        url: "http://info.cern.ch/hypertext/WWW/TheProject.html",
        ready: "h1",
        pages: 3,
        depth: 1,
      },
      {
        key: "books",
        url: "https://books.toscrape.com/catalogue/category/books_1/index.html",
        ready: ".product_pod img",
        pages: 1,
        depth: 0,
        images: 20,
      },
      {
        key: "dropdown",
        url: "https://the-internet.herokuapp.com/dropdown",
        ready: "#dropdown",
        pages: 1,
        depth: 0,
        context: true,
      },
      {
        key: "dynamic-controls",
        url: "https://the-internet.herokuapp.com/dynamic_controls",
        ready: "#input-example input",
        pages: 1,
        depth: 0,
        context: true,
        scripts: true,
      },
    ]
  : [fixture];
const selected = cases.filter(({ key }) => !only || only.includes(key));
assert(selected.length, "Select at least one known website case.");
assert(
  widths.every((width) => Number.isFinite(width) && width >= 320),
  "Widths must be at least 320 pixels.",
);

const passwordPath = process.env.LSE_TEST_PASSWORD_FILE;
const user = process.env.LSE_TEST_USER;
assert(
  Boolean(passwordPath) === Boolean(user),
  "Set both the test user and password file for an authenticated site.",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--disable-quic"] });
const report = { environment: null, cases: [] };

async function importDraft(admin, spec) {
  await admin.goto(
    origin + "/wp-admin/admin.php?page=little-studio-elementor",
    { waitUntil: "domcontentloaded" },
  );
  await admin.waitForFunction(
    () => window.LSECapture && window.LSEAdmin && !window.LSEManage?.busy,
  );
  report.environment ||= await admin.evaluate(() => ({
    version: LSE_CONFIG.version,
    wordpress: LSE_CONFIG.wordpress,
    elementor: LSE_CONFIG.elementor,
    pro: LSE_CONFIG.pro,
  }));
  if (process.env.LSE_TEST_VERSION)
    assert.equal(report.environment.version, process.env.LSE_TEST_VERSION);
  if (live) {
    // Bound the public crawl, then let the ordinary capture and save actions run.
    await admin.evaluate(({ pages, depth }) => {
      const request = LSEAdmin.request;
      LSEAdmin.request = (action, payload, ...extra) =>
        request(
          action,
          action === "capture_start" ? { ...payload, pages, depth } : payload,
          ...extra,
        );
    }, spec);
    await admin.locator("[data-export-open]").first().click();
    await admin.locator("#lse-capture-url").fill(spec.url);
    await admin.locator("#lse-capture-start").click();
    await admin.waitForFunction(
      () => {
        const dialog = document.getElementById("lse-flow-dialog");
        return (
          (dialog.open && !document.getElementById("lse-review").hidden) ||
          (!LSECapture.busy &&
            !document.getElementById("lse-capture-copy").hidden)
        );
      },
      null,
      { timeout: 150000 },
    );
    assert(
      await admin.locator("#lse-review").isVisible(),
      await admin.locator("#lse-capture-status").textContent(),
    );
  } else {
    const project = {
      format: "little-studio-website",
      version: 1,
      title: "Page context fixture",
      site_id: "page-context-fixture-" + randomUUID(),
      site_css: "",
      fonts: [],
      assets: [],
      site: { home_key: "home", navigation: [] },
      pages: [
        {
          key: "home",
          slug: "fidelity-context",
          title: "Page context",
          url: spec.url,
          html: spec.html,
          css: spec.css,
          js: "",
        },
      ],
    };
    await admin.locator("#lse-file").setInputFiles({
      name: "page-context.website.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await admin.waitForFunction(() => LSEAdmin.project && !LSEAdmin.busy);
  }
  if (spec.scripts) {
    const scripts = admin.locator("#lse-scripts");
    if (!(await scripts.isVisible()))
      await scripts.locator("xpath=ancestor::details[1]/summary").click();
    await scripts.check();
  }
  if (live) await admin.locator("#lse-import").click();
  else await admin.evaluate(() => LSEAdmin.run());
  await admin.waitForFunction(
    () => !LSEAdmin.busy && LSEAdmin.job?.state === "ready",
    null,
    { timeout: 90000 },
  );
  return admin.evaluate(() => LSEAdmin.job);
}

async function visualState(page, spec) {
  await page.locator(spec.ready).first().waitFor({ timeout: 20000 });
  await page.waitForLoadState("load", { timeout: 12000 }).catch(() => {});
  await page.evaluate(async () => {
    const deadline = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const images = [...document.images].filter(
      (image) => image.getClientRects().length,
    );
    for (const image of images) image.loading = "eager";
    await Promise.race([document.fonts.ready, deadline(4000)]);
    await Promise.race([
      Promise.allSettled(images.map((image) => image.decode())),
      deadline(4000),
    ]);
  });
  return page.evaluate(() => {
    const root = document.querySelector(".lse-imported-site") || document.body;
    const header = root.querySelector("a.home-link, a.site-home");
    const footer = root.querySelector("#page-footer, .site-footer");
    const images = [...document.images].filter(
      (img) => img.getClientRects().length,
    );
    const rect = (element) => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return [x, y, width, height];
    };
    const before = getComputedStyle(root, "::before");
    const label = header
      ? getComputedStyle(header, "::before").content
      : "none";
    const documentWidth = document.documentElement.scrollWidth;
    const viewport = document.documentElement.clientWidth;
    let overflow = null;
    if (documentWidth > viewport) {
      let furthest = viewport;
      for (const node of document.querySelectorAll("body *")) {
        const bounds = node.getBoundingClientRect();
        if (
          !bounds.width ||
          bounds.right < furthest ||
          bounds.right > documentWidth + 2
        )
          continue;
        furthest = bounds.right;
        overflow = {
          selector: node.id
            ? "#" + CSS.escape(node.id)
            : node.localName +
              [...node.classList]
                .slice(0, 3)
                .map((name) => "." + CSS.escape(name))
                .join(""),
          bounds: rect(node),
        };
      }
    }
    return {
      width: documentWidth,
      height: document.documentElement.scrollHeight,
      viewport,
      overflow,
      background: getComputedStyle(document.body).backgroundColor,
      images: images.length,
      loaded: images.filter((image) => image.naturalWidth).length,
      heading: rect(root.querySelector("h1,h2,h3,h4")),
      header: rect(header),
      headerLabel: ["none", "normal"].includes(label) ? null : label,
      banner: ["none", "normal"].includes(before.content)
        ? null
        : { height: before.height, paint: before.backgroundColor },
      footer: rect(footer),
      footerInContext: Boolean(footer && root.contains(footer)),
    };
  });
}

async function exercise(page, spec) {
  if (spec.key === "accordion") {
    const button = page.getByRole("button", {
      name: "Billing Address",
      exact: true,
    });
    const panel = page.locator("#sect2");
    assert.equal(await button.getAttribute("aria-expanded"), "false");
    assert(await panel.isHidden());
    await button.focus();
    await button.press("Enter", { timeout: 5500 });
    await panel.waitFor({ state: "visible", timeout: 5500 });
    assert.equal(await button.getAttribute("aria-expanded"), "true");
    await button.click({ timeout: 5500 });
    await panel.waitFor({ state: "hidden", timeout: 5500 });
    assert.equal(await button.getAttribute("aria-expanded"), "false");
    return;
  }
  if (spec.key === "dropdown" || spec.key === "page-context") {
    const field = page.locator(spec.key === "dropdown" ? "#dropdown" : "#size");
    const value = spec.key === "dropdown" ? "2" : "small";
    await field.selectOption(value, { timeout: 6000 });
    assert.equal(await field.inputValue(), value);
    if (spec.key === "page-context") {
      await page.getByRole("link", { name: "Start", exact: true }).click();
      assert.equal(new URL(page.url()).hash, "#content");
    }
    return;
  }
  if (spec.key !== "dynamic-controls") return;
  const field = page.locator("#input-example input");
  assert(await field.isDisabled());
  await page
    .getByRole("button", { name: "Enable", exact: true })
    .click({ timeout: 6000 });
  await page
    .getByRole("button", { name: "Disable", exact: true })
    .waitFor({ timeout: 7000 });
  assert(await field.isEnabled());
  const checkbox = page.locator("#checkbox-example input[type=checkbox]");
  await page
    .getByRole("button", { name: "Remove", exact: true })
    .click({ timeout: 6000 });
  await checkbox.waitFor({ state: "detached", timeout: 7000 });
  await page
    .getByRole("button", { name: "Add", exact: true })
    .click({ timeout: 6000 });
  await checkbox.waitFor({ state: "visible", timeout: 7000 });
}

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
  });
  const admin = await context.newPage();
  if (user) {
    await admin.goto(origin + "/wp-login.php");
    await admin.locator("#user_login").fill(user);
    await admin
      .locator("#user_pass")
      .fill((await readFile(passwordPath, "utf8")).trim());
    await Promise.all([
      admin.waitForURL("**/wp-admin/**"),
      admin.locator("#wp-submit").click(),
    ]);
  }
  for (const spec of selected) {
    console.log("Comparing " + spec.key);
    const entry = { key: spec.key, url: spec.url, viewports: [], errors: [] };
    report.cases.push(entry);
    const source = await browser.newPage();
    const preview = await context.newPage();
    const editor = await context.newPage();
    try {
      const job = await importDraft(admin, spec);
      entry.pages = job.pages.filter((page) => page.done).length;
      entry.assets = job.assets.length;
      entry.failedAssets = job.capture?.failed_resources ?? [];
      assert.equal(entry.pages, spec.pages ?? 1);
      const home =
        job.pages.find((page) => page.source_url === spec.url) || job.pages[0];
      entry.draftId = home.id;
      for (const width of widths) {
        const viewport = { width, height: 820 };
        for (const page of [source, preview])
          await page.setViewportSize(viewport);
        if (live) {
          assert.equal(
            (
              await source.goto(spec.url, {
                waitUntil: "commit",
                timeout: 25000,
              })
            ).status(),
            200,
          );
        } else
          await source.setContent(
            spec.html.replace(
              "</head>",
              "<style>" + spec.css + "</style></head>",
            ),
          );
        assert.equal(
          (
            await preview.goto(home.preview_url, {
              waitUntil: "domcontentloaded",
            })
          ).status(),
          200,
        );
        await preview.addStyleTag({
          content:
            "#wpadminbar{display:none!important}html{margin-top:0!important}",
        });
        const [original, draft] = await Promise.all([
          visualState(source, spec),
          visualState(preview, spec),
        ]);
        const fullPage = [original, draft].every(
          (state) =>
            state.height <= 16384 && state.width * state.height <= 16000000,
        );
        const shot = (page, side) =>
          page.screenshot({
            path: join(output, spec.key + "-" + width + "-" + side + ".png"),
            fullPage,
            timeout: 10000,
          });
        const screenshots = await Promise.all([
          shot(source, "source"),
          shot(preview, "draft"),
        ]);
        const check = {
          width,
          original,
          draft,
          screenshotScope: fullPage ? "full page" : "viewport",
          pixels: compareFullPages(...screenshots),
        };
        entry.viewports.push(check);
        if (spec.linkedImage) {
          const measureLink = (page) =>
            page
              .getByRole("img", { name: spec.linkedImage, exact: true })
              .evaluate((image) => ({
                href: image.closest("a")?.href,
                width: image.getBoundingClientRect().width,
                height: image.getBoundingClientRect().height,
              }));
          const [expected, actual] = await Promise.all([
            measureLink(source),
            measureLink(preview),
          ]);
          check.linkedImage = { expected, actual };
          assert.equal(
            actual.href,
            expected.href,
            "The linked image keeps its destination",
          );
          for (const axis of ["width", "height"])
            assert(
              Math.abs(actual[axis] - expected[axis]) <= 1,
              "Linked image " + axis,
            );
          assert(
            draft.width - draft.viewport <=
              original.width - original.viewport + 1,
            "Imported page adds horizontal overflow",
          );
        }
        if (spec.background) {
          const paint = (page) =>
            page.locator(spec.background).evaluate(async (node) => {
              const s = getComputedStyle(node);
              const urls = [
                ...s.backgroundImage.matchAll(/url\("([^"]*)"\)/g),
              ].map((match) => match[1]);
              const images = await Promise.all(
                urls.map(async (url) => {
                  const image = new Image();
                  image.src = url;
                  return image.decode().then(
                    () => true,
                    () => false,
                  );
                }),
              );
              return {
                layers: urls.length,
                loaded: images.filter(Boolean).length,
                position: s.backgroundPosition,
                size: s.backgroundSize,
                repeat: s.backgroundRepeat,
                attachment: s.backgroundAttachment,
              };
            });
          const [expected, actual] = await Promise.all([
            paint(source),
            paint(preview),
          ]);
          check.background = { expected, actual };
          assert.equal(
            expected.layers,
            4,
            "The source renders the four header background layers",
          );
          assert.deepEqual(
            actual,
            expected,
            "The draft preserves and loads the source background layers",
          );
        }
        if (spec.sidebar) {
          const measureGrid = (page) =>
            page
              .locator(spec.sidebar)
              .first()
              .evaluate((item) => {
                const style = getComputedStyle(item.parentElement);
                const bounds = item.getBoundingClientRect();
                return {
                  areas: style.gridTemplateAreas,
                  columns: style.gridTemplateColumns,
                  display: style.display,
                  x: Math.round(bounds.x),
                  width: Math.round(bounds.width),
                };
              });
          const [expected, actual] = await Promise.all([
            measureGrid(source),
            measureGrid(preview),
          ]);
          check.sidebar = { expected, actual };
          assert(
            draft.width - draft.viewport <=
              original.width - original.viewport + 1,
            "Imported grid adds horizontal overflow",
          );
          assert.equal(actual.display, expected.display, "Grid layout mode");
          if (expected.display.includes("grid")) {
            assert.equal(actual.areas, expected.areas, "Named grid areas");
            assert.equal(actual.columns, expected.columns, "Grid columns");
          }
          if (expected.width) {
            assert(
              Math.abs(actual.x - expected.x) <= 1,
              "Sidebar horizontal position",
            );
            assert(
              Math.abs(actual.width - expected.width) <= 1,
              "Sidebar width",
            );
          }
        }
        if (spec.images)
          assert.equal(
            draft.loaded,
            spec.images,
            "Loaded catalogue cover count",
          );
        if (spec.context || !live) {
          assert.equal(
            draft.background,
            original.background,
            "Page-wide background",
          );
          assert.equal(
            draft.headerLabel,
            original.headerLabel,
            "Generated header label",
          );
          assert(
            draft.footerInContext,
            "Footer sits inside the imported page context",
          );
          assert.equal(
            draft.footerInContext,
            original.footerInContext,
            "Footer layout context",
          );
          assert.deepEqual(
            draft.banner,
            original.banner,
            "Generated header band",
          );
        }
        await Promise.all([exercise(source, spec), exercise(preview, spec)]);
        if (spec.key !== "books" && spec.key !== "cern")
          check.interactions = true;
      }
      if (spec.key === "cern") {
        const destination = job.pages.find(
          (page) => page.id !== home.id && page.done,
        );
        const link = preview
          .locator('a[href*="page_id=' + destination.id + '"]')
          .first();
        const target = new URL(await link.getAttribute("href"), origin);
        assert.equal((await preview.goto(target.href)).status(), 200);
        entry.internalLink = true;
      }
      if (spec.sidebar) {
        await preview.setViewportSize({ width: 1280, height: 820 });
        const entryLink = preview
          .locator('a[href$="#References"]:visible')
          .first();
        const href = new URL(
          await entryLink.getAttribute("href"),
          preview.url(),
        );
        assert.equal(href.origin, new URL(preview.url()).origin);
        assert.equal(href.hash, "#References");
        await preview
          .locator("#References")
          .first()
          .waitFor({ state: "attached" });
        await Promise.all([
          preview.waitForURL((url) => url.hash === "#References", {
            timeout: 7500,
          }),
          entryLink.click({ timeout: 7500 }),
        ]);
        await preview.waitForFunction(() => {
          const target = document.getElementById("References");
          if (!target) return false;
          const bounds = target.getBoundingClientRect();
          return bounds.bottom >= 0 && bounds.top <= innerHeight;
        });
        entry.referencesLink = true;
      }
      await editor.goto(home.edit_url, { waitUntil: "domcontentloaded" });
      const canvas = editor.frameLocator("#elementor-preview-iframe");
      const heading = canvas.locator(".elementor-widget-heading").first();
      await handleEditorPrompts(editor, heading);
      await heading.waitFor({ timeout: 45000 });
      await editor
        .locator("#elementor-loading")
        .waitFor({ state: "hidden", timeout: 45000 });
      if (!live) {
        const homeLink = canvas.locator("a.site-home");
        assert.equal(
          await homeLink.evaluate(
            (link) => getComputedStyle(link, "::before").content,
          ),
          '"Start"',
        );
        await heading.hover();
        const edit = heading.locator('[aria-label="Edit Heading"]');
        await ((await edit.count()) ? edit : heading).click({ timeout: 10000 });
        const title = editor
          .locator(".elementor-control-title textarea")
          .first();
        await title.fill("Verified native heading");
        await canvas
          .getByRole("heading", {
            name: "Verified native heading",
            exact: true,
          })
          .waitFor();
        await title.fill("Page context");
      }
      entry.editor = true;
      entry.exact = entry.viewports.every(
        (check) =>
          check.screenshotScope === "full page" &&
          check.pixels.differentPixels === 0,
      );
      if (!live)
        assert(
          entry.exact,
          "The stable fixture changed pixels. See the per-viewport screenshots.",
        );
    } catch (error) {
      entry.errors.push(error.message);
    } finally {
      await Promise.all([source.close(), preview.close(), editor.close()]);
    }
  }
} finally {
  await writeFile(
    join(output, "comparison.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
const failures = report.cases.filter((entry) => entry.errors.length);
for (const entry of report.cases) {
  console.log(
    JSON.stringify({
      site: entry.key,
      exact: entry.exact,
      viewports: entry.viewports.map(
        (viewport) => viewport.pixels.percentDifferent,
      ),
      errors: entry.errors.map((error) => error.split("\n")[0]),
    }),
  );
}
assert(
  !failures.length,
  "See the final comparison report for the failed checks.",
);
