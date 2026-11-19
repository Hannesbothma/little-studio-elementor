import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const origin = process.env.LSE_TEST_URL || "http://127.0.0.1:9434";
const pages = [
  "home",
  "rooms",
  "standard",
  "family",
  "executive",
  "self-catering",
].map((key, i) => ({
  key,
  title: key,
  slug: key,
  url: "https://source.example/" + key + "/",
  parent_key: "",
  html: "",
  css: "",
  js: "",
  elementor: {
    title: key,
    type: "page",
    version: "0.4",
    page_settings: {},
    content: [
      {
        id: (0xabc0000 + i).toString(16),
        elType: "widget",
        widgetType: "heading",
        settings: { title: key },
        elements: [],
      },
    ],
  },
}));
const item = (key) => ({
  key,
  label: key,
  url: pages.find((p) => p.key === key).url,
});
const project = {
  format: "little-studio-website",
  version: 1,
  site_id: "navigation-fixture",
  title: "Nested navigation regression",
  site_css: "",
  fonts: [],
  assets: [],
  pages,
  site: {
    home_key: "home",
    navigation: [
      item("home"),
      { ...item("rooms"), children: pages.slice(2).map((p) => item(p.key)) },
      {
        label: "Book Now",
        url: "https://booking.example/reserve/",
        external: true,
      },
    ],
  },
};
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  await page.goto(origin + "/wp-admin/admin.php?page=little-studio-elementor", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => window.LSEAdmin && window.LSEManage && !LSEManage.busy,
  );
  const rpc = (a, x) =>
    page.evaluate(([a, x]) => LSEAdmin.request(a, x), [a, x]);
  const choose = async (data) => {
    await page.locator("#lse-file").setInputFiles({
      name: "navigation.website.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
    await page.waitForFunction(() => !LSEAdmin.busy);
    assert(
      await page.evaluate(() => !!LSEAdmin.project),
      await page.locator("#lse-status").innerText(),
    );
  };
  await choose(project);
  await page.evaluate(() => LSEAdmin.run());
  const job = await page.evaluate(() => LSEAdmin.job);
  assert.equal(
    job.state,
    "ready",
    await page.locator("#lse-status").innerText(),
  );
  const menu = await rpc("test", { operation: "navigation", job: job.id });
  assert.equal(menu.items.length, 7);
  assert.equal(menu.binding, String(menu.menu));
  const rooms = menu.items.find((n) => n.title === "rooms");
  assert.equal(menu.items.filter((n) => n.parent === rooms.id).length, 4);
  for (const p of job.pages) {
    const entry = menu.items.find((n) => n.title === p.key);
    assert.equal(entry.object, p.id);
    assert.equal(entry.type, "post_type");
  }
  const book = menu.items.find((n) => n.title === "Book Now");
  assert.equal(book.url, "https://booking.example/reserve/");
  assert.equal(book.target, "_blank");
  assert.match(menu.html, /menu-item-has-children/);
  assert.match(menu.html, /sub-menu/);
  const recovery = await rpc("test", {
    operation: "navigation-recovery",
    job: job.id,
    expected_items: menu.items,
  });
  Object.assign(
    recovery,
    await rpc("test", {
      operation: "navigation-journals",
      job: job.id,
      expected_items: menu.items,
    }),
  );
  // Importing only Home retains the source URLs for the unselected room pages.
  await page.evaluate(() => document.querySelector("#lse-reset").click());
  await choose(project);
  await page.locator("[data-page-key]:checked").evaluateAll((nodes) => {
    for (const n of nodes) {
      if (n.dataset.pageKey !== "home") {
        n.checked = false;
        n.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  });
  await page.evaluate(() => LSEAdmin.run());
  const subset = await page.evaluate(() => LSEAdmin.job);
  assert.equal(subset.state, "ready");
  assert.equal(subset.pages.length, 1);
  const subsetMenu = await rpc("test", {
    operation: "navigation",
    job: subset.id,
  });
  assert.equal(subsetMenu.items.length, 7);
  const subsetRooms = subsetMenu.items.find((n) => n.title === "rooms");
  assert.equal(subsetRooms.type, "custom");
  assert.equal(subsetRooms.url, "https://source.example/rooms/");
  assert.equal(
    subsetMenu.items.filter((n) => n.parent === subsetRooms.id).length,
    4,
  );
  const bad = structuredClone(project);
  bad.site.navigation[1].children[0].url = "javascript:alert(1)";
  await assert.rejects(
    rpc("start", {
      fingerprint: "a".repeat(64),
      title: "Rejected unsafe navigation",
      pages: pages.map(({ key, title, slug, url, parent_key }) => ({
        key,
        title,
        slug,
        url,
        parent_key,
      })),
      site: bad.site,
    }),
    /unsafe URL/i,
  );
  await page.evaluate(() => document.querySelector("#lse-reset").click());
  await page.locator("#lse-file").setInputFiles({
    name: "unsafe.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await page.waitForFunction(() => !LSEAdmin.busy);
  assert.equal(await page.evaluate(() => LSEAdmin.project), null);
  const result = {
    nestedWordPressMenu: true,
    fourRoomChildren: true,
    localPageDestinations: true,
    externalBookingTarget: true,
    nativeMenuBinding: true,
    subsetSourceLinksRetained: true,
    unsafeNestedLinkRejected: true,
    ...recovery,
    proRuntimeVerified: false,
  };
  await writeFile(
    "tests/results/navigation.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
