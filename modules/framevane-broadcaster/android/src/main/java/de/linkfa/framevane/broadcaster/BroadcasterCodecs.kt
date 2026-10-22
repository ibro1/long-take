package de.linkfa.framevane.broadcaster

import com.pedro.encoder.utils.CodecUtil

/**
 * Which codecs this handset will actually encode.
 *
 * H.265 is the single biggest win available on a phone uplink - the same
 * picture for half the bitrate - but plenty of handsets either cannot encode it
 * or ship an implementation that fails the moment it is asked to. Offering it
 * blind turns the best setting in the app into the one that ends broadcasts.
 *
 * AV1 is deliberately absent even on a phone that can encode it. RootEncoder's
 * GenericStream throws for AV1 outright: none of RTMP, RTSP, SRT or UDP carries
 * it there. A codec the handset can encode and the transport cannot carry is
 * still a trap, which is precisely what this function exists to prevent.
 */
internal fun supportedCodecs(): List<Map<String, Any>> =
  CARRIED_CODECS.mapNotNull { (codec, mime) ->
    val hardware = encoderCount(mime, hardware = true)
    val software = encoderCount(mime, hardware = false)
    if (hardware + software == 0) return@mapNotNull null
    mapOf<String, Any>("codec" to codec, "hardware" to (hardware > 0))
  }

/**
 * RootEncoder's own codec listing rather than MediaCodecList directly, because
 * it already filters the encoders known to be broken - which is the whole
 * question being asked here.
 */
private fun encoderCount(mime: String, hardware: Boolean): Int = runCatching {
  if (hardware) {
    CodecUtil.getAllHardwareEncoders(mime).size
  } else {
    CodecUtil.getAllSoftwareEncoders(mime).size
  }
}.getOrNull() ?: 0

private val CARRIED_CODECS = listOf(
  "h264" to CodecUtil.H264_MIME,
  "h265" to CodecUtil.H265_MIME,
)
