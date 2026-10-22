#!/usr/bin/env node
/**
 * Do the JS contract and the native modules agree?
 *
 * `requireNativeModule` resolves whether or not the function you are about to
 * call exists, so a name that is exported from `index.ts` and never declared
 * natively fails at the moment an operator presses the button - which on this
 * project means a fifty-minute build, an install, and a crash report, to learn
 * something a text comparison knows in a second.
 *
 * Checks three things, in both directions:
 *   - every `native.x(...)` call in index.ts is declared in the Kotlin module
 *   - the same for the iOS module, which must implement the whole contract
 *     even while it only throws, because "function not found" tells an
 *     operator nothing
 *   - every `onX` prop in BroadcasterViewProps is passed to `Events(...)` on
 *     both platforms, and has a dispatcher on the view
 *
 *   node scripts/check-native-contract.mjs
 *
 * Exits non-zero on any mismatch. Run it before pushing a build tag.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const module_ = join(root, "modules/framevane-broadcaster");

const read = (path) => readFileSync(join(module_, path), "utf8");

const contract = read("index.ts");
const types = read("src/types.ts");
const kotlinModule = read(
  "android/src/main/java/de/linkfa/framevane/broadcaster/BroadcasterModule.kt",
);
const swiftModule = read("ios/BroadcasterModule.swift");
const swiftView = read("ios/BroadcasterView.swift");

const all = (source, pattern) => [...source.matchAll(pattern)].map((m) => m[1]);
const unique = (list) => [...new Set(list)];

/**
 * The Kotlin module definition may be split across files - it gets long - so
 * anything in the android tree counts, not just BroadcasterModule.kt.
 */
function kotlinSources() {

  return execSync(
    `find ${join(module_, "android")} -name '*.kt' -type f`,
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}
const kotlin = (() => {
  try {
    return kotlinSources();
  } catch {
    return kotlinModule;
  }
})();

// What JavaScript will actually call.
const wanted = unique(all(contract, /\bnative\.([A-Za-z0-9_]+)\s*\(/g));

// What each platform declares. Expo's DSL spells both the same way.
const declaredKotlin = unique(all(kotlin, /\b(?:Async)?Function\(\s*"([^"]+)"/g));
const declaredSwift = unique(all(swiftModule, /\b(?:Async)?Function\(\s*"([^"]+)"/g));

// Events: the props the contract promises, against what each side exports.
const events = unique(all(types, /^\s{2}(on[A-Z][A-Za-z0-9]*)\??:/gm));
const eventsKotlin = unique(
  all(kotlin, /Events\(([^)]*)\)/g).flatMap((group) =>
    [...group.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  ),
);
const eventsSwift = unique(
  all(swiftModule, /Events\(([^)]*)\)/g).flatMap((group) =>
    [...group.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  ),
);
const dispatchersSwift = unique(all(swiftView, /let\s+(on[A-Z][A-Za-z0-9]*)\s*=\s*EventDispatcher/g));
const dispatchersKotlin = unique(
  all(kotlin, /val\s+(on[A-Z][A-Za-z0-9]*)\s+by\s+EventDispatcher/g),
);

const problems = [];
const missing = (label, want, have) => {
  const gaps = want.filter((name) => !have.includes(name));
  if (gaps.length) problems.push(`${label}: ${gaps.join(", ")}`);
};

missing("Called from JS, not declared in Kotlin", wanted, declaredKotlin);
missing("Called from JS, not declared in Swift", wanted, declaredSwift);
missing("In BroadcasterViewProps, not in Kotlin Events()", events, eventsKotlin);
missing("In BroadcasterViewProps, not in Swift Events()", events, eventsSwift);
missing("Declared in Kotlin Events(), no dispatcher on the view", eventsKotlin, dispatchersKotlin);
missing("Declared in Swift Events(), no dispatcher on the view", eventsSwift, dispatchersSwift);

/**
 * The other direction is a warning, not a failure: native may reasonably
 * declare something the contract does not expose yet.
 */
const strayKotlin = declaredKotlin.filter((name) => !wanted.includes(name));
const straySwift = declaredSwift.filter((name) => !wanted.includes(name));

console.log(`Contract:  ${wanted.length} functions, ${events.length} events`);
console.log(`Kotlin:    ${declaredKotlin.length} functions, ${eventsKotlin.length} events`);
console.log(`Swift:     ${declaredSwift.length} functions, ${eventsSwift.length} events`);
if (strayKotlin.length) console.log(`\nNative-only (Kotlin), not exposed to JS: ${strayKotlin.join(", ")}`);
if (straySwift.length) console.log(`Native-only (Swift), not exposed to JS: ${straySwift.join(", ")}`);

if (problems.length === 0) {
  console.log("\nPASS: every call and every event has an implementation on both platforms.");
  process.exit(0);
}

console.log("\nFAIL");
for (const problem of problems) console.log(`  ${problem}`);
process.exit(1);
