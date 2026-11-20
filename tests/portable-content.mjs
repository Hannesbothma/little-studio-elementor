import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9416";
const browser = await chromium.launch();
try {
  const tab = await browser.newPage();
  await tab.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor");
  await tab.waitForFunction(() => window.LSECapture && window.LSEReports);
  const site = "https://source.example";
  const image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=";
  const page = (url, html, requested = url) => ({
    kind: "page",
    type: "text/html",
    url,
    requested,
    data: Buffer.from(html).toString("base64"),
  });
  const asset = (name, type, data) => ({
    kind: "asset",
    type,
    url: site + "/" + name,
    requested: site + "/" + name,
    data,
  });
  const records = [
    page(
      site + "/bad%zz/",
      "<title>Malformed URL</title><main><p>Still present</p></main>",
    ),
    page(
      site + "/lodge/",
      `<meta NAME="ROBOTS" content="follow"><meta name="robots" content="none"><main>
      <h1>Guest Lodge</h1><a id="rooms"></a><a href="  #rooms  ">Room details</a>
      <figure><img alt="Pool" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-ll-src="/pool.png"><figcaption>Pool terrace</figcaption></figure>
      <a href="/tour/" target="_blank" rel="noopener nofollow"><img src="/pool.png" alt="Tour"></a>
      <picture><source media="(max-width:700px)" data-lazy-srcset="/pool.png 1x, /pool-large.png 2x"><img data-original-src="/pool.png" alt="Picture"></picture>
      <video src="/lodge.mp4" poster="/pool.png" controls muted loop preload="metadata"></video>
      <video src="/lodge.mp4" controls><track kind="captions" src="/en.vtt" srclang="en" label="English"></video>
      <a href="/policies.pdf#page=2">Policies</a>
      <input type="image" src="/pool.png" aria-label="Search">
      </main>`,
      site + "/",
    ),
    asset("pool.png", "image/png", image),
    asset("pool-large.png", "image/png", image),
    asset(
      "lodge.mp4",
      "video/mp4",
      Buffer.from("fixture media marker").toString("base64"),
    ),
    asset(
      "en.vtt",
      "text/plain",
      Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nWelcome").toString(
        "base64",
      ),
    ),
    asset(
      "policies.pdf",
      "application/octet-stream",
      Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
    ),
  ];
  const result = await tab.evaluate(
    async ({ site, records }) => {
      const project = await LSECapture.packageWebsite(site + "/", records);
      const source = project.pages[0];
      const document = new DOMParser().parseFromString(
        source.html,
        "text/html",
      );
      const current = await LSEConverter.convert(project, source, {
        preserveCSS: true,
      });
      const flattened = (items) =>
        items.flatMap((item) => [item, ...flattened(item.elements || [])]);
      const tree = flattened(current.elements);
      const caption = tree.find(
        (item) => item.widgetType === "image" && item.settings.caption,
      );
      const video = tree.find((item) => item.widgetType === "video");
      const linked = tree.find(
        (item) => item.widgetType === "image" && item.settings.link,
      );
      const report = LSEReports.journal(LSE_CONFIG, async () => ({
        recorded: [],
      })).report(
        {
          state: "ready",
          title: "Fixture",
          pages: [{ key: "lodge", title: "Guest Lodge", skipped: true }],
          skipped_assets: { x: { name: "gate.jpg", reason: "Rejected" } },
          reports: { lodge: { warnings: ["Needs a review"] } },
          capture: {
            warnings: ["Could not package " + site + "/unavailable/: HTTP 404"],
            failed_resources: [
              { url: site + "/unavailable/", kind: "page", status: 404 },
            ],
          },
        },
        null,
        "",
      );
      return {
        title: source.title,
        home: project.site.home_key === source.key,
        missingSlug: project.pages[1].slug,
        indexing: source.seo.indexing,
        image: caption?.settings,
        video: video?.settings,
        linked: linked?.settings.link,
        bookmark: tree.find((item) => item.settings._element_id === "rooms")
          ?.elType,
        fragment: document.querySelector('a[href="#rooms"]')?.textContent,
        sources: document
          .querySelector("picture source")
          .getAttribute("srcset"),
        input: document.querySelector("input").getAttribute("src"),
        track: tree.some(
          (item) =>
            item.widgetType === "html" && /<track/.test(item.settings.html),
        ),
        assetURLs: project.assets.map(({ type, url }) => [type, url]),
        policy: document
          .querySelector('a[href*="pdf#page"]')
          .getAttribute("href"),
        report,
      };
    },
    { site, records },
  );
  assert.equal(result.title, "Guest Lodge");
  assert(result.home);
  assert.equal(result.missingSlug, "bad-zz");
  assert.equal(result.indexing, "noindex");
  assert.equal(result.image.caption_source, "custom");
  assert.equal(result.image.caption, "Pool terrace");
  assert.equal(result.image.lse_image_alt, "Pool");
  assert.equal(result.linked.is_external, "on");
  assert.equal(result.linked.nofollow, "on");
  assert.equal(result.bookmark, "container");
  assert.equal(result.fragment, "Room details");
  assert.match(result.sources, /1x, .+ 2x/);
  assert(result.input.startsWith("https://little-studio-assets.invalid/"));
  assert.equal(result.video.video_type, "hosted");
  assert.equal(result.video.controls, "yes");
  assert.equal(result.video.mute, "yes");
  assert.equal(result.video.loop, "yes");
  assert.equal(result.video.preload, "metadata");
  assert(
    result.video.poster.url.startsWith("https://little-studio-assets.invalid/"),
  );
  assert(result.track);
  assert(
    result.assetURLs.some(
      ([type, url]) => type === "text/vtt" && url.endsWith(".vtt"),
    ),
  );
  const pdf = result.assetURLs.find(([type]) => type === "application/pdf")[1];
  assert.equal(result.policy, pdf + "#page=2");
  assert.match(result.report, /Skipped 1 page\(s\) \| 1 file\(s\)/);
  assert.match(result.report, /Guest Lodge · Needs a review/);
  assert.equal((result.report.match(/HTTP 404/g) || []).length, 1);
  const slide = await tab.evaluate(async () => {
    const source = LSEConverter.fromHTML(
      "<style>.swiper-slide{height:600px}.swiper-slide-bg{background-position:25% 75%;background-image:url(https://source.example/home.jpg)}@media(max-width:767px){.swiper-slide-bg{background-position:70% 20%}}</style>" +
        '<section><div data-widget_type="slides.default"><div class="elementor-slides-wrapper"><div class="swiper-wrapper"><div class="swiper-slide elementor-repeater-item-1234567"><div class="swiper-slide-bg"></div><div class="swiper-slide-inner"><div class="swiper-slide-contents"><div class="elementor-slide-heading">Featured room</div></div></div></div></div><div class="swiper-pagination"></div></div></div></section>',
      "hero.html",
    );
    LSE_CONFIG.widgets.push("slides");
    try {
      const result = await LSEConverter.convert(source, source.pages[0], {
        preserveCSS: true,
      });
      const all = (items) =>
        items.flatMap((item) => [item, ...all(item.elements || [])]);
      const widget = all(result.elements).find(
        (item) => item.widgetType === "slides",
      );
      return { navigation: widget?.settings.navigation, css: result.css };
    } finally {
      LSE_CONFIG.widgets.pop();
    }
  });
  assert.equal(slide.navigation, "dots");
  assert.match(
    slide.css,
    /elementor-repeater-item-1234567 \.swiper-slide-bg\{background-position:25% 75%\}/,
  );
  assert.match(
    slide.css,
    /@media\(max-width:767px\)\{[^{}]*elementor-repeater-item-1234567 \.swiper-slide-bg\{background-position:70% 20%\}/,
  );
  console.log(
    "Verified portable capture and editable native media controls, with deduplicated and named reports.",
  );
} finally {
  await browser.close();
}
