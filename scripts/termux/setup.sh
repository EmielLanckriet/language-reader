#!/data/data/com.termux/files/usr/bin/bash
# One-time setup on the phone. Install Termux from F-Droid (the Play Store build is abandoned),
# open it, and run:
#   curl -fsSL https://raw.githubusercontent.com/EmielLanckriet/language-reader/main/scripts/termux/setup.sh | bash
set -euo pipefail
SOURCE="${SOURCE:-https://raw.githubusercontent.com/EmielLanckriet/language-reader/main/scripts/termux}"
pkg upgrade -y -o Dpkg::Options::=--force-confnew
# Without recommends: python-pip and nodejs recommend clang, which took the install to 1.2 GB.
pkg install -y --no-install-recommends python ffmpeg nodejs curl
# yt-dlp's own single-file release, so no pip; `yt-dlp -U` updates it when YouTube breaks it.
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "$PREFIX/bin/yt-dlp"
chmod +x "$PREFIX/bin/yt-dlp"
mkdir -p ~/bin
curl -fsSL "$SOURCE/termux-url-opener" -o ~/bin/termux-url-opener
chmod +x ~/bin/termux-url-opener
echo "Done. In YouTube: Share → Termux."
