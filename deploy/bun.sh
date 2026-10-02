#!/bin/sh
set -eu

# Keep bootstrap dependencies outside the app's Bun-managed workspace.
tool_dir="${TMPDIR:-/tmp}/xeom-build-bun-1.4.0"
if ! "$tool_dir/node_modules/.bin/bun" --version >/dev/null 2>&1; then
  mkdir -p "$tool_dir"
  printf '%s\n' '{"private":true,"dependencies":{"bun":"1.4.0"}}' > "$tool_dir/package.json"
  printf '%s\n' '{"nodeModulesDir":"auto"}' > "$tool_dir/deno.json"
  # Deno skips lifecycle scripts unless explicitly allowed for this package.
  (cd "$tool_dir" && deno install --allow-scripts=npm:bun)
fi
export PATH="$tool_dir/node_modules/.bin:$PATH"
exec bun "$@"
