#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateWorkHonorRecord, type WorkHonorRecord } from "../apps/api/src/work-honor.js";

const input = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("input JSON file is required");
const payload = JSON.parse(readFileSync(input, "utf8")) as { records?: WorkHonorRecord[] };
if (!Array.isArray(payload.records)) throw new Error("input must contain a records array");
const records = payload.records.map((record) => ({ record, validation: validateWorkHonorRecord(record) }));
process.stdout.write(`${JSON.stringify({
  generatedAt: new Date().toISOString(),
  input,
  summary: {
    total: records.length,
    valid: records.filter((entry) => entry.validation.valid).length,
    invalid: records.filter((entry) => !entry.validation.valid).length
  },
  records
})}\n`);
