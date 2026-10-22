package de.linkfa.framevane.broadcaster

import android.net.Uri
import com.pedro.srt.srt.packets.control.handshake.EncryptionType

/**
 * SRT's two settings that are not the destination.
 *
 * They are handled together and awkwardly because RootEncoder 2.7.0 exposes
 * them in two different places: the passphrase is a method on the stream
 * client, and the latency is reachable only as a query parameter on the URL.
 * `SrtStreamClient.setLatency` exists but `GenericStreamClient` does not
 * re-export it and holds its SRT client privately, so there is no way to call
 * it from here. Rewriting the URL is not elegant; it is the only door.
 */

/** Ten to seventy-nine characters, which is what SRT's own handshake allows. */
internal const val SRT_PASSPHRASE_MIN = 10
internal const val SRT_PASSPHRASE_MAX = 79

/**
 * Hands the passphrase to the SRT client, if there is one.
 *
 * Called just before the URL is dialled, because the library ignores the call
 * outright while a stream is running. AES-128 is the encryption to ask for:
 * it is what RootEncoder itself defaults to when a URL carries a passphrase,
 * so a Framevane stream and a hand-typed SRT URL negotiate the same thing, and
 * the longer keys buy nothing against an attacker who would have to break the
 * key inside the seconds the stream is worth attacking.
 */
internal fun BroadcasterView.applySrtPassphrase() {
  if (srtPassphrase.isEmpty()) {
    clearSrtPassphrase()
    return
  }
  if (srtPassphrase.length !in SRT_PASSPHRASE_MIN..SRT_PASSPHRASE_MAX) return
  runCatching {
    stream.getStreamClient().setPassphrase(srtPassphrase, EncryptionType.AES128)
  }.onFailure {
    // Deliberately says nothing about the passphrase itself. It is a
    // credential, and the log is the thing an operator screenshots.
    log(LOG_WARN, "The SRT passphrase was not accepted")
  }
}

/**
 * Turns the SRT client's encryption off again, for a destination with no
 * passphrase.
 *
 * The client keeps its encryptor for as long as it lives, and the view keeps
 * one client for every broadcast - so once any SRT destination had a
 * passphrase, every later one was dialled encrypted with that key, and a server
 * that had never been given it refused the handshake with nothing on screen to
 * say why.
 *
 * RootEncoder 2.7.0 has no public way to undo it. `SrtClient.setPassphrase`
 * rejects anything shorter than ten characters before it gets as far as the
 * encryptor, and the call underneath it that does accept "no passphrase" -
 * `CommandsManager.setPassphrase`, which drops the encryptor for an empty
 * string or `EncryptionType.NONE` - is on a private field two private fields
 * down. So this reaches it by reflection: GenericStreamClient.srtClient (an
 * SrtStreamClient), its own srtClient (the SrtClient), and that one's
 * commandsManager. Release builds are not minified, and the names were read off
 * the 2.7.0 classes themselves; if a later version renames any of them this
 * fails, says so in the log, and leaves the client as it was.
 *
 * Only called before the socket opens, which is the only time the library
 * reads the encryptor for a new handshake.
 */
private fun BroadcasterView.clearSrtPassphrase() {
  runCatching {
    val srtStreamClient = privateField(stream.getStreamClient(), "srtClient")
    val srtClient = privateField(srtStreamClient, "srtClient")
    val commands = privateField(srtClient, "commandsManager")
    commands.javaClass
      .getMethod("setPassphrase", String::class.java, EncryptionType::class.java)
      .invoke(commands, "", EncryptionType.NONE)
  }.onFailure {
    log(LOG_WARN, "Could not turn SRT encryption off for this destination: ${it.message}")
  }
}

private fun privateField(owner: Any, name: String): Any {
  val field = owner.javaClass.getDeclaredField(name)
  field.isAccessible = true
  return field.get(owner) ?: throw IllegalStateException("$name is not set")
}

/**
 * The destination, with an SRT latency floor folded into it if one was asked
 * for.
 *
 * There is a trap in RootEncoder's URL parsing that this has to step around:
 * when a URL carries no explicit `streamid`, the stream id it sends is the path
 * *and the whole query string*. So `srt://host/live?latency=200000` publishes
 * to a stream called `live?latency=200000`. The rewrite therefore always names
 * the stream id explicitly, promoting the path into it, and leaves everything
 * already in the query exactly as it was found - the parser does no percent
 * decoding, so re-encoding anything here would change what the server receives.
 *
 * A URL that already carries its own `latency` is left alone: someone who
 * typed it meant it.
 */
internal fun BroadcasterView.srtDestination(url: String): String {
  if (srtLatencyMs <= 0) return url
  if (!url.startsWith("srt", ignoreCase = true)) return url

  val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return url
  val authority = uri.authority
  if (authority.isNullOrEmpty()) return url

  val query = uri.encodedQuery.orEmpty()
  if (query.split('&').any { it.startsWith("latency=") }) return url

  // SRT counts latency in microseconds; the contract counts in milliseconds,
  // because nobody thinks about an uplink buffer in microseconds.
  val micros = srtLatencyMs.toLong() * 1000L

  val hasStreamId = query.split('&').any { it.startsWith("streamid=") }
  if (hasStreamId) {
    return "srt://$authority${uri.encodedPath.orEmpty()}?$query&latency=$micros"
  }

  val streamId = uri.encodedPath.orEmpty().trim('/')
  if (streamId.isEmpty()) {
    log(LOG_WARN, "SRT latency needs a stream id in the URL; leaving the URL alone")
    return url
  }
  val rest = if (query.isEmpty()) "" else "&$query"
  return "srt://$authority/?streamid=$streamId$rest&latency=$micros"
}
