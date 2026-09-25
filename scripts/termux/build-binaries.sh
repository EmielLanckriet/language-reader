#!/usr/bin/env bash
# Cross-compile whisper-cli and llama-completion for Termux and publish them as a GitHub release,
# which setup.sh downloads. Termux packages neither, and building on the phone would bring back
# clang (ADR-0017).
#
#   scripts/termux/build-binaries.sh            # build into ./whisper-dist
#   scripts/termux/build-binaries.sh --publish  # and upload as release tools-<whisper>-<llama>
#
# Needs the Android NDK (sdkmanager "ndk;28.2.13676358") and git.
set -euo pipefail
COMMIT=d09f61a  # whisper.cpp; bump deliberately and re-measure
LLAMA=d81aef1   # llama.cpp, for translation (Qwen3-1.7B); same rule
NDK="${ANDROID_NDK:-$(ls -d "$HOME"/Android/Sdk/ndk/* | tail -1)}"
WORK="${WORK:-$(mktemp -d)}"
OUT="$PWD/whisper-dist"

git clone -q https://github.com/ggml-org/whisper.cpp "$WORK/whisper.cpp"
git -C "$WORK/whisper.cpp" checkout -q "$COMMIT"
git clone -q https://github.com/ggml-org/llama.cpp "$WORK/llama.cpp"
git -C "$WORK/llama.cpp" checkout -q "$LLAMA"

# GGML_NATIVE=OFF alone targets the baseline instruction set, which measured 4.4x slower (no AVX2 on
# the emulator); on ARM the equivalent is dotprod+fp16, present on nearly every phone since 2018.
# The baseline arm64 build is the fallback for the rest; setup.sh picks by /proc/cpuinfo.
# build <source> <target> <name> <cmake args...>
build() {
	local source=$1 target=$2 name=$3
	shift 3
	cmake -S "$WORK/$source" -B "$WORK/build-$source-$name" \
		-DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" -DANDROID_PLATFORM=android-28 \
		-DBUILD_SHARED_LIBS=OFF -DGGML_OPENMP=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF \
		-DWHISPER_SDL2=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release "$@" >/dev/null
	cmake --build "$WORK/build-$source-$name" -j "$(nproc)" --target "$target" >/dev/null
	mkdir -p "$OUT"
	"$NDK"/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip -o "$OUT/$target-$name" \
		"$WORK/build-$source-$name/bin/$target"
}
DOTPROD=(-DANDROID_ABI=arm64-v8a -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16)
BASELINE=(-DANDROID_ABI=arm64-v8a)
AVX2=(-DANDROID_ABI=x86_64 -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON)
for tool in "whisper.cpp whisper-cli" "llama.cpp llama-completion"; do
	set -- $tool
	build "$1" "$2" arm64-dotprod "${DOTPROD[@]}"
	build "$1" "$2" arm64 "${BASELINE[@]}"
	build "$1" "$2" x86_64-avx2 "${AVX2[@]}"
done
(cd "$OUT" && sha256sum whisper-cli-* llama-completion-* >SHA256SUMS && ls -la)

if [ "${1:-}" = --publish ]; then
	gh release create "tools-$COMMIT-$LLAMA" "$OUT"/* --title "whisper-cli $COMMIT, llama-completion $LLAMA for Termux" \
		--notes "Cross-compiled by scripts/termux/build-binaries.sh. Downloaded by scripts/termux/setup.sh."
fi
