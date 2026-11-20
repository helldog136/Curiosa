#!/usr/bin/env bash
# Usage: docs/formal/run-tlc.sh <Spec.tla> <Spec.cfg> [extra TLC args]   (paths relative to docs/formal/tla)
# Needs Java and tla2tools.jar (downloaded once into ${TLA_CACHE:-~/.cache/tla}). Not part of `npm test`: the TLA+ checks are run by hand, see docs/formal/README.md.
set -euo pipefail
spec="$1"; cfg="$2"; shift 2
cache="${TLA_CACHE:-$HOME/.cache/tla}"; jar="$cache/tla2tools.jar"
if [ ! -f "$jar" ]; then
  mkdir -p "$cache"
  curl -fsSL -o "$jar" https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar || { echo "tla2tools.jar unavailable" >&2; exit 2; }
fi
command -v java >/dev/null || { echo "java missing" >&2; exit 2; }
here="$(cd "$(dirname "$0")/tla" && pwd)"
meta="$(mktemp -d)"; trap 'rm -rf "$meta"' EXIT
cd "$here"
# -deadlock: a state with no next step is legal here (the clock stops at MaxT). -metadir: TLC's `states/` folder goes to a temporary directory, never into the repository.
java -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers auto -metadir "$meta" -config "$cfg" -deadlock "$@" "$spec"
