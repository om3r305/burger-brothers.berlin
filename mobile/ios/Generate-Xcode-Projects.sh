#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen not found. Install it on macOS first: brew install xcodegen" >&2
  exit 1
fi
for APP in burger-brothers bb-schnell bb-driver; do
  echo "Generating $APP"
  (cd "$ROOT/$APP" && xcodegen generate)
done
echo "All iOS projects generated. Open each .xcodeproj in Xcode and select your Apple Team."
