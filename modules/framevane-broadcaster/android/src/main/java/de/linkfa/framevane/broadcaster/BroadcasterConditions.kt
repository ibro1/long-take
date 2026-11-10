package de.linkfa.framevane.broadcaster

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.util.Size

/**
 * The state of the phone itself, as opposed to the state of the broadcast.
 *
 * Three things end a real event and none of them was being watched: the phone
 * getting hot, the disk filling, and the battery going. All three are cheap to
 * read and none of them is visible in the picture until it is too late to act
 * - a thermally throttled phone reports the frame rate it was configured with
 * right up until the picture starts stuttering.
 *
 * Read here and judged in JavaScript. The thresholds are a product decision
 * that will be argued about and changed; the readings are not.
 */

/**
 * Android's thermal status, as a name that means something.
 *
 * The numbers are Android's own: 0 NONE through 6 SHUTDOWN. The useful edge is
 * MODERATE, which is the system saying throttling is coming - ahead of the
 * encoder actually missing frames, which is the whole point of asking.
 */
internal fun thermalName(status: Int): String = when (status) {
  PowerManager.THERMAL_STATUS_NONE -> "none"
  PowerManager.THERMAL_STATUS_LIGHT -> "light"
  PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
  PowerManager.THERMAL_STATUS_SEVERE -> "severe"
  PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
  PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
  PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
  else -> "unknown"
}

/**
 * A phone too old to ask reports -1 rather than "none".
 *
 * The difference matters on screen: "this phone is not hot" and "this phone
 * cannot say" are different facts, and reporting the first when the second is
 * true is the app inventing a measurement. There is no way to approximate it
 * from frame timings that is worth having - a guess dressed as a reading is
 * worse than an honest silence.
 */
internal const val THERMAL_UNKNOWN = -1

internal fun BroadcasterView.thermalStatus(): Int {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return THERMAL_UNKNOWN
  val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
    ?: return THERMAL_UNKNOWN
  return runCatching { power.currentThermalStatus }.getOrDefault(THERMAL_UNKNOWN)
}

private var thermalWatch: PowerManager.OnThermalStatusChangedListener? = null

/**
 * Starts reporting thermal changes. Registered with the view like the audio
 * watches above it, and for the same reason: there is one view, and one
 * registration is the whole truth.
 */
internal fun BroadcasterView.watchThermal() {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
  if (thermalWatch != null) return
  val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return

  val watch = PowerManager.OnThermalStatusChangedListener { status ->
    /**
     * Logged at every step, not only the alarming ones. The log is what gets
     * screenshotted after an event that went wrong, and "it reached severe
     * forty minutes in" is the sort of thing that is only knowable if the
     * climb was written down as it happened.
     */
    log(
      if (status >= PowerManager.THERMAL_STATUS_SEVERE) LOG_WARN else LOG_INFO,
      "The phone reports it is ${thermalName(status)}",
    )
    post {
      runCatching { onThermal(mapOf("status" to status, "name" to thermalName(status))) }
    }

    /**
     * AGGRESSIVE THERMAL ADAPTATION: proactively reduce encoder load before
     * thermal throttling stalls the pipeline.
     *
     * The pipeline freezes because CPU/GPU throttling slows GL rendering,
     * which stalls the shared SurfaceTexture. By reducing bitrate/fps/resolution
     * EARLY (at LIGHT/MODERATE), we keep the pipeline running within the
     * throttled thermal budget instead of hitting the wall at SEVERE/CRITICAL.
     */
    when (status) {
      PowerManager.THERMAL_STATUS_LIGHT -> {
        post { applyThermalLadder(0.8, 24, null) } // -20% bitrate, 24fps
      }
      PowerManager.THERMAL_STATUS_MODERATE -> {
        post { applyThermalLadder(0.6, 20, Size(1280, 720)) } // -40% bitrate, 20fps, 720p
      }
      PowerManager.THERMAL_STATUS_SEVERE -> {
        post { applyThermalLadder(0.4, 15, Size(1280, 720)) } // -60% bitrate, 15fps, 720p
        if (!cameraLost) {
          log(LOG_WARN, "Thermal SEVERE - restarting camera session to clear stalled pipeline")
          cameraLost = true
          scheduleCameraRecovery()
        }
      }
      PowerManager.THERMAL_STATUS_CRITICAL,
      PowerManager.THERMAL_STATUS_EMERGENCY,
      PowerManager.THERMAL_STATUS_SHUTDOWN -> {
        post { applyThermalLadder(0.25, 10, Size(854, 480)) } // -75% bitrate, 10fps, 480p
        if (!cameraLost) {
          log(LOG_WARN, "Thermal ${thermalName(status)} - restarting camera session")
          cameraLost = true
          scheduleCameraRecovery()
        }
      }
      PowerManager.THERMAL_STATUS_NONE -> {
        post { liftThermalLadder() }
      }
    }
  }

  runCatching { power.addThermalStatusListener(context.mainExecutor, watch) }.onFailure {
    log(LOG_WARN, "Could not watch the phone's temperature: ${it.message}")
    return
  }
  thermalWatch = watch

  /**
   * What the phone claims before anything has changed.
   *
   * The listener only speaks on a change, so a phone that reports itself warm
   * from the moment the screen comes on - which plenty of them do - said
   * nothing at all here while the viewfinder showed a heat warning. The first
   * reading is the one that explains the banner.
   */
  val now = thermalStatus()
  log(LOG_INFO, "The phone reports it is ${thermalName(now)} to begin with")
}

internal fun BroadcasterView.stopWatchingThermal() {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
  val watch = thermalWatch ?: return
  thermalWatch = null
  val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
  runCatching { power.removeThermalStatusListener(watch) }
}

/**
 * Room left where recordings are written.
 *
 * `usableSpace` rather than `freeSpace`: the second counts blocks the system
 * has reserved and this app can never have, which would let a recording start
 * on space that does not exist.
 *
 * Reported as doubles because that is the only number type that survives the
 * bridge intact, and a phone with 512 GB of storage is past what an Int holds
 * in bytes.
 */
internal fun storage(context: Context): Map<String, Any> {
  val dir = recordingsDir(context)
  val usable = dir?.let { runCatching { it.usableSpace }.getOrNull() } ?: 0L
  val total = dir?.let { runCatching { it.totalSpace }.getOrNull() } ?: 0L
  return mapOf("usableBytes" to usable.toDouble(), "totalBytes" to total.toDouble())
}

/**
 * The width and height to record at, or null to match the broadcast.
 *
 * RootEncoder compares `recordWidth / recordHeight` with `width / height` as
 * doubles and throws on anything that is not exactly equal, so the width has
 * to come from the stream's own shape rather than from a table of standard
 * sizes: 854x480 against a 1280x720 picture is 1.7792 against 1.7778, and is
 * refused. Scaling the stream's width lands on the ratio exactly whenever the
 * division is clean, and a height where it is not is refused here instead -
 * a rounded width would be the same refusal with extra steps.
 *
 * Matching the broadcast is also returned as null when the wanted height is
 * what the broadcast already is: there is no reason to run a second encoder
 * to produce the same picture twice.
 */
internal fun recordSizeFor(width: Int, height: Int, wanted: Int): Pair<Int, Int>? {
  if (wanted <= 0 || height <= 0 || width <= 0) return null
  if (wanted == height) return null

  val scaled = width.toLong() * wanted
  if (scaled % height != 0L) return null

  val recordWidth = (scaled / height).toInt()
  // Odd dimensions are refused by most hardware encoders, and a picture one
  // pixel off is not worth the risk of finding out which ones.
  if (recordWidth % 2 != 0 || wanted % 2 != 0) return null
  return recordWidth to wanted
}
