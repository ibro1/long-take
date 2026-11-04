# Third-party notices

Framevane Broadcaster is licensed under the GNU General Public License, version
3 or later (see `LICENSE`). It is built on other people's work, and this file
lists the parts that are shipped inside the app together with the licence each
one arrives under.

The full text of every licence named here is available from the project that
publishes it. Where a package's own `package.json` states the licence, that is
the authoritative statement, not this summary.

## The encoder

**RootEncoder** — `com.github.pedroSG94.RootEncoder:library:2.7.0`, Apache-2.0.
The H.264/AAC encoder, the RTMP and SRT transports, and the camera and audio
plumbing underneath them. This is the single most substantial piece of other
people's work in the app, and the reason the app can broadcast at all.
<https://github.com/pedroSG94/RootEncoder>

The version is pinned deliberately. Later releases pull a `kotlin-stdlib` newer
than the Kotlin compiler this project builds with, and the build stops with a
metadata error rather than a useful message; `scripts/check-kotlin-window.mjs`
fails loudly if the pin is ever moved past the ceiling.

## Direct dependencies that are not MIT

Run from `apps/mobile`:

| Package | Version | Licence |
| --- | --- | --- |
| `@expo-google-fonts/inter` | 0.4.2 | MIT AND OFL-1.1 (the Inter typeface itself is OFL) |
| `class-variance-authority` | 0.7.1 | Apache-2.0 |
| `drizzle-orm` | 0.43.1 | Apache-2.0 |
| `drizzle-zod` | 0.5.1 | Apache-2.0 |
| `lucide-react-native` | 0.514.0 | ISC |
| `react-native-mmkv` | 3.3.3 | MIT AND BSD-3-Clause |

Everything else in the production tree is MIT. To list the whole tree with the
licence of each package:

```bash
cd apps/mobile
npm ls --prod
```

## Apache-2.0 and the GPL

Apache-2.0 is compatible with GPL-3.0 in this direction: Apache-2.0 code may be
included in a GPL-3.0-or-later work, and the combined work is distributed under
the GPL. The Apache-2.0 notices above are kept, as that licence requires, and
nothing here relicenses the Apache-2.0 parts on their own.

## Trademarks

The licence grants copyright and patent permissions. It does not grant
permission to use the Framevane name or logo:

- **Framevane**, the Framevane wordmark and the app icon are trademarks of
  Davebukar Technologies.
- A fork is welcome under the GPL. A fork distributed to other people must use
  its own name, icon and application id, so that users are not misled about
  where it came from.
- The in-app name that points at the hosted relay (`lib/product.ts`) is part of
  the brand, not part of the functionality; forks replace that file.
