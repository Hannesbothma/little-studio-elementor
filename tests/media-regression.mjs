import { chromium } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(
    (process.env.LSE_TEST_URL || "http://127.0.0.1:9420") +
      "/wp-admin/admin.php?page=little-studio-elementor",
  );
  await page.waitForFunction(
    () => window.LSEAdmin && window.LSEManage && !LSEManage.busy,
  );
  if (process.env.LSE_DEV_SYNC) {
    await page.evaluate(() => LSEAdmin.request("dev_sync", {}));
    await page.reload();
    await page.waitForFunction(() => window.LSEAdmin);
  }
  const rpc = (action, payload) =>
    page.evaluate(([a, p]) => LSEAdmin.request(a, p), [action, payload]);
  const ready = await page.evaluate(
    async (id) => {
      LSEAdmin.setJob(null);
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1000;
      const ctx = canvas.getContext("2d"),
        gradient = ctx.createLinearGradient(0, 0, 1600, 1000);
      gradient.addColorStop(0, "#347");
      gradient.addColorStop(1, "#f9a");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1600, 1000);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.95),
      );
      const job = await LSEAdmin.request("prepare", {
        fingerprint: id.repeat(2),
        site_id: id,
        title: "Image queue regression",
        pages: [
          {
            key: "home",
            title: "Image queue regression",
            slug: id,
            url: "https://source.example/",
          },
        ],
        layout: "elementor_canvas",
        scripts: false,
        site: { home_key: "home", navigation: [] },
      });
      const asset = await LSEAdmin.request(
        "asset",
        { job: job.id, url: "https://source.example/queue.jpg" },
        new File([blob, id], "queue.jpg", { type: "image/jpeg" }),
      );
      const held = await LSEAdmin.request("media_process", {
        job: job.id,
        attachment: asset.id,
      });
      if (held.processed !== 0 || held.media.pending !== 1)
        throw Error("Image processing competed with the active import");
      await LSEAdmin.request("page", {
        job: job.id,
        key: "home",
        elements: [
          {
            id: "abc01234",
            elType: "widget",
            widgetType: "image",
            settings: {
              image: { id: asset.id, url: asset.url },
              image_size: "full",
            },
            elements: [],
          },
        ],
        css: "",
        compact: true,
      });
      let ready;
      do {
        ready = await LSEAdmin.request("finish", { job: job.id });
      } while (ready.state === "finishing");
      return { job: ready, asset };
    },
    randomUUID().replaceAll("-", ""),
  );
  const { job, asset } = ready;
  assert.equal(job.state, "ready");
  assert.equal(job.media.pending, 1);
  let state = await rpc("test", { operation: "image-state", id: asset.id });
  assert.equal(Object.keys(state.meta.sizes || {}).length, 0);
  assert(Object.keys(state.task.sizes).length >= 3);
  await page.evaluate((job) => LSEAdmin.setJob(job), job);
  assert.match(
    await page.locator("#lse-media-summary").innerText(),
    /Pages ready.*remaining/,
  );
  // Freeze automatic worker while driving exactly one controlled operation at a time.
  await page.evaluate(() => LSEAdmin.setJob(null));
  await rpc("test", { operation: "image-failure", enabled: true });
  let response = await rpc("media_process", {
    job: job.id,
    attachment: asset.id,
  });
  assert.equal(response.media.pending, 1);
  assert.equal(response.media.errors[0].code, "image_size_failed");
  const failed = response.media.errors[0];
  assert.equal(failed.id, asset.id);
  assert(failed.skip?.token);
  await page.evaluate((job) => LSEAdmin.setJob(job), {
    ...job,
    media: response.media,
  });
  assert.equal(await page.locator("#lse-media-skip").isVisible(), true);
  assert.match(
    await page.locator("#lse-media-message").innerText(),
    new RegExp(failed.size),
  );
  const download = page.waitForEvent("download");
  await page.locator("#lse-media-details").click();
  const errorDownload = await download;
  const { readFile } = await import("node:fs/promises");
  const report = JSON.parse(await readFile(await errorDownload.path(), "utf8"));
  assert.equal(report.error.id, asset.id);
  assert.equal(report.error.size, failed.size);
  await page.locator("#lse-media-skip").click();
  await page.waitForFunction(() => LSEAdmin.job.media.skipped.length === 1);
  await page.evaluate(() => LSEAdmin.setJob(null));
  response = await rpc("status", { job: job.id });
  assert.equal(response.media.skipped.length, 1);
  assert.equal(response.media.skipped[0].size, failed.size);
  await assert.rejects(
    rpc("media_skip", {
      job: job.id,
      attachment: asset.id,
      size: failed.size,
      token: failed.skip.token,
    }),
    /changed/,
  );
  await assert.rejects(
    rpc("media_process", { job: job.id, attachment: asset.id + 100000 }),
    /does not belong/,
  );
  await rpc("test", { operation: "image-failure", enabled: false });
  await rpc("media_process", {
    job: job.id,
    retry: true,
    restore_skipped: true,
  });
  response = await rpc("status", { job: job.id });
  assert.equal(response.media.pending, 0);
  assert.equal(response.media.skipped.length, 0);
  state = await rpc("test", { operation: "image-state", id: asset.id });
  for (const name of Object.keys(state.task.sizes))
    assert(state.meta.sizes[name]);
  const completed = structuredClone(state.meta.sizes),
    size = Object.keys(completed)[0];
  await rpc("test", { operation: "image-partial", id: asset.id, size });
  await rpc("media_process", { job: job.id });
  state = await rpc("test", { operation: "image-state", id: asset.id });
  assert.deepEqual(
    state.meta.sizes,
    completed,
    "Resuming replaced completed image-size metadata",
  );
  assert(!(String(asset.id) in state.queue));
  console.log(
    JSON.stringify({
      imageQueue: true,
      originalsReadyBeforeSizes: true,
      preciseFailure: true,
      skipOneSize: true,
      staleSkipDenied: true,
      foreignImageDenied: true,
      retryRestoresSkipped: true,
      resumesExistingMetadata: true,
      sizes: Object.keys(completed),
    }),
  );
} finally {
  await browser.close();
}
