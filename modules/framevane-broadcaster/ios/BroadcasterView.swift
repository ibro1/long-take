import ExpoModulesCore

/**
 * A placeholder preview, so the app builds and runs on iOS while the encoder
 * side is unwritten. It draws nothing rather than pretending to be a camera.
 *
 * The dispatchers exist because Expo validates that every name passed to
 * `Events(...)` in the module definition has a matching dispatcher on the view.
 * None of them ever fire here.
 */
public class BroadcasterView: ExpoView {
  let onStatus = EventDispatcher()
  let onBitrate = EventDispatcher()
  let onLevel = EventDispatcher()
  let onCameras = EventDispatcher()
  let onAudioDevices = EventDispatcher()
  let onLog = EventDispatcher()
  let onRecord = EventDispatcher()
  let onAudioInterrupted = EventDispatcher()
  let onThermal = EventDispatcher()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
  }
}
