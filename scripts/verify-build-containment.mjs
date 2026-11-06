#!/usr/bin/env node
// Build-containment verification (#258).
//
// Places uniquely identifiable but non-secret canary values in every location
// a real credential or private runtime file could occupy, then proves each one
// is absent from:
//
//   1. the Next.js standalone output (host build — tracing must not pull
//      unrelated project files in),
//   2. the Docker build context (`.dockerignore` coverage),
//   3. the built dashboard runtime image (end to end, with the image digest
//      recorded for the evidence trail).
//
// No real secret is read, written, or logged: every canary is a synthetic
// fixed-format token, so a hit names only the fixture path. Canaries are
// removed in `finally` whether the run passes or fails.
//
// Usage: node scripts/verify-build-containment.mjs [--skip-image]
//        CONTAINMENT_SKIP_IMAGE=1 skips the slower image build.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]+$/, "");
// Resolve the build script directly instead of going through npm: Windows
// npm.cmd shims cannot be spawned without a shell, and a shell would have to
// interpolate the canary token.
const dashboardBuild = [join(process.cwd(), "scripts", "dashboard.mjs"), "build"];
const skipImage = process.argv.includes("--skip-image") || process.env.CONTAINMENT_SKIP_IMAGE === "1";
const token = `TANAGHOMCONTAINMENTCANARY${Date.now().toString(36).toUpperCase()}${process.pid}`;
const imageTag = `tanaghom-containment:${token.toLowerCase()}`;

// Every entry is a path a real deployment could plausibly hold private data
// in. `.env.production.local` is the nested case that a root-anchored
// `.env.*` pattern does not cover.
const fixtures = [
  ".env.local",
  join("apps", "dashboard", ".env.production.local"),
  join("apps", "dashboard", "local-private", "canary.txt"),
  join("deployment", "dashboard-demo", "secrets", "gemini_api_key"),
  join("deployment", "dashboard-demo", "secrets", "workspace_worker_token"),
];

const failures = [];
const created = [];

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function note(message) {
  console.log(`ok   ${message}`);
}

function write(path) {
  const absolute = join(root, path);
  if (existsSync(absolute)) throw new Error(`refusing to overwrite existing path: ${path}`);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  created.push(absolute);
}

function removeFixtures() {
  for (const path of created.reverse()) rmSync(path, { force: true });
  // Prune only the directories this run created, never a pre-existing one.
  for (const dir of [join(root, "apps", "dashboard", "local-private"), join(root, "deployment", "dashboard-demo", "secrets")]) {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function requireOk(command, args, label) {
  const result = run(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
  return result;
}

// Recursively collect files containing the token. Binary-safe and bounded:
// only file contents are scanned, never symlinks or generated bundles.
function scanTree(directory, { ignore = [] } = {}) {
  const hits = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      if (ignore.some((prefix) => absolute.startsWith(prefix))) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      let contents;
      try {
        contents = readFileSync(absolute);
      } catch {
        continue;
      }
      if (contents.includes(token)) hits.push(absolute.slice(root.length + 1).split(sep).join("/"));
    }
  };
  walk(directory);
  return hits;
}

function assertAbsent(hits, surface) {
  if (hits.length === 0) {
    note(`${surface}: no canary content found`);
    return;
  }
  fail(`${surface}: canary content leaked into ${hits.length} file(s): ${hits.slice(0, 5).join(", ")}`);
}

function main() {
  console.log(`build-containment verification (#258) token=${token}`);
  for (const fixture of fixtures) write(fixture);
  console.log(`planted ${created.length} canary fixtures`);

  // 1. Host build: the trace must not drag unrelated project files into the
  //    standalone server output.
  requireOk(process.execPath, dashboardBuild, "dashboard build");
  const standalone = join(root, "apps", "dashboard", ".next", "standalone");
  if (!existsSync(standalone)) throw new Error("standalone output missing after build");
  assertAbsent(scanTree(standalone), "standalone output");

  // A build that traces the whole project ships dashboard sources it does not
  // need. Record the size so a regression is visible, not just the warning.
  const tracedFiles = scanTree(standalone, { ignore: [join(standalone, "node_modules")] });
  console.log(`     standalone traced non-dependency file count: ${tracedFiles.length}`);

  // 2. Build context: prove `.dockerignore` keeps the same fixtures out of
  //    what Docker actually uploads to the builder.
  const probeDockerfile = join(root, "tmp", "containment-probe.Dockerfile");
  mkdirSync(join(root, "tmp"), { recursive: true });
  writeFileSync(probeDockerfile, ["FROM alpine:3.20", "WORKDIR /probe", "COPY . /probe", "CMD [\"true\"]", ""].join("\n"));
  try {
    const probe = run("docker", ["build", "--quiet", "-f", probeDockerfile, "-t", `${imageTag}-context`, "."]);
    if (probe.status !== 0) throw new Error(`context probe build failed: ${(probe.stderr || "").trim().slice(-400)}`);
    // The token is passed as an argument, never through a shell: an unset or
    // empty pattern would silently match every file and read as a leak.
    const listed = run("docker", ["run", "--rm", "--entrypoint", "/bin/grep", `${imageTag}-context`, "-rlF", token, "/probe"]);
    if (listed.error) throw listed.error;
    assertAbsent((listed.stdout || "").split("\n").map((line) => line.trim()).filter(Boolean), "docker build context");
  } finally {
    run("docker", ["image", "rm", "--force", `${imageTag}-context`]);
    rmSync(probeDockerfile, { force: true });
  }

  // 3. Final image: end-to-end absence plus the digest for the evidence record.
  if (skipImage) {
    console.log("skip final image build (--skip-image)");
  } else {
    const digestFile = join(root, "tmp", "containment-image.iid");
    rmSync(digestFile, { force: true });
    requireOk(
      "docker",
      ["build", "--iidfile", digestFile, "-f", join(root, "deployment", "dashboard-demo", "Dockerfile"), "-t", imageTag, "."],
      "dashboard image build",
    );
    const scanned = run("docker", ["run", "--rm", "--entrypoint", "/bin/grep", imageTag, "-rlF", token, "/app"]);
    if (scanned.error) throw scanned.error;
    assertAbsent((scanned.stdout || "").split("\n").map((line) => line.trim()).filter(Boolean), "final image");
    if (existsSync(digestFile)) console.log(`     image digest: ${readFileSync(digestFile, "utf8").trim()}`);
    run("docker", ["image", "rm", "--force", imageTag]);
    rmSync(digestFile, { force: true });
  }

  if (failures.length > 0) throw new Error(`${failures.length} containment failure(s)`);
  console.log("build containment verified");
}

try {
  main();
} catch (error) {
  console.error(`containment verification error: ${error.message}`);
  process.exitCode = 1;
} finally {
  removeFixtures();
  const leftovers = fixtures.filter((fixture) => existsSync(join(root, fixture)));
  if (leftovers.length > 0) console.error(`fixture cleanup incomplete: ${leftovers.join(", ")}`);
}
