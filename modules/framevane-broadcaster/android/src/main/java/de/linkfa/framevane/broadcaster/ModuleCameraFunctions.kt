package de.linkfa.framevane.broadcaster

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * The camera half of the module definition.
 *
 * Reads as synchronous or asynchronous by whether it acts: a list or a range is
 * a read and the UI wants it now, in render; anything that touches the camera
 * goes through a promise because it can fail and the operator should be told.
 */
internal fun ModuleDefinitionBuilder.cameraFunctions() {
  /**
   * Every camera the phone will open, with facing and field of view, so the
   * operator picks a lens rather than a number. A USB camera plugged in later
   * appears here too, and the view reports the change without being asked.
   */
  Function("cameras") { BroadcasterView.current?.cameras() ?: emptyList<Map<String, Any>>() }

  AsyncFunction("openCamera") { id: String -> view().openCamera(id) }

  AsyncFunction("switchCamera") { view().switchCamera() }

  /**
   * What the lens now open will actually let the operator change. Read after
   * every camera change: an ultra-wide and a main lens do not offer the same
   * controls, and a control the lens ignores is worse than no control.
   */
  Function("capabilities") {
    BroadcasterView.current?.capabilities() ?: unavailableCapabilities()
  }

  AsyncFunction("setZoom") { level: Float -> view().camera.setZoom(level) }

  Function("zoomRange") {
    val range = BroadcasterView.current?.camera?.getZoomRange()
    mapOf("min" to (range?.lower ?: 1f), "max" to (range?.upper ?: 1f))
  }

  /**
   * Focus where the operator touched, in fractions of the preview. Tapping
   * means "this, not whatever you chose", so it takes the lens off auto focus -
   * which is the point rather than a side effect.
   */
  AsyncFunction("focusAt") { x: Float, y: Float -> view().focusAt(x, y) }

  AsyncFunction("setAutoFocus") { on: Boolean -> view().setAutoFocus(on) }

  AsyncFunction("setExposure") { value: Int -> view().setExposure(value) }

  // The exposure reticle's spot meter: brightness of the picture where it sits.
  AsyncFunction("sampleLuma") { x: Float, y: Float, promise: Promise ->
    view().sampleLuma(x, y, promise)
  }

  /**
   * Manual focus in dioptres - 1/metres, so 0 is infinity and the lens maximum
   * is as near as it goes. `capabilities().focusNear` is that maximum, and 0
   * there means the lens is fixed and this call has nothing to do.
   */
  AsyncFunction("setFocusDistance") { dioptres: Float -> view().setFocusDistance(dioptres) }

  AsyncFunction("resumeAutoFocus") { view().resumeAutoFocus() }

  AsyncFunction("setExposureLock") { on: Boolean -> view().setExposureLock(on) }

  /**
   * Manual ISO and shutter, the shutter in nanoseconds. Clamped to the lens's
   * `isoRange` and `exposureTimeRange` from `capabilities()`, whose shutter
   * ceiling is already one frame. Doubles across the bridge because a
   * shutter in nanoseconds can be past what an Int holds.
   */
  AsyncFunction("setManualExposure") { iso: Double, exposureNs: Double ->
    val v = view()
    v.setManualExposure(
      if (iso.isNaN()) 0 else iso.roundToInt(),
      if (exposureNs.isNaN()) 0L else exposureNs.roundToLong(),
    )
  }

  /** Back to the camera's metering, with the compensation and lock it had. */
  AsyncFunction("resumeAutoExposure") { view().resumeAutoExposure() }

  /**
   * White balance by temperature: kelvin 2000-10000, tint -50 (green) to 50
   * (magenta). `setWhiteBalance` with any mode - 1 for auto - ends it.
   */
  AsyncFunction("setWhiteBalanceKelvin") { kelvin: Double, tint: Double ->
    view().setWhiteBalanceKelvin(kelvin, tint)
  }

  AsyncFunction("setWhiteBalance") { mode: Int -> view().setWhiteBalance(mode) }

  AsyncFunction("setStabilization") { on: Boolean -> view().setStabilization(on) }

  AsyncFunction("setTorch") { on: Boolean -> view().setTorch(on) }

  Function("isTorchOn") { BroadcasterView.current?.camera?.isLanternEnabled() ?: false }

  /**
   * Filmic's Gamma and Looks: any of `curve` (0 Native, 1 Natural, 2 Dynamic,
   * 3 Flat, 4 Log), `black`/`white` (0..1), `shadow`/`highlight` (-1..1),
   * `contrast`, `saturation`, `warmth`, `tint`, `shadowTone`/`highlightTone`
   * ([r, g, b] each -1..1) and `lutStrength` (0..1). Keys left out keep their
   * value. View-less like the monitor options: kept in [GradeOptions] and
   * picked up by the next preview, and burned into the stream and the file.
   */
  Function("setColorGrade") { options: Map<String, Any?> ->
    val o = GradeOptions
    fun num(key: String) = (options[key] as? Number)?.toFloat()?.takeIf { !it.isNaN() }
    fun tone(key: String) = (options[key] as? List<*>)?.mapNotNull { (it as? Number)?.toFloat() }
      ?.takeIf { it.size == 3 }?.map { it.coerceIn(-1f, 1f) }?.toFloatArray()
    num("curve")?.let { o.curve = it.toInt().coerceIn(0, 4) }
    num("black")?.let { o.black = it.coerceIn(0f, 0.5f) }
    num("white")?.let { o.white = it.coerceIn(0.5f, 1f) }
    num("shadow")?.let { o.shadow = it.coerceIn(-1f, 1f) }
    num("highlight")?.let { o.highlight = it.coerceIn(-1f, 1f) }
    num("contrast")?.let { o.contrast = it.coerceIn(0.5f, 1.6f) }
    num("saturation")?.let { o.saturation = it.coerceIn(0f, 2f) }
    num("warmth")?.let { o.warmth = it.coerceIn(-1f, 1f) }
    num("tint")?.let { o.tint = it.coerceIn(-1f, 1f) }
    tone("shadowTone")?.let { o.shadowTone = it }
    tone("highlightTone")?.let { o.highlightTone = it }
    num("lutStrength")?.let { o.lutStrength = it.coerceIn(0f, 1f) }
    BroadcasterView.current?.syncGrade()
    Unit
  }

  /**
   * Reads a `.cube` LUT from a file path (a `file://` URI is fine) and puts it
   * in the grade, burned in. Resolves with the cube's size as used; rejects
   * with the reason a file is not a usable LUT.
   */
  AsyncFunction("loadLut") { path: String ->
    val lut = Lut.parseCube(java.io.File(path.removePrefix("file://")))
    GradeOptions.lutLoaded = false
    GradeOptions.pendingLut = lut
    BroadcasterView.current?.syncGrade()
    lut.size
  }

  Function("clearLut") {
    GradeOptions.pendingLut = null
    GradeOptions.lutLoaded = false
    BroadcasterView.current?.syncGrade()
    Unit
  }

  AsyncFunction("setMonitor") { mode: String -> view().setMonitor(mode) }

  Function("monitorMode") { BroadcasterView.current?.monitorMode ?: "off" }

  /**
   * Tuning for the monitoring aids: `peakingColor` as "#RRGGBB",
   * `peakingThreshold` 0.05-0.4 (higher marks only the sharpest edges),
   * `zebraThreshold` 0.7-1 (luma). Any of them may be left out, and one that
   * is malformed is ignored with a line in the log rather than failing the
   * others.
   *
   * Synchronous and view-less, because the settings screen that sets these has
   * no preview: they are kept in [MonitorOptions], applied to the aid on screen
   * if there is one, and read by every aid built afterwards.
   */
  Function("setMonitorOptions") { options: Map<String, Any?> ->
    val view = BroadcasterView.current
    (options["peakingColor"] as? String)?.let { value ->
      val rgb = MonitorOptions.parseColor(value)
      if (rgb != null) {
        MonitorOptions.peakingColor = rgb
      } else {
        view?.log(LOG_WARN, "Peaking colour '$value' is not #RRGGBB; keeping the current one")
      }
    }
    (options["peakingThreshold"] as? Number)?.toFloat()?.takeIf { !it.isNaN() }?.let {
      MonitorOptions.peakingThreshold = it.coerceIn(MIN_PEAKING_THRESHOLD, MAX_PEAKING_THRESHOLD)
    }
    (options["zebraThreshold"] as? Number)?.toFloat()?.takeIf { !it.isNaN() }?.let {
      MonitorOptions.zebraThreshold = it.coerceIn(MIN_ZEBRA_THRESHOLD, 1f)
    }
    view?.applyMonitorOptions()
    Unit
  }
}

/**
 * The ranges the monitoring aids are held to. Below 0.05 peaking marks sensor
 * noise as edges and paints the whole frame; above 0.4 it marks almost nothing
 * even in sharp focus. Zebras below 0.7 stripe ordinary skin, which is a
 * mid-tone, not a warning.
 */
private const val MIN_PEAKING_THRESHOLD = 0.05f
private const val MAX_PEAKING_THRESHOLD = 0.4f
private const val MIN_ZEBRA_THRESHOLD = 0.7f
