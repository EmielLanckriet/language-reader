#!/data/data/com.termux/files/usr/bin/bash
# One-time setup on the phone. Install Termux from F-Droid (the Play Store build is abandoned),
# open it, and run:
#   curl -fsSL https://raw.githubusercontent.com/EmielLanckriet/language-reader/main/scripts/termux/setup.sh | bash
set -euo pipefail
SOURCE="${SOURCE:-https://raw.githubusercontent.com/EmielLanckriet/language-reader/main/scripts/termux}"
pkg upgrade -y -o Dpkg::Options::=--force-confnew
# Without recommends: python-pip and nodejs recommend clang, which took the install to 1.2 GB.
pkg install -y --no-install-recommends python nodejs curl
# A small ffmpeg from this repository's release (scripts/termux/build-ffmpeg.sh): yt-dlp needs it
# only to merge video and audio and to convert the thumbnail, and Termux's package brought 395 MB
# of graphics libraries for that (#24). Termux's own one replaces it if `pkg install ffmpeg` runs.
FFMPEG_RELEASE="${FFMPEG_RELEASE:-https://github.com/EmielLanckriet/language-reader/releases/download/tools-ffmpeg-8.1.3-2}"
case "$(uname -m)" in x86_64) arch=x86_64 ;; *) arch=arm64 ;; esac
for tool in ffmpeg ffprobe; do
	curl -fsSL "$FFMPEG_RELEASE/$tool-$arch" -o "$PREFIX/bin/$tool"
	chmod +x "$PREFIX/bin/$tool"
done
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
curl -fsSL "$SOURCE/reader-service-start" -o ~/bin/reader-service-start
chmod +x ~/bin/reader-service-start
curl -fsSL "$SOURCE/translate.py" -o ~/bin/translate.py
# Stories (spec 016): a draft on the phone when the laptop's writer is not reachable.
curl -fsSL "$SOURCE/story.py" -o ~/bin/story.py
# Spoken stories (spec 018): speak.py makes a story a download, read aloud by MeloTTS through a
# static sherpa-onnx build (scripts/termux/tts/build-tts.sh), about 200 MB with the voice.
curl -fsSL "$SOURCE/speak.py" -o ~/bin/speak.py
TTS_RELEASE="${TTS_RELEASE:-https://github.com/EmielLanckriet/language-reader/releases/download/tools-tts-1.13.8}"
if [ "$(uname -m)" = aarch64 ]; then
	mkdir -p ~/opt/tts/melo
	curl -fsSL "$TTS_RELEASE/speak-arm64" -o ~/opt/tts/speak && chmod +x ~/opt/tts/speak
	[ -f ~/opt/tts/melo/model.onnx ] || curl -fsSL "$TTS_RELEASE/melo-zh-en.tar" | tar xf - -C ~/opt/tts/melo
fi

# The service that keeps copies of the reader's work, serves downloads, and takes Reader's
# transcripts to translate (ADR-0020, ADR-0029). Termux:Boot
# (F-Droid, next to Termux; open it once after installing) starts it at boot; opening Termux starts
# it again if Android stopped it. Both run the service in the foreground of a task, which lasts as
# long as it does: Termux keeps its foreground service only while a task or session runs, and a
# service left behind by a task or session that ended was frozen or killed (issue #17). No wake lock
# here: the service takes it only while a download or translation runs (issue #27).
mkdir -p ~/.termux/boot
printf '#!/data/data/com.termux/files/usr/bin/sh\nexec ~/bin/reader-service-up\n' >~/.termux/boot/reader-service
chmod +x ~/.termux/boot/reader-service
# Replaces the line an earlier setup wrote, which started the service in the session itself.
sed -i '/reader-service/d' ~/.bashrc 2>/dev/null || true
echo '~/bin/reader-service-start' >>~/.bashrc
# Reader Start (android/reader-start) runs reader-service-up through Termux's RUN_COMMAND, which
# Termux refuses unless this is set.
mkdir -p ~/.termux
grep -q '^allow-external-apps *= *true' ~/.termux/termux.properties 2>/dev/null ||
	echo 'allow-external-apps = true' >>~/.termux/termux.properties
termux-reload-settings 2>/dev/null || true
~/bin/reader-service-start
chmod +x ~/bin/termux-url-opener
echo "Done. In YouTube: Share → Termux. For copies at boot, install Termux:Boot from F-Droid and open it once."
echo "For Reader's Start Termux button: Android settings → Apps → Termux → Display over other apps → allow."
