#!/bin/sh
# Build step proof: TypeScript -> plain JS that Gecko loads. Output goes into the app folder.
# Uses the esbuild already installed for the Electron app (app/node_modules). Run from Git Bash.
HERE="$(cd "$(dirname "$0")" && pwd)"
ESB="$HERE/../../../../app/node_modules/.bin/esbuild"
# 1. system modules + actors: one file in, one file out, ESM, NO bundling (.sys.ts -> .sys.mjs)
"$ESB" "$HERE/src/modules/TsProbe.sys.ts" --format=esm --target=firefox140 \
  --outdir="$HERE/../app/modules/generated" --out-extension:.js=.mjs --log-level=warning
# 2. per-window UI: bundle into one classic script (IIFE) for loadSubScript
"$ESB" "$HERE/src/chrome/window.ts" --bundle --format=iife --target=firefox140 \
  --outfile="$HERE/../app/chrome/generated/window.bundle.js" --log-level=warning
