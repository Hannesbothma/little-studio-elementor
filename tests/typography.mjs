import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({
  atob: (value) => Buffer.from(value, "base64").toString("binary"),
  btoa: (value) => Buffer.from(value, "binary").toString("base64"),
});
vm.runInContext(await readFile("assets/converter.js", "utf8"), context);
const stack = (value) =>
  JSON.parse(JSON.stringify(context.LSEConverter.fontStack(value)));
assert.deepEqual(stack('Georgia, "Times New Roman", serif'), {
  family: "Georgia",
  fallbacks: '"Times New Roman", serif',
});
assert.deepEqual(stack('"Foundry, Serif", Georgia, serif'), {
  family: "Foundry, Serif",
  fallbacks: "Georgia, serif",
});
assert.deepEqual(stack("'Open Sans', Arial, sans-serif"), {
  family: "Open Sans",
  fallbacks: "Arial, sans-serif",
});
assert.deepEqual(stack('"A\\"B", serif'), {
  family: 'A"B',
  fallbacks: "serif",
});
assert.deepEqual(stack("sans-serif"), { family: "sans-serif", fallbacks: "" });
console.log("Font stack regression checks passed.");

const kind = context.LSEConverter.sourceScriptKind;
assert.equal(
  kind({ id: "lsa-tracker-js-before", code: "window.LSA_CONFIG={}" }),
  "analytics",
);
assert.equal(
  kind({ src: "https://www.googletagmanager.com/gtag/js?id=test" }),
  "analytics",
);
assert.equal(
  kind({ type: "module", code: 'const e="script#wp-emoji-settings";' }),
  "framework",
);
assert.equal(
  kind({
    src: "https://source.test/wp-content/plugins/elementor/assets/js/frontend.min.js",
  }),
  "framework",
);
assert.equal(kind({ type: "module", code: "import './store.js';" }), "module");
assert.equal(
  kind({ type: "application/ld+json", code: '{"@type":"Product"}' }),
  "data",
);
assert.equal(
  kind({
    id: "code-canvas-js",
    code: "document.querySelector('button').addEventListener('click',openDialog);",
  }),
  "script",
);
assert.equal(
  kind({ src: "https://source.test/page-interactions.js" }),
  "script",
);
console.log("Source script classification checks passed.");

const svg =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10"/></svg>',
  ).toString("base64");
const embedded = context.LSEConverter.validate({
  format: "code-canvas",
  version: 1,
  title: "Embedded SVG",
  html: `<img src="${svg}">`,
  css: "",
  js: "",
  assets: [],
  fonts: [],
});
assert.equal(embedded.assets.length, 1);
assert.equal(embedded.assets[0].type, "image/svg+xml");
assert.ok(embedded.pages[0].html.includes(embedded.assets[0].url));
assert.ok(!embedded.pages[0].html.includes("data:image/svg+xml"));
console.log("Embedded SVG packaging regression passed.");
