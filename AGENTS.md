# WWP Project Instructions

## Film Workflow Plugin

- For WWP film or series production tasks, use the repo-local Codex plugin at `.codex/plugins/wwp-film-workflow/`.
- Treat the user command `开始制作影视库` as an explicit request to start the plugin's complete end-to-end workflow. Use enabled ledger input roots when available; ask for an input directory only when neither the request nor the ledger provides one.
- The plugin owns workflow routing, selection rules, encoding defaults, Notion publishing handoff, Media Assets backfill, source archive handling, and film metadata backfill.
- Review drafts under `.local-data/reviews/` are discussion artifacts only. Do not treat them as plugin source or ingest them into production docs unless the user explicitly asks.
