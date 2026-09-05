---
name: wwp-highlight-curator
description: Propose, score, review, and publish WWP viewing-highlight tags and concise non-spoiler editorial highlights after work identity, key People, and honor prerequisites have been checked.
---

# WWP Highlight Curator

Read `../../references/editorial-highlight-rules.md` before generating
candidates. Highlights are downstream editorial output, not a substitute for
missing metadata.

Load the saved factual snapshot and its work-enrichment assessment. Continue
only when the highlight gate is `ready`; otherwise return the exact blocker and
next enrichment stage. Generate up to eight candidates, score them with the
rule's five-part rubric, deduplicate near-synonyms, and retain at most three.
`insufficient_evidence` is a valid result.

Keep candidate category, label, reason, evidence references, score, confidence,
and review state in the audit artifact. Never directly turn a person, company,
IP, award category, genre, score, box office result, or synopsis sentence into a
highlight tag.

AI may update missing or draft output only. Preserve reviewed or human-locked
tags and prose. Preview and review the exact batch before any Notion write, then
require exact readback before marking the highlight stage `reviewed` or
`verified`.
