package de.linkfa.framevane.broadcaster

import android.media.MediaCodec
import com.pedro.library.base.recording.RecordController
import java.nio.ByteBuffer

/**
 * Filmic's Timelapse: frames captured slowly, played back at the take's own
 * frame rate, so minutes become seconds.
 *
 * Two halves. The GL renderer's frame limiter lets only [captureFps] frames a
 * second reach the encoder; the preview keeps running at full rate. Then the
 * recorder rewrites each video frame's timestamp, squeezing the gaps between
 * them by [factor] (playback fps / capture fps), so a frame captured every
 * half second lands every 1/30 s in the file. Sound is not recorded: sped up
 * it is noise, and Filmic records none either.
 *
 * Off air only. A broadcast is real time by definition, and the stream and
 * the recording share an encoder.
 */
internal object TimelapseOptions {
  /** Frames captured per second, or 0 for a normal take. */
  @Volatile var captureFps = 0
}

/**
 * The recorder with its clock squeezed. Everything else is delegated to the
 * library's own controller, which still owns the file.
 */
internal class TimelapseRecordController(
  private val inner: RecordController,
  private val factor: Double,
) : RecordController by inner {
  private var firstPts = -1L

  override fun recordVideo(videoBuffer: ByteBuffer, videoInfo: MediaCodec.BufferInfo) {
    if (firstPts < 0) firstPts = videoInfo.presentationTimeUs
    val squeezed = firstPts + ((videoInfo.presentationTimeUs - firstPts) / factor).toLong()
    val info = MediaCodec.BufferInfo().apply {
      set(videoInfo.offset, videoInfo.size, squeezed, videoInfo.flags)
    }
    inner.recordVideo(videoBuffer, info)
  }

  override fun recordAudio(audioBuffer: ByteBuffer, audioInfo: MediaCodec.BufferInfo) {
    // No sound in a timelapse.
  }
}
