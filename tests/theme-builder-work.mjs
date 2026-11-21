import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const tab = await context.newPage();
  await tab.goto(
    process.env.LSE_TEST_URL +
      "/wp-admin/admin.php?page=little-studio-elementor",
  );
  await tab.waitForFunction(() => LSEAdmin && !LSEManage.busy);
  const request = (action, data) =>
    tab.evaluate(
      ([op, payload]) => LSEAdmin.request(op, payload),
      [action, data],
    );
  assert.equal(await tab.evaluate(() => !!LSE_CONFIG.themeBuilder), true);
  const kinds = ["header", "footer"];
  const originals = await Promise.all(
    kinds.map((kind) =>
      request("test", { operation: "theme-builder-template", kind }),
    ),
  );
  await tab.locator("#lse-file").setInputFiles({
    name: "theme-builder-switch.html",
    mimeType: "text/html",
    buffer: Buffer.from(`<!doctype html>
<html><head><title>Theme Builder workflow</title></head><body>
<header><h2>Imported header test</h2></header>
<main><h1>Theme Builder workflow</h1>
<div class="elementor-widget-form" data-widget_type="form.default">
<form class="elementor-form" action="https://source.example/receiver" name="Enquiry form">
<label for="email">Email</label><input id="email" type="email" name="form_fields[email]" required>
<label for="message">Message</label><textarea name="form_fields[message]" id="message"></textarea>
<button type="submit">Send an enquiry</button>
</form></div>
</main><footer><h2>Imported footer test</h2></footer>
</body></html>`),
  });
  await tab.locator("#lse-flow-dialog[open] #lse-import").click();
  await tab.waitForFunction(
    () => LSEAdmin.job?.state === "ready" && !LSEAdmin.busy,
  );
  const job = await tab.evaluate(() => LSEAdmin.job);
  assert.equal(job.site_template_links.length, 2);
  assert.equal(
    job.site_template_links.every((part) => part.assign),
    true,
  );
  const conditions = (id) =>
    request("test", { operation: "theme-builder-conditions", id });
  const original = ["include/general", "exclude/singular/post/123"];
  const preview = await tab.context().newPage();
  await preview.goto(job.pages[0].preview_url);
  for (const [index, kind] of kinds.entries()) {
    const id = job.templates["site-" + kind].id;
    assert.deepEqual(await conditions(id), {
      status: "publish",
      type: kind,
      conditions: ["include/singular/page/" + job.pages[0].id],
    });
    await assert.rejects(
      request("theme_part", { job: job.id, kind, operation: "assign" }),
      /Confirm/,
    );
    tab.once("dialog", (dialog) => dialog.accept());
    await tab
      .getByRole("button", { name: "Use " + kind + " sitewide" })
      .click();
    await tab
      .getByRole("button", { name: "Restore previous " + kind })
      .waitFor();
    await preview.reload();
    assert.equal(
      await preview
        .getByRole("heading", { name: "Imported " + kind + " test" })
        .count(),
      1,
    );
    assert.deepEqual(await conditions(id), {
      status: "publish",
      conditions: ["include/general"],
      type: kind,
    });
    assert.deepEqual((await conditions(originals[index])).conditions, [
      "exclude/singular/post/123",
    ]);
    tab.once("dialog", (dialog) => dialog.accept());
    await tab.getByRole("button", { name: "Restore previous " + kind }).click();
    await tab
      .getByRole("button", { name: "Use " + kind + " sitewide" })
      .waitFor();
    assert.deepEqual(await conditions(id), {
      status: "publish",
      type: kind,
      conditions: ["include/singular/page/" + job.pages[0].id],
    });
    assert.deepEqual((await conditions(originals[index])).conditions, original);
  }
  await tab.goto(job.pages[0].preview_url);
  await tab.getByRole("heading", { name: "Theme Builder workflow" }).waitFor();
  const form = tab.locator(".elementor-widget-form form");
  await form.getByRole("textbox", { name: "Email" }).waitFor();
  await form.getByRole("textbox", { name: "Message" }).waitFor();
  await form.getByRole("button", { name: "Send an enquiry" }).waitFor();
  assert.equal(
    await form.evaluate((node) => node.getAttribute("action")),
    null,
  );
  console.log(
    "Verified separate Pro templates, reversible sitewide assignments, and an editable native contact form.",
  );
} finally {
  await browser.close();
}
