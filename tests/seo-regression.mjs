import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = process.cwd(),
  origin = "http://127.0.0.1:9417";
const version = (await readFile("little-studio-elementor.php", "utf8")).match(
  /Version:\s*(\d+\.\d+\.\d+)/,
)[1];
const providers = {
  yoast: { slug: "wordpress-seo", version: "28.8" },
  rankmath: { slug: "seo-by-rank-math", version: "1.0.282" },
  aioseo: { slug: "all-in-one-seo-pack", version: "5.0.5" },
};
const blueprint = {
  landingPage: "/wp-admin/admin.php?page=little-studio-elementor",
  login: true,
  steps: [
    {
      step: "installPlugin",
      pluginData: {
        resource: "url",
        url: "https://downloads.wordpress.org/plugin/elementor.4.4.0.zip",
      },
      options: { activate: true },
    },
    {
      step: "installPlugin",
      pluginData: {
        resource: "vfs",
        path: "/packages/little-studio-elementor-" + version + ".zip",
      },
      options: { activate: true },
    },
    ...Object.values(providers).map(({ slug, version }) => ({
      step: "installPlugin",
      pluginData: {
        resource: "url",
        url:
          "https://downloads.wordpress.org/plugin/" +
          slug +
          "." +
          version +
          ".zip",
      },
      options: { activate: false },
    })),
    {
      step: "runPHP",
      code: "<?php require '/wordpress/wp-load.php'; update_option('blog_public',1); update_option('elementor_onboarded',true); if(!is_dir('/wordpress/wp-content/mu-plugins'))mkdir('/wordpress/wp-content/mu-plugins',0777,true); copy('/tests/seo-fixture.php','/wordpress/wp-content/mu-plugins/lse-seo-tests.php');",
    },
  ],
};
await mkdir("tests/results", { recursive: true });
await writeFile("tests/results/seo-blueprint.json", JSON.stringify(blueprint));
const uploads = await mkdtemp(join(tmpdir(), "lse-seo-uploads-"));
const server = spawn(
  process.execPath,
  [
    "node_modules/@wp-playground/cli/cli.js",
    "server",
    "--mount-before-install=" + uploads + ":/wordpress/wp-content/uploads",
    "--mount=" + root + "/tests:/tests",
    "--mount=" + root + "/dist:/packages",
    "--blueprint=tests/results/seo-blueprint.json",
    "--port=9417",
    "--workers=1",
    "--php=8.3",
    "--wp=7.1.4",
    "--php-ini",
    "memory_limit",
    "1024M",
    "--define-bool",
    "DISABLE_WP_CRON",
    "true",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let browser;
try {
  await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(
      () => reject(Error("SEO test startup timed out")),
      180000,
    );
    server.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      text += chunk;
      if (text.includes("Ready!")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error("SEO test server exited " + code));
    });
  });
  browser = await chromium.launch({ headless: true });
  const admin = await browser.newPage();
  await admin.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor");
  await admin.waitForFunction(() => LSEAdmin);
  const rpc = (action, input) =>
    admin.evaluate(
      ([action, input]) => LSEAdmin.request(action, input),
      [action, input],
    );
  const view = await browser.newPage();
  const results = {};
  for (const provider of process.env.LSE_SEO_PROVIDERS?.split(",") ||
    Object.keys(providers)) {
    await rpc("seo_test", { operation: "provider", provider });
    const nonce = randomUUID(),
      pages = ["hidden", "visible"].map((key) => ({
        key,
        title: "SEO regression " + provider + " " + key,
        slug: "seo-" + provider + "-" + key,
        url: "https://source.example/" + key + "/",
        parent_key: "",
      }));
    const job = await rpc("start", {
      fingerprint: createHash("sha256").update(nonce).digest("hex"),
      site_id: "seo-" + nonce,
      title: "SEO regression " + provider,
      pages,
      site: { home_key: "visible", navigation: [] },
    });
    const social = await admin.evaluate(async (job) => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#345678";
      ctx.fillRect(0, 0, 400, 400);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      return LSEAdmin.request(
        "asset",
        { job, url: "https://source.example/social.png" },
        new File([blob], "seo-social.png", { type: "image/png" }),
      );
    }, job.id);
    for (const page of pages) {
      await rpc("page", {
        job: job.id,
        key: page.key,
        elements: [
          {
            id: "aabbccdd",
            elType: "widget",
            widgetType: "heading",
            settings: { title: "SEO content" },
            elements: [],
          },
        ],
        css: "",
        source: { html: "<h1>SEO content</h1>", css: "", js: "" },
        seo: {
          title: "Imported SEO title",
          description: "Imported SEO description",
          canonical: page.url,
          indexing: page.key === "hidden" ? "noindex" : "default",
          social_title: "Imported social title",
          social_description: "Imported social description",
          social_image: "https://source.example/social.png",
        },
      });
    }
    await rpc("finish", { job: job.id });
    const urls = [];
    for (const page of job.pages)
      urls.push(
        (await rpc("seo_test", { operation: "publish", id: page.id })).url,
      );
    await view.goto(urls[0], { waitUntil: "domcontentloaded" });
    const robots = await view
      .locator('meta[name="robots"]')
      .evaluateAll((nodes) => nodes.map((n) => n.content).join(","));
    assert.match(robots, /noindex/, provider + " lost source noindex");
    await view.goto(urls[1], { waitUntil: "domcontentloaded" });
    const visible = await view.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content,
      canonical: [...document.querySelectorAll('link[rel="canonical"]')].map(
        (n) => n.href,
      ),
      socialTitle: document.querySelector('meta[property="og:title"]')?.content,
      socialImage: document.querySelector('meta[property="og:image"]')?.content,
      robots: [...document.querySelectorAll('meta[name="robots"]')]
        .map((n) => n.content)
        .join(","),
    }));
    assert.equal(visible.title, "Imported SEO title", provider + " title");
    assert.equal(
      visible.description,
      "Imported SEO description",
      provider + " description",
    );
    assert.equal(
      visible.canonical.length,
      1,
      provider + " duplicated/missing canonical",
    );
    assert.match(visible.canonical[0], /^http:\/\/127\.0\.0\.1:9417\//);
    assert.equal(
      visible.socialTitle,
      "Imported social title",
      provider + " social title",
    );
    assert.equal(visible.socialImage, social.url, provider + " social image");
    assert(
      !visible.robots.includes("noindex"),
      provider + " forced noindex on a normal page",
    );
    const current = await rpc("status", { job: job.id });
    await rpc("remove_import", {
      job: job.id,
      consent: true,
      expected_stamps: Object.fromEntries(
        current.pages.map((p) => [p.key, p.current_stamp]),
      ),
    });
    results[provider] = {
      version: providers[provider].version,
      noindex: true,
      canonical: true,
      title: true,
      description: true,
      social: true,
    };
    console.log(
      JSON.stringify({ seoProvider: provider, ...results[provider] }),
    );
  }
  await rpc("seo_test", { operation: "provider", provider: "none" });
  await writeFile(
    "tests/results/seo-regression.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", resolve),
  );
  await rm(uploads, { recursive: true, force: true });
}
