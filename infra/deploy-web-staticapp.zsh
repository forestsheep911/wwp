#!/bin/zsh
# Native macOS entrypoint; the shared Node implementation needs no PowerShell.
set -eu
exec node "${0:A:h}/deploy-web-staticapp.mjs" "$@"
