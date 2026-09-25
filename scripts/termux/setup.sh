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
# Speech-to-text for videos without Chinese subtitles: whisper-cli from this repository's release
# (scripts/termux/build-binaries.sh), and the base and small models (148 + 488 MB).
RELEASE="${RELEASE:-https://github.com/EmielLanckriet/language-reader/releases/download/tools-d09f61a-d81aef1}"
case "$(uname -m)" in
x86_64) variant=x86_64-avx2 ;;
*) grep -qw asimddp /proc/cpuinfo && variant=arm64-dotprod || variant=arm64 ;;
esac
for tool in whisper-cli llama-completion; do
	curl -fsSL "$RELEASE/$tool-$variant" -o "$PREFIX/bin/$tool"
	chmod +x "$PREFIX/bin/$tool"
done
MODELS="${MODELS:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main}"
mkdir -p ~/.whisper
for model in base small; do
	[ -f ~/.whisper/ggml-$model.bin ] || curl -fL "$MODELS/ggml-$model.bin" -o ~/.whisper/ggml-$model.bin
done
# Translation into English (translate.py): Qwen3-1.7B at Q8, 1.8 GB. Q4 merged lines, so not smaller.
[ -f ~/.whisper/qwen3-1.7b-q8.gguf ] ||
	curl -fL https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf -o ~/.whisper/qwen3-1.7b-q8.gguf

mkdir -p ~/bin
curl -fsSL "$SOURCE/termux-url-opener" -o ~/bin/termux-url-opener
curl -fsSL "$SOURCE/transcribe.py" -o ~/bin/transcribe.py
curl -fsSL "$SOURCE/reader-service.py" -o ~/bin/reader-service.py
curl -fsSL "$SOURCE/translate.py" -o ~/bin/translate.py

# The service that keeps copies of the reader's work and serves transcripts (ADR-0020). Termux:Boot
# (F-Droid, next to Termux; open it once after installing) starts it at boot; opening Termux starts
# it again if Android stopped it.
START='curl -fs -m 2 http://127.0.0.1:8765/health >/dev/null || (nohup python3 ~/bin/reader-service.py >/dev/null 2>&1 &)'
mkdir -p ~/.termux/boot
printf '#!/data/data/com.termux/files/usr/bin/sh\ntermux-wake-lock\n%s\n' "$START" >~/.termux/boot/reader-service
chmod +x ~/.termux/boot/reader-service
grep -q reader-service ~/.bashrc 2>/dev/null || printf '%s\n' "$START" >>~/.bashrc
sh ~/.termux/boot/reader-service
chmod +x ~/bin/termux-url-opener
echo "Done. In YouTube: Share → Termux. For copies at boot, install Termux:Boot from F-Droid and open it once."
