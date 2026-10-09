#!/bin/zsh
# Cloud selector/check helper; never exports resolved secret values.
set -eu
if (( $# == 0 )); then set -- check; fi
exec node "${0:A:h}/../tools/cloud-config.mjs" "$@"
