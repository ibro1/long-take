# Contributing

Bug reports and pull requests are welcome. This is a small project maintained
around a production job, so the fastest way to get a change accepted is to keep
it small, explain what it fixes, and say what you saw on a real phone.

## Before you start

For anything larger than a bug fix, open an issue first. It is much less
disappointing to be told early that a change clashes with a decision than after
it is written.

## What is wanted

- **iOS.** The module builds and refuses to work, honestly. A real encoder
  implementation is the single biggest gap in the project.
- **Phones this has never run on.** It is tested on one handset. Reports from
  other camera stacks - especially H.265, unusual sensor layouts and OEM ROMs
  that sit at `moderate` thermal status permanently - are worth more than they
  sound.
- **Bluetooth call recovery.** The audio path rebuilds after a phone call takes
  the SCO link, and this is the least-exercised part of the app.
- **Translations.** The interface ships in Hausa and Arabic; both were written
  by a developer and want a native speaker.

## Before you push

```bash
cd apps/mobile
node --test --experimental-strip-types "lib/**/*.test.ts"
npx tsc --noEmit
node scripts/check-hooks.mjs
node scripts/check-kotlin-window.mjs
node --experimental-strip-types scripts/test-pairing.mjs
```

`check-native-contract.mjs` is expected to fail on the iOS stubs today. If your
change touches the native surface, run it and make sure it does not report
anything new.

## The rules this codebase holds itself to

Most of the comments in this repository explain *why* something is the way it
is, usually because the obvious way cost a broadcast. A few of those decisions
are load-bearing and a pull request that reverses one will be asked about:

- **Nothing is faked on screen.** A compositor that cannot be reached is not
  "OFFLINE", and a control that will not work says why rather than going quiet
  or grey. States are persistent; events are not.
- **Never prepare audio off air.** `createMicrophone()` overwrites the
  `AudioRecord` without releasing the previous one, which silences the
  microphone. Use `prepare(videoOnly = true)`.
- **The encoder pin stays put.** Later RootEncoder releases pull a
  `kotlin-stdlib` the compiler here cannot read, and the build fails with a
  metadata error instead of anything useful.
- **Secrets never reach a commit.** No stream keys, tokens, passphrases or
  pairing codes, not in tests, not in fixtures, not in screenshots.
- **No AI attribution.** Commits carry the author who wrote them and nothing
  else - no `Co-Authored-By` trailer naming a tool.

## Submitting

1. Fork, and branch from `main`.
2. One change per pull request.
3. Run the checks above and paste what they said.
4. Say what you ran it on: phone model, Android version, and what the network
   was doing.

By contributing you agree that your contribution is licensed under the same
licence as the project, GPL-3.0-or-later.
