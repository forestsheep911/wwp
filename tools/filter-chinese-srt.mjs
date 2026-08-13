#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const values = new Set(["--input", "--output"]);
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!values.has(arg)) throw new Error(`unknown argument: ${arg}`);
    options[arg.slice(2)] = argv[++i];
  }
  if (!options.input || !options.output) throw new Error("--input and --output are required");
  return options;
}

function keepChineseLine(line) {
  return /[\u3400-\u9fff]/u.test(line);
}

function filterSrt(text) {
  const blocks = text.replace(/^\uFEFF/u, "").split(/\r?\n\r?\n+/u);
  const kept = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/u);
    if (lines.length < 3) continue;
    const body = lines.slice(2).filter(keepChineseLine);
    if (body.length === 0) continue;
    kept.push([lines[0], lines[1], ...body].join("\n"));
  }
  return `${kept.join("\n\n")}\n`;
}

const options = parseArgs(process.argv.slice(2));
writeFileSync(options.output, filterSrt(readFileSync(options.input, "utf8")), "utf8");
