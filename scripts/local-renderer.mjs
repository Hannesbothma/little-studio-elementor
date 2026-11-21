import { chromium } from "playwright";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const site = new URL(process.argv[2]);
if (
  site.username ||
  site.password ||
  site.search ||
  site.hash ||
  (site.protocol !== "https:" &&
    !(
      site.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname)
    ))
)
  throw Error(
    "Use an HTTPS WordPress installation URL or a local loopback address.",
  );
const admin = new URL(
  "wp-admin/admin.php?page=little-studio-elementor&lse-renderer=1",
  site.href.replace(/\/$/, "") + "/",
).href;
const signin = process.argv.includes("--login");
const profile = join(
  process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
  "ls-elementor",
  createHash("sha256").update(admin).digest("hex").slice(0, 20),
);
await mkdir(profile, { recursive: true, mode: 0o700 });
await chmod(profile, 0o700);
const browser = await chromium.launchPersistentContext(profile, {
  headless: !signin,
  acceptDownloads: false,
});
const controller = browser.pages()[0] || (await browser.newPage());
let worker;
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    stopping = true;
    void browser.close();
  });
const request = (input) =>
  controller.evaluate((data) => window.LSEAdmin.request("renderer", data), {
    ...input,
    worker,
  });
async function connect() {
  await controller.goto(admin, { waitUntil: "domcontentloaded" });
  worker = await controller.evaluate((id) => {
    const key = "lse-renderer-worker";
    if (!localStorage.getItem(key)) localStorage.setItem(key, id);
    return localStorage.getItem(key);
  }, randomUUID());
  if (signin) {
    console.log(
      "Sign in to WordPress. Keep Remember Me selected to pair this browser.",
    );
    const remember = controller.locator(
      'form#loginform input[name="rememberme"]',
    );
    if (await remember.isVisible()) await remember.check();
  }
  await controller.waitForFunction(
    () => !!window.LSEAdmin?.importReport,
    null,
    { timeout: signin ? 600000 : 12000 },
  );
}
const requestJob = (id) =>
  controller.evaluate(
    (id) => window.LSEAdmin.request("status", { job: id }),
    id,
  );
async function processTask(task) {
  const tab = await browser.newPage();
  let job = "",
    started = false,
    report = "";
  try {
    const workUrl = new URL(admin);
    workUrl.searchParams.set("lse-render-task", task.id);
    await tab.goto(workUrl.href, { waitUntil: "domcontentloaded" });
    if (task.resume && task.job) {
      const saved = await requestJob(task.job);
      job = task.job;
      if (saved.state === "ready" || saved.background?.phase) {
        await request({
          operation: "update",
          id: task.id,
          job,
          state: "submitted",
          message: "Drafts are queued in WordPress.",
        });
        return;
      }
      if (
        await tab.evaluate(
          (id) => window.LSERecovery.load(id).then(Boolean),
          job,
        )
      ) {
        started = true;
        await tab.evaluate((id) => {
          void window.LSEAdmin.resumeImport(id).catch((e) => {
            window.lseRendererFailure = e.message;
          });
        }, job);
      }
    }
    if (!started) {
      await tab.locator("[data-export-open]").first().click();
      await tab.locator("#lse-capture-url").fill(task.url);
      const resume =
        task.resume &&
        (await tab.evaluate(
          (url) => window.LSECapture.hasCheckpoint(url),
          task.url,
        ));
      await tab
        .locator(resume ? "#lse-capture-resume" : "#lse-capture-start")
        .click();
    }
    while (!stopping) {
      const state = await tab.evaluate(() => {
        const a = window.LSEAdmin,
          cap = window.LSECapture;
        const visible = (id) =>
          !!document.getElementById(id)?.getClientRects().length;
        const text = (id) =>
          document.getElementById(id)?.textContent.trim() || "";
        const scanning = document.getElementById("lse-capture-dialog").open;
        const choices = scanning
          ? ["lse-capture-skip", "lse-capture-retry"]
          : ["lse-skip-item", "lse-retry"];
        return {
          fatal: window.lseRendererFailure,
          item: scanning
            ? text("lse-capture-status")
            : text("lse-error-item") + " " + text("lse-current"),
          scanning,
          scanBusy: cap.busy,
          busy: a.busy,
          ready: !!a.project,
          job: a.job?.id,
          phase: a.job?.background?.phase,
          saved: a.job?.state === "ready",
          message: scanning
            ? text("lse-capture-status")
            : text("lse-current") || text("lse-status"),
          skip: visible(choices[0]) ? choices[0] : "",
          retry: visible(choices[1]) ? choices[1] : "",
          reviewed: visible("lse-import-background"),
          failure: !scanning && !a.busy && visible("lse-error-item"),
        };
      });
      if (state.fatal) throw Error(state.fatal);
      if (state.reviewed && state.ready && !started) {
        // Remote source scripts and replace-existing imports require a separate review.
        await tab
          .locator("#lse-scripts")
          .evaluate((input) => (input.checked = false));
        await tab.locator("#lse-import-background").click();
        started = true;
        continue;
      }
      if (started && state.job) job = state.job;
      if (started && !state.busy && (state.phase || state.saved) && job) {
        await request({
          operation: "update",
          id: task.id,
          job,
          state: "submitted",
          message: "Drafts are queued in WordPress.",
          report: await tab.evaluate(() => LSEAdmin.importReport()),
        });
        return;
      }
      const choices = [
        ...(state.skip ? ["skip"] : []),
        ...(state.retry ? ["retry"] : []),
      ];
      if (
        !choices.length &&
        ((state.scanning && !state.scanBusy) ||
          state.failure ||
          (started && !state.busy && !state.saved && !state.phase))
      )
        throw Error(
          state.message || "The import stopped before it was queued.",
        );
      if (choices.length)
        report = await tab.evaluate(() => LSEAdmin.importReport());
      const reply = await request({
        operation: "update",
        id: task.id,
        job,
        state: choices.length ? "waiting" : "working",
        choices,
        item: state.item,
        message: state.message || "Preparing the import.",
        report,
      });
      if (choices.includes(reply.command))
        await tab.locator("#" + state[reply.command]).click();
      await sleep(2500);
    }
  } catch (e) {
    if (!stopping)
      await request({
        operation: "update",
        id: task.id,
        job,
        state: "failed",
        message: e.message.slice(0, 450),
        report:
          report ||
          (await tab
            .evaluate(() => window.LSEAdmin?.importReport())
            .catch(() => "")),
      }).catch(() => {});
  } finally {
    await tab.close().catch(() => {});
  }
}
try {
  await connect();
  if (signin) {
    const cookies = await browser.cookies(admin);
    if (
      !cookies.some(
        (c) =>
          c.name.startsWith("wordpress_logged_in_") &&
          c.expires > Date.now() / 1000,
      )
    )
      throw Error(
        "Pairing requires a persistent WordPress sign-in. Sign in with Remember Me selected.",
      );
    console.log("Local renderer signed in.");
  } else {
    console.log("Waiting for background imports from " + site.origin);
    while (!stopping) {
      try {
        const { task } = await request({ operation: "claim" });
        if (task) await processTask(task);
        else await sleep(8000);
      } catch (e) {
        if (stopping) break;
        console.error("Renderer connection interrupted. Reconnecting.");
        await sleep(10000);
        await connect().catch(() => {});
      }
    }
  }
} finally {
  await browser.close().catch(() => {});
}
