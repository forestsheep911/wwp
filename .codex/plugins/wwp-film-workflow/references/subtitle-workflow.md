# Subtitle Acquisition Workflow

This is a bounded recovery lane for subtitle-dependent playable production.

```text
source probe and hard-sub check
  -> exact Notion/Media Assets existing-playable preflight
  -> no verified Chinese subtitle
  -> create content-addressed search task
  -> collect provider candidates
  -> local compatibility gate
  -> authorized artifact handoff
  -> safe file/content inspection
  -> beginning/middle/end sync checks
  -> short burn-in sample and visual QC
  -> existing playable encoder
  -> provenance and production manifest
```

## V0.1 Boundary

V0.1 implements the task protocol, short-lived loopback Bridge, retained event
state, a locally installed userscript, and the first SubHD page adapter. The
Companion returns normalized candidates. A separate programmatic SubHD CLI can
now search public pages and download one explicitly selected artifact without
the browser, retaining the original file and provenance.

Automatic task-to-provider handoff, archive ingestion, cross-provider ranking,
QC, and ledger completion remain follow-up work. The CLI download alone does not
complete acquisition; pass its staged artifact through the existing external-
subtitle QC before releasing the production task.

## Production preflight and bounded batches

Before selecting any subtitle-driven encode, run:

```powershell
node tools/subtitle-production-preflight.mjs --work-page <work-page-id> --report <run-directory>/preflight.json
```

This inspects the exact work's Media Assets through one shared serial limiter,
then retrieves each recorded media block and verifies its destination. An empty
local ledger is not evidence that a work has no playable versions. Existing
unverified playables require QC first; an existing compact Chinese-subtitled
playable requires review before any new encode. Larger verified versions can
justify a distinct compact version, with the decision recorded explicitly.
If Media Assets is empty, also inspect the work's page structure for unmapped
historical media before preparing a destination.

Start a batch with two titles, one at a time. Preserve each preflight, candidate,
original artifact, hash, rejection reason, and three-point QC. Different IDs can
contain the same subtitle; compare decoded text after normalizing BOM and line
endings. Do not treat a provider's human-corrected or language label as proof of
edition compatibility. A mismatched on-screen opening quotation requires
checking both edition and timing before a full encode. Compare original-language
speech at the beginning, middle and end. A constant offset can be shifted; a
smooth drift can justify a verified speed correction. Discontinuous mismatches
require another candidate or a separately evidenced segmented correction.

For a verified uniform ASS correction, preserve the source and run:

```powershell
python .codex/plugins/wwp-film-workflow/scripts/subtitle_retime.py --input original.ass --output retimed.ass --scale 0.999000999 --offset 8.8626 --evidence timing-anchors.json
```

Those numbers are an example from Sans soleil's French 24fps version, not
defaults for other films. The program changes timestamps only, retains text and
styles, refuses an existing output and saves hashes/provenance. Evidence must
cover multiple separated regions; reject unreliable ASR timestamps before
estimating correction. Repeat audio and burned-frame QC after correction.
Different opening quotations need a source-backed translation and attribution
correction recorded separately, even if the narration matches thereafter.

For the home-hosted production site, refresh the actual home index explicitly:

```powershell
node tools/notion-index-refresh.mjs --home --page-id <work-page-id> --title "<exact-title>"
```

`--backend local` alone does not select the home data directory. Verify the
running site and its configured public origin after refresh, including exact
media block/asset IDs, poster and core metadata. Upload completion alone is
not the end-to-end acceptance gate.

## Acquisition completion

Candidate capture is not production completion. Subtitle acquisition completes
only after one authorized local artifact passes safe-file, language, coverage,
timing, and visual sample checks and its provenance is attached to the production
manifest. If none passes, preserve the task evidence and defer playable
production; metadata and other workflow lanes continue.
