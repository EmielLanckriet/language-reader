#!/usr/bin/env bash
# A small ffmpeg and ffprobe for Termux (#24), cross-compiled with the Android NDK, published as a
# GitHub release that setup.sh downloads, like build-binaries.sh does for llama-completion.
#
#   scripts/termux/build-ffmpeg.sh            # build into ./ffmpeg-dist
#   scripts/termux/build-ffmpeg.sh --publish  # and upload as release tools-ffmpeg-<version>
#
# termux-url-opener needs ffmpeg for two things only: yt-dlp merging an mp4 video with an m4a audio
# (a stream copy) and converting YouTube's thumbnail to jpg (webp/png decode, mjpeg encode, the
# mjpeg2jpeg filter); and, since build 2, encoding a spoken story's WAV to AAC (spec 018). Termux's
# ffmpeg package brought 395 MB for that (libllvm, mesa, Vulkan, X11,
# through libplacebo and ocl-icd); this is about 8 MB. On the phone (2026-10-16) its merge and its
# thumbnail were byte-identical to Termux's ffmpeg 8.1.3 for the same download.
set -euo pipefail
VERSION=8.1.3 # Termux's ffmpeg when this replaced it
BUILD=2 # 2: an AAC encoder for spoken stories (spec 018)
NDK="${ANDROID_NDK:-$(ls -d "$HOME"/Android/Sdk/ndk/* | tail -1)}"
WORK="${WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
OUT="$PWD/ffmpeg-dist"
tc=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin

curl -fsSL "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz" -o "$WORK/ffmpeg.tar.xz"
tar xf "$WORK/ffmpeg.tar.xz" -C "$WORK"

# build <name> <arch> <clang triple> [configure args...]
build() {
	local name=$1 arch=$2 triple=$3 src="$WORK/build-$1"
	shift 3
	rm -rf "$src" && cp -r "$WORK/ffmpeg-$VERSION" "$src"
	(
		cd "$src"
		./configure \
			--prefix="$src/install" --target-os=android --arch="$arch" --enable-cross-compile \
			--cc="$tc/$triple-clang" --cxx="$tc/$triple-clang++" \
			--nm="$tc/llvm-nm" --ar="$tc/llvm-ar" --ranlib="$tc/llvm-ranlib" --strip="$tc/llvm-strip" \
			--enable-pic --disable-shared --enable-static --disable-doc --disable-debug \
			--disable-network --disable-autodetect --enable-zlib --disable-everything --disable-ffplay \
			--enable-ffmpeg --enable-ffprobe --enable-swscale --enable-avfilter \
			--enable-protocol=file,pipe \
			--enable-demuxer=mov,matroska,image2,webp_pipe,png_pipe,jpeg_pipe,image_webp_pipe,image_png_pipe,image_jpeg_pipe,aac,mp3,ogg,wav \
			--enable-muxer=mp4,mov,ipod,matroska,webm,image2,mjpeg,ogg,adts \
			--enable-decoder=webp,vp8,png,mjpeg,bmp,pcm_s16le,pcm_f32le \
			--enable-encoder=mjpeg,png,aac \
			--enable-parser=h264,hevc,aac,vp8,vp9,av1,opus,png,mjpeg,webp \
			--enable-bsf=mjpeg2jpeg,aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,vp9_superframe,extract_extradata,av1_frame_merge \
			--enable-filter=scale,format,null,anull,copy,buffer,buffersink,abuffer,abuffersink,aformat,aresample \
			"$@" >/dev/null
		make -j"$(nproc)" >/dev/null
		make install >/dev/null
	)
	mkdir -p "$OUT"
	cp "$src/install/bin/ffmpeg" "$OUT/ffmpeg-$name"
	cp "$src/install/bin/ffprobe" "$OUT/ffprobe-$name"
}
build arm64 aarch64 aarch64-linux-android24 --cpu=armv8-a
# The emulator only; without nasm, so no x86 assembly (a stream copy does not need it).
build x86_64 x86_64 x86_64-linux-android24 --disable-asm
ls -la "$OUT"

if [ "${1:-}" = --publish ]; then
	tag="tools-ffmpeg-$VERSION-$BUILD"
	gh release create "$tag" "$OUT"/* --title "ffmpeg $VERSION for Termux (merge and thumbnails only)" \
		--notes "Built by scripts/termux/build-ffmpeg.sh from ffmpeg $VERSION (LGPL 2.1+; source at https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz), configured for what termux-url-opener asks of it. Replaces Termux's ffmpeg package (#24)."
fi
