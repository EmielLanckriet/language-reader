#!/usr/bin/env bash
# Cross-compile Reader's story speaker for Termux (spec 018): sherpa-onnx's static Android build with
# speak-c-api.c added to its C API examples, one self-contained arm64 binary.
#
#   scripts/termux/tts/build-tts.sh            # build into ./tts-dist
#   scripts/termux/tts/build-tts.sh --publish  # and upload as release tools-tts-<sherpa version>
set -euo pipefail
SHERPA=v1.13.8 # the version measured on the laptop (scripts/measure/tts)
HERE=$(cd "$(dirname "$0")" && pwd)
NDK="${ANDROID_NDK:-$(ls -d "$HOME"/Android/Sdk/ndk/* | tail -1)}"
WORK="${WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
OUT="$PWD/tts-dist"

[ -d "$WORK/sherpa-onnx" ] || git clone -q --depth 1 --branch "$SHERPA" https://github.com/k2-fsa/sherpa-onnx "$WORK/sherpa-onnx"
cd "$WORK/sherpa-onnx"
cp "$HERE/speak-c-api.c" c-api-examples/
grep -q speak-c-api c-api-examples/CMakeLists.txt ||
	printf '\nadd_executable(speak-c-api speak-c-api.c)\ntarget_link_libraries(speak-c-api sherpa-onnx-c-api)\n' >>c-api-examples/CMakeLists.txt
sed -i 's/-DSHERPA_ONNX_ENABLE_C_API=$SHERPA_ONNX_ENABLE_C_API \\/-DSHERPA_ONNX_ENABLE_C_API=$SHERPA_ONNX_ENABLE_C_API -DSHERPA_ONNX_BUILD_C_API_EXAMPLES=ON \\/' build-android-arm64-v8a.sh
ANDROID_NDK="$NDK" BUILD_SHARED_LIBS=OFF SHERPA_ONNX_ENABLE_BINARY=ON SHERPA_ONNX_ENABLE_C_API=ON \
	SHERPA_ONNX_ENABLE_JNI=OFF SHERPA_ONNX_ENABLE_TTS=ON bash build-android-arm64-v8a.sh
mkdir -p "$OUT"
"$NDK"/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip -o "$OUT/speak-arm64" build-android-arm64-v8a-static/bin/speak-c-api
ls -la "$OUT"

if [ "${1:-}" = --publish ]; then
	gh release create "tools-tts-${SHERPA#v}" "$OUT"/* --title "Story speaker for Termux (sherpa-onnx ${SHERPA#v})" \
		--notes "Built by scripts/termux/tts/build-tts.sh: sherpa-onnx ${SHERPA#v} (Apache-2.0), static, with speak-c-api.c. Speaks Reader's stories with MeloTTS (spec 018)."
fi
