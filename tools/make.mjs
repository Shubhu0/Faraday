#!/usr/bin/env node
// Faraday build: assembles dist/<target> from src/ + platform/<target>/.
// Copy-only, uBlock-Origin-style — no bundler, no dependencies.
//
//   node tools/make.mjs            # build every target
//   node tools/make.mjs firefox    # build one target

import { cpSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = ["chromium", "firefox", "safari"];

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : TARGETS;

for (const target of targets) {
  if (!TARGETS.includes(target)) {
    console.error(`unknown target "${target}" — expected one of: ${TARGETS.join(", ")}`);
    process.exit(1);
  }
  const out = resolve(root, "dist", target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(resolve(root, "src"), out, { recursive: true });
  cpSync(
    resolve(root, "platform", target, "manifest.json"),
    resolve(out, "manifest.json")
  );
  console.log(`built dist/${target}`);
}
