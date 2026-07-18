# Bilingual Subtitle Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render multiple short subtitle-language labels as one compact hard-burned subtitle tag, such as `繁英`.

**Architecture:** `apps/web/src/cinema/format.ts` maps subtitle-language codes to existing one-character labels and currently inserts a slash between them. Change only the subtitle-label joining behavior; the outer variant-spec formatter continues to separate subtitle, size, and episode fields as before.

**Tech Stack:** TypeScript, Node.js built-in test runner, Vite web workspace.

## Global Constraints

- Multiple subtitle languages render with no separator: `zh-Hant` + `en` becomes `繁英`.
- Single-language values retain their current labels.
- Non-subtitle fields retain their existing ` / ` separator.

---

### Task 1: Format structured bilingual subtitle metadata as one fixed tag

**Files:**
- Modify: `apps/web/test/format.test.ts`
- Modify: `apps/web/src/cinema/format.ts`

**Interfaces:**
- Consumes: `variantSpecLabels(variant: MediaVariant): string[]` and `variantSpecText(title: string, variant: MediaVariant): string`.
- Produces: structured bilingual subtitle labels without a slash separator.

- [ ] **Step 1: Write the failing test**

```typescript
assert.deepEqual(variantSpecLabels(variant), ["简英", "1.72G"]);
assert.equal(variantSpecText("地球特派员 Elio (2025)", variant), "简英 / 1.72G");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx apps/web/test/format.test.ts`

Expected: `variantSpecLabels` returns `"简 / 英"`, showing the old switcher-like separator.

- [ ] **Step 3: Write minimal implementation**

```typescript
function subtitleLabelList(values?: string[]) {
  return values
    ?.map((value) => mediaLanguageLabels[value] ?? sourceLineageLabels[value] ?? value)
    .filter(Boolean)
    .join("");
}
```

Use `subtitleLabelList(metadata.subtitleLanguages)` in the two structured subtitle-label callers. Keep `labelList` unchanged if it serves another structured field.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx apps/web/test/format.test.ts`

Expected: all `format.test.ts` subtests pass.

- [ ] **Step 5: Run web verification**

Run: `npm run typecheck --workspace @wwpdw/web` and `npm run build --workspace @wwpdw/web`

Expected: both commands exit successfully.
