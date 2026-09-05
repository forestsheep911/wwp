# Editorial highlight rules

Use these rules when AI proposes work-level `看点标签` or writes `观影看点`.
Highlights are editorial outputs. Metadata fields provide evidence; the
website must not concatenate metadata fields into highlights at render time.

## Metadata prerequisite gate

Highlight generation is downstream of factual metadata maintenance. Do not run
the model merely because a title and synopsis exist. First complete or audit:

- stable work identity, kind, canonical title, and release year;
- a usable synopsis or equivalent descriptive source;
- directors, writers, principal cast, and other material creators;
- canonical genres;
- production companies, studios, and franchise/IP identity when applicable;
- major awards, nominations, and festival selections with exact result,
  category, year, and source when available;
- enough source context to distinguish publicity copy from a supported claim.

Ratings, box office, and popularity are optional context. They never satisfy a
missing creator, award, synopsis, or identity prerequisite. An empty award
result must mean `checked_none_found` or `not_checked`, not an ambiguous blank.

If core facts are missing, conflicting, or not yet checked, return
`blocked_metadata` with `missingFields` and `nextAction`. Do not generate a
smaller or more generic tag set to hide the gap. Highlight generation may start
only after the factual snapshot used by the model is saved with its source
references and observation time.

## What qualifies

A highlight tag must name a work-specific reason that changes a viewer's
understanding of the expected experience or the work's significance. A
candidate passes only when it:

1. is specific enough that replacing the title with an unrelated work would
   make the claim false or misleading;
2. helps a viewer decide why or how to watch it;
3. names a concrete quality, method, theme, historical position, viewing
   experience, verified recognition milestone, or career-significant
   performance rather than repeating the synopsis;
4. is non-spoiler by default;
5. has source support for factual claims; and
6. uses a reusable controlled label rather than a sentence fragment.

Score specificity, viewer value, concreteness, evidence, and wording from 0–2.
Require at least 7/10 and no hard rejection. `verified` additionally requires
at least 8/10, source-backed factual claims, and a completed readback/review.

## Hard rejections

Do not create a highlight tag from:

- a person name, studio, company, franchise, or IP name by itself;
- a prize/category name by itself;
- a genre already represented by `旨趣`;
- a rating, popularity number, box office, or vague critical consensus;
- generic praise such as `演员出色`, `剧情精彩`, `制作精良`, or `值得一看`;
- plot events, twists, endings, villains, deaths, or other spoiler-bearing details;
- a thin or unreleased-work synopsis that does not support a distinctive claim.

People belong in structured credits/People relations. Companies belong in
production-company, distributor, studio, or future franchise fields. Awards
belong in sourced honor facts. Verify those facts in their structured fields
first, then allow them to support an audience-recognition highlight when the
label adds a concrete viewing reason instead of merely copying a name.

Examples that may qualify after verification include `六项奥斯卡大奖`,
`戛纳金棕榈获奖作`, or `汤姆·汉克斯奥斯卡代表作`. The exact award result must
match a sourced honor fact. A representative-work claim must not come from cast
billing alone: require at least two meaningful signals such as a leading role,
a major personal award, repeated inclusion in institutional career summaries,
or durable critical/public recognition. These labels communicate recognition
and career significance; they do not prove that every viewer will like the
work.

Treat legacy `闻达` values as migration inputs, not approved highlights:

- creator names -> People/credit relations first; a representative-work
  candidate may then be assessed when career significance has independent
  support;
- Disney, Pixar, Marvel, studio, company, franchise, and IP names -> structured
  company/franchise data or browse facets;
- award names -> sourced honor facts first; an exact verified achievement may
  then be assessed as an audience-recognition candidate;
- genres -> `旨趣`;
- only a genuinely editorial, reusable viewing reason proceeds to highlight
  scoring.

## Candidate generation

For one work, generate up to eight candidates across distinct categories, then
score, deduplicate, and retain at most five. Prefer one precise tag over two
near-synonyms. When evidence supports both sides, retain at least one
audience-recognition candidate and one editorial-analysis candidate. Three or
four strong tags are usually enough; five is a ceiling rather than a target.
Keep the candidate vocabulary open during pilots; promote a tag to the
controlled vocabulary only after it appears usefully on at least two works or
describes a clearly important singleton that cannot be expressed by an
existing tag.

Useful candidate families include audience recognition through exact awards or
career-significant performances; theme and human experience; society, history,
culture, and ethics; narrative or formal construction; image, sound, music,
animation, and performance method; documentary method and access;
film-historical or genre-changing significance; and series-continuity value.

Do not force a tag. `insufficient_evidence` is a healthy result.

## Output and ownership

The canonical backend artifact should retain the factual-snapshot version and
each candidate's `category`,
`label`, short `reason`, `evidenceRefs`, `score`, `confidence`, and `status`.
Notion may expose the approved labels, final `观影看点`, review status, and a
human-lock flag. The website reads only approved output; it does not rerun the
model or rebuild highlights from raw fields.

AI may fill missing or draft output. It must not overwrite human-locked or
reviewed text. Highlight enrichment is optional metadata and does not block
playable publication during the pilot phase.
