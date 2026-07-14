# AI Check And Issue Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable AI inspection timestamps and separate human and AI issue fields to the WWP Notion metadata workflow.

**Architecture:** Extend the managed schema and add an idempotent schema migration planner for the legacy property rename. Centralize AI-check completion updates so enrichment tools preserve human notes and update review state conservatively.

**Tech Stack:** TypeScript, Node test runner, Notion data source API, Markdown Codex skills.

## Global Constraints

- Preserve all existing `Issue` values through an in-place rename.
- Never overwrite or clear `Human Issue` from AI automation.
- Do not continue bulk movie metadata enrichment in this change.

---

### Task 1: Schema Contract And Rename Migration

**Files:**
- Modify: `apps/api/src/notion-metadata-schema.ts`
- Modify: `apps/api/src/notion-metadata-schema.test.ts`
- Modify: `apps/api/src/notion-metadata-maintenance.ts`
- Test: `apps/api/src/notion-metadata-schema.test.ts`

- [ ] Write failing tests for the three managed fields and idempotent `Issue` rename planning.
- [ ] Run the focused test and confirm failures describe missing fields/migration behavior.
- [ ] Add the managed fields and migration planner.
- [ ] Run the focused test and TypeScript compiler.

### Task 2: AI Check Write Semantics

**Files:**
- Modify: `apps/api/src/notion-family-age-enrichment.ts`
- Modify: the corresponding focused test module.

- [ ] Write failing tests proving successful checks update `Last AI Check Time`, unresolved findings populate `AI Issue`, and `Human Issue` is untouched.
- [ ] Add the minimal update planner behavior.
- [ ] Run focused and related tests.

### Task 3: Plugin Workflow Rules

**Files:**
- Modify: `.codex/plugins/wwp-film-workflow/skills/wwp-metadata-backfiller/SKILL.md`
- Modify: `.codex/plugins/wwp-film-workflow/references/metadata-sources.md`
- Modify: `.codex/plugins/wwp-film-workflow/references/script-map.md`

- [ ] Add field ownership, review-gate, refresh scheduling, and no-repeat-check rules.
- [ ] Search the plugin for contradictory `Issue` or timestamp guidance and correct it.

### Task 4: Live Migration And Readback

**Files:**
- Create: `.local-data/notion-ai-check-schema-20260713.json`

- [ ] Preview the live schema migration.
- [ ] Apply schema-only migration without scanning pages.
- [ ] Retrieve schema again and verify `Human Issue`, `AI Issue`, and `Last AI Check Time` types.
- [ ] Run relevant tests, `tsc`, and `git diff --check`.
