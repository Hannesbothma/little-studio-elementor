import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  args: ["--js-flags=--max-old-space-size=192"],
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({
    content: await readFile("assets/converter.js", "utf8"),
  });
  await page.evaluate(() => {
    const css = Array.from(
      { length: 1400 },
      (_, i) =>
        ".tone-" +
        i +
        ":hover h2{color:rgb(" +
        (i % 255) +
        ",34,56);background:linear-gradient(90deg,#fff,#ddd);padding:8px;margin:4px}",
    ).join("\n");
    const media = Array.from({ length: 8 }, (_, index) => ({
      url: "https://source.example/image-" + index + ".png",
      name: "image-" + index + ".png",
      type: "image/png",
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=",
    }));
    const active = new Set();
    let allocated = 0;
    const createURL = URL.createObjectURL,
      revokeURL = URL.revokeObjectURL;
    URL.createObjectURL = (blob) => {
      const url = createURL.call(URL, blob);
      active.add(url);
      allocated++;
      return url;
    };
    URL.revokeObjectURL = (url) => {
      active.delete(url);
      revokeURL.call(URL, url);
    };
    const project = LSEConverter.validate({
      format: "little-studio-website",
      version: 1,
      site_id: "memory-check",
      title: "CSS cache memory regression",
      site_css: css,
      pages: ["one", "two", "three", "four"].map((key, index) => ({
        key,
        title: key,
        slug: key,
        url: "https://source.example/" + key + "/",
        html:
          '<main><h1>Native CSS cache check</h1><p>Styles stay intact.</p><img src="' +
          media[index].url +
          '" alt="Fixture"></main>',
        css: "",
        js: "",
      })),
      assets: media,
      fonts: [],
      site: { home_key: "one", navigation: [] },
    });
    window.memoryCheck = {
      project,
      resources: LSEConverter.resourceSession(project, {}),
      previews: () => ({ active: active.size, allocated }),
    };
  });
  const cdp = await page.context().newCDPSession(page),
    measurements = [];
  for (let i = 0; i < 4; i++) {
    const converted = await page.evaluate(async (i) => {
      const { project, resources } = memoryCheck,
        result = await LSEConverter.convert(project, project.pages[i], {
          preserveCSS: true,
          layout: "elementor_canvas",
          resources,
        });
      if (
        !result.css.includes(".tone-0:hover") ||
        !result.css.includes(".tone-1399:hover")
      )
        throw Error("CSS cache lost source rules");
      return {
        cssBytes: result.css.length,
        cachedRules: resources.styles.size,
        native: result.counts.native,
        previews: memoryCheck.previews(),
      };
    }, i);
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    assert.deepEqual(converted.previews, { active: 0, allocated: i + 1 });
    assert(
      heap.usedSize < 96 * 1024 * 1024,
      "CSS cache retains accumulated stylesheet copies",
    );
    assert(
      converted.cssBytes > 500000 &&
        converted.cachedRules >= 1400 &&
        converted.native > 0,
    );
    measurements.push({ ...converted, heapBytes: heap.usedSize });
  }
  await page.evaluate(() => {
    memoryCheck.resources.dispose();
    if (memoryCheck.resources.styles.size)
      throw Error("Conversion CSS cache was not released");
  });
  console.log(
    JSON.stringify({
      conversionMemoryRegression: true,
      pages: 4,
      rules: 1400,
      heapLimitMB: 192,
      measurements,
      cacheReleased: true,
    }),
  );
} finally {
  await browser.close();
}
