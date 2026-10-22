# Framevane Broadcaster

The phone end of Framevane: camera in, RTMP or SRT out, straight to your own
ingest edge. Built because the alternatives are either paid, or send your video
through somebody else's servers on the way to yours.

## What it does

- Publishes over **RTMP** or **SRT** - SRT matters on a mobile uplink, where it
  recovers from the packet loss that makes RTMP stutter.
- Hardware H.264 encoding through [RootEncoder](https://github.com/pedroSG94/RootEncoder)
  (Apache 2.0), the same library the serious Android broadcasters use.
- Bitrate can be changed **while live** - the one encoder setting that is safe
  to touch mid-broadcast, and the one worth touching when the network dips.
- Pairs with a Framevane stream by scanning a QR code, so the server URL and the
  stream key are never typed on a phone keyboard in a hurry.

## State of it

**Android works. iOS does not yet** - the module builds and runs on iOS, and
every broadcast call fails with a message saying so rather than showing a black
preview. The iOS encoder is a separate implementation (RootEncoder for iOS or
HaishinKit) and needs an Apple Developer account to test on a device at all.

It has been run on a phone. On 13 September 2026 it broadcast end to end -
camera, to the ingest edge, through the compositor, out to YouTube - with no
restarts and no dropped frames, from a destination it got by scanning a pairing
code. Around twenty on-device fixes have landed since the first APK. What has
still not been exercised on real hardware: SRT, recording to the phone,
background broadcasting, and a Bluetooth microphone under load.

## Building

Never Expo Go - this app has native code.

```bash
./scripts/build-release.sh
```

That is how every APK so far has been built, because **GitHub Actions is not
running for this account** over billing. The script bumps `versionCode` and
commits it to `app.json`, runs the pre-flight checks, and builds both the
release and the dev-client APK; it publishes nothing if Gradle fails. It is
self-documenting - read the top of it for the toolchain paths.

For iterating with a device attached:

```bash
bun install
bunx expo run:android
```

When Actions billing is restored, pushing a commit whose subject carries a build
tag builds one on the runner instead:

```
[build:android:preview]
```

See `.github/workflows/mobile-build.yml` at the repo root. Artifacts land on a
GitHub Release.

## Layout

```
modules/framevane-broadcaster/   the native module
  android/  Kotlin: camera, encoder, RTMP/SRT, connection callbacks
  ios/      Swift: honest stub
  index.ts  the JS surface
lib/broadcast/                   connections, endpoint building, the live hook
app/(tabs)/index.tsx             the viewfinder and the GO LIVE button
app/(tabs)/connections.tsx       destinations: scan a code, or type it in
```
