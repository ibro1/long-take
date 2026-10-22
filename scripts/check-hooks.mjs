#!/usr/bin/env node
/**
 * Hooks must run in the same order on every render.
 *
 * This exists because a hook was added to the viewfinder below its permission
 * gates - which return early - and the screen crashed with "Rendered more
 * hooks than during the previous render" the moment the permission check came
 * back. It type-checked, it bundled, and it was found by an operator with the
 * app in their hand. The rule that catches it is ESLint's rules-of-hooks; this
 * project lints with Biome and the equivalent rule is not on in the version
 * pinned here, so the check is written out rather than argued about.
 *
 * Two things are flagged, both of them the same mistake seen from different
 * sides:
 *
 *   - a hook called after a `return` in the body of a component or hook, and
 *   - a hook called inside an `if`, a loop, or a `try`.
 *
 * Hook calls inside a nested function are not walked into. A callback's own
 * body is not this function's render, and the alternative - flagging every
 * `useCallback(() => ...)` that happens to contain something use-shaped -
 * would make the check noise, and a noisy check gets ignored.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const ROOTS = ["app", "components", "lib", "hooks", "modules"];

/** A component or a hook: the two kinds of function React calls for a render. */
function rendersWithHooks(name) {
  return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name);
}

function isHookCall(node) {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
      ? callee.name.text
      : null;
  return name && /^use[A-Z]/.test(name) ? name : null;
}

function nameOf(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  // `const Thing = () => {}` and `const useThing = function () {}`.
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return null;
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

const findings = [];

function checkBody(source, fnName, body) {
  if (!body || !ts.isBlock(body)) return;
  let returned = null;

  const report = (node, why) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({
      file: relative(ROOT, source.fileName),
      line: line + 1,
      fn: fnName,
      hook: isHookCall(node),
      why,
    });
  };

  /**
   * `conditional` is carried down rather than recomputed, so a hook three
   * blocks inside an `if` is still reported against the `if`.
   */
  const walk = (node, conditional) => {
    if (isFunctionLike(node)) return; // Another render, or none at all.

    const hook = isHookCall(node);
    if (hook) {
      if (returned) {
        report(
          node,
          `runs after the \`return\` on line ${
            source.getLineAndCharacterOfPosition(returned.getStart(source)).line + 1
          }, so it is skipped on any render that takes that branch`,
        );
      } else if (conditional) {
        report(node, `runs inside \`${conditional}\`, so it is skipped when that is not taken`);
      }
    }

    const nextConditional =
      conditional ??
      (ts.isIfStatement(node)
        ? "if"
        : ts.isForStatement(node) ||
            ts.isForOfStatement(node) ||
            ts.isForInStatement(node) ||
            ts.isWhileStatement(node) ||
            ts.isDoStatement(node)
          ? "a loop"
          : ts.isTryStatement(node) || ts.isSwitchStatement(node)
            ? "try/switch"
            : ts.isConditionalExpression(node) || ts.isBinaryExpression(node)
              ? null
              : null);

    ts.forEachChild(node, (child) => walk(child, nextConditional));
  };

  for (const statement of body.statements) {
    walk(statement, null);
    // Only a return at the top of the body ends the render for everything
    // after it; one inside an `if` is the early return itself.
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) returned = statement;
    else if (ts.isIfStatement(statement) && endsRender(statement.thenStatement) && !statement.elseStatement) {
      // `if (!ready) { return ... }` - everything after it is conditional on
      // that branch not being taken, which is exactly the shape that crashed.
      returned = statement;
    }
  }
}

/** Whether this branch always leaves the function. */
function endsRender(node) {
  if (!node) return false;
  if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true;
  if (ts.isBlock(node)) {
    return node.statements.some((s) => ts.isReturnStatement(s) || ts.isThrowStatement(s));
  }
  return false;
}

function checkFile(file) {
  const source = ts.createSourceFile(
    file,
    ts.sys.readFile(file) ?? "",
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const visit = (node) => {
    if (isFunctionLike(node)) {
      const name = nameOf(node);
      if (name && rendersWithHooks(name)) checkBody(source, name, node.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function* sources(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "android" || entry === "ios" || entry[0] === ".") {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) yield path;
  }
}

let files = 0;
for (const root of ROOTS) {
  for (const file of sources(join(ROOT, root))) {
    files += 1;
    checkFile(file);
  }
}

if (findings.length === 0) {
  console.log(`Hooks:     ${files} files, every hook runs on every render.`);
  process.exit(0);
}

console.error("A hook does not run on every render:\n");
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  ${f.hook} in ${f.fn}`);
  console.error(`    ${f.why}\n`);
}
console.error("Move it above the early return, with the other hooks.");
process.exit(1);
