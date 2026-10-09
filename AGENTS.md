# WWP Project Instructions

## Windows and macOS compatibility

- Consider both Windows and macOS for every workflow, script, tool choice, and change. Identify platform-specific dependencies and provide equivalent behavior on both platforms when applicable.
- Detect the host platform before choosing commands. Do not assume drive letters, PowerShell, Windows executable names, fixed mount points, or a particular hardware encoder are portable. Use platform-aware paths and arguments, configurable roots, and explicit capability checks.
- Cover resource ownership, background-process lifetime, failure/interruption cleanup, and verification on both platforms. For disc images, follow the film encoder skill's platform-specific ISO mount lifecycle.
- Validate on available platforms and state which platforms were actually tested. Documentation or mocked checks do not constitute a live macOS/Windows test; record unavailable-platform verification as pending.

## Film Workflow Plugin

- For WWP film or series production tasks, use the repo-local Codex plugin at `.codex/plugins/wwp-film-workflow/`.
- Treat the user command `开始制作影视库` as an explicit request to start the plugin's complete end-to-end workflow. Use enabled ledger input roots when available; ask for an input directory only when neither the request nor the ledger provides one.
- The plugin owns workflow routing, selection rules, encoding defaults, Notion publishing handoff, Media Assets backfill, source archive handling, and film metadata backfill.
- Review drafts under `.local-data/reviews/` are discussion artifacts only. Do not treat them as plugin source or ingest them into production docs unless the user explicitly asks.

## Notion attachment transport

- Use the global `notion-attachment-transfer` skill and implementation for attachment upload/download, route changes, probes and traffic evidence. Project tools are compatibility/business adapters. Do not add independent transport implementations. Film/spec/Media Assets/ledger and release gates stay in this project.
