#!/usr/bin/env bash
# Cross-compile whisper-cli for Termux and publish it as a GitHub release, which setup.sh downloads.
# Termux has no whisper.cpp package, and building on the phone would bring back clang (ADR-0017).
#
#   scripts/termux/build-whisper.sh            # build into ./whisper-dist
#   scripts/termux/build-whisper.sh --publish  # and upload as release whisper-<commit>
#
# Needs the Android NDK (sdkmanager "ndk;28.2.13676358") and git.
set -euo pipefail
COMMIT=d09f61a # whisper.cpp; bump deliberately and re-measure
NDK="${ANDROID_NDK:-$(ls -d "$HOME"/Android/Sdk/ndk/* | tail -1)}"
WORK="${WORK:-$(mktemp -d)}"
OUT="$PWD/whisper-dist"

git clone -q https://github.com/ggml-org/whisper.cpp "$WORK/whisper.cpp"
git -C "$WORK/whisper.cpp" checkout -q "$COMMIT"

# GGML_NATIVE=OFF alone targets the baseline instruction set, which measured 4.4x slower (no AVX2 on
# the emulator); on ARM the equivalent is dotprod+fp16, present on nearly every phone since 2018.
# The baseline arm64 build is the fallback for the rest; setup.sh picks by /proc/cpuinfo.
build() {
	local name=$1
	shift
	cmake -S "$WORK/whisper.cpp" -B "$WORK/build-$name" \
		-DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" -DANDROID_PLATFORM=android-28 \
		-DBUILD_SHARED_LIBS=OFF -DGGML_OPENMP=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF \
		-DWHISPER_SDL2=OFF -DCMAKE_BUILD_TYPE=Release "$@" >/dev/null
	cmake --build "$WORK/build-$name" -j "$(nproc)" --target whisper-cli >/dev/null
	mkdir -p "$OUT"
	"$NDK"/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip -o "$OUT/whisper-cli-$name" \
		"$WORK/build-$name/bin/whisper-cli"
}
build arm64-dotprod -DANDROID_ABI=arm64-v8a -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16
build arm64 -DANDROID_ABI=arm64-v8a
build x86_64-avx2 -DANDROID_ABI=x86_64 -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON
(cd "$OUT" && sha256sum whisper-cli-* >SHA256SUMS && ls -la)

if [ "${1:-}" = --publish ]; then
	gh release create "whisper-$COMMIT" "$OUT"/* --title "whisper-cli $COMMIT for Termux" \
		--notes "whisper.cpp $COMMIT cross-compiled by scripts/termux/build-whisper.sh. Downloaded by scripts/termux/setup.sh."
fi
