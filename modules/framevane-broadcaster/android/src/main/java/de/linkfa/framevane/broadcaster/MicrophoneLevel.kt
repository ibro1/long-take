package de.linkfa.framevane.broadcaster

import com.pedro.encoder.input.audio.CustomAudioEffect

/**
 * Peak microphone level, measured on the buffer as it goes past.
 *
 * RootEncoder ships an `AmplitudeEffect` that does this, and it cannot be
 * used: it hands each buffer to its own worker thread through a blocking
 * queue, and its `stop()` calls `shutdownNow()`, which interrupts that thread
 * while it is parked in `queue.take()`. The `InterruptedException` is not
 * caught, so it reaches the top of a pool thread and kills the process. On this
 * app that meant leaving the Broadcast tab crashed the whole application -
 * which read as "Settings and Destinations crash", because the crash was in
 * the leaving, not the arriving.
 *
 * So the peak is computed here instead, in place, on the thread that already
 * has the buffer. It is a pass over a couple of thousand bytes looking for the
 * largest one - cheaper than cloning the buffer and waking another thread to
 * do the same work, and there is nothing to interrupt because there is no
 * thread and no queue.
 *
 * The buffer is returned untouched. The library uses this return value as the
 * frame it encodes, so anything else here would change what viewers hear.
 *
 * Stereo is measured per channel, in the same single pass. A stereo
 * AudioRecord hands back interleaved frames - left sample, right sample - so
 * walking the buffer four bytes at a time reads both sides with no second pass
 * and no copy. Which layout the buffer is in comes from [isStereo], asked once
 * per buffer rather than fixed at construction, because the microphone's
 * channel setting is a broadcast setting the operator can change between one
 * start and the next while this object lives as long as the view.
 *
 * @param isStereo whether the running AudioRecord was opened with two channels.
 * In RootEncoder 2.7.0 `MicrophoneSource.start` and `AudioSource.init` (which
 * `prepareAudio` goes through) both build the recorder from the source's own
 * `isStereo` (CHANNEL_IN_STEREO when true, CHANNEL_IN_MONO when false), so that
 * property is the layout of the buffer arriving here.
 * @param onPeak the left and right peaks, 0-100; right is [LevelBus.MONO] when
 * the microphone is mono, and left is then the only channel there is.
 */
internal class MicrophoneLevel(
  private val isStereo: () -> Boolean,
  private val onPeak: (left: Float, right: Float) -> Unit,
) : CustomAudioEffect() {

  private var heard = false
  private var firstBufferAt = 0L
  private var silenceSettled = false

  /**
   * When the current run of all-zero buffers began, or 0 while sound is
   * arriving. This is the second half of the same measurement the startup
   * check makes, kept running for the life of the broadcast rather than
   * settled once - because the microphone being taken away is a thing that
   * happens in the middle, not at the start.
   */
  private var silentSince = 0L

  override fun process(pcmBuffer: ByteArray): ByteArray {
    val stereo = isStereo()
    var left = 0
    var right = 0
    var i = 0
    // Signed 16-bit little-endian, which is what the microphone is configured
    // for throughout. An odd trailing byte is not half a sample, so it is left.
    if (stereo) {
      // Interleaved L, R. A trailing left sample with no right partner is half
      // a frame and is left with the odd byte; the library sizes its buffer
      // in whole frames, so in practice there is none.
      while (i + 3 < pcmBuffer.size) {
        val l = ((pcmBuffer[i + 1].toInt() shl 8) or (pcmBuffer[i].toInt() and 0xFF)).toShort().toInt()
        val r = ((pcmBuffer[i + 3].toInt() shl 8) or (pcmBuffer[i + 2].toInt() and 0xFF)).toShort().toInt()
        val lm = if (l < 0) -l else l
        val rm = if (r < 0) -r else r
        if (lm > left) left = lm
        if (rm > right) right = rm
        i += 4
      }
    } else {
      while (i + 1 < pcmBuffer.size) {
        val sample = ((pcmBuffer[i + 1].toInt() shl 8) or (pcmBuffer[i].toInt() and 0xFF)).toShort().toInt()
        val magnitude = if (sample < 0) -sample else sample
        if (magnitude > left) left = magnitude
        i += 2
      }
    }
    /**
     * The silence watch takes the louder side: a microphone is not dead
     * because one of its channels is quiet, and a stereo pair where one side
     * has failed is still sound arriving. This is also the same number the
     * single-channel loop used to produce over the whole buffer, so nothing
     * downstream of [note] changes with the layout.
     */
    note(if (right > left) right else left)
    // 0-100, matching what the library's own amplitude reported, so the meter
    // above it did not have to change.
    onPeak(left / MAX_SAMPLE * 100f, if (stereo) right / MAX_SAMPLE * 100f else LevelBus.MONO)
    return pcmBuffer
  }

  /**
   * The two lines that tell a dead meter apart from a dead microphone.
   *
   * A column of grey segments has two causes and an operator cannot see which:
   * a microphone this app never managed to start, and a microphone that is
   * running and handing back digital silence because something else on the
   * phone holds the input. Every link between the two is silent, so the log
   * reads identically either way - and the first thing anyone needs to know is
   * whether PCM is reaching this class at all.
   *
   * One line each for the life of the view, which is the ceiling rather than an
   * accident: this runs dozens of times a second on the audio thread, and a
   * meter that narrates itself is a log nobody can read the failures out of.
   */
  private fun note(peak: Int) {
    val now = System.currentTimeMillis()

    if (!heard) {
      heard = true
      firstBufferAt = now
      BroadcasterView.current?.log(LOG_INFO, "The level meter is reading the microphone")
      return
    }

    /**
     * One sample above zero is sound. A real microphone in a silent room still
     * delivers its own noise floor, so this is not a threshold that a quiet
     * passage can trip - every sample being zero is not a quiet room, it is
     * nothing at all.
     */
    if (peak > 0) {
      silenceSettled = true
      if (silentSince != 0L) {
        silentSince = 0L
        BroadcasterView.current?.noteAudioSilence(false, "silent")
      }
      return
    }

    if (silentSince == 0L) silentSince = now
    val since = if (silenceSettled) silentSince else firstBufferAt
    if (now - since < SILENCE_AFTER_MS) return

    /**
     * The startup case keeps its one-line log: a microphone that never
     * delivered anything is a different story from one that stopped, and it is
     * the one an operator hits while setting up rather than mid-broadcast.
     */
    if (!silenceSettled) {
      silenceSettled = true
      BroadcasterView.current?.log(
        LOG_WARN,
        "The microphone is running and every sample is silent; another app may hold the input",
      )
    }

    // Reported on every pass, and made news exactly once - the view holds the
    // state and drops anything that is not a change.
    BroadcasterView.current?.noteAudioSilence(true, "silent")
  }

  private companion object {
    /** Short.MAX_VALUE as a float, which is full scale for 16-bit audio. */
    const val MAX_SAMPLE = 32_767f

    /**
     * Long enough that a phone still opening its input is not accused of
     * silence, short enough that the answer is on screen before the operator
     * has finished wondering.
     */
    const val SILENCE_AFTER_MS = 3_000L
  }
}
