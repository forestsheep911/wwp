# AI Check And Issue Fields Design

## Goal

Separate human-authored issues from unresolved AI findings and record completed AI checks independently from metadata changes.

## Field Contract

- Rename the existing `Issue` property to `Human Issue` in place so its values survive.
- Add `AI Issue` as rich text. AI writes only concrete unresolved findings from the current check.
- Add `Last AI Check Time` as a date. A completed, valid AI inspection writes this even when no metadata changed.
- `Metadata Updated At` changes only when metadata values change.
- AI must never overwrite or clear `Human Issue`.
- A non-empty `Human Issue` or `AI Issue` prevents automatic clearing of `Needs Review`.
- AI may remove an `AI Issue` only when readback evidence confirms that specific issue is resolved.
- Neither issue field automatically changes `Hide from Website`.

## Migration

Schema maintenance performs an idempotent rename before adding missing managed properties. It fails safely when both old and new names exist, preserving both rather than guessing which content to merge.

## Workflow

Metadata candidate selection may use `Last AI Check Time` to avoid repeat checks. Recently checked stable works are skipped; missing fields, unresolved issues, newly released works, and airing series can become eligible earlier for rating refresh.

## Verification

Unit tests cover schema contract, rename planning, conflict handling, and AI check updates. Apply schema migration once, then retrieve the live data source and verify property names and types.
