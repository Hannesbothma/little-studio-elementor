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
    const project = LSEConverter.validate({
      format: "little-studio-website",
      version: 1,
      site_id: "memory-check",
      title: "CSS cache memory regression",
      site_css: css,
      pages: ["one", "two", "three", "four"].map((key) => ({
        key,
        title: key,
        slug: key,
        url: "https://source.example/" + key + "/",
        html: "<main><h1>Native CSS cache check</h1><p>Styles stay intact.</p></main>",
        css: "",
        js: "",
      })),
      assets: [],
      fonts: [],
      site: { home_key: "one", navigation: [] },
    });
    window.memoryCheck = {
      project,
      resources: LSEConverter.resourceSession(project, {}),
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
      };
    }, i);
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
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
