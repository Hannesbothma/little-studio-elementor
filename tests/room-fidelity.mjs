import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { handleEditorPrompts } from "./editor-prompts.mjs";

const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9420";
const room = (key, size, border, buttonWidth, alignment) => ({
  key,
  slug: key,
  title: key,
  url: "https://room-fixture.example/" + key + "/",
  html: `<!doctype html><main>
    <div class="room-column">
      <h1>Room details</h1>
      <div data-id="440af33a" class="elementor-widget-icon-box elementor-position-inline-start">
        <div class="elementor-icon-box-wrapper">
          <div class="elementor-icon-box-icon"><span class="elementor-icon">
            <svg class="e-font-icon-svg e-fas-circle" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10"/></svg>
          </span></div>
          <div class="elementor-icon-box-content"><h2 class="elementor-icon-box-title"><span>Room label</span></h2></div>
        </div>
      </div>
      <div class="e-tabs-base" data-id="35f4a3b2">
        <div class="e-tabs-menu-base" role="tablist">
          <button role="tab" id="details-tab" aria-controls="details" aria-selected="true"><span>Description</span></button>
          <button role="tab" id="features-tab" aria-controls="features" aria-selected="false"><span>Features</span></button>
        </div>
        <div class="e-tabs-content-area-base">
          <div id="details" class="e-tab-content-base" role="tabpanel" aria-labelledby="details-tab"><p>Room description</p></div>
          <div id="features" class="e-tab-content-base" role="tabpanel" aria-labelledby="features-tab" hidden><p>Room amenities</p></div>
        </div>
      </div>
    </div>
  </main>`,
  css: `
    *{box-sizing:border-box}
    body{margin:0;font:16px/1.5 Arial,sans-serif}
    .room-column{display:flex;flex-direction:column;width:100%;padding:0 8%}
    h1{font:700 28px/1.1 Arial,sans-serif;margin:0}
    .elementor-icon-box-wrapper{display:flex;align-items:center;gap:8px}
    .elementor-icon{display:block;font-size:${size}px;line-height:1}
    .elementor-icon svg{display:block;width:1em;height:1em}
    .elementor-icon-box-title{font:400 18px/1.3 Arial,sans-serif;margin:0}
    .e-tabs-base{display:flex;flex-direction:column;gap:15px}
    .e-tabs-menu-base{display:flex;justify-content:${alignment};padding:0 10px}
    .e-tabs-menu-base button{display:block;width:${buttonWidth}px;padding:8px;
      font:16px/24px Arial,sans-serif;background:#fff;color:#292929;border:${border}px solid #8791a0}
    .e-tabs-menu-base button[aria-selected="true"]{border-color:#284667}
    .e-tabs-content-area-base{padding:0 10px}
    @media (min-width:1800px){h1{font-size:48px}}
    @media (max-width:767px){.elementor-icon{font-size:${size + 4}px}}
  `,
  js: "",
});

const fixtures = [
  {
    page: room("compact", 6, 2, 128, "flex-start"),
    size: 6,
    border: 2,
    width: 128,
    right: false,
  },
  {
    page: room("spacious", 22, 3, 152, "flex-end"),
    size: 22,
    border: 3,
    width: 152,
    right: true,
  },
];
const browser = await chromium.launch({
  executablePath: process.env.LSE_CHROMIUM || undefined,
});
try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const admin = await ctx.newPage();
  if (process.env.LSE_TEST_PASSWORD_FILE) {
    const password = (
      await readFile(process.env.LSE_TEST_PASSWORD_FILE, "utf8")
    ).trim();
    await admin.goto(origin + "/wp-login.php");
    await admin.locator("#user_login").fill(process.env.LSE_TEST_USER);
    await admin.locator("#user_pass").fill(password);
    await Promise.all([
      admin.waitForURL("**/wp-admin/**"),
      admin.locator("#wp-submit").click(),
    ]);
  }
  let edit;
  for (const order of [fixtures, fixtures.toReversed()]) {
    const project = {
      format: "little-studio-website",
      version: 1,
      site_id: "room-fidelity-" + randomUUID(),
      title: "Room fidelity fixture",
      site_css: "",
      fonts: [],
      assets: [],
      site: { home_key: order[0].page.key, navigation: [] },
      pages: order.map(({ page }) => page),
    };
    await admin.goto(
      origin + "/wp-admin/admin.php?page=little-studio-elementor",
    );
    await admin.locator("#lse-file").setInputFiles({
      name: "room-fidelity.website.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await admin.waitForFunction(
      () => window.LSEAdmin?.project && !LSEAdmin.busy,
    );
    await admin.evaluate(() => {
      void LSEAdmin.run();
    });
    await admin.waitForFunction(
      () => !LSEAdmin.busy || !document.getElementById("lse-error-item").hidden,
      null,
      { timeout: 60000 },
    );
    assert(
      await admin.locator("#lse-error-item").isHidden(),
      await admin.locator("#lse-error-item-location").textContent(),
    );

    const job = await admin.evaluate(() => LSEAdmin.job);
    assert.equal(
      job?.state,
      "ready",
      await admin.locator("#lse-status").innerText(),
    );
    assert.equal(job.pages.filter((page) => page.done).length, fixtures.length);
    assert(!job.scripts);
    const preview = await ctx.newPage();
    for (const fixture of order) {
      const saved = job.pages.find((page) => page.key === fixture.page.key);
      assert(saved?.preview_url, fixture.page.key);
      edit = saved.edit_url;
      await preview.goto(saved.preview_url);
      await preview.addStyleTag({
        content:
          "*,*::before,*::after{transition:none!important;animation:none!important}",
      });
      const icon = preview.locator(
        ".elementor-widget-icon-box .elementor-icon svg",
      );
      const menu = preview.locator(".e-n-tabs-heading");
      const description = menu.getByRole("tab", { name: "Description" });
      const features = menu.getByRole("tab", { name: "Features" });
      const heading = preview.getByRole("heading", { name: "Room details" });
      const text = preview.getByText("Room description", { exact: true });
      for (const width of [2048, 1440, 768, 390]) {
        await preview.setViewportSize({ width, height: 900 });
        const css = (locator, property) =>
          locator.evaluate(
            (el, property) => getComputedStyle(el).getPropertyValue(property),
            property,
          );
        const iconWidth = fixture.size + (width === 390 ? 4 : 0) + "px";
        await preview.waitForFunction((width) => {
          const icon = document.querySelector(
            ".elementor-widget-icon-box .elementor-icon svg",
          );
          return icon && getComputedStyle(icon).width === width;
        }, iconWidth);
        assert.equal(await css(description, "width"), fixture.width + "px");
        assert.equal(
          await css(description, "height"),
          40 + fixture.border * 2 + "px",
        );
        assert.equal(
          await css(description, "border-top-width"),
          fixture.border + "px",
        );
        assert.equal(
          await css(description, "border-top-color"),
          "rgb(40, 70, 103)",
        );
        assert.equal(
          await css(features, "border-top-color"),
          "rgb(135, 145, 160)",
        );
        assert.equal(
          (await css(menu, "justify-content")).replace(/^flex-/, ""),
          fixture.right ? "end" : "start",
        );
        assert.equal(
          await css(heading, "font-size"),
          (width >= 1800 ? 48 : 28) + "px",
        );
        assert(Math.abs((await heading.boundingBox()).x - width * 0.08) < 1);
        assert(
          Math.abs(
            (await text.boundingBox()).x - (await menu.boundingBox()).x - 10,
          ) < 1,
        );
        assert(
          await preview.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
      await features.click();
      await preview.getByText("Room amenities", { exact: true }).waitFor();
      assert.equal(await features.getAttribute("aria-selected"), "true");
      await description.focus();
      await description.press("Enter");
      await preview.getByText("Room description", { exact: true }).waitFor();
      assert.equal(await description.getAttribute("aria-selected"), "true");
    }
    await preview.close();
  }

  const editor = await ctx.newPage();
  await editor.goto(edit, { waitUntil: "domcontentloaded" });
  const frame = editor.frameLocator("#elementor-preview-iframe");
  const iconBox = frame.locator(".elementor-widget-icon-box");
  await handleEditorPrompts(editor, iconBox);
  await editor.locator("#elementor-loading").waitFor({ state: "hidden" });
  for (const [widget, control] of [
    [iconBox, "selected_icon"],
    [frame.locator(".elementor-widget-n-tabs"), "tabs"],
  ]) {
    const id = await widget.getAttribute("data-id");
    await editor.waitForFunction(
      (id) => !!window.elementor?.getContainer?.(id)?.view,
      id,
    );
    await editor.evaluate((id) => {
      const { model, view } = elementor.getContainer(id);
      return $e.run("panel/editor/open", { model, view });
    }, id);
    await editor.locator(".elementor-control-" + control).waitFor();
  }
  console.log(
    "Room fidelity passed in both import orders at four viewport widths.",
  );
} finally {
  await browser.close();
}
