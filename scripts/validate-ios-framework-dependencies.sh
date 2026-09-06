#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "Usage: $0 <app-path>" >&2
  exit 64
fi

app_path=$1
checked=0
while IFS= read -r -d '' candidate; do
  [[ "$(file -b "$candidate")" == *Mach-O* ]] || continue
  # Inspect load commands, excluding the dylib's own ID and optional weak links.
  commands=$(otool -l "$candidate")
  dependencies=$(awk '
    $1 == "cmd" { required = ($2 == "LC_LOAD_DYLIB" || $2 == "LC_REEXPORT_DYLIB" || $2 == "LC_LOAD_UPWARD_DYLIB") }
    required && $1 == "name" { sub(/^[[:space:]]*name /, ""); sub(/ \(offset [0-9]+\)$/, ""); print }
  ' <<<"$commands")
  while IFS= read -r dependency; do
    case "$dependency" in
      @rpath/*.framework/*)
        if [[ ! -f "$app_path/Frameworks/${dependency#@rpath/}" ]]; then
          echo "Missing embedded framework: $dependency (required by ${candidate#"$app_path/"})" >&2
          exit 1
        fi
        checked=$((checked + 1))
        ;;
    esac
  done <<<"$dependencies"
done < <(find "$app_path" -type f -print0)

((checked > 0)) || { echo 'No required embedded framework references found' >&2; exit 1; }
echo "Validated $checked required embedded framework references"
