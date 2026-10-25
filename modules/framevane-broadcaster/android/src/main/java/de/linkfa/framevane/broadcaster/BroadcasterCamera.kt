package de.linkfa.framevane.broadcaster

import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.ColorSpaceTransform
import android.hardware.camera2.params.RggbChannelVector
import android.os.SystemClock
import android.view.MotionEvent
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * The camera controls, kept apart from the view itself.
 *
 * Every one of them is a thin wrapper over Camera2 by way of RootEncoder, and
 * every one of them has to survive a phone that does not offer it - so they all
 * read the same way: ask, notice whether the camera agreed, and say so in the
 * log rather than leaving the operator with a control that does nothing.
 */

/**
 * What the camera now open will actually let the operator change.
 *
 * Read after every camera change: an ultra-wide and a main lens do not offer
 * the same controls, and offering one the lens will silently ignore is worse
 * than not offering it.
 *
 * `torch` says whether the lens has a flash at all rather than whether it is
 * lit, because `isTorchOn` already answers that.
 */
internal fun BroadcasterView.capabilities(): Map<String, Any?> {
  if (runCatching { camera.isRunning() }.getOrNull() != true) return unavailableCapabilities()

  val characteristics = currentCharacteristics()
  val zoomRange = runCatching { camera.getZoomRange() }.getOrNull()
  /**
   * Said out loud, once per change.
   *
   * Pinch is offered only where the lens reports a range to pinch through, so
   * "there is no zoom" and "the gesture is broken" look identical from the
   * viewfinder and are fixed in completely different places. This is the line
   * that tells them apart, and it was not there when it was needed.
   */
  val zoomSummary = "${zoomRange?.lower ?: 1f}-${zoomRange?.upper ?: 1f}"
  if (zoomSummary != lastZoomSummary) {
    lastZoomSummary = zoomSummary
    log(LOG_INFO, "This lens reports zoom ${zoomSummary}x")
  }
  val exposureRange = characteristics?.let {
    runCatching { it.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE) }.getOrNull()
  }
  val whiteBalance = runCatching { camera.getWhiteBalance() }.getOrNull()
    ?: CameraCharacteristics.CONTROL_AWB_MODE_AUTO

  return mapOf(
    "zoom" to mapOf(
      "min" to (zoomRange?.lower ?: 1f).toDouble(),
      "max" to (zoomRange?.upper ?: 1f).toDouble(),
      "current" to (runCatching { camera.getZoom() }.getOrNull() ?: 1f).toDouble(),
    ),
    "exposure" to mapOf(
      "min" to (exposureRange?.lower ?: 0),
      "max" to (exposureRange?.upper ?: 0),
      "current" to (runCatching { camera.getExposure() }.getOrNull() ?: 0),
      "locked" to exposureLocked,
      "lockAvailable" to aeLockAvailable(characteristics),
      "evStep" to evStep(characteristics),
    ),
    "autoFocus" to (runCatching { camera.isAutoFocusEnabled() }.getOrNull() ?: false),
    /**
     * How near this lens can focus, in dioptres - 1/metres, so 10 is ten
     * centimetres and 0 is infinity. A lens with no manual focus at all
     * reports 0 for its minimum, which is Camera2's way of saying the focus is
     * fixed, and the screen offers no focus rail on one of those.
     */
    "focusNear" to (
      characteristics?.let {
        runCatching { it.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) }.getOrNull()
      }?.toDouble() ?: 0.0
      ),
    "focusDistance" to focusDistance.toDouble(),
    "stabilization" to stabilizationSupported(characteristics),
    "stabilizationOn" to (
      runCatching { camera.isVideoStabilizationEnabled() }.getOrNull() ?: false
      ),
    "whiteBalanceModes" to (
      runCatching { camera.getAutoWhiteBalanceModesAvailable() }.getOrNull() ?: emptyList<Int>()
      ),
    "whiteBalance" to whiteBalance,
    "autoWhiteBalance" to (whiteBalance == CameraCharacteristics.CONTROL_AWB_MODE_AUTO),
    "torch" to (characteristics?.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true),
    /**
     * Only the modes this lens says it has.
     *
     * Both of these are optional in Camera2 and plenty of phones report a
     * single mode, which means the control would be a row that cannot change
     * anything. Sending the list rather than a boolean lets the screen leave
     * them out entirely on hardware that does not offer a choice - the same
     * rule the white balance list already follows.
     */
    "noiseReductionModes" to
      (characteristics?.get(
        CameraCharacteristics.NOISE_REDUCTION_AVAILABLE_NOISE_REDUCTION_MODES,
      )?.toList() ?: emptyList<Int>()),
    "noiseReduction" to noiseReduction,
    "antiFlickerModes" to
      (characteristics?.get(
        CameraCharacteristics.CONTROL_AE_AVAILABLE_ANTIBANDING_MODES,
      )?.toList() ?: emptyList<Int>()),
    "antiFlicker" to antiFlicker,
    /**
     * Manual exposure and white balance, each offered only where the lens
     * says it can do the whole thing - see [manualSensorSupported] and
     * [manualWhiteBalanceSupported]. A phone that half-supports either does
     * something different on every model, and a control that works on the
     * operator's phone and not on the one they borrow is worse than none.
     */
    "manualSensor" to manualSensorSupported(characteristics),
    "isoRange" to isoRange(characteristics)?.let { mapOf("min" to it.first, "max" to it.second) },
    "exposureTimeRange" to exposureTimeRange(characteristics)?.let {
      // Doubles: a lens's longest exposure in nanoseconds can be past what an
      // Int holds, and JavaScript numbers are doubles anyway.
      mapOf("minNs" to it.first.toDouble(), "maxNs" to it.second.toDouble())
    },
    "manualWhiteBalance" to manualWhiteBalanceSupported(characteristics),
    /**
     * The frame rates this lens can hold steadily: the tops of its AE target
     * ranges that are fixed (24-24, 30-30, 60-60). A range like 15-30 is the
     * camera free to drop frames in the dark, which is no promise of 30 at
     * all, so only the fixed ones count. Ascending.
     */
    "frameRates" to (characteristics?.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
      ?.filter { it.lower == it.upper }
      ?.map { it.upper }
      ?.distinct()
      ?.sorted() ?: emptyList<Int>()),
    "available" to true,
  )
}

/**
 * Whether this lens lets the request set ISO and shutter itself.
 *
 * MANUAL_SENSOR is the capability that promises CONTROL_AE_MODE_OFF,
 * SENSOR_SENSITIVITY, SENSOR_EXPOSURE_TIME and SENSOR_FRAME_DURATION all work.
 * Without it, AE_MODE_OFF is not even in the lens's list of AE modes, and
 * asking for it is somewhere between ignored and a session error depending on
 * the phone.
 */
internal fun manualSensorSupported(characteristics: CameraCharacteristics?): Boolean =
  hasCapability(
    characteristics,
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR,
  )

/**
 * Whether this lens lets the request set the white balance gains itself.
 *
 * Two things, because Camera2 splits the promise in two. MANUAL_POST_PROCESSING
 * is the capability that guarantees COLOR_CORRECTION_MODE_TRANSFORM_MATRIX
 * with its gains and transform - Camera2 has no characteristics key listing
 * colour-correction modes, so the capability is the only way to ask. And the
 * gains only reach the picture with AWB off, so AWB_MODE_OFF has to be one of
 * the lens's AWB modes as well.
 */
internal fun manualWhiteBalanceSupported(characteristics: CameraCharacteristics?): Boolean {
  if (!hasCapability(
      characteristics,
      CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING,
    )
  ) {
    return false
  }
  val awbModes = characteristics?.let {
    runCatching { it.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES) }.getOrNull()
  }
  return awbModes?.contains(CameraCharacteristics.CONTROL_AWB_MODE_OFF) == true
}

private fun hasCapability(characteristics: CameraCharacteristics?, capability: Int): Boolean {
  val available = characteristics?.let {
    runCatching { it.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) }.getOrNull()
  }
  return available?.contains(capability) == true
}

/** SENSOR_INFO_SENSITIVITY_RANGE as (min, max), or null where the lens does not say. */
private fun isoRange(characteristics: CameraCharacteristics?): Pair<Int, Int>? {
  val range = characteristics?.let {
    runCatching { it.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE) }.getOrNull()
  } ?: return null
  return range.lower to range.upper
}

/**
 * The frame rate the camera is running at, for the shutter's ceiling and the
 * frame duration.
 *
 * The camera source's own figure first: `prepareVideo` hands the configured fps
 * to `VideoSource.init`, and `Camera2Source.start` gives that same number to
 * Camera2ApiManager, which builds the target fps range from it - so
 * `camera.fps` is the rate the repeating request asks for. The configured
 * [BroadcasterView.videoFps] covers the moment before the source has been
 * initialised at all.
 */
internal fun BroadcasterView.captureFps(): Int {
  val source = runCatching { camera.fps }.getOrNull() ?: 0
  return (if (source > 0) source else videoFps).coerceAtLeast(1)
}

/** One frame at [fps], in nanoseconds: the longest a shutter can stay open without dropping frames. */
private fun frameNs(fps: Int): Long = NANOS_PER_SECOND / fps.coerceAtLeast(1)

/**
 * SENSOR_INFO_EXPOSURE_TIME_RANGE as (minNs, maxNs), with the maximum held to
 * one frame at the current frame rate, or null where the lens does not say.
 *
 * Phones list exposures of a second or more for stills, and a shutter open
 * longer than a frame is a frame that cannot be delivered on time: at 30 fps,
 * 1/15s halves the frame rate of the broadcast. Offering the operator that end
 * of the range would offer them a stuttering stream with a brighter picture.
 */
private fun BroadcasterView.exposureTimeRange(characteristics: CameraCharacteristics?): Pair<Long, Long>? {
  val range = characteristics?.let {
    runCatching { it.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE) }.getOrNull()
  } ?: return null
  val max = minOf(range.upper, frameNs(captureFps()))
  return range.lower to max.coerceAtLeast(range.lower)
}

/**
 * Whether this lens stabilises at all, asked of the camera rather than guessed
 * from whether turning it on appeared to work.
 *
 * Both kinds count, because [setStabilization] turns on both: a lens with
 * optical stabilisation and no electronic mode does stabilise, and reporting
 * false would hide a control that works.
 */
private fun stabilizationSupported(characteristics: CameraCharacteristics?): Boolean {
  if (characteristics == null) return false
  val electronic = runCatching {
    characteristics.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES)
  }.getOrNull()?.any { it == CameraCharacteristics.CONTROL_VIDEO_STABILIZATION_MODE_ON } == true
  val optical = runCatching {
    characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)
  }.getOrNull()?.any {
    it == CameraCharacteristics.LENS_OPTICAL_STABILIZATION_MODE_ON
  } == true
  return electronic || optical
}

/**
 * How many EV one of the camera's exposure steps is worth.
 *
 * Cameras count exposure compensation in their own steps, usually a third or a
 * sixth of a stop, and the number they report means nothing to a person. EV is
 * the unit every other camera an operator has used is marked in, so the step
 * has to travel with the range for the UI to translate.
 */
private fun evStep(characteristics: CameraCharacteristics?): Double {
  val step = characteristics?.let {
    runCatching { it.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP) }.getOrNull()
  } ?: return 0.0
  val ev = runCatching { step.toDouble() }.getOrNull() ?: 0.0
  // A camera with a zero denominator would hand back an infinity, and a UI
  // multiplying by it would show an operator nonsense rather than nothing.
  return if (ev.isFinite() && ev > 0.0) ev else 0.0
}

/** Nothing is meaningful without a camera, and saying so beats inventing it. */
internal fun unavailableCapabilities(): Map<String, Any?> = mapOf(
  "zoom" to mapOf("min" to 1.0, "max" to 1.0, "current" to 1.0),
  "exposure" to mapOf(
    "min" to 0,
    "max" to 0,
    "current" to 0,
    "locked" to false,
    "lockAvailable" to false,
    "evStep" to 0.0,
  ),
  "autoFocus" to false,
  "focusNear" to 0.0,
  "focusDistance" to 0.0,
  "stabilization" to false,
  "stabilizationOn" to false,
  "whiteBalanceModes" to emptyList<Int>(),
  "noiseReductionModes" to emptyList<Int>(),
  "noiseReduction" to CameraCharacteristics.NOISE_REDUCTION_MODE_FAST,
  "antiFlickerModes" to emptyList<Int>(),
  "antiFlicker" to CameraCharacteristics.CONTROL_AE_ANTIBANDING_MODE_AUTO,
  "whiteBalance" to CameraCharacteristics.CONTROL_AWB_MODE_AUTO,
  "autoWhiteBalance" to true,
  "torch" to false,
  "manualSensor" to false,
  "isoRange" to null,
  "exposureTimeRange" to null,
  "manualWhiteBalance" to false,
  "frameRates" to emptyList<Int>(),
  "available" to false,
)

/**
 * Focus where the operator touched, given in fractions of the preview.
 *
 * RootEncoder's tap-to-focus takes the view and the touch that landed on it and
 * works the sensor coordinates out from the two, which is the right way round -
 * but it means there is no way in without a MotionEvent. JS only sends
 * coordinates, so one is manufactured here: the library reads nothing from it
 * but x, y and the view it came with.
 *
 * The uptime clock rather than the wall clock, because that is the clock every
 * real MotionEvent carries and the one anything downstream would compare
 * against.
 */
internal fun BroadcasterView.focusAt(x: Float, y: Float) {
  if (width <= 0 || height <= 0) {
    log(LOG_WARN, "Cannot focus before the preview has been laid out")
    return
  }

  val now = SystemClock.uptimeMillis()
  val event = MotionEvent.obtain(
    now,
    now,
    MotionEvent.ACTION_DOWN,
    x.coerceIn(0f, 1f) * width,
    y.coerceIn(0f, 1f) * height,
    0,
  )
  try {
    val focused = runCatching { camera.tapToFocus(this, event) }.getOrNull() ?: false
    if (focused) {
      log(LOG_INFO, "Focused on the point tapped")
    } else {
      log(LOG_WARN, "This lens does not support focusing on a point")
    }
  } finally {
    // MotionEvents come from a pool. One that is not handed back is a slow leak
    // in something an operator will tap dozens of times while framing a shot.
    event.recycle()
  }
}

internal fun BroadcasterView.setAutoFocus(on: Boolean) {
  val applied = runCatching {
    if (on) camera.enableAutoFocus() else camera.disableAutoFocus()
  }.getOrNull() ?: false
  if (applied) {
    log(LOG_INFO, if (on) "Auto focus on" else "Auto focus off, focus locked")
  } else {
    log(LOG_WARN, "This lens refused to turn auto focus ${if (on) "on" else "off"}")
  }
}

/**
 * Exposure compensation, in the camera's own steps. RootEncoder clamps the
 * value into whatever range the camera reports, so a UI that has not read
 * [capabilities] yet cannot push it somewhere the lens will reject.
 */
internal fun BroadcasterView.setExposure(value: Int) {
  runCatching { camera.setExposure(value) }.onFailure {
    log(LOG_WARN, "Could not set exposure: ${it.message}")
    return
  }
  /**
   * Kept as the camera took it - after RootEncoder's clamp - so that it can
   * be put back: by [resumeAutoExposure] after a spell in manual, and by
   * [reapplyCaptureRequest] after a restart, which builds a request at the
   * template's zero. Marking the request overridden is what has the restart
   * put it back at all.
   *
   * Under manual exposure the camera ignores compensation, but RootEncoder
   * still writes it into the request; that is harmless, and this is where it
   * is remembered for when the metering comes back.
   */
  exposureCompensation = runCatching { camera.getExposure() }.getOrNull() ?: value
  captureRequestOverridden = true
  log(LOG_INFO, "Exposure compensation set to $value steps")
}

/** [BroadcasterView.exposureCompensation] held to this lens's own range. */
private fun BroadcasterView.compensationFor(characteristics: CameraCharacteristics?): Int {
  val range = characteristics?.let {
    runCatching { it.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE) }.getOrNull()
  } ?: return exposureCompensation
  return exposureCompensation.coerceIn(range.lower, range.upper)
}

/**
 * Holds the exposure where the camera has just put it.
 *
 * This is the control a broadcast actually needs, and it is not the one that
 * used to be here. RootEncoder's `disableAutoExposure` sets CONTROL_AE_MODE to
 * OFF, which is not a lock but manual exposure - the request then carries
 * whatever sensor time and sensitivity the template was built with rather than
 * what the scene had converged to, and CONTROL_AE_EXPOSURE_COMPENSATION is
 * ignored entirely while AE is off, so the stepper beside the toggle stopped
 * doing anything. On a phone without MANUAL_SENSOR the call was refused and
 * the app said "exposure locked" over a camera that was still metering.
 *
 * CONTROL_AE_LOCK is the real thing: the metering algorithm keeps the values
 * it has and stops re-deciding, so someone walking through the shot no longer
 * pulls the whole picture down. Compensation still applies on top of it -
 * Android is explicit that changing it moves the exposure even while locked -
 * so lock and stepper work together rather than cancelling out.
 */
internal fun BroadcasterView.setExposureLock(on: Boolean) {
  /**
   * Under manual exposure the lock has nothing to hold - the metering is not
   * running - so it is kept, not sent, and goes on with the metering when
   * [resumeAutoExposure] hands exposure back.
   */
  if (manualExposure) {
    exposureLocked = on
    log(LOG_INFO, "Exposure lock ${if (on) "on" else "off"}, for when exposure is automatic again")
    return
  }
  val applied = runCatching {
    camera.setCustomRequest { it.set(CaptureRequest.CONTROL_AE_LOCK, on) }
  }.getOrNull() ?: false

  if (!applied) {
    log(LOG_WARN, "The camera would not ${if (on) "lock" else "unlock"} the exposure")
    return
  }
  exposureLocked = on
  captureRequestOverridden = true
  log(LOG_INFO, if (on) "Exposure locked where it is" else "Exposure metering again")
}

/**
 * Whether this camera says it can lock its metering.
 *
 * A missing key is treated as yes. It is optional in Camera2 and some phones
 * simply do not answer, and hiding a working control on the strength of an
 * unanswered question is the worse mistake of the two - if the lock really is
 * not there, [setExposureLock] says so in the log.
 */
private fun aeLockAvailable(characteristics: CameraCharacteristics?): Boolean {
  val available = characteristics?.let {
    runCatching { it.get(CameraCharacteristics.CONTROL_AE_LOCK_AVAILABLE) }.getOrNull()
  }
  return available ?: true
}

/**
 * White balance, as an Android CONTROL_AWB_MODE value from
 * `capabilities().whiteBalanceModes`.
 *
 * Mode 0 is AWB_MODE_OFF and takes a different call in RootEncoder, so it is
 * routed accordingly. It is worth knowing what it means: off is not a preset
 * but manual, and without colour-correction gains - which this contract has no
 * way to supply - the picture stays at whatever the camera last chose. Useful
 * for holding a white balance steady across a scene change, useless for
 * correcting one.
 */
internal fun BroadcasterView.setWhiteBalance(mode: Int) {
  /**
   * Any mode chosen here ends kelvin white balance - this is how the operator
   * gets back from it, mode 1 being auto. Cleared first, so a restart in the
   * middle cannot put kelvin back over the mode just chosen.
   *
   * Mode 0 from kelvin keeps the kelvin gains in the request, so "hold the
   * white balance where it is" holds the temperature that was dialled in,
   * which is where it is. Every other mode has the AWB routine overriding the
   * colour pipeline anyway; the colour-correction mode is still put back to
   * FAST after it, so nothing of the manual matrix is left behind for a HAL
   * that reads it regardless.
   */
  val leavingKelvin = kelvinWhiteBalance
  kelvinWhiteBalance = false
  if (leavingKelvin && mode != CameraCharacteristics.CONTROL_AWB_MODE_OFF) {
    val applied = runCatching { camera.enableAutoWhiteBalance(mode) }.getOrNull() ?: false
    runCatching {
      camera.setCustomRequest {
        it.set(
          CaptureRequest.COLOR_CORRECTION_MODE,
          CameraCharacteristics.COLOR_CORRECTION_MODE_FAST,
        )
      }
    }
    if (applied) {
      log(LOG_INFO, "White balance mode set to $mode; kelvin off")
    } else {
      log(LOG_WARN, "This lens does not support white balance mode $mode")
    }
    return
  }
  if (mode == CameraCharacteristics.CONTROL_AWB_MODE_OFF) {
    runCatching { camera.disableAutoWhiteBalance() }.onFailure {
      log(LOG_WARN, "Could not lock white balance: ${it.message}")
      return
    }
    log(LOG_INFO, "White balance locked where it is")
    return
  }

  val applied = runCatching { camera.enableAutoWhiteBalance(mode) }.getOrNull() ?: false
  if (applied) {
    log(LOG_INFO, "White balance mode set to $mode")
  } else {
    log(LOG_WARN, "This lens does not support white balance mode $mode")
  }
}

/**
 * Stabilisation, both kinds at once.
 *
 * A phone may have optical stabilisation in the lens, electronic stabilisation
 * in the pipeline, or both, and an operator asking for a steadier picture is
 * not asking which. Optical is free quality where it exists, so it goes on
 * first; electronic costs a crop and some latency but is better than nothing.
 */
internal fun BroadcasterView.setStabilization(on: Boolean) {
  val optical = runCatching {
    if (on) camera.enableOpticalVideoStabilization() else {
      camera.disableOpticalVideoStabilization()
      true
    }
  }.getOrNull() ?: false

  val electronic = runCatching {
    if (on) camera.enableVideoStabilization() else {
      camera.disableVideoStabilization()
      true
    }
  }.getOrNull() ?: false

  if (!on) {
    log(LOG_INFO, "Stabilisation off")
    return
  }
  when {
    optical && electronic -> log(LOG_INFO, "Stabilisation on, optical and electronic")
    optical -> log(LOG_INFO, "Stabilisation on, optical only")
    electronic -> log(LOG_INFO, "Stabilisation on, electronic only")
    else -> log(LOG_WARN, "This lens has no stabilisation to turn on")
  }
}

/**
 * The torch, reported as the camera left it rather than as it was asked.
 *
 * `enableLantern` hands back nothing and gives up without throwing in three
 * separate places: Camera2Source skips the call entirely when the camera is not
 * running, Camera2ApiManager returns early when the capture request builder has
 * gone - every `closeCamera` nulls it, and configuring the encoder closes the
 * camera - and the repeating request it builds is applied by a helper that
 * writes a refusal to logcat and answers false. Only the fourth case, a lens
 * with no flash at all, throws. So a wrapper that trusts the call tells an
 * operator holding an unlit phone that the torch is on, which is worse than
 * saying nothing.
 *
 * The library's own flag is the honest answer: it is set from whether the
 * repeating request was actually accepted, and cleared whenever the camera
 * closes.
 */
internal fun BroadcasterView.setTorch(on: Boolean) {
  runCatching {
    if (on) camera.enableLantern() else camera.disableLantern()
  }.onFailure {
    log(LOG_WARN, "Could not switch the torch ${if (on) "on" else "off"}: ${it.message}")
    return
  }

  if (runCatching { camera.isLanternEnabled() }.getOrNull() == on) {
    log(LOG_INFO, if (on) "Torch on" else "Torch off")
    return
  }

  // Which of the three it was. A camera that is not running and a camera that
  // refused the request are different faults with different fixes, and the
  // difference costs one call here and cannot be recovered afterwards.
  val running = runCatching { camera.isRunning() }.getOrNull() == true
  log(
    LOG_WARN,
    if (!running) {
      "The torch was ignored: the camera is not running"
    } else {
      "The camera took the torch request and the flash did not follow; " +
        "the capture session refused it or was rebuilt without it"
    },
  )
}

/**
 * Manual focus, in dioptres: 0 is infinity and the lens maximum is as near as
 * it goes.
 *
 * Through the capture request, like the other two settings RootEncoder has no
 * call for. Auto-focus has to be turned off in the same request or the lens
 * takes the distance and immediately overrules it, which looks exactly like the
 * control not working.
 */
internal fun BroadcasterView.setFocusDistance(dioptres: Float) {
  val applied = runCatching {
    camera.setCustomRequest {
      it.set(CaptureRequest.CONTROL_AF_MODE, CameraCharacteristics.CONTROL_AF_MODE_OFF)
      it.set(CaptureRequest.LENS_FOCUS_DISTANCE, dioptres)
    }
  }.getOrNull() ?: false

  if (!applied) {
    log(LOG_WARN, "The camera would not take a focus distance")
    return
  }
  focusDistance = dioptres
  manualFocus = true
  captureRequestOverridden = true
  log(LOG_INFO, "Focus held at ${"%.2f".format(dioptres)} dioptres")
}

/**
 * Hands focus back to the camera.
 *
 * Separate from [setAutoFocus] because that one goes through RootEncoder's own
 * call, and a lens put into manual by the capture request above is not a lens
 * RootEncoder knows it changed - so it has to be undone the same way it was
 * done.
 */
internal fun BroadcasterView.resumeAutoFocus() {
  val applied = runCatching {
    camera.setCustomRequest {
      it.set(CaptureRequest.CONTROL_AF_MODE, CameraCharacteristics.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
    }
  }.getOrNull() ?: false

  if (!applied) {
    log(LOG_WARN, "The camera would not go back to automatic focus")
    return
  }
  manualFocus = false
  log(LOG_INFO, "Focus back to automatic")
}

/**
 * Video noise reduction, as a CONTROL NOISE_REDUCTION_MODE value.
 *
 * Worth having on a phone that is filming a dim room, which is most of them:
 * OFF shows the sensor's grain, FAST is what the camera app uses, HIGH_QUALITY
 * costs frame time and is not always honoured while recording. The list of
 * modes comes from the lens, so nothing is offered that it cannot do.
 *
 * Through setCustomRequest because RootEncoder has no call of its own for it.
 * That returns false when the capture request does not exist yet - the camera
 * is not running - which is a state worth saying rather than a failure.
 */
internal fun BroadcasterView.setNoiseReduction(mode: Int) {
  val applied = runCatching {
    camera.setCustomRequest { it.set(CaptureRequest.NOISE_REDUCTION_MODE, mode) }
  }.getOrNull() ?: false

  if (applied) {
    noiseReduction = mode
    captureRequestOverridden = true
    log(LOG_INFO, "Noise reduction set to $mode")
  } else {
    log(LOG_WARN, "The camera would not take noise reduction mode $mode")
  }
}

/**
 * Anti-flicker, as a CONTROL_AE_ANTIBANDING_MODE value.
 *
 * The one camera setting on this list that fixes a fault rather than a
 * preference. Mains lighting flickers at twice the supply frequency, and a
 * sensor exposing out of step with it lays dark bands through the picture that
 * roll as the phone moves. It cannot be corrected afterwards, and it is
 * invisible on the viewfinder until somebody watches the broadcast back. 50Hz
 * or 60Hz depending on the country, AUTO where the phone will work it out.
 */
internal fun BroadcasterView.setAntiFlicker(mode: Int) {
  val applied = runCatching {
    camera.setCustomRequest { it.set(CaptureRequest.CONTROL_AE_ANTIBANDING_MODE, mode) }
  }.getOrNull() ?: false

  if (applied) {
    antiFlicker = mode
    captureRequestOverridden = true
    log(LOG_INFO, "Anti-flicker set to $mode")
  } else {
    log(LOG_WARN, "The camera would not take anti-flicker mode $mode")
  }
}

// --- Manual exposure ----------------------------------------------------

private const val NANOS_PER_SECOND = 1_000_000_000L

/**
 * ISO and shutter as this lens can take them: each clamped into the lens's own
 * range, the shutter also to one frame (see [exposureTimeRange]), and the frame
 * duration that goes with them. Null when the lens does not report the ranges,
 * which a MANUAL_SENSOR lens is required to.
 */
private data class ManualExposure(val iso: Int, val exposureNs: Long, val frameNs: Long)

private fun BroadcasterView.manualExposureFor(
  characteristics: CameraCharacteristics?,
  iso: Int,
  exposureNs: Long,
): ManualExposure? {
  val isoLimits = isoRange(characteristics) ?: return null
  val timeLimits = exposureTimeRange(characteristics) ?: return null
  return ManualExposure(
    iso = iso.coerceIn(isoLimits.first, isoLimits.second),
    exposureNs = exposureNs.coerceIn(timeLimits.first, timeLimits.second),
    /**
     * One frame at the camera's rate, never shorter than the shutter.
     *
     * With AE off the camera stops choosing the frame duration as well as the
     * exposure, and CONTROL_AE_TARGET_FPS_RANGE is ignored with it - so a
     * request that leaves SENSOR_FRAME_DURATION at the template's value runs
     * at whatever rate the template happened to carry. On a 60 fps broadcast
     * that is typically 30, and the picture would halve its frame rate the
     * moment the operator touched ISO. Setting it to the stream's own frame is
     * what keeps manual exposure from changing anything but exposure.
     */
    frameNs = maxOf(frameNs(captureFps()), exposureNs.coerceIn(timeLimits.first, timeLimits.second)),
  )
}

/** Writes manual exposure into a capture request; see [setManualExposure]. */
private fun CaptureRequest.Builder.putManualExposure(values: ManualExposure) {
  set(CaptureRequest.CONTROL_AE_MODE, CameraCharacteristics.CONTROL_AE_MODE_OFF)
  set(CaptureRequest.SENSOR_SENSITIVITY, values.iso)
  set(CaptureRequest.SENSOR_EXPOSURE_TIME, values.exposureNs)
  set(CaptureRequest.SENSOR_FRAME_DURATION, values.frameNs)
}

/**
 * Manual exposure: the operator chooses the ISO and the shutter, and the
 * camera stops metering.
 *
 * Not the lock. [setExposureLock] holds whatever the meter settled on; this
 * says what the exposure is, which is what a broadcast needs when the meter is
 * being fooled - a speaker in a spotlight against a dark hall, where every
 * metering mode either burns the face or loses the room. The shutter also
 * matters on its own: at 1/50 or 1/60 under mains lighting, the flicker bands
 * vanish without anti-flicker having to guess.
 *
 * Both values are clamped to the lens, and the shutter to one frame (see
 * [exposureTimeRange]); the values asked for are kept as asked, so a lens
 * change clamps them afresh for the new lens. Kept on the view and put back by
 * [reapplyCaptureRequest], because every lens open and preview restart builds
 * a new request from the camera's template.
 *
 * Exposure compensation and the AE lock mean nothing with the meter off and
 * are left where they are, stored, for [resumeAutoExposure] to restore.
 */
internal fun BroadcasterView.setManualExposure(iso: Int, exposureNs: Long) {
  val characteristics = currentCharacteristics()
  if (!manualSensorSupported(characteristics)) {
    log(LOG_WARN, "This lens has no manual exposure; it keeps metering")
    return
  }
  val values = manualExposureFor(characteristics, iso, exposureNs)
  if (values == null) {
    log(LOG_WARN, "This lens did not report its ISO and shutter ranges; it keeps metering")
    return
  }
  val applied = runCatching {
    camera.setCustomRequest { it.putManualExposure(values) }
  }.getOrNull() ?: false
  if (!applied) {
    log(LOG_WARN, "The camera would not take a manual exposure")
    return
  }
  manualExposure = true
  manualIso = iso
  manualExposureNs = exposureNs
  captureRequestOverridden = true
  log(
    LOG_INFO,
    "Exposure manual: ISO ${values.iso}, 1/${shutterDenominator(values.exposureNs)}s",
  )
  // Without the capture results there is no other way the readout learns.
  if (!captureResultsWired) emitRequestedExposure()
}

/** 1/x for a log line: what an operator reads a shutter as. */
private fun shutterDenominator(exposureNs: Long): Int =
  if (exposureNs <= 0L) 0 else (NANOS_PER_SECOND.toDouble() / exposureNs).roundToInt()

/**
 * Hands exposure back to the camera, with the compensation and the lock the
 * operator had before going manual.
 *
 * All three in one request. AE_MODE_ON alone would come back metering at
 * whatever compensation is in the builder - which, after a restart while
 * manual, is the template's zero rather than the operator's - and unlocked,
 * so a lock they set before going manual would be silently gone. The
 * compensation comes from what [setExposure] kept, not from the builder, for
 * exactly that reason.
 */
internal fun BroadcasterView.resumeAutoExposure() {
  val compensation = compensationFor(currentCharacteristics())
  val applied = runCatching {
    camera.setCustomRequest {
      it.set(CaptureRequest.CONTROL_AE_MODE, CameraCharacteristics.CONTROL_AE_MODE_ON)
      it.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, compensation)
      it.set(CaptureRequest.CONTROL_AE_LOCK, exposureLocked)
    }
  }.getOrNull() ?: false
  if (!applied) {
    log(LOG_WARN, "The camera would not go back to automatic exposure")
    return
  }
  manualExposure = false
  log(LOG_INFO, "Exposure back to automatic${if (exposureLocked) ", locked" else ""}")
}

// --- White balance by temperature ---------------------------------------

private const val MIN_KELVIN = 2_000.0
private const val MAX_KELVIN = 10_000.0
private const val MAX_TINT = 50.0

/**
 * How far full tint moves the green gain: 0.3, so tint 50 is green at 0.7 and
 * -50 is green at 1.3. Enough to correct the green cast of cheap LED panels
 * and fluorescent tubes, which is what tint is for, without the far end
 * becoming a colour effect.
 */
private const val TINT_STRENGTH = 0.3

/**
 * The gains are held inside this range. At 2000K the black-body curve's blue
 * is close to zero, so the blue gain it implies runs to ten and more, which no
 * sensor pipeline amplifies cleanly; eight is already four stops of blue.
 */
private const val MIN_GAIN = 0.125f
private const val MAX_GAIN = 8f

/**
 * The colour of a black body at [kelvin], as 0..255 RGB.
 *
 * Tanner Helland's fit to the CIE 1964 10-degree black-body data, the
 * approximation most camera and photo software uses for a kelvin slider: one
 * curve per channel, either side of 6600K. It is a fit, not colorimetry - good
 * to a few per cent across 1000-40000K, which is closer than any operator can
 * judge a white balance by eye on a phone screen.
 */
private fun blackBodyRgb(kelvin: Double): Triple<Double, Double, Double> {
  val t = kelvin / 100.0
  val r = if (t <= 66.0) 255.0 else 329.698727446 * (t - 60.0).pow(-0.1332047592)
  val g = if (t <= 66.0) {
    99.4708025861 * ln(t) - 161.1195681661
  } else {
    288.1221695283 * (t - 60.0).pow(-0.0755148492)
  }
  val b = when {
    t >= 66.0 -> 255.0
    t <= 19.0 -> 0.0
    else -> 138.5177312231 * ln(t - 10.0) - 305.0447927307
  }
  return Triple(r.coerceIn(0.0, 255.0), g.coerceIn(0.0, 255.0), b.coerceIn(0.0, 255.0))
}

/**
 * The colour-correction gains that make light of [kelvin] read as white, with
 * [tint] applied to green.
 *
 * Light of a temperature has that black body's colour, so neutralising it is
 * dividing each channel by it. Normalised so green is 1 - the channel the
 * sensor has twice as many of and the one Camera2's own AWB holds at unity -
 * which leaves red as g/r and blue as g/b: 3200K tungsten comes out at roughly
 * red 0.7, blue 1.5, pulling the orange out.
 *
 * Tint then moves green alone: positive is more magenta, which is less green,
 * so the green gains come down. Both green channels together, because the
 * Bayer pattern's two greens are the same colour and splitting them would draw
 * a checkerboard.
 */
private fun kelvinGains(kelvin: Double, tint: Double): RggbChannelVector {
  val (r, g, b) = blackBodyRgb(kelvin)
  // A channel of zero is a gain of infinity; one code value is already past
  // the clamp below, so it costs nothing in range.
  val red = (g / r.coerceAtLeast(1.0)).toFloat().coerceIn(MIN_GAIN, MAX_GAIN)
  val blue = (g / b.coerceAtLeast(1.0)).toFloat().coerceIn(MIN_GAIN, MAX_GAIN)
  val green = (1.0 - (tint / MAX_TINT) * TINT_STRENGTH).toFloat().coerceIn(MIN_GAIN, MAX_GAIN)
  return RggbChannelVector(red, green, green, blue)
}

/** The 3x3 identity as Camera2 wants it: numerator/denominator pairs, row by row. */
private val IDENTITY_TRANSFORM = ColorSpaceTransform(
  intArrayOf(
    1, 1, 0, 1, 0, 1,
    0, 1, 1, 1, 0, 1,
    0, 1, 0, 1, 1, 1,
  ),
)

/** Writes kelvin white balance into a capture request; see [setWhiteBalanceKelvin]. */
private fun BroadcasterView.putKelvin(builder: CaptureRequest.Builder) {
  val id: String? = runCatching { camera.getCurrentCameraId() }.getOrNull()
  builder.set(CaptureRequest.CONTROL_AWB_MODE, CameraCharacteristics.CONTROL_AWB_MODE_OFF)
  builder.set(
    CaptureRequest.COLOR_CORRECTION_MODE,
    CameraCharacteristics.COLOR_CORRECTION_MODE_TRANSFORM_MATRIX,
  )
  builder.set(CaptureRequest.COLOR_CORRECTION_GAINS, kelvinGains(whiteBalanceKelvin, whiteBalanceTint))
  builder.set(
    CaptureRequest.COLOR_CORRECTION_TRANSFORM,
    id?.let { autoColorTransforms[it] } ?: IDENTITY_TRANSFORM,
  )
}

/**
 * White balance by colour temperature: [kelvin] 2000-10000, [tint] -50 (green)
 * to 50 (magenta).
 *
 * The presets in [setWhiteBalance] are the camera's guesses at a few named
 * lights, and auto is a guess that moves: a speaker in a blue shirt walks into
 * shot and the whole room goes orange. A temperature the operator sets stays
 * put, and matches between two phones filming the same hall, which no preset
 * does.
 *
 * AWB off, colour correction in TRANSFORM_MATRIX mode, gains from the
 * black-body curve ([kelvinGains]). The matrix is the one this lens's own auto
 * white balance was last seen using, from its capture results, and identity
 * only for a lens never seen in auto: see [BroadcasterView.autoColorTransforms]
 * for why identity alone would flatten every colour.
 *
 * Kept on the view and put back by [reapplyCaptureRequest], like everything
 * else set through the request. [setWhiteBalance] - any mode, 1 being auto -
 * ends it.
 */
internal fun BroadcasterView.setWhiteBalanceKelvin(kelvin: Double, tint: Double) {
  if (!manualWhiteBalanceSupported(currentCharacteristics())) {
    log(LOG_WARN, "This lens has no manual white balance; it keeps its own")
    return
  }
  val k = if (kelvin.isNaN()) BroadcasterView.DEFAULT_KELVIN else kelvin.coerceIn(MIN_KELVIN, MAX_KELVIN)
  val t = if (tint.isNaN()) 0.0 else tint.coerceIn(-MAX_TINT, MAX_TINT)
  val previousKelvin = whiteBalanceKelvin
  val previousTint = whiteBalanceTint
  whiteBalanceKelvin = k
  whiteBalanceTint = t
  val applied = runCatching { camera.setCustomRequest { putKelvin(it) } }.getOrNull() ?: false
  if (!applied) {
    // Back to what the request actually carries, so a restart does not put a
    // temperature back that the camera never took.
    whiteBalanceKelvin = previousKelvin
    whiteBalanceTint = previousTint
    log(LOG_WARN, "The camera would not take a white balance temperature")
    return
  }
  kelvinWhiteBalance = true
  captureRequestOverridden = true
  log(LOG_INFO, "White balance ${k.roundToInt()}K, tint ${t.roundToInt()}")
}

/**
 * How long to keep offering the settings back to a session that is still
 * being built. A capture session takes a few hundred milliseconds to come up
 * on a cold lens and there is no callback out of RootEncoder that says when,
 * so this asks until it is taken, then stops.
 */
private const val REAPPLY_TRIES = 12
private const val REAPPLY_INTERVAL_MS = 250L

/**
 * Puts the capture-request settings back after the session was rebuilt:
 * noise reduction, anti-flicker, the exposure lock, manual focus, manual
 * exposure and kelvin white balance.
 *
 * `setCustomRequest` writes into the builder RootEncoder holds, and that
 * builder is made fresh by `createCaptureRequest` every time a lens is opened
 * or the preview is restarted - a rotation does both. So anti-flicker set to
 * 50Hz in the dressing room was gone by the time the phone was turned
 * sideways, with the panel still showing 50Hz: the picture bands and the one
 * thing that would explain it says it is already handled.
 *
 * The lock is a partial restoration and worth being honest about: Camera2
 * cannot be told which exposure to hold, only to hold the one it has, so a
 * lock put back after a rotation pins whatever the meter has settled on by
 * then. That is a hair's difference on the same scene, and it beats the
 * alternative of the picture quietly starting to breathe again halfway
 * through a broadcast.
 *
 * Nothing here is done for an operator who never touched any of them, and
 * nothing is retried once the camera has taken them.
 */
internal fun BroadcasterView.reapplyCaptureRequest(attempt: Int = 0) {
  if (!captureRequestOverridden) return

  /**
   * Manual exposure and kelvin white balance are worked out against the lens
   * now open, not the one they were set on: the ranges, the frame rate and
   * the colour matrix are all the lens's own. A lens that cannot do one of
   * them simply does not get it - the camera meters, or balances, as it would
   * have - and the choice is kept, so the next lens that can takes it back.
   */
  val characteristics = currentCharacteristics()
  val manual = if (manualExposure && manualSensorSupported(characteristics)) {
    manualExposureFor(characteristics, manualIso, manualExposureNs)
  } else {
    null
  }
  val kelvin = kelvinWhiteBalance && manualWhiteBalanceSupported(characteristics)

  val applied = runCatching {
    camera.setCustomRequest {
      it.set(CaptureRequest.NOISE_REDUCTION_MODE, noiseReduction)
      it.set(CaptureRequest.CONTROL_AE_ANTIBANDING_MODE, antiFlicker)
      if (manual != null) {
        // The lock and compensation mean nothing with the meter off; see
        // [setManualExposure]. Both stay stored for [resumeAutoExposure].
        it.putManualExposure(manual)
      } else {
        it.set(CaptureRequest.CONTROL_AE_LOCK, exposureLocked)
        it.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, compensationFor(characteristics))
      }
      if (manualFocus) {
        it.set(CaptureRequest.CONTROL_AF_MODE, CameraCharacteristics.CONTROL_AF_MODE_OFF)
        it.set(CaptureRequest.LENS_FOCUS_DISTANCE, focusDistance)
      }
      if (kelvin) putKelvin(it)
    }
  }.getOrNull() ?: false

  if (applied) {
    log(LOG_INFO, "Camera settings put back on the new capture session")
    if (manual != null && !captureResultsWired) emitRequestedExposure()
    return
  }
  if (attempt + 1 >= REAPPLY_TRIES) {
    log(LOG_WARN, "The camera never took those settings back")
    return
  }
  postDelayed({ reapplyCaptureRequest(attempt + 1) }, REAPPLY_INTERVAL_MS)
}
