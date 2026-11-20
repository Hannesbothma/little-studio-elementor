import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route("http://recovery.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Import recovery</title>",
    }),
  );
  await page.goto("http://recovery.test/");
  await page.evaluate(() => {
    window.LSE_CONFIG = { ajax: "/wp-admin/admin-ajax.php", userId: 1 };
  });
  await page.addScriptTag({
    content: await readFile("assets/recovery.js", "utf8"),
  });
  const result = await page.evaluate(async () => {
    const stored = IDBObjectStore.prototype.put;
    let previousWriteFinished = true;
    let consecutiveCopies = 0;
    let writes = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (!previousWriteFinished) consecutiveCopies++;
      previousWriteFinished = false;
      writes++;
      queueMicrotask(() => {
        previousWriteFinished = true;
      });
      return stored.apply(this, args);
    };
    const source = {
      title: "Recovery test",
      pages: Array.from({ length: 104 }, (_, i) => ({ key: "page-" + i })),
      assets: Array.from({ length: 256 }, (_, i) => ({
        url: "https://image.test/" + i + ".png",
        data: "data:image/png;base64," + "A".repeat(262144) + i,
      })),
    };
    const options = { keys: ["page-3", "page-82"], background: true };
    const key = "saved-website";
    await LSERecovery.save(key, source, options);
    if (!(await LSERecovery.available(key)))
      throw Error("No saved recovery copy");
    const saved = await LSERecovery.load(key);
    if (
      saved.project.title !== source.title ||
      !source.pages.every(
        (record, index) => saved.project.pages[index].key === record.key,
      ) ||
      !source.assets.every(
        (record, index) => saved.project.assets[index].data === record.data,
      ) ||
      JSON.stringify(saved.options) !== JSON.stringify(options)
    )
      throw Error("The recovery copy lost data or import options");
    await LSERecovery.remove(key);
    if (await LSERecovery.available(key))
      throw Error("The recovery copy was not removed");
    return { writes, consecutiveCopies };
  });
  assert.deepEqual(result, { writes: 361, consecutiveCopies: 0 });
  console.log(
    "Verified an approximately 64 MiB recovery copy saves one record per browser turn and reopens intact.",
  );
} finally {
  await browser.close();
}
