import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = process.cwd();
const port = process.env.LSE_TEST_PORT || "9416";
const blueprintPath = "tests/results/blueprint-" + port + ".json";
const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(command + " exited " + code)),
    );
  });
await run(process.execPath, ["tests/rewrite-regression.mjs"]);
await run(process.execPath, ["scripts/package.mjs", ".", "dist"]);
const version = (await readFile("little-studio-elementor.php", "utf8")).match(
  /Version:\s*(\d+\.\d+\.\d+)/,
)[1];
const scratch = await mkdtemp(join(tmpdir(), "lse-update-fixture-"));
try {
  for (const name of [
    "assets",
    "includes",
    "little-studio-elementor.php",
    "readme.txt",
    "LICENSE.txt",
  ])
    await cp(name, join(scratch, name), { recursive: true });
  const file = join(scratch, "little-studio-elementor.php");
  const text = await readFile(file, "utf8");
  const next = version.split(".");
  next[2] = String(Number(next[2]) + 1);
  const nextVersion = next.join(".");
  await writeFile(file, text.replaceAll(version, nextVersion));
  await run(
    process.execPath,
    ["scripts/package.mjs", scratch, "dist/update-fixture"],
    {
      env: {
        ...process.env,
        RELEASE_TAG: "v" + nextVersion,
        GITHUB_REF_TYPE: "branch",
      },
    },
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
const blueprint = JSON.parse(await readFile("tests/blueprint.json", "utf8"));
blueprint.preferredVersions = {
  php: process.env.LSE_TEST_PHP || "8.3",
  wp: process.env.LSE_TEST_WORDPRESS || "7.1.4",
};
blueprint.steps[0].pluginData = {
  resource: "url",
  url:
    "https://downloads.wordpress.org/plugin/elementor." +
    (process.env.LSE_TEST_ELEMENTOR || "4.4.0") +
    ".zip",
};
blueprint.steps = blueprint.steps.map((step) =>
  step.step === "activatePlugin"
    ? {
        step: "installPlugin",
        pluginData: {
          resource: "vfs",
          path: "/packages/little-studio-elementor-" + version + ".zip",
        },
        options: { activate: true },
      }
    : step,
);
await mkdir("tests/results", { recursive: true });
await writeFile(blueprintPath, JSON.stringify(blueprint));
// Use one PHP worker and shared uploads for deterministic CSS regeneration.
// Playground worker-local VFS deletion propagation can lose recreated files.
const uploads = await mkdtemp(join(tmpdir(), "lse-wp-uploads-"));
const args = [
  "node_modules/@wp-playground/cli/cli.js",
  "server",
  "--mount-before-install=" + uploads + ":/wordpress/wp-content/uploads",
  "--mount=" + root + "/tests:/tests",
  "--mount=" + root + "/dist:/packages",
  "--blueprint=" + blueprintPath,
  "--port=" + port,
  "--workers=1",
  "--php=" + blueprint.preferredVersions.php,
  "--wp=" + blueprint.preferredVersions.wp,
  "--php-ini",
  "memory_limit",
  "1024M",
  "--php-ini",
  "upload_max_filesize",
  "64M",
  "--php-ini",
  "post_max_size",
  "64M",
  "--define-bool",
  "DISABLE_WP_CRON",
  "true",
];
const server = spawn(process.execPath, args, {
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(Error("Playground startup timed out")),
      180000,
    );
    server.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += chunk;
      if (output.includes("Ready!")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error("Playground exited " + code));
    });
  });
  const selected = process.env.LSE_TEST_ONLY?.split(",");
  for (const name of [
    "fidelity-regression",
    "audit-regression",
    "shared-context",
    "css-regression",
    "large-import",
    "resources",
    "integration",
  ]) {
    if (selected && !selected.includes(name)) continue;
    await run(process.execPath, ["tests/" + name + ".mjs"], {
      env: {
        ...process.env,
        LSE_TEST_URL: "http://127.0.0.1:" + port,
        ...(name === "integration" ? { LSE_TEST_UPDATER: "1" } : {}),
      },
    });
  }
  if (process.env.LSE_BENCH_BASELINE)
    await run(process.execPath, ["tests/performance.mjs"], {
      env: { ...process.env, LSE_TEST_URL: "http://127.0.0.1:" + port },
    });
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", resolve),
  );
  await rm(uploads, { recursive: true, force: true });
}
