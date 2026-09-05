# Work honors schema

Store each award, nomination, festival selection, or special mention as one
fact. Do not store a promotional roll-up such as `奥斯卡获奖` as the canonical
record.

## Canonical record

The executable contract is `apps/api/src/work-honor.ts`. A record contains:

- stable `honorId` and related `workId`;
- awarding body, event or edition, edition year, and exact category;
- one result: `winner`, `nominee`, `selection`, or `special_mention`;
- recipient scope (`work` or exact credited people);
- one or more HTTPS official or institutional source references, each with an
  observation time;
- review status and last check time.

`checked_none_found` is a work-level audit result, not a fake honor record.

## Proposed Notion projection

Prefer a related `Honors / 荣誉` data source with one page per canonical fact:

- `Name`: concise generated display name;
- `Work`: relation to the canonical work;
- `Awarding Body`, `Event`, `Edition Year`, `Category`, `Result`;
- `Recipients`: relation or exact text until recipient relations are ready;
- `Sources`: source URLs plus observation metadata;
- `Review Status`, `Checked At`.

The work page may expose rollups such as `主要荣誉摘要` and `荣誉核实状态` for
operators and the website. Those rollups are derived views, never the evidence
store. Do not overload `闻达`, `旨趣`, or free-form notes with canonical honor
facts.

Schema creation and migration are separate apply operations. First produce a
dry-run property plan, compare it with the live schema, and require an explicit
apply command before creating data sources, properties, relations, or records.
