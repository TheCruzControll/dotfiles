#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["README.md"];
const excluded = "skills/statechart/scripts/test/corpus";

function walk(dir) {
  if (dir === excluded) return;
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile() && path.endsWith(".md")) files.push(path);
  }
}
for (const dir of ["skills", "docs", "agents"]) walk(dir);

// shortcut: only one level of nested parentheses, use a Markdown parser if deeper nesting appears.
const link = /(?<!\\)!?\[(?:\\.|[^\]\\]|\[(?:\\.|[^\]\\])*\])*\]\(\s*(?:<([^<>\n]*)>|((?:\\.|[^\\\s()]|\((?:\\.|[^\\()])*\))+))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g;
const definition = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^<>\n]*)>|((?:\\.|[^\\\s()]|\((?:\\.|[^\\()])*\))+))(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*\r?$/gm;
const reference = /(?<!\\)!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g;
const label = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const mask = (value) => value.replace(/[^\n]/g, " ");
let links = 0;
let problems = 0;
for (const file of files) {
  const text = readFileSync(join(root, file), "utf8");
  let fence;
  let source = text.split("\n").map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return mask(line);
    }
    if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
      fence = marker[1];
      return mask(line);
    }
    return line;
  }).join("\n").replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, mask);
  const definitions = new Map();
  source = source.replace(definition, (whole, name, angle, plain) => {
    const key = label(name);
    if (!definitions.has(key)) definitions.set(key, angle ?? plain);
    return mask(whole);
  });
  const check = (href, index) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return;
    links++;
    const target = href.split(/[?#]/, 1)[0].replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1");
    let decoded = target;
    try { decoded = decodeURIComponent(target); } catch {}
    const path = decoded ? resolve(root, dirname(file), decoded) : join(root, file);
    if (!existsSync(path)) {
      const line = text.slice(0, index).split("\n").length;
      console.log(`${file}:${line} -> ${href}`);
      problems++;
    }
  };
  source = source.replace(link, (whole, angle, plain, index) => {
    check(angle ?? plain, index);
    return mask(whole);
  });
  for (const match of source.matchAll(reference)) {
    const href = definitions.get(label(match[2] || match[1]));
    if (href !== undefined) check(href, match.index);
  }
}
if (problems) process.exitCode = 1;
else console.log(`links ok (${links} links in ${files.length} files)`);
