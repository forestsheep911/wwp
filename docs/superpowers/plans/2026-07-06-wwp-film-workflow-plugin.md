# WWP Film Workflow Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a repo-local Codex plugin that preserves WWP film/series production rules, script entry points, and Notion/Media Assets handoff rules.

**Architecture:** The plugin lives at `.codex/plugins/wwp-film-workflow/` and exposes one coordinator skill plus focused skills for candidate selection, encoding, series production, Notion publishing, Media Assets backfill, source archive handling, and film metadata backfill. Shared rules are factored into `references/`, while deterministic ffprobe/QC/variant-planning helpers live in `scripts/`.

**Tech Stack:** Codex plugin manifest, Codex skill `SKILL.md` files, Markdown references, Node.js helper scripts, PowerShell ffmpeg helper script, existing WWP repository `tools/` scripts.

---

### Task 1: Scaffold Plugin

**Files:**
- Create: `.codex/plugins/wwp-film-workflow/.codex-plugin/plugin.json`
- Create: `.codex/plugins/wwp-film-workflow/skills/`
- Create: `.codex/plugins/wwp-film-workflow/scripts/`
- Create: `.codex/plugins/wwp-film-workflow/references/`
- Create or modify: `AGENTS.md`

- [ ] **Step 1: Generate plugin skeleton**

Run:

```powershell
python C:\Users\fores\.codex\skills\.system\plugin-creator\scripts\create_basic_plugin.py wwp-film-workflow --path .codex\plugins --with-skills --with-scripts
```

Expected: `.codex/plugins/wwp-film-workflow/.codex-plugin/plugin.json` exists and validates.

- [ ] **Step 2: Add repo pointer**

Write `AGENTS.md` with a short pointer saying WWP film work should load `.codex/plugins/wwp-film-workflow/` skills and that `.local-data/reviews/` review files are not plugin source.

### Task 2: Create Skills

**Files:**
- Create: `.codex/plugins/wwp-film-workflow/skills/wwp-film-producer/SKILL.md`
- Create: `.codex/plugins/wwp-film-workflow/skills/wwp-film-candidate-selector/SKILL.md`
- Create: `.codex/plugins/wwp-film-workflow/skills/wwp-playable-encoder/SKILL.md`
- Create: `.codex/plugins/wwp-film-workflow/skills/wwp-series-producer/SKILL.md`
- Create: `.codex/plugins/wwp-film-workflow/skills/wwp-notion-publisher/SKILL.md`
- Create: `.codex/plugins/wwp-film-workflow/skills/wwp-media-assets-backfiller/SKILL.md`
- Create: `.codex/plugins/wwp-film-workflow/skills/wwp-source-archive-operator/SKILL.md`
- Create: `.codex/plugins/wwp-film-workflow/skills/wwp-metadata-backfiller/SKILL.md`

- [ ] **Step 1: Write concise trigger metadata**

Each skill frontmatter must include only `name` and `description`; descriptions start with "Use when" and mention concrete WWP film/series/Notion/Media Assets triggers.

- [ ] **Step 2: Keep routing and detailed rules separate**

The producer skill routes to the focused skills. Detailed repeated rules go into references and are linked from the relevant skill.

### Task 3: Add References

**Files:**
- Create: `.codex/plugins/wwp-film-workflow/references/decision-rules.md`
- Create: `.codex/plugins/wwp-film-workflow/references/encoding-rules.md`
- Create: `.codex/plugins/wwp-film-workflow/references/notion-media-assets.md`
- Create: `.codex/plugins/wwp-film-workflow/references/metadata-sources.md`
- Create: `.codex/plugins/wwp-film-workflow/references/series-rules.md`
- Create: `.codex/plugins/wwp-film-workflow/references/source-archive-rules.md`
- Create: `.codex/plugins/wwp-film-workflow/references/script-map.md`

- [ ] **Step 1: Write decision and encoding references**

Capture user-confirmed rules: user-specified input directory, default playable output `E:\video_made`, Chinese subtitle gate, MP4 default, hard-sub default, HEVC preference, language/subtitle/audio priorities, and stream reuse constraints.

- [ ] **Step 2: Write Notion and metadata references**

Capture Media Assets as authoritative structured data, API-stable page creation, ffprobe-backed metadata, recent-update backfill, Douban/OMDb/TMDb/AI source separation, and OMDb quota caution.

### Task 4: Add Helper Scripts

**Files:**
- Create: `.codex/plugins/wwp-film-workflow/scripts/probe-media.mjs`
- Create: `.codex/plugins/wwp-film-workflow/scripts/make-qc-contact-sheet.ps1`
- Create: `.codex/plugins/wwp-film-workflow/scripts/plan-stream-variants.mjs`

- [ ] **Step 1: Implement deterministic helpers**

`probe-media.mjs` wraps `ffprobe`, `make-qc-contact-sheet.ps1` wraps `ffmpeg` contact-sheet creation, and `plan-stream-variants.mjs` classifies when video/audio streams can be reused.

- [ ] **Step 2: Keep schema-bound Notion/Douban tools as mapped repo tools**

Do not rewrite existing WWP Notion upload and metadata scripts inside the plugin. Put their command paths and use cases in `references/script-map.md`.

### Task 5: Validate

**Files:**
- Validate plugin directory
- Validate each created skill directory
- Run representative script help commands

- [ ] **Step 1: Validate plugin manifest**

Run:

```powershell
python C:\Users\fores\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py .codex\plugins\wwp-film-workflow
```

Expected: validation succeeds.

- [ ] **Step 2: Validate skills**

Run quick validation for each skill with:

```powershell
python C:\Users\fores\.codex\skills\.system\skill-creator\scripts\quick_validate.py .codex\plugins\wwp-film-workflow\skills\<skill-name>
```

Expected: validation succeeds for all eight skills.

- [ ] **Step 3: Smoke-test helper scripts**

Run:

```powershell
node .codex\plugins\wwp-film-workflow\scripts\probe-media.mjs --help
node .codex\plugins\wwp-film-workflow\scripts\plan-stream-variants.mjs --help
powershell -NoProfile -ExecutionPolicy Bypass -File .codex\plugins\wwp-film-workflow\scripts\make-qc-contact-sheet.ps1 -Help
```

Expected: each command prints usage without touching media files.
