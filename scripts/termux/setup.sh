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
# Translation runs here; speech-to-text does not: Reader transcribes videos itself (spec 008,
# ADR-0029). llama-completion from this repository's release (scripts/termux/build-binaries.sh).
RELEASE="${RELEASE:-https://github.com/EmielLanckriet/language-reader/releases/download/tools-d09f61a-d81aef1}"
case "$(uname -m)" in
x86_64) variant=x86_64-avx2 ;;
*) grep -qw asimddp /proc/cpuinfo && variant=arm64-dotprod || variant=arm64 ;;
esac
curl -fsSL "$RELEASE/llama-completion-$variant" -o "$PREFIX/bin/llama-completion"
chmod +x "$PREFIX/bin/llama-completion"
# What earlier setups installed for whisper, about 720 MB: gone with Termux's transcription.
rm -f "$PREFIX/bin/whisper-cli" ~/bin/transcribe.py ~/.whisper/ggml-*.bin ~/.whisper/chunk-seconds.json
mkdir -p ~/.whisper
# Translation into English (translate.py): Qwen3-1.7B at Q4_K_M, 1.1 GB, run with --no-repack
# (1.4 GB peak on the phone, against 2.45 GB for the Q8 it replaces; ADR-0023).
[ -f ~/.whisper/qwen3-1.7b-q4.gguf ] ||
	curl -fL https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf -o ~/.whisper/qwen3-1.7b-q4.gguf
rm -f ~/.whisper/qwen3-1.7b-q8.gguf

mkdir -p ~/bin
curl -fsSL "$SOURCE/termux-url-opener" -o ~/bin/termux-url-opener
curl -fsSL "$SOURCE/reader-service.py" -o ~/bin/reader-service.py
curl -fsSL "$SOURCE/reader-service-up" -o ~/bin/reader-service-up
chmod +x ~/bin/reader-service-up
curl -fsSL "$SOURCE/translate.py" -o ~/bin/translate.py

# The service that keeps copies of the reader's work, serves downloads, and takes Reader's
# transcripts to translate (ADR-0020, ADR-0029). Termux:Boot
# (F-Droid, next to Termux; open it once after installing) starts it at boot; opening Termux starts
# it again if Android stopped it. The boot task runs the service in the foreground and so lasts as
# long as it does: Termux keeps its wake lock only while a task or session runs, and a service left
# behind by a task that ended was frozen or killed.
START='curl -fs -m 2 http://127.0.0.1:8765/health >/dev/null || (nohup python3 ~/bin/reader-service.py >/dev/null 2>&1 &)'
mkdir -p ~/.termux/boot
printf '#!/data/data/com.termux/files/usr/bin/sh\nexec ~/bin/reader-service-up\n' >~/.termux/boot/reader-service
chmod +x ~/.termux/boot/reader-service
grep -q reader-service ~/.bashrc 2>/dev/null || printf '%s\n' "$START" >>~/.bashrc
termux-wake-lock
eval "$START"
# Reader Start (android/reader-start) runs reader-service-up through Termux's RUN_COMMAND, which
# Termux refuses unless this is set.
mkdir -p ~/.termux
grep -q '^allow-external-apps *= *true' ~/.termux/termux.properties 2>/dev/null ||
	echo 'allow-external-apps = true' >>~/.termux/termux.properties
termux-reload-settings 2>/dev/null || true
chmod +x ~/bin/termux-url-opener
echo "Done. In YouTube: Share → Termux. For copies at boot, install Termux:Boot from F-Droid and open it once."
echo "For Reader's Start Termux button: Android settings → Apps → Termux → Display over other apps → allow."
