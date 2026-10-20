#!/bin/sh
# Makes a clean Chrome Web Store ZIP of the extension folder in dist/.
# Only what Chrome needs to run goes in: no README, store notes or privacy policy (that's
# linked from the store listing instead).
set -e
cd "$(dirname "$0")"
VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
mkdir -p dist
OUT="dist/herbivore-v${VERSION}.zip"
rm -f "$OUT"
(cd extension && zip -qr "../$OUT" . -x "*.DS_Store" -x "*Thumbs.db")
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
