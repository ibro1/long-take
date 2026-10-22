package de.linkfa.framevane.broadcaster

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * What keeps a broadcast alive when the app is not on screen.
 *
 * RootEncoder's own half of this already works: stopping the preview leaves the
 * camera and the GL context running while a stream is live, so losing the
 * surface to a backgrounded app or a dark screen costs nothing. Android is the
 * problem. It revokes camera and microphone access to a process that is not in
 * the foreground and then kills the process outright, and the only way to be
 * exempt from both is to run a foreground service that says, in a notification
 * the operator can see, exactly what is being held open.
 *
 * Which is also the only honest way to do it. A phone that is quietly filming
 * with nothing on screen is a phone nobody should trust, so the notification is
 * not a tax on the feature - it is the feature working properly, and it carries
 * the one control an operator has left once the app is out of sight.
 */
class BroadcastService : Service() {

  /**
   * A foreground service is exempt from being killed. It is not exempt from the
   * CPU sleeping, and an encoder on a sleeping CPU stops encoding - which is
   * exactly the case this whole class exists for, a phone in a pocket with the
   * screen off. Hence the wake lock, which is why the module asks for
   * WAKE_LOCK.
   */
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopBroadcast()
      stopSelf()
      return START_NOT_STICKY
    }

    // A wake lock behind a notification that never appeared is the worst of
    // both: the phone stays awake and the operator has nothing to stop.
    if (!startForegroundNotification()) return START_NOT_STICKY
    acquireWakeLock()

    // Not sticky, deliberately. If Android kills the process the encoder dies
    // with it, and a service restarted with a null intent would sit there
    // holding a wake lock and showing a notification about a broadcast that no
    // longer exists.
    return START_NOT_STICKY
  }

  /**
   * Swiping the app out of Recents destroys the activity and leaves this
   * service - and with it the process, the camera, the encoder and the socket -
   * running behind a notification whose Stop button no longer reaches anything
   * that is streaming. To the operator that is a broadcast they ended; to the
   * phone it is an orphan burning uplink and battery until Android gets round
   * to killing the process.
   *
   * Android delivers this before any of that happens, so a swipe is taken to
   * mean what it plainly means and the broadcast ends here.
   */
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopBroadcast()
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    // The state text is only worth re-saying while there is a notification to
    // say it on, and there is about not to be.
    running = false
    releaseWakeLock()
    // Whether asked to stop or refused to start, the view's request is over;
    // see BroadcasterView.serviceRequested.
    runCatching { BroadcasterView.current?.onServiceGone() }
    super.onDestroy()
  }

  /**
   * The Stop action has to do what the button on screen does, not merely
   * dismiss the notification - it is the operator's only control while the app
   * is out of sight.
   *
   * The work happens off the main thread because ending a stream closes a
   * socket and waits for its thread, and the main thread is the one thread that
   * must not wait.
   */
  private fun stopBroadcast() {
    val view = BroadcasterView.current ?: return
    Thread { runCatching { view.stopBroadcast() } }.start()
  }

  /**
   * True if the service is actually in the foreground.
   *
   * Every throw here is process-fatal otherwise, and there are two that a
   * working app hits in the field: Android 12 refuses a start attributed to
   * the background with ForegroundServiceStartNotAllowedException, and Android
   * 14 refuses a camera or microphone service with SecurityException when the
   * runtime permission behind the type has gone - which is exactly what an
   * operator revoking the camera in settings does. Neither is recoverable
   * here, but both are the difference between background broadcasting not
   * working and the app dying on the spot with the stream still up.
   *
   * `startForegroundService` returns long before any of this runs, so the
   * caller's own runCatching never sees it. This is the only place that can.
   */
  private fun startForegroundNotification(): Boolean = runCatching {
    // Back to the plain sentence: this is a broadcast starting, whatever the
    // last one ended as.
    //
    // Unless nothing is going out. The service is held for an off-air
    // recording too, and "broadcasting" on the lock screen of a phone that is
    // only recording is a claim about an audience that does not exist.
    if (recordingOnly()) {
      stateTitle = RECORDING_TITLE
      stateText = RECORDING_TEXT
    } else {
      stateTitle = "Framevane is broadcasting"
      stateText = "The camera and microphone are live."
    }
    val notification = buildNotification()
    // The camera and microphone service types, and the constants for them,
    // arrived in Android 11. Below that the manifest declaration is all there
    // is, and the plain call is the only one that exists.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    running = true
    true
  }.getOrElse {
    // The log is the screen that has to explain this afterwards, and it is
    // reached through the preview because that is where it lives.
    BroadcasterView.current?.log(
      LOG_ERROR,
      "Android refused to run the background broadcast service: ${it.message}",
    )
    stopSelf()
    false
  }

  private fun buildNotification(): Notification = buildFor(this)

  /**
   * Low importance, and that is a decision rather than a default. The
   * notification is a permanent statement of what the phone is doing, not news:
   * it has to be visible in the shade and on the lock screen, and it must never
   * make a sound or push a banner over whatever the operator is looking at.
   */
  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    runCatching {
      val power = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
      val lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
      // No timeout: the lock lasts exactly as long as the service, and the
      // service lasts exactly as long as the broadcast.
      lock.acquire()
      wakeLock = lock
    }
  }

  private fun releaseWakeLock() {
    runCatching { wakeLock?.let { if (it.isHeld) it.release() } }
    wakeLock = null
  }

  companion object {
    private const val ACTION_STOP = "de.linkfa.framevane.broadcaster.STOP"
    private const val CHANNEL_ID = "framevane.broadcast"
    private const val WAKE_LOCK_TAG = "framevane:broadcast"
    private const val NOTIFICATION_ID = 8_421
    private const val ALERT_CHANNEL_ID = "framevane.broadcast.alert"

    /**
     * What the ongoing notification currently says.
     *
     * It used to say "Framevane is broadcasting / The camera and microphone are
     * live" for the whole life of the service, including the minutes a dropped
     * connection spends retrying. A notification that reports a state the app
     * is not in is worse than a vague one: an operator glancing at a locked
     * phone was being told the stream was fine while it was down.
     *
     * Held here rather than on the instance because the view sets it and the
     * service reads it, and the two do not have a reference to each other.
     */
    @Volatile private var stateTitle: String = "Framevane is broadcasting"
    @Volatile private var stateText: String = "The camera and microphone are live."
    /**
     * Whether the service is actually in the foreground: set once
     * `startForeground` has returned, cleared in `onDestroy`.
     *
     * The view reads this rather than its own record of having asked, because
     * asking is not getting - see BroadcasterView.syncBackgroundService.
     */
    @Volatile private var running = false

    internal val isRunning: Boolean
      get() = running

    private const val RECORDING_TITLE = "Framevane is recording"
    private const val RECORDING_TEXT = "Recording to this phone. Nothing is going out."

    /** Recording with no stream, which is the one case the plain sentence gets wrong. */
    private fun recordingOnly(): Boolean {
      val stream = BroadcasterView.current?.stream ?: return false
      return runCatching { stream.isRecording && !stream.isStreaming }.getOrDefault(false)
    }

    /**
     * Low importance, and that is a decision rather than a default. The
     * notification is a permanent statement of what the phone is doing, not
     * news: it has to be visible in the shade and on the lock screen, and it
     * must never make a sound or push a banner over whatever the operator is
     * looking at. The interruption channel beside it is the opposite, and is
     * created separately.
     */
    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return
      val channel =
        NotificationChannel(CHANNEL_ID, "Broadcasting", NotificationManager.IMPORTANCE_LOW)
      channel.setShowBadge(false)
      channel.setSound(null, null)
      channel.enableVibration(false)
      // Visible on the lock screen: a phone that is filming should say so even
      // when it is locked, which is when nobody is looking at the app.
      channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      manager.createNotificationChannel(channel)
    }

    /**
       * The ongoing notification, built from a Context rather than from the
       * service instance - so the state text can be re-said from anywhere
       * without a handle on the running service.
       */
      private fun buildFor(context: Context): Notification {
        ensureChannel(context)

      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)
      }

      builder
        .setContentTitle(stateTitle)
        .setContentText(stateText)
        // A framework drawable rather than one of ours: a status bar icon is
        // masked down to a white silhouette, which turns a full-colour app icon
        // into a blob, and this one already reads as a camera at that size.
        .setSmallIcon(android.R.drawable.ic_menu_camera)
        .setOngoing(true)
        // The clock on an ongoing status notification is noise. Nobody wants to
        // know what time they pressed the button.
        .setShowWhen(false)

      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
        builder.setContentIntent(
          PendingIntent.getActivity(context, REQUEST_OPEN, launch, PendingIntent.FLAG_IMMUTABLE),
        )
      }

      val stop = PendingIntent.getService(
        context,
        REQUEST_STOP,
        Intent(context, BroadcastService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      builder.addAction(
        Notification.Action.Builder(
          Icon.createWithResource(context, android.R.drawable.ic_menu_close_clear_cancel),
          "Stop",
          stop,
        ).build(),
      )

      return builder.build()
    }

    /** The ongoing notification's two lines for a state, recording aside. */
    private fun sentenceFor(state: String, detail: String): Pair<String, String> = when (state) {
      "reconnecting" -> "Framevane lost the connection" to
        (if (detail.isBlank()) "Trying again." else "Trying again - $detail")
      "paused" -> "Framevane is paused" to "The picture is held. Sound follows the mute button."
      "connecting" -> "Framevane is connecting" to "Opening the connection."
      "failed" -> "The broadcast stopped" to
        (if (detail.isBlank()) "It could not be kept on air. Nothing is going out." else "Nothing is going out - $detail")
      "authError" -> "The server refused the stream key" to
        "Nothing is going out. Copy the key again from the stream's page."
      "disconnected" -> "Framevane is off air" to "The connection closed. Nothing is going out."
      "idle" -> "Framevane is off air" to "Nothing is going out."
      else -> "Framevane is broadcasting" to "The camera and microphone are live."
    }

    /**
     * Re-says it, when the broadcast changes state under a locked screen.
     *
     * The ends of a broadcast say that it has ended. They used to fall back to
     * "Framevane is broadcasting" - for a stream that had failed, been refused
     * or closed - and the service can outlive the stream for a moment, or for
     * the length of a recording, so that sentence sat on the lock screen
     * describing an audience that had gone.
     */
    internal fun setState(context: Context, state: String, detail: String) {
      val ended = state == "idle" || state == "disconnected" || state == "failed" || state == "authError"
      val (title, text) = when {
        // A broadcast that ended under a recording that carries on leaves the
        // service up for the recording, and the recording is what to say.
        ended && recordingOnly() -> RECORDING_TITLE to RECORDING_TEXT
        else -> sentenceFor(state, detail)
      }
      if (title == stateTitle && text == stateText) return
      stateTitle = title
      stateText = text
      // Only worth saying if there is a notification on screen to say it on.
      if (!running) return
      runCatching {
        val manager =
          context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        manager.notify(NOTIFICATION_ID, buildFor(context))
      }
    }
    private const val ALERT_NOTIFICATION_ID = 8_422

    /** The microphone's own, so the two alerts do not overwrite each other. */
    private const val ALERT_MICROPHONE_ID = 8_423
    private const val REQUEST_OPEN = 1
    private const val REQUEST_STOP = 2

    internal fun start(context: Context) {
      val intent = Intent(context, BroadcastService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    internal fun stop(context: Context) {
      context.stopService(Intent(context, BroadcastService::class.java))
    }

    /**
     * Says the broadcast has ended when nobody is looking at the app.
     *
     * The ongoing notification cannot carry this: it belongs to the service,
     * and a broadcast that fails stops the service, so the only signal an
     * operator got was that notification quietly disappearing from the shade.
     * A phone in a pocket, a stream that died, and nothing that said so.
     *
     * A separate channel because it is the opposite kind of message from the
     * ongoing one. That must never make a sound; this one has to - it is the
     * only chance to notice before the audience does.
     */
    internal fun alertEnded(context: Context, reason: String) {
      alert(context, "The broadcast stopped", reason.ifBlank { "The connection was lost." })
    }

    /**
     * The same channel, for anything else the operator has to know about while
     * the phone is face down.
     *
     * A second id, so a microphone warning does not replace the notice that the
     * broadcast ended - they are different facts and the second one arriving
     * must not quietly erase the first.
     */
    internal fun alertMicrophone(context: Context, text: String) {
      alert(context, "The microphone is silent", text, ALERT_MICROPHONE_ID)
    }

    private fun alert(
      context: Context,
      title: String,
      text: String,
      id: Int = ALERT_NOTIFICATION_ID,
    ) {
      runCatching {
        val manager =
          context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
          manager.getNotificationChannel(ALERT_CHANNEL_ID) == null
        ) {
          val channel = NotificationChannel(
            ALERT_CHANNEL_ID,
            "Broadcast interrupted",
            NotificationManager.IMPORTANCE_HIGH,
          )
          channel.description = "When a broadcast stops on its own."
          channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
          manager.createNotificationChannel(channel)
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Notification.Builder(context, ALERT_CHANNEL_ID)
        } else {
          @Suppress("DEPRECATION")
          Notification.Builder(context).setPriority(Notification.PRIORITY_HIGH)
        }

        builder
          .setContentTitle(title)
          /**
           * The reason as the encoder gave it. It is the difference between
           * "the network went" and "the server refused the key", and an
           * operator standing in a hall can act on the first and not the
           * second - but only if they are told which it was.
           */
          .setContentText(text)
          .setStyle(Notification.BigTextStyle().bigText(text))
          .setSmallIcon(android.R.drawable.stat_notify_error)
          .setAutoCancel(true)
          .setOnlyAlertOnce(true)

        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
          builder.setContentIntent(
            PendingIntent.getActivity(context, REQUEST_OPEN, launch, PendingIntent.FLAG_IMMUTABLE),
          )
        }

        manager.notify(id, builder.build())
      }
    }
  }
}
