#!/usr/bin/env bash
# Build Reader Start without Gradle: javac, d8, aapt2, zipalign, apksigner from the Android SDK
# (sdkmanager "build-tools;35.0.0" "platforms;android-35"). Install with
#   adb -d install -r android/reader-start/build/reader-start.apk
# Signed with a key kept outside the repository (~/.android/reader-start.keystore, made on first
# build); a reinstall must use the same key, so keep it.
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
TOOLS="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
KEY="$HOME/.android/reader-start.keystore"
rm -rf build && mkdir -p build/classes build/dex

javac -source 11 -target 11 -classpath "$PLATFORM" -d build/classes $(find src -name '*.java')
"$TOOLS/d8" --min-api 26 --lib "$PLATFORM" --output build/dex $(find build/classes -name '*.class')
"$TOOLS/aapt2" link --manifest AndroidManifest.xml -I "$PLATFORM" -o build/unsigned.apk
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$TOOLS/zipalign" -f 4 build/unsigned.apk build/aligned.apk

[ -f "$KEY" ] || keytool -genkeypair -keystore "$KEY" -alias reader-start -keyalg RSA -keysize 2048 \
	-validity 10000 -storepass reader-start -keypass reader-start -dname CN=reader-start
"$TOOLS/apksigner" sign --ks "$KEY" --ks-pass pass:reader-start --out build/reader-start.apk build/aligned.apk
echo "built android/reader-start/build/reader-start.apk"
