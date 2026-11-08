#!/usr/bin/env bash
# Crée dist/furet-v<version>.zip, installable via « Charger l'extension non empaquetée ».
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')
out="dist/furet-v${version}.zip"
mkdir -p dist
rm -f "$out"
zip -qr "$out" manifest.json background.js popup.html popup.css popup.js player.html player.css player.js lib icons -x '*.DS_Store'
echo "$out"
