#!/usr/bin/env node
/**
 * Does anything the native module drags in need a newer Kotlin than the app
 * compiles with?
 *
 * This exists because that question cost two full CI builds to answer. A
 * Kotlin compiler reads class metadata from its own version and two minors
 * back, no further. Expo SDK 54 compiles with 2.1.20, so anything on the
 * classpath built by Kotlin 2.3 fails the build - and not with a version
 * error, but with dozens of `Unresolved reference 'let'`, because the standard
 * library itself becomes unreadable.
 *
 * The offender is never the dependency you added. It was RootEncoder 2.8.1 ->
 * common -> ktor-network:3.5.2 -> kotlin-stdlib:2.3.21, four levels down, and
 * the failure surfaced in Expo's own source files rather than ours: Expo's
 * autolinking puts every module's dependency graph on the `:expo` project's
 * compile classpath, so one module's transitive breaks a different module's
 * compilation.
 *
 * A library's own stdlib requirement is also what says which compiler built
 * it - the Kotlin Gradle plugin adds its own version - so walking the graph
 * and taking the maximum answers both questions at once.
 *
 *   node scripts/check-kotlin-window.mjs
 *
 * Run it before pushing a dependency bump. It takes seconds; the build takes
 * twenty minutes to tell you the same thing less clearly.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const gradleFile = join(here, "../modules/framevane-broadcaster/android/build.gradle");

/**
 * The newest Kotlin whose metadata the app's compiler can read. Expo prints
 * its Kotlin version during every Android build ("[ExpoRootProject] Using the
 * following versions: ... kotlin: 2.1.20"), and the window is that version's
 * minor plus one.
 */
const COMPILER = "2.1.20";
const CEILING = "2.2.99";

const REPOS = [
  "https://jitpack.io",
  "https://repo1.maven.org/maven2",
  "https://dl.google.com/dl/android/maven2",
];

const cmp = (a, b) => {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
};

function rootDependency() {
  const gradle = readFileSync(gradleFile, "utf8");
  const version = gradle.match(/rootEncoderVersion\s*=\s*'([^']+)'/)?.[1];
  if (!version) throw new Error(`No rootEncoderVersion in ${gradleFile}`);
  return { group: "com.github.pedroSG94.RootEncoder", module: "library", version };
}

async function metadata({ group, module, version }) {
  const path = `${group.replace(/\./g, "/")}/${module}/${version}/${module}-${version}.module`;
  for (const repo of REPOS) {
    try {
      const res = await fetch(`${repo}/${path}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      return JSON.parse(await res.text());
    } catch {
      // Next repository. A coordinate published only as a POM has no Gradle
      // metadata anywhere, which is reported by the caller as unresolved.
    }
  }
  return null;
}

const seen = new Set();
/** coordinate -> the chain that asked for it, for the report. */
const via = new Map();
const stdlibs = [];
const unresolved = [];

async function walk(coord, chain) {
  const key = `${coord.group}:${coord.module}:${coord.version}`;
  if (seen.has(key)) return;
  seen.add(key);
  via.set(key, chain);

  if (coord.group === "org.jetbrains.kotlin" && coord.module.startsWith("kotlin-stdlib")) {
    stdlibs.push({ version: coord.version, chain });
    return; // The standard library's own graph adds nothing.
  }

  const meta = await metadata(coord);
  if (!meta) {
    unresolved.push({ key, chain });
    return;
  }

  const next = new Map();
  for (const variant of meta.variants ?? []) {
    for (const dep of variant.dependencies ?? []) {
      const version = dep.version?.requires ?? dep.version?.strictly;
      if (!version) continue;
      next.set(`${dep.group}:${dep.module}:${version}`, {
        group: dep.group,
        module: dep.module,
        version,
      });
    }
  }
  for (const dep of next.values()) await walk(dep, [...chain, key]);
}

const root = rootDependency();
console.log(`Compiler: Kotlin ${COMPILER} · readable metadata up to ${CEILING}`);
console.log(`Walking ${root.group}:${root.module}:${root.version}\n`);
await walk(root, []);

stdlibs.sort((a, b) => cmp(b.version, a.version));
const worst = stdlibs[0];
const unique = [...new Set(stdlibs.map((s) => s.version))].sort(cmp).reverse();

console.log(`kotlin-stdlib versions in the graph: ${unique.join(", ") || "none"}`);
console.log(`Coordinates walked: ${seen.size}`);
if (unresolved.length) {
  console.log(`\nNo Gradle metadata (POM-only, not inspected): ${unresolved.length}`);
  for (const u of unresolved.slice(0, 8)) console.log(`  ${u.key}`);
}

if (!worst) {
  console.log("\nFAIL: no kotlin-stdlib found at all, which means this walk is wrong.");
  process.exit(1);
}

if (cmp(worst.version, CEILING) > 0) {
  console.log(`\nFAIL: kotlin-stdlib ${worst.version} is newer than the compiler can read.`);
  console.log(`Requested through:\n  ${[...worst.chain, `org.jetbrains.kotlin:kotlin-stdlib:${worst.version}`].join("\n  -> ")}`);
  console.log("\nPick a version of the dependency whose own graph stays inside the window,");
  console.log("or raise the project's Kotlin - which means raising KSP with it.");
  process.exit(1);
}

console.log(`\nPASS: the whole graph stays on kotlin-stdlib ${worst.version} or older.`);
