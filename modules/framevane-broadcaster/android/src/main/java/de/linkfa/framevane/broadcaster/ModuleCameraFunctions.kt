package de.linkfa.framevane.broadcaster

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

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

  AsyncFunction("setWhiteBalance") { mode: Int -> view().setWhiteBalance(mode) }

  AsyncFunction("setStabilization") { on: Boolean -> view().setStabilization(on) }

  AsyncFunction("setTorch") { on: Boolean -> view().setTorch(on) }

  Function("isTorchOn") { BroadcasterView.current?.camera?.isLanternEnabled() ?: false }

  AsyncFunction("setMonitor") { mode: String -> view().setMonitor(mode) }

  Function("monitorMode") { BroadcasterView.current?.monitorMode ?: "off" }
}
