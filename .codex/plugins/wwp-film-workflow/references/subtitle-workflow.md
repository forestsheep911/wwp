# Subtitle Acquisition Workflow

This is a bounded recovery lane for subtitle-dependent playable production.

```text
source probe and hard-sub check
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
user opens the site, refreshes tasks, starts the search, and explicitly captures
the current result/detail page. The adapter returns normalized candidates.

Artifact download, archive ingestion, automated cross-provider rank calculation,
and ledger schema integration remain visible follow-up work. Until those gates
are implemented and tested, the user downloads a selected subtitle explicitly
and supplies its local path for existing external-subtitle QC.

## Completion

Candidate capture is not production completion. Subtitle acquisition completes
only after one authorized local artifact passes safe-file, language, coverage,
timing, and visual sample checks and its provenance is attached to the production
manifest. If none passes, preserve the task evidence and defer playable
production; metadata and other workflow lanes continue.

