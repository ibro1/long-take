/**
 * Takes anything shaped like a credential out of a string.
 *
 * One place, because three things need the same rule and a rule written three
 * times drifts: the crash reporter, the log that is now kept across restarts,
 * and the log the operator can send to the studio. Each of those leaves the
 * moment it is written, or outlives the broadcast it describes.
 */

/**
 * Every shape a destination comes in, and the last path segment of each.
 *
 * Both halves of the old pattern were wrong in the field. It insisted on two
 * path segments, so `rtmp://host/streamkey` - which is what a self-hosted
 * server hands out, and the shape this app is built around - went through
 * untouched; and it only knew `rtmp` and `rtmps`, so every SRT and RTSP URL
 * was missed. The key is the last segment whatever the scheme, so that is what
 * is replaced, with however many segments in front of it.
 */
const STREAM_URL = /\b((?:rtmps?|srts?|rtsp):\/\/[^\s?#]*\/)([^\s/?#]+)/gi;

/**
 * A pairing link, query and all.
 *
 * `framevane://pair?server=...&key=...&token=...` is the whole destination in
 * one string - the stream key, and the control token that lets whoever holds
 * it push overlays onto the stream - and it is exactly what ends up in a log
 * when a scan fails to parse. Nothing in its query is worth keeping in a line
 * someone may paste into a support chat, so the query goes as a whole rather
 * than parameter by parameter, which would miss whichever one is added next.
 */
const PAIRING_LINK = /\b(framevane:\/\/[^\s?#]*)\?[^\s#]*/gi;

/**
 * SRT and RTMPS carry the credential in the query string instead, and a
 * pairing link's parameters can turn up on their own, parsed out of one.
 *
 * `token` and `controlToken` are the overlay credential; `api` is not secret,
 * but it names the dashboard the token opens, and the pair together is the
 * whole of what an attacker would need.
 */
const CREDENTIAL_PARAM =
  /([?&](?:streamid|passphrase|key|streamkey|token|controltoken|api)=)[^&\s]+/gi;

/** The control token as it travels: in an Authorization header. */
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

/**
 * The account-link token wherever it turns up on its own - a claim answer
 * echoed into an error, a stored record printed while debugging. It opens
 * every stream on the account, so it is matched by its prefix rather than
 * trusted to always arrive behind "Bearer".
 */
const DEVICE_TOKEN = /\bfvd_[A-Za-z0-9_-]+/g;

export function scrub(text: string): string {
  return text
    .replace(PAIRING_LINK, "$1?<redacted>")
    .replace(STREAM_URL, "$1<key>")
    .replace(CREDENTIAL_PARAM, "$1<redacted>")
    .replace(BEARER, "$1<redacted>")
    .replace(DEVICE_TOKEN, "fvd_<redacted>");
}
