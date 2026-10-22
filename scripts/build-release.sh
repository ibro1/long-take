#!/usr/bin/env bash
#
# Builds the release and dev-client APKs on this machine.
#
# GitHub Actions is refusing to run for this account (billing), so release
# builds happen here and are uploaded to a GitHub release by hand. This script
# is the whole procedure; it used to live in a scratch directory, which meant
# the only way to ship the app disappeared whenever the scratch dir was cleaned.
#
# Usage:  ./scripts/build-release.sh            # bumps versionCode, builds both
#         KEEP_VERSION=1 ./scripts/build-release.sh   # rebuild without bumping
#
set -uo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MOBILE_DIR" || exit 1

export ANDROID_HOME="${ANDROID_HOME:-/mnt/shared/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# The JDK, wherever it is this time.
#
# It used to be the distribution's /usr/lib/jvm/java-17-openjdk-amd64, which is
# a system package - so a rebuilt machine has the Android SDK still sitting on
# shared storage and no Java at all, and the only symptom is "missing
# toolchain" with no hint that the two live in different places. The shared
# copy is looked for first because it is the one that survives; the system path
# stays as a fallback for a machine that has one.
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "${JAVA_HOME}/bin/javac" ]; then
  for candidate in /mnt/shared/.toolchain/jdk-17* /usr/lib/jvm/java-17-openjdk-amd64; do
    if [ -x "$candidate/bin/javac" ]; then
      JAVA_HOME="$candidate"
      break
    fi
  done
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

for required in "$ANDROID_HOME" "$JAVA_HOME"; do
  if [ ! -d "$required" ]; then
    echo "missing toolchain: $required" >&2
    exit 1
  fi
done

LOG_DIR="${BUILD_LOG_DIR:-$(mktemp -d -t framevane-build-XXXXXX)}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/gradle.log"

# Android refuses to install an APK whose versionCode is lower than the one on
# the device, and Sentry groups crashes by version. Every build before this one
# went out as versionCode 1, so eleven different binaries all reported as the
# same release. Bump it once per build and keep the number in app.json, so the
# committed value is the record of what was shipped.
if [ -z "${KEEP_VERSION:-}" ]; then
  node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync("app.json", "utf8"));
    j.expo.android.versionCode = (j.expo.android.versionCode || 0) + 1;
    fs.writeFileSync("app.json", JSON.stringify(j, null, 2) + "\n");
    console.log("versionCode -> " + j.expo.android.versionCode);
  ' || exit 1
fi
VERSION_CODE=$(node -p 'require("./app.json").expo.android.versionCode')

# Pre-flight. Each of these checks a mistake that has already cost a build: a
# Kotlin stdlib the Expo toolchain cannot read, a native module whose Kotlin no
# longer matches the TypeScript contract, and a hook added below an early
# return - which type-checks, bundles, and crashes the screen on the first
# render that takes the early branch.
node scripts/check-kotlin-window.mjs || exit 1
node scripts/check-native-contract.mjs || exit 1
node scripts/check-hooks.mjs || exit 1
node --test --experimental-strip-types "lib/**/*.test.ts" || exit 1

# A config plugin change (Sentry, icons, splash) alters the generated project,
# so it has to be regenerated rather than merely recompiled.
npx expo prebuild --platform android --no-install || exit 1

# prebuild rewrites this file, so the metaspace raise has to be re-applied:
# Android lint runs the JVM out of it on Expo's own sources at the default 512m.
sed -i 's#^org.gradle.jvmargs=.*#org.gradle.jvmargs=-Xmx6144m -XX:MaxMetaspaceSize=2048m#' android/gradle.properties

# One architecture, not four.
#
# The default builds arm64-v8a, armeabi-v7a, x86 and x86_64, and ships all of
# them: 96 MB of the 128 MB APK was native libraries, three quarters of which no
# handset can run. x86 and x86_64 exist for emulators, and armeabi-v7a is 32-bit
# hardware from before about 2019. It is also four native compiles instead of
# one, which is most of the build time.
#
# Set ANDROID_ABIS to widen it - "arm64-v8a,armeabi-v7a" to support older
# phones, or all four to run this on an emulator.
ABIS="${ANDROID_ABIS:-arm64-v8a}"
if grep -q '^reactNativeArchitectures=' android/gradle.properties; then
  sed -i "s#^reactNativeArchitectures=.*#reactNativeArchitectures=$ABIS#" android/gradle.properties
else
  printf '\nreactNativeArchitectures=%s\n' "$ABIS" >> android/gradle.properties
fi
echo "building for: $ABIS"

# Sentry's Gradle step uploads source maps and fails the whole build when there
# is no organisation to upload them to. Symbolicated stack traces are worth
# having; they are not worth making the app unbuildable without a Sentry account.
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi

# A build without a DSN reports no crashes at all, and nothing says so on the
# phone. Shipping blind should be a choice made on purpose, so it is said here.
if [ -z "${EXPO_PUBLIC_SENTRY_DSN:-}" ]; then
  echo "WARNING: EXPO_PUBLIC_SENTRY_DSN is not set - this build will NOT report crashes." >&2
  echo "         Set it to the Framevane project's DSN at bug.linkfa.de and rebuild." >&2
else
  echo "crash reporting: on"
fi

cd android || exit 1

# expo-updates writes the embedded manifest and, for a fingerprint runtime
# version, the fingerprint itself in createXUpdatesResources. That task does not
# declare app.json among its inputs, so Gradle calls it UP-TO-DATE after the
# updates config changes and quietly reuses the previous build's output. That is
# how build 12 first went out carrying the `file:fingerprint` sentinel with no
# fingerprint asset behind it - a combination expo-updates resolves by opening
# an asset that is not there, which throws during startup. Cheap to regenerate,
# so never trust the cache for it.
rm -rf app/build/generated/assets/createReleaseUpdatesResources \
       app/build/generated/assets/createDebugUpdatesResources

./gradlew assembleRelease assembleDebug --no-daemon --max-workers=4 \
  -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease > "$LOG" 2>&1
STATUS=$?
cd "$MOBILE_DIR" || exit 1

# Publishing a failed build's stale artefacts is worse than publishing nothing:
# it hands someone an APK wearing a name it has not earned. This happened once.
if [ "$STATUS" -ne 0 ]; then
  echo "BUILD FAILED (exit $STATUS) - nothing to publish"
  echo "full log: $LOG"
  grep -E "^e: |error:|What went wrong|Execution failed" "$LOG" | head -12
  exit "$STATUS"
fi

REL=android/app/build/outputs/apk/release/app-release.apk
DEV=android/app/build/outputs/apk/debug/app-debug.apk
for apk in "$REL" "$DEV"; do
  if [ ! -f "$apk" ]; then
    echo "gradle reported success but $apk is missing" >&2
    exit 1
  fi
done

# Check the artefact rather than the configuration that was meant to produce it.
# Everything above can succeed and still leave an APK that cannot start.
AAPT=$(find "$ANDROID_HOME/build-tools" -name aapt2 2>/dev/null | sort | tail -1)
if [ -n "$AAPT" ]; then
  BUILT_CODE=$("$AAPT" dump badging "$REL" 2>/dev/null | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)
  if [ "$BUILT_CODE" != "$VERSION_CODE" ]; then
    echo "APK reports versionCode $BUILT_CODE, expected $VERSION_CODE - stale build" >&2
    exit 1
  fi
  RV=$("$AAPT" dump resources "$REL" 2>/dev/null | grep -A1 'string/expo_runtime_version' | tail -1)
  case "$RV" in
    *file:fingerprint*)
      # Read the archive in one process rather than `unzip -l | grep -q`.
      # grep -q exits on the first match, unzip takes SIGPIPE, and `set -o
      # pipefail` reports that as failure - but only when unzip's output is
      # bigger than the pipe buffer, so the check passed or failed depending on
      # how many entries the APK happened to have. A test that flaky is worse
      # than none: it teaches you to ignore it.
      if ! python3 -c "import sys, zipfile; sys.exit(0 if 'assets/fingerprint' in zipfile.ZipFile(sys.argv[1]).namelist() else 1)" "$REL"; then
        echo "APK asks for a fingerprint runtime version but carries no fingerprint asset." >&2
        echo "expo-updates opens that asset at startup; without it the app throws." >&2
        exit 1
      fi
      ;;
  esac
fi

echo "OK  versionCode $VERSION_CODE"
ls -la "$REL" "$DEV" | awk '{print $5, $9}'
echo "log: $LOG"
