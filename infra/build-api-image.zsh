#!/bin/zsh
# Native Node/Azure CLI implementation, no PowerShell runtime required.
set -eu
exec node "${0:A:h}/native-cli.mjs" build-api-image "$@"
