#!/usr/bin/env bash
# Cross-compile llama-completion for Termux and publish it as a GitHub release, which setup.sh
# downloads. Termux does not package it, and building on the phone would bring back clang
# (ADR-0017). whisper-cli is no longer built: Reader transcribes in the browser (ADR-0029).
#
#   scripts/termux/build-binaries.sh            # build into ./whisper-dist
#   scripts/termux/build-binaries.sh --publish  # and upload as release tools-llama-<llama>
#
# setup.sh still downloads from the older release tools-d09f61a-d81aef1, which has this same
# llama-completion; point its RELEASE at a new one after publishing.
#
# Needs the Android NDK (sdkmanager "ndk;28.2.13676358") and git.
set -euo pipefail
LLAMA=d81aef1   # llama.cpp, for translation (Qwen3-1.7B); bump deliberately and re-measure
NDK="${ANDROID_NDK:-$(ls -d "$HOME"/Android/Sdk/ndk/* | tail -1)}"
WORK="${WORK:-$(mktemp -d)}"
OUT="$PWD/whisper-dist"

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
		-DBUILD_SHARED_LIBS=OFF -DGGML_OPENMP=OFF -DGGML_NATIVE=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release "$@" >/dev/null
	cmake --build "$WORK/build-$source-$name" -j "$(nproc)" --target "$target" >/dev/null
	mkdir -p "$OUT"
	"$NDK"/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip -o "$OUT/$target-$name" \
		"$WORK/build-$source-$name/bin/$target"
}
DOTPROD=(-DANDROID_ABI=arm64-v8a -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16)
BASELINE=(-DANDROID_ABI=arm64-v8a)
AVX2=(-DANDROID_ABI=x86_64 -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON)
build llama.cpp llama-completion arm64-dotprod "${DOTPROD[@]}"
build llama.cpp llama-completion arm64 "${BASELINE[@]}"
build llama.cpp llama-completion x86_64-avx2 "${AVX2[@]}"
(cd "$OUT" && sha256sum llama-completion-* >SHA256SUMS && ls -la)

if [ "${1:-}" = --publish ]; then
	gh release create "tools-llama-$LLAMA" "$OUT"/* --title "llama-completion $LLAMA for Termux" \
		--notes "Cross-compiled by scripts/termux/build-binaries.sh. Downloaded by scripts/termux/setup.sh."
fi
