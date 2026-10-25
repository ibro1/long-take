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
  /**
   * The right-channel value of a mono buffer. Negative, so it is below every
   * real peak: a listener that only wants the louder side can take the max of
   * the two and get the mono peak back without asking which it was.
   */
  const val MONO = -1f

  fun interface Listener {
    /**
     * Called on the audio thread. Do the least possible and hand off.
     *
     * Two floats rather than an array, so a publish dozens of times a second
     * allocates nothing. [right] is [MONO] when the microphone is mono.
     */
    fun onPeak(left: Float, right: Float)
  }

  private val listeners = CopyOnWriteArraySet<Listener>()

  fun subscribe(listener: Listener) {
    listeners.add(listener)
  }

  fun unsubscribe(listener: Listener) {
    listeners.remove(listener)
  }

  /** 0-100 per channel, the same scale `onLevel` reports; [right] is [MONO] for mono. */
  fun publish(left: Float, right: Float) {
    // The empty case is the common one off the broadcast screen, and the
    // iterator is worth skipping there.
    if (listeners.isEmpty()) return
    for (listener in listeners) {
      // A listener's failure must not reach the audio thread: an exception
      // there has nothing above it and takes the process, which is the
      // AmplitudeEffect crash this app has already had once.
      runCatching { listener.onPeak(left, right) }
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
 * A stereo microphone gets two columns side by side, left channel on the
 * left, each with its own hold line and clip cap, splitting the width the
 * single column had. Two because a stereo pair fails one side at a time - a
 * lapel lead half out of its socket, a mixer feeding one channel - and a
 * single column of the louder side reads perfectly healthy while viewers hear
 * sound in one ear. A mono microphone draws exactly the single column it
 * always did. The layout follows the buffers, not a prop: the audio thread
 * says which it is with every peak, so the meter changes shape the moment the
 * microphone does and JavaScript does not have to know.
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

  /**
   * The most frames a second this meter redraws at, from JavaScript; 30 by
   * default, which is more than an eye reads a meter at.
   *
   * The thermal ladder lowers it to 5 on a hot phone. Every frame is a wakeup
   * of the UI thread and, when the level moved, a redraw - small on its own,
   * but on a phone that is already throttling, everything the UI thread does
   * competes with the encoder for the same heat budget. Five frames a second
   * still says "the microphone is alive", which is the one job the meter has
   * that cannot be given up; the clip cap and the hold mark are timed by the
   * clock, not by frames, so they still hold for as long as they should.
   *
   * Held between 1 and 60: below one a meter is a still picture, above sixty
   * no phone's display shows the difference. A change is taken at the next
   * frame - the loop reads [frameMs] each time it schedules itself.
   */
  var maxFps: Double = DEFAULT_MAX_FPS
    set(value) {
      val fps = if (value.isNaN()) DEFAULT_MAX_FPS else value.coerceIn(MIN_FPS, MAX_FPS)
      field = fps
      frameMs = (1000.0 / fps).toLong().coerceAtLeast(1L)
    }

  /** The frame interval [maxFps] works out to; see [tick]. */
  @Volatile
  private var frameMs = FRAME_MS

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
   * The loudest peak since the last frame, per channel, as float bits, or
   * [NO_SAMPLE]. Index 0 is left (or the only channel), 1 is right.
   *
   * An atomic max rather than a lock: the audio thread may only ever do a
   * compare-and-set here, never wait for the UI thread to finish drawing.
   */
  private val pendingPeaks = arrayOf(AtomicInteger(NO_SAMPLE), AtomicInteger(NO_SAMPLE))

  /**
   * Whether the last buffer was stereo, as the audio thread last said. Read by
   * the frame loop to decide how many columns to draw; a lone volatile is
   * enough because it only ever moves between two whole values.
   */
  @Volatile
  private var stereoSeen = false

  /** When the last buffer arrived, so a microphone that stops can be told apart. */
  @Volatile
  private var lastSampleAt = 0L

  /** Whether a frame is scheduled. One at a time, so frames cannot pile up. */
  private val ticking = AtomicBoolean(false)

  private val listener = LevelBus.Listener { peakL, peakR ->
    // Never touches a View from here - this is the audio thread.
    val stereo = peakR >= 0f
    raise(pendingPeaks[0], peakL)
    if (stereo) raise(pendingPeaks[1], peakR)
    stereoSeen = stereo
    lastSampleAt = SystemClock.uptimeMillis()
    // The first sample after a quiet spell wakes the frame loop; every other
    // one just updates the max above and lets the running loop pick it up.
    if (ticking.compareAndSet(false, true)) post(tick)
  }

  /** Lift [slot] to [peak] if it is lower. Lock-free; safe on the audio thread. */
  private fun raise(slot: AtomicInteger, peak: Float) {
    while (true) {
      val current = slot.get()
      if (current != NO_SAMPLE && Float.fromBits(current) >= peak) return
      if (slot.compareAndSet(current, peak.toRawBits())) return
    }
  }

  // --- State, read and written on the UI thread only --------------------

  //
  // Everything per channel is a two-slot array, index 0 left (or mono), 1
  // right, so one column's code serves both without a second copy of it and
  // without allocating per frame. Slot 1 is simply idle while mono.

  /** How many columns are drawn: 1 for mono, 2 for stereo. */
  private var channels = 1

  /** The displayed level per channel, 0-1, after the meter curve and the release. */
  private val level = FloatArray(2)
  private var levelAt = 0L

  /** The peak-hold mark per channel: where it was set and when. */
  private val holdLevel = FloatArray(2)
  private val holdAt = LongArray(2)

  /** When each channel's clip cap was last lit, or 0. */
  private val clipAt = LongArray(2)

  /** What the last drawn frame showed, so an unchanged frame is never redrawn. */
  private var drawnChannels = 1
  private val drawnLit = intArrayOf(-1, -1)
  private val drawnHoldPx = intArrayOf(-1, -1)
  private val drawnClip = BooleanArray(2)

  /**
   * One frame of the meter: fold in what arrived, age the hold and the clip
   * cap, and invalidate only if any of it changed what is on the glass.
   *
   * Runs at most every [frameMs] - about thirty times a second by default,
   * which is more than an eye reads a meter at and a fraction of what the
   * audio thread produces, and fewer when [maxFps] asks for fewer - and stops
   * altogether once nothing is moving, so a meter on a
   * screen with no microphone running costs nothing at all.
   */
  private val tick: Runnable = object : Runnable {
    override fun run() {
      val now = SystemClock.uptimeMillis()
      val dt = if (levelAt == 0L) 0L else now - levelAt
      levelAt = now

      /**
       * The microphone changed shape - mono to stereo or back. The right
       * column's state is cleared either way: arriving, it starts from empty
       * rather than from whatever a stereo spell long ago left; leaving, it
       * must not linger in a slot that is no longer drawn and then reappear.
       */
      val nowChannels = if (stereoSeen) 2 else 1
      if (nowChannels != channels) {
        channels = nowChannels
        resetChannel(1)
      }
      /**
       * While mono, the right slot is emptied on every frame, not only at the
       * switch. A stereo buffer's right peak can land just before a mono
       * buffer flips [stereoSeen] back, after the switch has been seen; left
       * there, nothing would ever consume it, and the stop re-check below
       * would keep re-posting a frame that never clears it.
       */
      if (channels == 1) pendingPeaks[1].set(NO_SAMPLE)

      var moving = now - lastSampleAt <= STALE_MS
      for (c in 0 until channels) {
        if (advance(c, pendingPeaks[c].getAndSet(NO_SAMPLE), now, dt)) moving = true
      }

      invalidateIfChanged(now)

      if (moving && isAttachedToWindow) {
        postDelayed(this, frameMs)
        return
      }
      // Stopping. Cleared first and then re-checked, so a sample that landed
      // between the decision and the clear still gets a frame instead of
      // waiting for the next buffer to wake the loop.
      ticking.set(false)
      val pending = pendingPeaks[0].get() != NO_SAMPLE ||
        (stereoSeen && pendingPeaks[1].get() != NO_SAMPLE)
      if (pending && isAttachedToWindow && ticking.compareAndSet(false, true)) {
        post(this)
      }
    }
  }

  /**
   * One channel's share of a frame: fold in its peak, age its hold and clip
   * cap. Returns whether anything on that column is still moving.
   */
  private fun advance(c: Int, bits: Int, now: Long, dt: Long): Boolean {
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
    var next = (level[c] - dt * RELEASE_PER_MS).coerceAtLeast(0f)
    if (bits != NO_SAMPLE) {
      val peak = Float.fromBits(bits)
      // The same curve the JavaScript meter used, so the column means what
      // it meant: speech sits low on a linear scale, and the square root
      // puts a normal speaking voice in the middle where movement is seen.
      val curved = min(1f, sqrt((peak / 100f).coerceAtLeast(0f)))
      if (curved > next) next = curved
      if (peak >= CLIP_PEAK) clipAt[c] = now
    }
    level[c] = next

    // The hold mark rides up with the level and then sinks to nothing over
    // HOLD_DECAY_MS - unless the level comes back up to meet it first.
    val heldNow = heldLevel(c, now)
    if (next >= heldNow) {
      holdLevel[c] = next
      holdAt[c] = now
    }

    val clipLit = clipAt[c] != 0L && now - clipAt[c] < CLIP_HOLD_MS
    return next > 0f || heldLevel(c, now) > 0f || clipLit
  }

  /** The hold mark's height right now on channel [c], 0-1, after its decay. */
  private fun heldLevel(c: Int, now: Long): Float {
    if (holdAt[c] == 0L) return 0f
    val age = now - holdAt[c]
    if (age >= HOLD_DECAY_MS) return 0f
    return holdLevel[c] * (1f - age.toFloat() / HOLD_DECAY_MS)
  }

  /** Forget everything one channel was showing. UI thread only. */
  private fun resetChannel(c: Int) {
    level[c] = 0f
    holdLevel[c] = 0f
    holdAt[c] = 0L
    clipAt[c] = 0L
    drawnLit[c] = -1
    drawnHoldPx[c] = -1
    drawnClip[c] = false
  }

  private fun invalidateIfChanged(now: Long) {
    var changed = channels != drawnChannels
    drawnChannels = channels
    val column = columnHeight()
    for (c in 0 until channels) {
      // In pixels: the column is one solid bar now, so it moves a pixel at a time.
      val lit = (level[c] * column).roundToInt()
      val held = heldLevel(c, now)
      // Compared in pixels, so a hold that has sunk less than one pixel since
      // the last frame does not cost a redraw.
      val holdPx = if (held <= 0f || held <= level[c]) -1 else (held * column).roundToInt()
      val clip = clipAt[c] != 0L && now - clipAt[c] < CLIP_HOLD_MS
      if (lit == drawnLit[c] && holdPx == drawnHoldPx[c] && clip == drawnClip[c]) continue
      drawnLit[c] = lit
      drawnHoldPx[c] = holdPx
      drawnClip[c] = clip
      changed = true
    }
    if (changed) invalidate()
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

    /**
     * Filmic's meter: thin bars, well apart, one at each edge of the view, so
     * left and right read as two channels at a glance rather than one block.
     * A bar is at most [BAR_WIDTH_DP] wide whatever the view's width; the
     * view's width is the spacing.
     */
    val bar = min(BAR_WIDTH_DP * density, w / 3f)
    if (drawnChannels < 2) {
      val x0 = (w - bar) / 2f
      drawColumn(canvas, 0, x0, x0 + bar, alpha)
      return
    }
    drawColumn(canvas, 0, 0f, bar, alpha)
    drawColumn(canvas, 1, w - bar, w, alpha)
  }

  /**
   * One channel's column - cap, segments, hold line - between x [x0] and [x1].
   *
   * Named x0/x1 rather than left/right because a View already has `left` and
   * `right` (its own position in the parent), and shadowing them here would be
   * one typo away from drawing at the wrong place.
   */
  private fun drawColumn(canvas: Canvas, c: Int, x0: Float, x1: Float, alpha: Int) {
    val gap = gap()
    val cap = capHeight()
    val columnTop = cap + gap
    val column = columnHeight()
    // Square-ended, like Filmic's: a solid bar reads as a level, not a count.
    val radius = min(radiusPx, (x1 - x0) / 2f) * 0.25f
    val litPx = drawnLit[c].coerceAtLeast(0).toFloat().coerceAtMost(column)

    // The clip cap, dark until a buffer reaches full scale.
    rect.set(x0, 0f, x1, cap)
    canvas.drawRoundRect(rect, radius, radius, if (drawnClip[c]) litHot else unlit)

    // One solid column: the unlit track, then the level filled from the
    // bottom - green, and red for whatever of it is above HOT.
    val floor = columnTop + column
    rect.set(x0, columnTop, x1, floor)
    canvas.drawRoundRect(rect, radius, radius, unlit)
    if (litPx > 0f) {
      val hotLine = floor - column * HOT
      val top = floor - litPx
      rect.set(x0, maxOf(top, hotLine), x1, floor)
      canvas.drawRect(rect, litGood)
      if (top < hotLine) {
        rect.set(x0, top, x1, hotLine)
        canvas.drawRect(rect, litHot)
      }
    }

    // The hold mark, a 2dp bar across the column at the held height, in the
    // colour of the zone it sits in.
    val holdPx = drawnHoldPx[c]
    if (holdPx > 0) {
      val y = columnTop + column - holdPx
      val held = holdPx / column
      holdPaint.color = if (held > HOT) COLOR_ALERT else COLOR_HOLD
      holdPaint.alpha = alpha
      val thickness = 2f * density
      rect.set(x0, (y - thickness / 2f).coerceAtLeast(columnTop), x1, (y + thickness / 2f).coerceAtMost(columnTop + column))
      canvas.drawRect(rect, holdPaint)
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    // The hold mark is cached in pixels; a new size makes that stale. Worked
    // out again now rather than at the next frame, because if nothing is
    // moving there will not be a next frame.
    drawnHoldPx.fill(-1)
    drawnLit.fill(-1)
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
    pendingPeaks[0].set(NO_SAMPLE)
    pendingPeaks[1].set(NO_SAMPLE)
    levelAt = 0L
    resetChannel(0)
    resetChannel(1)
    /**
     * Back to one column, the shape every meter starts in. If the microphone
     * is still stereo when this view is attached again, the first buffer
     * says so and the second column comes back on the next frame.
     */
    stereoSeen = false
    channels = 1
    drawnChannels = 1
  }

  /**
   * Internal rather than private only so the module's `maxFps` prop can fall
   * back to [DEFAULT_MAX_FPS]; nothing outside this file has any other use for
   * these.
   */
  internal companion object {
    /** What [maxFps] is when JavaScript does not say. */
    const val DEFAULT_MAX_FPS = 30.0

    /** The range [maxFps] is held to. */
    const val MIN_FPS = 1.0
    const val MAX_FPS = 60.0

    /** As in level-meter.tsx. */
    const val SEGMENTS = 12

    /** How wide one channel's bar is drawn, in dp. */
    const val BAR_WIDTH_DP = 7f

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

    /** ~30 frames a second: [DEFAULT_MAX_FPS] as an interval. */
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
