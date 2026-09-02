#!/usr/bin/env bash
# Regenerate the application's icons from static/icon.svg.
#
# The PNGs are committed, so this script is not part of the build and nothing needs Inkscape or a
# CJK font to check out and build the project. It exists so the icons are reproducible rather than
# mysterious, per Principle VII: static/icon.svg is the source a human edits, this is the committed
# command that regenerates the artifacts, and the PNGs are never hand-edited.
#
# static/icon.svg already has the glyph as outlines rather than as <text>, so it renders identically
# anywhere. It was produced once from this, with Noto Sans CJK SC installed:
#
#   <text x="256" y="350" font-family="Noto Sans CJK SC" font-weight="500"
#         font-size="296" fill="#1a1a1a" text-anchor="middle">听</text>
#
#   inkscape --export-text-to-path --export-plain-svg \
#            --export-filename=static/icon.svg  <that file>
#
# Note for anyone re-running this: Inkscape here is a snap, so it cannot read /tmp and resolves
# relative paths against $HOME. Absolute paths inside the repository are the way to keep it happy.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

render() { # <source> <size> <output>
	inkscape --export-type=png --export-width="$2" --export-height="$2" \
		--export-filename="$ROOT/$3" "$ROOT/$1" 2>/dev/null
	echo "  $3 (${2}px)"
}

echo "icons:"
render static/icon.svg 192 static/icon-192.png
render static/icon.svg 512 static/icon-512.png
render static/icon-maskable.svg 512 static/icon-maskable-512.png
