package de.linkfa.framevane.broadcaster

import android.content.Context
import android.opengl.GLES20
import android.opengl.Matrix
import com.pedro.encoder.input.gl.render.filters.BaseFilterRender
import com.pedro.encoder.utils.gl.GlUtil
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Custom RootEncoder GL filters for the Filmic-style monitoring aids.
 *
 * RootEncoder ships only [com.pedro.encoder.input.gl.render.filters.EdgeDetectionFilterRender],
 * whose Sobel path floods every edge with no strength threshold - useful as a
 * cartoon effect, useless as a focus aid. These filters are display-only: the
 * view clears any active filter before going on air (see clearMonitorForAir in
 * [BroadcasterView]) so none of them is ever encoded into the stream or file.
 *
 * All four share the library's vertex plumbing (copied from EdgeDetectionFilterRender);
 * only the fragment shader differs. The base class [BaseFilterRender.draw] binds
 * the FBO and issues the GL_TRIANGLE_STRIP draw itself, so [drawFilter] only has
 * to bind the program, the quad attributes, the uniforms and the input texture.
 */
abstract class ShaderFilterRender : BaseFilterRender() {

  // X, Y, Z, U, V - a full-screen quad, same layout the library uses.
  private val squareVertexData = floatArrayOf(
    -1f, -1f, 0f, 0f, 0f, // bottom left
    1f, -1f, 0f, 1f, 0f,  // bottom right
    -1f, 1f, 0f, 0f, 1f,  // top left
    1f, 1f, 0f, 1f, 1f,   // top right
  )

  private var program = -1
  private var aPositionHandle = -1
  private var aTextureHandle = -1
  private var uMVPMatrixHandle = -1
  private var uSTMatrixHandle = -1
  private var uSamplerHandle = -1

  init {
    squareVertex = ByteBuffer.allocateDirect(squareVertexData.size * FLOAT_SIZE)
      .order(ByteOrder.nativeOrder())
      .asFloatBuffer()
    squareVertex.put(squareVertexData).position(0)
    Matrix.setIdentityM(MVPMatrix, 0)
    Matrix.setIdentityM(STMatrix, 0)
  }

  /** The fragment shader source for this aid. */
  protected abstract fun fragmentShader(): String

  /** Look up a uniform location after the program is linked (called from [onInit]). */
  protected fun uniform(name: String): Int = GLES20.glGetUniformLocation(program, name)

  /** Resolve uniform handles once, after the program links. */
  protected open fun onInit() {}

  /** Bind this aid's extra uniforms each frame. The input texture is bound by the base. */
  protected open fun onBindUniforms() {}

  override fun initGlFilter(context: Context) {
    program = GlUtil.createProgram(VERTEX_SHADER, fragmentShader())
    aPositionHandle = GLES20.glGetAttribLocation(program, "aPosition")
    aTextureHandle = GLES20.glGetAttribLocation(program, "aTextureCoord")
    uMVPMatrixHandle = GLES20.glGetUniformLocation(program, "uMVPMatrix")
    uSTMatrixHandle = GLES20.glGetUniformLocation(program, "uSTMatrix")
    uSamplerHandle = GLES20.glGetUniformLocation(program, "uSampler")
    onInit()
  }

  override fun drawFilter() {
    GLES20.glUseProgram(program)

    squareVertex.position(POS_OFFSET)
    GLES20.glVertexAttribPointer(
      aPositionHandle, 3, GLES20.GL_FLOAT, false, STRIDE_BYTES, squareVertex,
    )
    GLES20.glEnableVertexAttribArray(aPositionHandle)

    squareVertex.position(UV_OFFSET)
    GLES20.glVertexAttribPointer(
      aTextureHandle, 2, GLES20.GL_FLOAT, false, STRIDE_BYTES, squareVertex,
    )
    GLES20.glEnableVertexAttribArray(aTextureHandle)

    GLES20.glUniformMatrix4fv(uMVPMatrixHandle, 1, false, MVPMatrix, 0)
    GLES20.glUniformMatrix4fv(uSTMatrixHandle, 1, false, STMatrix, 0)

    onBindUniforms()

    GLES20.glUniform1i(uSamplerHandle, 0)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, previousTexId)
  }

  override fun disableResources() {
    GlUtil.disableResources(aTextureHandle, aPositionHandle)
  }

  override fun release() {
    if (program != -1) GLES20.glDeleteProgram(program)
    program = -1
  }

  /**
   * The texel size (1/width, 1/height) used for neighbour sampling. Taken from
   * the preview dimensions (public getters, cleanly visible); falls back to a
   * 720p-ish texel so edge sampling still works before a size is reported.
   */
  protected fun texelWidth(): Float = previewWidth.let { if (it > 0) 1f / it else 1f / 1280f }
  protected fun texelHeight(): Float = previewHeight.let { if (it > 0) 1f / it else 1f / 720f }

  companion object {
    private const val FLOAT_SIZE = 4
    private const val STRIDE_BYTES = 5 * FLOAT_SIZE
    private const val POS_OFFSET = 0
    private const val UV_OFFSET = 3

    // The library's simple_vertex shader, inlined (we cannot read its R.raw).
    const val VERTEX_SHADER = """
attribute vec4 aPosition;
attribute vec4 aTextureCoord;
uniform mat4 uMVPMatrix;
uniform mat4 uSTMatrix;
varying vec2 vTextureCoord;
void main() {
  gl_Position = uMVPMatrix * aPosition;
  vTextureCoord = (uSTMatrix * aTextureCoord).xy;
}
"""
  }
}

/**
 * The operator's tuning for the two aids that have a knob: the peaking colour
 * and sensitivity, and the zebra level.
 *
 * An object rather than fields on the view, for the same reason the level
 * event interval lives on the view's companion: the screen sets these once,
 * from settings, and the preview is torn down and rebuilt by every tab change.
 * A preference kept on the view would be kept on nothing the moment the
 * operator looked at another tab, and the next peaking filter would come back
 * red at the default threshold with the settings screen claiming otherwise.
 *
 * Volatile because the writer is the JavaScript thread and the reader is the
 * GL thread, every frame; each one is a single whole value, so nothing more
 * than visibility is needed.
 */
internal object MonitorOptions {
  /** filmic-alert-ish red, the colour peaking has always drawn in. */
  const val DEFAULT_PEAKING_COLOR = 0xFF3030

  /** The threshold the peaking filter shipped with; see [PeakingFilterRender]. */
  const val DEFAULT_PEAKING_THRESHOLD = 0.13f

  /** 235/255, the broadcast ceiling; see [ZebraFilterRender]. */
  const val DEFAULT_ZEBRA_THRESHOLD = 0.92f

  /** 0xRRGGBB, no alpha: the outline is always drawn opaque. */
  @Volatile
  var peakingColor = DEFAULT_PEAKING_COLOR

  @Volatile
  var peakingThreshold = DEFAULT_PEAKING_THRESHOLD

  @Volatile
  var zebraThreshold = DEFAULT_ZEBRA_THRESHOLD

  /**
   * `#RRGGBB` to 0xRRGGBB, or null for anything else.
   *
   * Strict on purpose. `Color.parseColor` would also take `#AARRGGBB` and
   * named colours, and a translucent or misspelt outline is a peaking filter
   * that quietly shows nothing - which reads as "nothing is in focus".
   */
  fun parseColor(value: String): Int? {
    val hex = value.trim().removePrefix("#")
    if (hex.length != 6) return null
    return hex.toIntOrNull(16)
  }
}

/**
 * Focus peaking: a thresholded 4-neighbour Sobel. Only transitions whose
 * gradient magnitude clears [threshold] are painted, so soft (out-of-focus)
 * gradients stay clear and the sharp focal plane reads as a thin coloured
 * outline - the Filmic behaviour, unlike the library's flood-fill edge filter.
 *
 * The colour and the threshold can be changed while the filter is on screen
 * ([setColor], [threshold]): the operator tunes peaking by looking at it, and
 * rebuilding the filter for every nudge of a slider would recompile the shader
 * each time and blink the viewfinder.
 *
 * @param threshold 0..1 gradient magnitude cutoff; higher = more selective.
 */
class PeakingFilterRender(
  r: Int = 255,
  g: Int = 48,
  b: Int = 48,
  threshold: Float = 0.13f,
) : ShaderFilterRender() {

  /**
   * Written from the JavaScript thread, read on the GL thread every frame.
   * Volatile per value; a frame that catches the red of the new colour with
   * the green of the old one is one frame, and nobody can see it.
   */
  @Volatile
  var threshold: Float = threshold

  @Volatile
  private var edgeR = r / 255f
  @Volatile
  private var edgeG = g / 255f
  @Volatile
  private var edgeB = b / 255f

  /** A new outline colour as 0xRRGGBB, taken on the next frame. */
  fun setColor(rgb: Int) {
    edgeR = ((rgb shr 16) and 0xff) / 255f
    edgeG = ((rgb shr 8) and 0xff) / 255f
    edgeB = (rgb and 0xff) / 255f
  }

  private var uTexel = -1
  private var uEdgeColor = -1
  private var uThreshold = -1

  override fun fragmentShader(): String = """
precision mediump float;
uniform sampler2D uSampler;
uniform vec2 uTexel;
uniform vec3 uEdgeColor;
uniform float uThreshold;
varying vec2 vTextureCoord;
float luma(vec2 c) {
  vec3 p = texture2D(uSampler, c).rgb;
  return dot(p, vec3(0.299, 0.587, 0.114));
}
void main() {
  vec4 base = texture2D(uSampler, vTextureCoord);
  float l = luma(vTextureCoord - vec2(uTexel.x, 0.0));
  float rr = luma(vTextureCoord + vec2(uTexel.x, 0.0));
  float t = luma(vTextureCoord - vec2(0.0, uTexel.y));
  float bb = luma(vTextureCoord + vec2(0.0, uTexel.y));
  float edge = length(vec2(rr - l, bb - t));
  gl_FragColor = mix(base, vec4(uEdgeColor, 1.0), step(uThreshold, edge));
}
"""

  override fun onInit() {
    uTexel = uniform("uTexel")
    uEdgeColor = uniform("uEdgeColor")
    uThreshold = uniform("uThreshold")
  }

  override fun onBindUniforms() {
    GLES20.glUniform2f(uTexel, texelWidth(), texelHeight())
    GLES20.glUniform3f(uEdgeColor, edgeR, edgeG, edgeB)
    GLES20.glUniform1f(uThreshold, threshold)
  }
}

/**
 * Zebras: pixels at or above [threshold] luma are painted with marching
 * diagonal black/white stripes - the classic overexposure warning.
 *
 * @param threshold 0..1 luma cutoff (0.92 ~ 235/255, the broadcast ceiling).
 * Changeable while on screen, for the same reason peaking's is.
 */
class ZebraFilterRender(
  threshold: Float = 0.92f,
) : ShaderFilterRender() {

  /** Written from the JavaScript thread, read on the GL thread every frame. */
  @Volatile
  var threshold: Float = threshold

  private var uThreshold = -1
  private var uTime = -1
  private val startNanos = System.nanoTime()

  override fun fragmentShader(): String = """
precision mediump float;
uniform sampler2D uSampler;
uniform float uThreshold;
uniform float uTime;
varying vec2 vTextureCoord;
void main() {
  vec4 base = texture2D(uSampler, vTextureCoord);
  float l = dot(base.rgb, vec3(0.299, 0.587, 0.114));
  if (l >= uThreshold) {
    float stripe = mod(gl_FragCoord.x + gl_FragCoord.y + uTime * 40.0, 16.0);
    float s = step(8.0, stripe);
    gl_FragColor = vec4(vec3(s), 1.0);
  } else {
    gl_FragColor = base;
  }
}
"""

  override fun onInit() {
    uThreshold = uniform("uThreshold")
    uTime = uniform("uTime")
  }

  override fun onBindUniforms() {
    GLES20.glUniform1f(uThreshold, threshold)
    GLES20.glUniform1f(uTime, (System.nanoTime() - startNanos) / 1_000_000_000f)
  }
}

/**
 * False colour: maps luma to an IRE-style exposure palette so the operator can
 * read exposure at a glance - purple/blue for crushed shadows, grey through the
 * midtones, yellow/red as highlights approach clipping.
 */
class FalseColorFilterRender : ShaderFilterRender() {

  override fun fragmentShader(): String = """
precision mediump float;
uniform sampler2D uSampler;
varying vec2 vTextureCoord;
void main() {
  vec3 c = texture2D(uSampler, vTextureCoord).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 col;
  if (l < 0.03)      col = vec3(0.40, 0.00, 0.60); // crushed black
  else if (l < 0.10) col = vec3(0.00, 0.00, 1.00); // deep shadow
  else if (l < 0.20) col = vec3(0.00, 0.60, 1.00); // shadow
  else if (l < 0.42) col = vec3(0.35, 0.35, 0.35); // low mid
  else if (l < 0.52) col = vec3(0.00, 0.80, 0.25); // mid / skin reference
  else if (l < 0.78) col = vec3(0.65, 0.65, 0.65); // high mid
  else if (l < 0.90) col = vec3(1.00, 0.55, 0.00); // bright
  else if (l < 0.97) col = vec3(1.00, 1.00, 0.00); // near clip
  else               col = vec3(1.00, 0.00, 0.00); // clipped
  gl_FragColor = vec4(col, 1.0);
}
"""
}

/**
 * Clipping: pixels where any one channel has reached [threshold] are painted
 * solid red; everything else is the untouched picture.
 *
 * Not the same question zebras answer. Zebras test luma, and luma weights blue
 * at a tenth - a saturated blue stage light or a red banner can blow its own
 * channel flat while its luma sits comfortably mid-grey, so zebras never mark
 * it and the detail in it is gone all the same. Testing max(R, G, B) catches
 * the channel that clipped, whichever it is, which is what "is anything lost"
 * actually means.
 *
 * Solid rather than striped because the point is a yes/no map of lost detail,
 * read at a glance while the operator rides the exposure down until the red is
 * gone. The red is filmic-alert (#FF3B30), the same alert colour as the level
 * meter's clip cap, so "red means clipped" holds across picture and sound.
 *
 * @param threshold 0..1 per-channel cutoff. 0.98 rather than 1.0: the preview
 * texture has been through the camera's own tone curve and an 8-bit surface,
 * and a channel that has hit the ceiling routinely lands a code value or two
 * short of it, so testing for exactly 1.0 would show almost nothing.
 */
class ClippingFilterRender(
  private val threshold: Float = 0.98f,
) : ShaderFilterRender() {

  private var uThreshold = -1
  private var uClipColor = -1

  override fun fragmentShader(): String = """
precision mediump float;
uniform sampler2D uSampler;
uniform float uThreshold;
uniform vec3 uClipColor;
varying vec2 vTextureCoord;
void main() {
  vec4 base = texture2D(uSampler, vTextureCoord);
  float m = max(base.r, max(base.g, base.b));
  gl_FragColor = mix(base, vec4(uClipColor, 1.0), step(uThreshold, m));
}
"""

  override fun onInit() {
    uThreshold = uniform("uThreshold")
    uClipColor = uniform("uClipColor")
  }

  override fun onBindUniforms() {
    GLES20.glUniform1f(uThreshold, threshold)
    GLES20.glUniform3f(uClipColor, CLIP_R, CLIP_G, CLIP_B)
  }

  private companion object {
    /** filmic-alert, #FF3B30. */
    const val CLIP_R = 255f / 255f
    const val CLIP_G = 59f / 255f
    const val CLIP_B = 48f / 255f
  }
}
