package de.linkfa.framevane.broadcaster

import android.graphics.Rect
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.MeteringRectangle
import android.os.SystemClock
import android.view.MotionEvent

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
internal fun BroadcasterView.capabilities(): Map<String, Any> {
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
    "available" to true,
  )
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
internal fun unavailableCapabilities(): Map<String, Any> = mapOf(
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
  log(LOG_INFO, "Exposure compensation set to $value steps")
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
 * Meter exposure on a point, Filmic-style: the operator drags the exposure
 * reticle and the camera reads the light under it, so the point's position is
 * the brightness control. Independent of focus - focus has its own reticle and
 * its own call ([focusAt]).
 *
 * The point arrives in preview fractions (0..1). Exposure metering, though, is
 * set in the sensor's own pixel grid (CONTROL_AE_REGIONS), which is rotated
 * relative to what the operator sees by SENSOR_ORIENTATION and mirrored on the
 * front lens - so the point is turned into sensor space before a small metering
 * box is placed around it. The box is weighted to the maximum so it, and not
 * the rest of the frame, decides the exposure.
 *
 * Goes through setCustomRequest because RootEncoder has no call for AE regions;
 * that returns false when the camera is not running yet.
 */
internal fun BroadcasterView.setExposurePoint(x: Float, y: Float) {
  val characteristics = currentCharacteristics() ?: run {
    log(LOG_WARN, "Cannot meter: no camera open")
    return
  }
  val maxRegions = characteristics.get(CameraCharacteristics.CONTROL_MAX_REGIONS_AE) ?: 0
  if (maxRegions <= 0) {
    log(LOG_WARN, "This lens cannot meter exposure on a point")
    return
  }
  val active = characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE) ?: run {
    log(LOG_WARN, "Cannot meter: the sensor did not report its array size")
    return
  }
  val orientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
  val front = characteristics.get(CameraCharacteristics.LENS_FACING) ==
    CameraCharacteristics.LENS_FACING_FRONT
  val region = meteringRegion(active, x, y, orientation, front)

  val applied = runCatching {
    camera.setCustomRequest { it.set(CaptureRequest.CONTROL_AE_REGIONS, arrayOf(region)) }
  }.getOrNull() ?: false

  if (!applied) {
    log(LOG_WARN, "The camera would not take an exposure metering point")
    return
  }
  captureRequestOverridden = true
  log(LOG_INFO, "Exposure metering at ($x, $y) -> sensor $region")
}

/**
 * Turn a normalised preview point into a small, max-weighted metering box in
 * the sensor's active array, correcting for sensor rotation and front mirroring.
 *
 * The box is about a quarter of the frame wide so a hand that is not perfectly
 * steady still meters roughly the same patch of the scene from one frame to the
 * next.
 */
private fun meteringRegion(
  active: Rect,
  nx: Float,
  ny: Float,
  orientation: Int,
  front: Boolean,
): MeteringRectangle {
  var dx = nx.coerceIn(0f, 1f)
  val dy = ny.coerceIn(0f, 1f)
  // The front preview is shown mirrored; undo it before going to the sensor.
  if (front) dx = 1f - dx
  // Rotate the display point into sensor space by the sensor's orientation.
  val (sxN, syN) = when (((orientation % 360) + 360) % 360) {
    90 -> dy to (1f - dx)
    180 -> (1f - dx) to (1f - dy)
    270 -> (1f - dy) to dx
    else -> dx to dy
  }

  val w = active.width()
  val h = active.height()
  val halfW = (w / 8).coerceAtLeast(1)
  val halfH = (h / 8).coerceAtLeast(1)
  val cx = active.left + (sxN * w).toInt()
  val cy = active.top + (syN * h).toInt()
  val left = (cx - halfW).coerceIn(active.left, active.right - 1)
  val top = (cy - halfH).coerceIn(active.top, active.bottom - 1)
  val right = (cx + halfW).coerceIn(left + 1, active.right)
  val bottom = (cy + halfH).coerceIn(top + 1, active.bottom)
  return MeteringRectangle(left, top, right - left, bottom - top, MeteringRectangle.METERING_WEIGHT_MAX)
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
 * noise reduction, anti-flicker, and the exposure lock.
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

  val applied = runCatching {
    camera.setCustomRequest {
      it.set(CaptureRequest.NOISE_REDUCTION_MODE, noiseReduction)
      it.set(CaptureRequest.CONTROL_AE_ANTIBANDING_MODE, antiFlicker)
      it.set(CaptureRequest.CONTROL_AE_LOCK, exposureLocked)
      if (manualFocus) {
        it.set(CaptureRequest.CONTROL_AF_MODE, CameraCharacteristics.CONTROL_AF_MODE_OFF)
        it.set(CaptureRequest.LENS_FOCUS_DISTANCE, focusDistance)
      }
    }
  }.getOrNull() ?: false

  if (applied) {
    log(LOG_INFO, "Camera settings put back on the new capture session")
    return
  }
  if (attempt + 1 >= REAPPLY_TRIES) {
    log(LOG_WARN, "The camera never took those settings back")
    return
  }
  postDelayed({ reapplyCaptureRequest(attempt + 1) }, REAPPLY_INTERVAL_MS)
}
