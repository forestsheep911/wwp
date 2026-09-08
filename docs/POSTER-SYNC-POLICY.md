# Website poster synchronization

The maintained Notion `海报` files property (English alias `Poster` / `Posters`)
is the only poster source. Multiple files retain their source order. A file
attached through Notion's files property may be hosted or externally attached;
its bytes must still be cached before the website may display it.

- Ignore `Poster URL`, rich-text URLs, page covers, unrelated image properties,
  OMDb and Douban fallbacks. The website sync does not search for or repair art.
- An absent/empty files field means no poster. Continue syncing the work's other
  metadata. Missing source art belongs to the film-production workflow.
- Cache maintained files in Azure Blob for the cloud deployment (the local
  filesystem backend follows the same source and display rules). Metadata sync
  always performs this step; the old `POSTER_CACHE_ENABLED=false` bypass no longer applies.
- Preserve provenance as `MoviePoster.origin = "notion-files"`. Legacy external
  candidates must be refreshed from Notion before they can become new cached files.
- Keep failed source candidates internally for retries, log cache failures, and
  exclude them from website image responses. Never fall back to the source URL.
- Reuse existing cached files when Notion merely rotates a signed URL. If any
  current download fails, do not clean up the previous Blob set. A confirmed
  empty field removes the display and permits cleanup; a failed Notion read does not.
- New Blob names include a content fingerprint so reordered/replaced posters
  cannot overwrite an old image still referenced by a failed partial batch or
  served with an immutable browser cache lifetime.
- Update `metadata.posters`, `metadata.posterUrl` and `work.media.posters`
  together. An empty canonical list must not resurrect an old nested poster.

Existing indexes require a Notion refresh to reconcile legacy mixed-source
entries. Deploying code alone does not backfill missing images or prove that
existing legacy cached files came from the maintained field. Use the existing
bounded poster-backfill workflow against reviewed work IDs; do not perform an
unbounded cloud sweep implicitly. A successful refresh with no source image is
valid; a failed image cache must be reported as failed, not successfully repaired.
