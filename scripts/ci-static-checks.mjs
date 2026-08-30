import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { inspectRepositoryText } from "../lib/release-quality.mjs";

const roots = [".github", "app", "docs", "lib", "prisma", "scripts", "tests"];
const extensions = new Set([".js", ".json", ".md", ".mjs", ".prisma", ".sql", ".yaml", ".yml"]);

async function collectFiles(relativePath) {
  const entries = await readdir(relativePath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(child));
    else if (extensions.has(path.extname(entry.name))) files.push(child);
  }
  return files;
}

const files = (await Promise.all(roots.map(collectFiles))).flat().sort();
const findings = [];
for (const file of files) findings.push(...inspectRepositoryText(file.replaceAll("\\", "/"), await readFile(file, "utf8")));

if (findings.length > 0) {
  for (const finding of findings) process.stderr.write(`${finding.path}:${finding.line} ${finding.code}\n`);
  process.stderr.write(`Static integrity check failed with ${findings.length} finding(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({ event: "static_integrity_passed", filesChecked: files.length }) + "\n");
}
