#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreHighlight, validateHighlightDraft, type WorkHighlightDraft } from "../apps/api/src/work-highlight.js";

const input = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("highlight draft JSON path is required");
const draft = JSON.parse(readFileSync(input, "utf8")) as WorkHighlightDraft;
const validation = validateHighlightDraft(draft);
process.stdout.write(`${JSON.stringify({ input, validation, candidates: draft.candidates.map((candidate) => ({ label: candidate.label, category: candidate.category, score: scoreHighlight(candidate), status: candidate.status, confidence: candidate.confidence })) }, null, 2)}\n`);
if (!validation.valid) process.exitCode = 1;
