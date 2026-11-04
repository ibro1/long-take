# Framevane Broadcaster

A Filmic-style camera and recorder for Android that also streams. Point it at
any RTMP or SRT server, or at a [Framevane](https://framevane.linkfa.de) relay
and let the server do the rest.

Built because the alternatives are either paid, closed, or send your video
through somebody else's servers on the way to yours.

## What it does

**It records first and streams when you say so.** With no destination chosen it
is a camera: shutter, manual focus and exposure, LUTs, zebras, false colour,
focus peaking, timelapse. Choose a destination and the same viewfinder becomes a
live broadcast, still recording to the phone if you want it.

- Publishes over **RTMP** or **SRT** - SRT matters on a mobile uplink, where it
  recovers from the packet loss that makes RTMP stutter.
- Hardware H.264 through [RootEncoder](https://github.com/pedroSG94/RootEncoder)
  (Apache 2.0), the same library the serious Android broadcasters use.
- Bitrate can be changed **while live** - the one encoder setting that is safe
  to touch mid-broadcast, and the one worth touching when the network dips.
- Takes an external microphone the moment one appears. Android never prefers an
  accessory, so a transmitter switched on in a pocket was ignored and the room
  is what went out. USB receiver, then wired, then Bluetooth.
- Records to the phone in split files, exported to `Movies/Framevane`, so a
  three-hour take is not one chance at a muxer finishing.
- Pairs with a Framevane stream by scanning a QR code, so the server URL and the
  stream key are never typed on a phone keyboard in a hurry.
- Ships with Hausa and Arabic, because the people it was built for broadcast in
  them.

Nothing about the camera or the standard streaming is gated. If you never touch
the Framevane relay, the app is simply a good broadcaster.

## State of it

**Android works. iOS does not yet.** The native module builds and runs on iOS
and every broadcast call fails with a message saying so, rather than showing a
black preview. The iOS encoder is a separate implementation (RootEncoder for iOS
or HaishinKit) and needs an Apple Developer account to test on a device at all.

Android is in daily use for long live lectures - multi-destination fan-out,
recording through the phone and server-side overlays in production since
September 2026. The parts still exercised only lightly: **SRT on a congested
uplink**, **Bluetooth call recovery under load**, and **timelapse on the
longest takes**. Those are the places a bug report is most valuable.

## Building

Never Expo Go - this app has native code.

```bash
./scripts/build-release.sh
```

It bumps `versionCode`, commits it to `app.json`, runs the pre-flight checks,
and builds the release and dev-client APKs. It publishes nothing if Gradle
fails. The toolchain paths it needs are documented at the top of the script.

For iterating against a device you have to build locally first - a JS change
alone can go over the air with `npx eas-cli update`, which is far cheaper than a
new APK:

```bash
npx expo run:android          # first time, and after any Kotlin change
npx expo start --dev-client   # after that
```

## Checks

There is no CI yet; these are what to run before a pull request.

```bash
node --test --experimental-strip-types "lib/**/*.test.ts"   # unit tests
npx tsc --noEmit                                            # types
node scripts/check-hooks.mjs                                # no hook below an early return
node scripts/check-kotlin-window.mjs                        # the encoder pin is still legal
node scripts/check-native-contract.mjs                      # JS, Kotlin and Swift agree
node --experimental-strip-types scripts/test-pairing.mjs    # pairing links, both ends
```

`check-native-contract.mjs` currently **fails** on iOS: the Swift stubs do not
declare the camera-monitoring and rolling-shutter calls the JS side offers. That
is a real gap, not a flake, and fixing it is a good first contribution.

## Layout

```
modules/framevane-broadcaster/   the native module
  android/  Kotlin: camera, encoder, RTMP/SRT, connection callbacks
  ios/      Swift: honest stub
  index.ts  the JS surface
lib/broadcast/                   connections, endpoint building, the live hook
lib/product.ts                   the Framevane service address, and nothing else
app/(tabs)/index.tsx             the viewfinder and the GO LIVE button
app/(tabs)/connections.tsx       destinations: scan a code, or type it in
```

## Licence

GPL-3.0-or-later. See `LICENSE`, and `THIRD-PARTY-NOTICES.md` for the work this
is built on.

The licence covers the code. The name and the icon do not come with it: a fork
is welcome, but a fork distributed to other people needs its own name, icon and
application id. `lib/product.ts` is the one file that names the hosted relay,
and a fork replaces it.

## Contributing

See `CONTRIBUTING.md`. Short version: fork, branch, run the checks, describe
what you saw on a real phone.
