#!/bin/sh
# Gera dist/panda-qa-recorder-<versão>.zip só com os arquivos da extensão.
set -e
cd "$(dirname "$0")/.."
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
mkdir -p dist
out="dist/panda-qa-recorder-$version.zip"
rm -f "$out"
zip -qr "$out" manifest.json background.js content.js page-hook.js lib sidepanel icons
echo "$out"
# Nome fixo para o asset do release (link .../releases/latest/download/panda-qa-recorder.zip).
cp "$out" dist/panda-qa-recorder.zip
