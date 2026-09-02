import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = new Set(["node_modules", ".git", "private", ".runtime"]);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|mjs)$/.test(entry.name)) files.push(full);
  }
}

walk(root);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  console.log(`OK sintaxis: ${path.relative(root, file)}`);
}

// Apps Script usa extensión .gs. Copiamos temporalmente a .js solo para validar sintaxis JS.
const gsPath = path.join(root, "apps-script", "CobrosVIP.gs");
if (fs.existsSync(gsPath)) {
  const temp = path.join(os.tmpdir(), `CobrosVIP-${process.pid}.js`);
  fs.copyFileSync(gsPath, temp);
  const result = spawnSync(process.execPath, ["--check", temp], { encoding: "utf8" });
  fs.unlinkSync(temp);
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  console.log("OK sintaxis: apps-script/CobrosVIP.gs");
}

const tests = spawnSync(process.execPath, ["--test", path.join(root, "tests", "*.test.js")], {
  encoding: "utf8",
  shell: true,
});
process.stdout.write(tests.stdout || "");
process.stderr.write(tests.stderr || "");
if (tests.status !== 0) process.exit(tests.status || 1);

console.log("\nCHECK COMPLETO: sintaxis + pruebas automáticas OK.");
