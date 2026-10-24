package de.linkfa.framevane.broadcaster

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * The microphone's peaks, handed straight from the audio thread to whatever
 * native view is drawing them.
 *
 * The meter used to be drawn by JavaScript from an `onLevel` event, and an hour
 * into a broadcast the JavaScript thread is the busiest thing on the phone: the
 * meter was the first thing to freeze, which is the worst thing to freeze,
 * because a still meter reads as a dead microphone. Nothing about a level needs
 * JavaScript - it is a number from the audio thread drawn as rectangles - so
 * this takes JavaScript out of the loop altogether.
 *
 * An object rather than a field on [BroadcasterView] because the two ends do
 * not know about each other: the meter is mounted by React wherever the screen
 * puts it, and the preview is claimed and released on its own schedule (see
 * `claim`). Either can come and go without the other being told, and a
 * registry that outlives both is the one thing that does not care which came
 * first.
 *
 * Copy-on-write because the two sides are lopsided: a publish happens on every
 * PCM buffer, dozens of times a second, and a subscribe happens when a screen
 * mounts. Iteration takes no lock and allocates nothing, which is what the
 * audio thread needs - it must never wait on the UI thread.
 */
internal object LevelBus {
  fun interface Listener {
    /** Called on the audio thread. Do the least possible and hand off. */
    fun onPeak(peak: Float)
  }

  private val listeners = CopyOnWriteArraySet<Listener>()

  fun subscribe(listener: Listener) {
    listeners.add(listener)
  }

  fun unsubscribe(listener: Listener) {
    listeners.remove(listener)
  }

  /** 0-100, the same scale `onLevel` reports. */
  fun publish(peak: Float) {
    // The empty case is the common one off the broadcast screen, and the
    // iterator is worth skipping there.
    if (listeners.isEmpty()) return
    for (listener in listeners) {
      // A listener's failure must not reach the audio thread: an exception
      // there has nothing above it and takes the process, which is the
      // AmplitudeEffect crash this app has already had once.
      runCatching { listener.onPeak(peak) }
    }
  }
}

/**
 * The microphone level, drawn natively on the UI thread.
 *
 * Laid out to match the JavaScript meter it replaces (components/broadcast/
 * level-meter.tsx) so the screen does not change shape under the operator: a
 * column of twelve segments filled bottom up, green while the level is
 * healthy, red in the top segments where it is hot, a dark slate where unlit.
 * It adds the two things that column could not afford to do through the
 * bridge:
 *
 * - a peak-hold line, which marks the loudest recent moment and sinks away
 *   over [HOLD_DECAY_MS]. A level that bounces is hard to read at a glance; a
 *   line that stays put long enough to be seen is not.
 * - a clip cap above the column that lights red for [CLIP_HOLD_MS] whenever a
 *   buffer reaches full scale. Clipping lasts a few milliseconds and damages
 *   the audio for good, and a segment that flickers red for one frame is a
 *   segment nobody sees.
 *
 * Sized entirely from layout: JavaScript gives it a width and a height and the
 * segments are divided out of whatever that turns out to be.
 *
 * An [ExpoView] although it has no children, for what a release build does to
 * anything less: expo-modules-core builds views by reflecting on the
 * constructor, and its R8 rules keep those constructors only on ExpoView
 * subclasses. A plain View would build in debug and lose its constructor to
 * the shrinker in release.
 */
class LevelMeterView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  init {
    // A ViewGroup skips onDraw unless told otherwise, and this view is
    // nothing but its onDraw.
    setWillNotDraw(false)
  }

  /**
   * Whether the microphone is muted, from JavaScript. Mute changes are rare -
   * a tap - so this is the one input that is fine coming across the bridge.
   *
   * The whole meter is drawn dimmed while muted, unlit segments and clip
   * cap included. RootEncoder (2.7.0) hands the encoder a buffer of zeros
   * while muted and skips the audio effect altogether, so no peaks arrive and
   * the column empties - which on its own looks exactly like a dead
   * microphone. Fading the meter itself is what says "you chose this" rather
   * than "something broke"; the JavaScript side shows the word Muted beside
   * it, as it did before.
   */
  var muted = false
    set(value) {
      if (field == value) return
      field = value
      invalidate()
    }

  private val density = resources.displayMetrics.density

  /** The same gap the JavaScript meter used, 3dp, unless the view is tiny. */
  private val gapPx = 3f * density

  /** The JavaScript meter's 2dp corner radius. */
  private val radiusPx = 2f * density

  private val litGood = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = COLOR_GOOD }
  private val litHot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = COLOR_ALERT }
  private val unlit = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = COLOR_UNLIT }
  private val holdPaint = Paint(Paint.ANTI_ALIAS_FLAG)

  /** Reused for every rectangle; onDraw must not allocate. */
  private val rect = RectF()

  // --- Fed from the audio thread ----------------------------------------

  /**
   * The loudest peak since the last frame, as float bits, or [NO_SAMPLE].
   *
   * An atomic max rather than a lock: the audio thread may only ever do a
   * compare-and-set here, never wait for the UI thread to finish drawing.
   */
  private val pendingPeak = AtomicInteger(NO_SAMPLE)

  /** When the last buffer arrived, so a microphone that stops can be told apart. */
  @Volatile
  private var lastSampleAt = 0L

  /** Whether a frame is scheduled. One at a time, so frames cannot pile up. */
  private val ticking = AtomicBoolean(false)

  private val listener = LevelBus.Listener { peak ->
    // Never touches a View from here - this is the audio thread.
    while (true) {
      val current = pendingPeak.get()
      if (current != NO_SAMPLE && Float.fromBits(current) >= peak) break
      if (pendingPeak.compareAndSet(current, peak.toRawBits())) break
    }
    lastSampleAt = SystemClock.uptimeMillis()
    // The first sample after a quiet spell wakes the frame loop; every other
    // one just updates the max above and lets the running loop pick it up.
    if (ticking.compareAndSet(false, true)) post(tick)
  }

  // --- State, read and written on the UI thread only --------------------

  /** The displayed level, 0-1, after the meter curve and the release. */
  private var level = 0f
  private var levelAt = 0L

  /** The peak-hold mark: where it was set and when. */
  private var holdLevel = 0f
  private var holdAt = 0L

  /** When the clip cap was last lit, or 0. */
  private var clipAt = 0L

  /** What the last drawn frame showed, so an unchanged frame is never redrawn. */
  private var drawnLit = -1
  private var drawnHoldPx = -1
  private var drawnClip = false

  /**
   * One frame of the meter: fold in what arrived, age the hold and the clip
   * cap, and invalidate only if any of it changed what is on the glass.
   *
   * Runs at most every [FRAME_MS] - about thirty times a second, which is more
   * than an eye reads a meter at and a fraction of what the audio thread
   * produces - and stops altogether once nothing is moving, so a meter on a
   * screen with no microphone running costs nothing at all.
   */
  private val tick: Runnable = object : Runnable {
    override fun run() {
      val now = SystemClock.uptimeMillis()
      val bits = pendingPeak.getAndSet(NO_SAMPLE)
      val dt = if (levelAt == 0L) 0L else now - levelAt
      levelAt = now

      /**
       * The release: the level falls no faster than [RELEASE_PER_MS], so a
       * 33 ms frame that happened to catch only a quiet buffer does not snap
       * the column to the floor and back. Rising is instant, as on any meter.
       *
       * It is also what happens when the microphone stops: no peaks arrive,
       * nothing holds the level up, and the column falls to empty. The last
       * level is never left standing - a column frozen at speaking height is
       * the exact lie this view exists to stop telling.
       */
      var next = (level - dt * RELEASE_PER_MS).coerceAtLeast(0f)
      if (bits != NO_SAMPLE) {
        val peak = Float.fromBits(bits)
        // The same curve the JavaScript meter used, so the column means what
        // it meant: speech sits low on a linear scale, and the square root
        // puts a normal speaking voice in the middle where movement is seen.
        val curved = min(1f, sqrt((peak / 100f).coerceAtLeast(0f)))
        if (curved > next) next = curved
        if (peak >= CLIP_PEAK) clipAt = now
      }
      level = next

      // The hold mark rides up with the level and then sinks to nothing over
      // HOLD_DECAY_MS - unless the level comes back up to meet it first.
      val heldNow = heldLevel(now)
      if (level >= heldNow) {
        holdLevel = level
        holdAt = now
      }

      invalidateIfChanged(now)

      val clipLit = clipAt != 0L && now - clipAt < CLIP_HOLD_MS
      val moving = now - lastSampleAt <= STALE_MS || level > 0f || heldLevel(now) > 0f || clipLit
      if (moving && isAttachedToWindow) {
        postDelayed(this, FRAME_MS)
        return
      }
      // Stopping. Cleared first and then re-checked, so a sample that landed
      // between the decision and the clear still gets a frame instead of
      // waiting for the next buffer to wake the loop.
      ticking.set(false)
      if (pendingPeak.get() != NO_SAMPLE && isAttachedToWindow && ticking.compareAndSet(false, true)) {
        post(this)
      }
    }
  }

  /** The hold mark's height right now, 0-1, after its decay. */
  private fun heldLevel(now: Long): Float {
    if (holdAt == 0L) return 0f
    val age = now - holdAt
    if (age >= HOLD_DECAY_MS) return 0f
    return holdLevel * (1f - age.toFloat() / HOLD_DECAY_MS)
  }

  private fun invalidateIfChanged(now: Long) {
    val lit = (level * SEGMENTS).roundToInt()
    val held = heldLevel(now)
    // Compared in pixels, so a hold that has sunk less than one pixel since
    // the last frame does not cost a redraw.
    val holdPx = if (held <= 0f || held <= level) -1 else (held * columnHeight()).roundToInt()
    val clip = clipAt != 0L && now - clipAt < CLIP_HOLD_MS
    if (lit == drawnLit && holdPx == drawnHoldPx && clip == drawnClip) return
    drawnLit = lit
    drawnHoldPx = holdPx
    drawnClip = clip
    invalidate()
  }

  // --- Geometry ---------------------------------------------------------

  /** The clip cap's height: half a segment, never thinner than 2dp. */
  private fun capHeight(): Float {
    val h = height.toFloat()
    val gap = gap()
    val segment = (h - gap * SEGMENTS) / (SEGMENTS + 0.5f)
    return (segment * 0.5f).coerceAtLeast(2f * density).coerceAtMost(h / 4f)
  }

  /** The gap, shrunk on a view too short to afford 3dp between thirteen bars. */
  private fun gap(): Float = min(gapPx, height / (SEGMENTS * 4f))

  /** The height the twelve segments share, below the cap and its gap. */
  private fun columnHeight(): Float = (height - capHeight() - gap()).coerceAtLeast(0f)

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val w = width.toFloat()
    if (w <= 0f || height <= 0) return

    // Dimmed, not hidden; see [muted].
    val alpha = if (muted) MUTED_ALPHA else 255
    litGood.alpha = alpha
    litHot.alpha = alpha
    unlit.alpha = alpha

    val gap = gap()
    val cap = capHeight()
    val columnTop = cap + gap
    val column = columnHeight()
    val segment = ((column - gap * (SEGMENTS - 1)) / SEGMENTS).coerceAtLeast(1f)
    val radius = min(radiusPx, segment / 2f)
    val lit = drawnLit.coerceAtLeast(0)

    // The clip cap, dark until a buffer reaches full scale.
    rect.set(0f, 0f, w, cap)
    canvas.drawRoundRect(rect, radius, radius, if (drawnClip) litHot else unlit)

    // Drawn bottom up: segment 1 is the floor, segment 12 the top.
    for (n in 1..SEGMENTS) {
      val bottom = columnTop + column - (n - 1) * (segment + gap)
      rect.set(0f, bottom - segment, w, bottom)
      val paint = when {
        n > lit -> unlit
        // The JavaScript meter's rule: a segment whose top sits above HOT of
        // the column is red when lit.
        n.toFloat() / SEGMENTS > HOT -> litHot
        else -> litGood
      }
      canvas.drawRoundRect(rect, radius, radius, paint)
    }

    // The hold mark, a 2dp bar across the column at the held height, in the
    // colour of the zone it sits in.
    if (drawnHoldPx > 0) {
      val y = columnTop + column - drawnHoldPx
      val held = drawnHoldPx / column
      holdPaint.color = if (held > HOT) COLOR_ALERT else COLOR_HOLD
      holdPaint.alpha = alpha
      val thickness = 2f * density
      rect.set(0f, (y - thickness / 2f).coerceAtLeast(columnTop), w, (y + thickness / 2f).coerceAtMost(columnTop + column))
      canvas.drawRect(rect, holdPaint)
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    // The hold mark is cached in pixels; a new size makes that stale. Worked
    // out again now rather than at the next frame, because if nothing is
    // moving there will not be a next frame.
    drawnHoldPx = -1
    drawnLit = -1
    invalidateIfChanged(SystemClock.uptimeMillis())
  }

  // --- Lifecycle --------------------------------------------------------

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    LevelBus.subscribe(listener)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    /**
     * Unsubscribed on the way out, so a meter on a tab nobody is looking at is
     * not woken thirty times a second, and a view React has dropped is not
     * kept alive by the registry - [LevelBus] holds its listeners strongly.
     */
    LevelBus.unsubscribe(listener)
    removeCallbacks(tick)
    ticking.set(false)
    pendingPeak.set(NO_SAMPLE)
    level = 0f
    levelAt = 0L
    holdAt = 0L
    clipAt = 0L
    drawnLit = -1
    drawnHoldPx = -1
    drawnClip = false
  }

  private companion object {
    /** As in level-meter.tsx. */
    const val SEGMENTS = 12

    /** As in level-meter.tsx: above this the microphone is close to clipping. */
    const val HOT = 0.82f

    /**
     * filmic-good, filmic-alert and filmic-line from tailwind.config.ts, so the
     * native meter is the same colours as the rest of the chrome.
     */
    const val COLOR_GOOD = 0xFF34C759.toInt()
    const val COLOR_ALERT = 0xFFFF3B30.toInt()
    const val COLOR_UNLIT = 0xFF2A2D36.toInt()

    /** The hold mark over green: white, so it reads against a lit segment. */
    const val COLOR_HOLD = 0xFFFFFFFF.toInt()

    /** About 35%: plainly still there, plainly not live. */
    const val MUTED_ALPHA = 90

    /** ~30 frames a second. */
    const val FRAME_MS = 33L

    /** How long the peak-hold mark takes to sink to nothing. */
    const val HOLD_DECAY_MS = 1_500L

    /** How long the clip cap stays lit after the last full-scale buffer. */
    const val CLIP_HOLD_MS = 2_000L

    /**
     * Full scale on the 0-100 peak scale. 99 is within 0.1 dB of the ceiling;
     * a peak that close is already flat-topped on a phone's converter.
     */
    const val CLIP_PEAK = 99f

    /**
     * Release: the whole column in about half a second. Fast enough that
     * the meter follows speech, slow enough that it is readable.
     */
    const val RELEASE_PER_MS = 1f / 500f

    /**
     * No buffer for this long and the microphone is treated as stopped. Ten
     * times the ~20-40 ms a buffer takes, so a scheduling hiccup on the audio
     * thread is not read as silence.
     */
    const val STALE_MS = 400L

    /** A float bit pattern no peak produces: NaN. */
    val NO_SAMPLE = Float.NaN.toRawBits()
  }
}
