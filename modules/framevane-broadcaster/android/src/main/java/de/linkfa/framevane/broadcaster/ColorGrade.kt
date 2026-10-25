package de.linkfa.framevane.broadcaster

import android.opengl.GLES20
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Filmic's colour tabs - Gamma, Looks and LUT - as one GL pass.
 *
 * The order inside the shader is the order a colourist works in: levels (the
 * black and white points), the tone curve (Native, Natural, Dynamic, Flat,
 * Log), shadows and highlights, then the look (contrast, saturation, warmth,
 * tint, split toning), and the LUT last, at its strength. It is first in the
 * filter chain, so the stream and the recording are graded and the monitoring
 * aids measure the graded picture.
 *
 * The settings are plain volatile fields read every frame on the GL thread,
 * so moving a slider never rebuilds the shader or blinks the viewfinder.
 */
internal object GradeOptions {
  /** 0 Native, 1 Natural, 2 Dynamic, 3 Flat, 4 Log. */
  @Volatile var curve = 0
  /** Levels, 0..1 of full scale. */
  @Volatile var black = 0f
  @Volatile var white = 1f
  /** -1..1: lift or sink the shadows / the highlights. */
  @Volatile var shadow = 0f
  @Volatile var highlight = 0f

  // The look. Neutral values change nothing.
  @Volatile var contrast = 1f
  @Volatile var saturation = 1f
  /** -1..1, cool to warm. */
  @Volatile var warmth = 0f
  /** -1..1, green to magenta. */
  @Volatile var tint = 0f
  /** Split toning: colours added to the shadows and the highlights, -1..1 per channel. */
  @Volatile var shadowTone = floatArrayOf(0f, 0f, 0f)
  @Volatile var highlightTone = floatArrayOf(0f, 0f, 0f)

  /** A LUT waiting to be uploaded on the GL thread, and the one in use. */
  @Volatile var pendingLut: Lut? = null
  @Volatile var lutLoaded = false
  /** 0..1, how much of the LUT. 0 leaves it loaded but off. */
  @Volatile var lutStrength = 1f

  fun isIdentity(): Boolean =
    curve == 0 && black == 0f && white == 1f && shadow == 0f && highlight == 0f &&
      contrast == 1f && saturation == 1f && warmth == 0f && tint == 0f &&
      shadowTone.all { it == 0f } && highlightTone.all { it == 0f } &&
      (!lutLoaded && pendingLut == null || lutStrength == 0f)
}

/**
 * A 3D LUT laid out as a 2D strip for GLES2, which has no 3D textures: N
 * slices of N x N side by side, blue choosing the slice, red across it and
 * green down it. RGB bytes.
 */
internal class Lut(val size: Int, val rgb: ByteBuffer) {
  companion object {
    /** The widest strip any phone GPU takes: 64 slices of 64 is 4096 wide. */
    private const val MAX_SIZE = 64

    /**
     * Reads an Adobe/Resolve `.cube` file. A 65-point cube (Resolve's
     * default) is thinned to 33 points - every other entry - so it fits the
     * strip; at 33 points trilinear interpolation is still finer than 8-bit
     * video can show.
     */
    fun parseCube(file: File): Lut {
      var size = 0
      var domainMin = floatArrayOf(0f, 0f, 0f)
      var domainMax = floatArrayOf(1f, 1f, 1f)
      val values = ArrayList<Float>()
      file.bufferedReader().useLines { lines ->
        for (raw in lines) {
          val line = raw.trim()
          if (line.isEmpty() || line.startsWith("#")) continue
          val parts = line.split(Regex("\\s+"))
          when (parts[0].uppercase()) {
            "TITLE" -> continue
            "LUT_1D_SIZE" -> throw IllegalArgumentException("1D LUTs are not supported; use a 3D .cube")
            "LUT_3D_SIZE" -> size = parts[1].toInt()
            "DOMAIN_MIN" -> domainMin = floatArrayOf(parts[1].toFloat(), parts[2].toFloat(), parts[3].toFloat())
            "DOMAIN_MAX" -> domainMax = floatArrayOf(parts[1].toFloat(), parts[2].toFloat(), parts[3].toFloat())
            else -> {
              val r = parts[0].toFloatOrNull() ?: continue
              values.add(r)
              values.add(parts[1].toFloat())
              values.add(parts[2].toFloat())
            }
          }
        }
      }
      require(size in 2..256) { "No LUT_3D_SIZE in the file" }
      require(values.size == size * size * size * 3) {
        "The file says $size points but holds ${values.size / 3} entries"
      }
      // Thin a cube too big for the strip: 65 -> 33 takes every other point.
      var step = 1
      while ((size - 1) / step + 1 > MAX_SIZE) step *= 2
      require((size - 1) % step == 0) { "A $size-point LUT is too large for this phone" }
      val n = (size - 1) / step + 1
      val buffer = ByteBuffer.allocateDirect(n * n * n * 3).order(ByteOrder.nativeOrder())
      val width = n * n
      for (b in 0 until n) for (g in 0 until n) for (r in 0 until n) {
        // .cube order: red fastest, then green, then blue.
        val i = ((b * step) * size * size + (g * step) * size + (r * step)) * 3
        val x = b * n + r
        val o = (g * width + x) * 3
        for (c in 0..2) {
          val v = (values[i + c] - domainMin[c]) / (domainMax[c] - domainMin[c])
          buffer.put(o + c, (v.coerceIn(0f, 1f) * 255f).roundToInt().toByte())
        }
      }
      buffer.position(0)
      return Lut(n, buffer)
    }
  }
}

class ColorGradeFilterRender : ShaderFilterRender() {
  private var uCurve = -1
  private var uLevels = -1
  private var uShadowHighlight = -1
  private var uLook = -1
  private var uShadowTone = -1
  private var uHighTone = -1
  private var uLut = -1
  private var uLutSize = -1
  private var uLutStrength = -1
  private var lutTexture = 0
  private var lutSize = 0f

  override fun fragmentShader(): String = FRAGMENT

  override fun onInit() {
    uCurve = uniform("uCurve")
    uLevels = uniform("uLevels")
    uShadowHighlight = uniform("uShadowHighlight")
    uLook = uniform("uLook")
    uShadowTone = uniform("uShadowTone")
    uHighTone = uniform("uHighTone")
    uLut = uniform("uLut")
    uLutSize = uniform("uLutSize")
    uLutStrength = uniform("uLutStrength")
  }

  override fun onBindUniforms() {
    val o = GradeOptions
    o.pendingLut?.let { uploadLut(it); o.pendingLut = null }
    GLES20.glUniform1f(uCurve, o.curve.toFloat())
    GLES20.glUniform2f(uLevels, o.black, maxOf(o.white, o.black + 0.01f))
    GLES20.glUniform2f(uShadowHighlight, o.shadow, o.highlight)
    GLES20.glUniform4f(uLook, o.contrast, o.saturation, o.warmth, o.tint)
    val s = o.shadowTone
    val h = o.highlightTone
    GLES20.glUniform3f(uShadowTone, s[0], s[1], s[2])
    GLES20.glUniform3f(uHighTone, h[0], h[1], h[2])
    val lutOn = o.lutLoaded && lutTexture != 0
    GLES20.glUniform1f(uLutStrength, if (lutOn) o.lutStrength else 0f)
    GLES20.glUniform1f(uLutSize, if (lutOn) lutSize else 2f)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lutTexture)
    GLES20.glUniform1i(uLut, 1)
  }

  private fun uploadLut(lut: Lut) {
    if (lutTexture == 0) {
      val ids = IntArray(1)
      GLES20.glGenTextures(1, ids, 0)
      lutTexture = ids[0]
    }
    GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lutTexture)
    GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 1)
    GLES20.glTexImage2D(
      GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGB, lut.size * lut.size, lut.size, 0,
      GLES20.GL_RGB, GLES20.GL_UNSIGNED_BYTE, lut.rgb,
    )
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    lutSize = lut.size.toFloat()
    GradeOptions.lutLoaded = true
  }

  override fun release() {
    if (lutTexture != 0) GLES20.glDeleteTextures(1, intArrayOf(lutTexture), 0)
    lutTexture = 0
    super.release()
  }

  companion object {
    private const val FRAGMENT = """
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D uLut;
uniform float uCurve;
uniform vec2 uLevels;
uniform vec2 uShadowHighlight;
uniform vec4 uLook;
uniform vec3 uShadowTone;
uniform vec3 uHighTone;
uniform float uLutSize;
uniform float uLutStrength;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 lutSample(vec3 c) {
  float n = uLutSize;
  float b = c.b * (n - 1.0);
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, n - 1.0);
  float x = (c.r * (n - 1.0) + 0.5) / (n * n);
  float y = (c.g * (n - 1.0) + 0.5) / n;
  vec3 lo = texture2D(uLut, vec2(x + b0 / n, y)).rgb;
  vec3 hi = texture2D(uLut, vec2(x + b1 / n, y)).rgb;
  return mix(lo, hi, b - b0);
}

void main() {
  vec3 c = texture2D(uSampler, vTextureCoord).rgb;

  // Levels.
  c = clamp((c - uLevels.x) / (uLevels.y - uLevels.x), 0.0, 1.0);

  // Tone curve.
  if (uCurve > 3.5) {
    // Log: shadows opened right up, highlights rolled off - for grading later.
    c = log(1.0 + c * 12.0) / log(13.0);
    c = mix(vec3(0.08), vec3(0.92), c);
  } else if (uCurve > 2.5) {
    // Flat: blacks lifted, highlights held down, contrast eased.
    c = 0.05 + 0.88 * mix(c, 0.5 + (c - 0.5) * 0.78, 1.0);
  } else if (uCurve > 1.5) {
    // Dynamic: a firm S.
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.65);
  } else if (uCurve > 0.5) {
    // Natural: a gentle S.
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
  }

  // Shadows and highlights.
  float l = dot(c, LUMA);
  c += uShadowHighlight.x * 0.25 * (1.0 - smoothstep(0.0, 0.55, l));
  c += uShadowHighlight.y * 0.25 * smoothstep(0.45, 1.0, l);

  // Look: contrast, saturation, warmth and tint, then split toning.
  c = (c - 0.5) * uLook.x + 0.5;
  l = dot(c, LUMA);
  c = mix(vec3(l), c, uLook.y);
  c += vec3(uLook.z, 0.0, -uLook.z) * 0.12;
  c += vec3(uLook.w * 0.5, -uLook.w, uLook.w * 0.5) * 0.10;
  c += uShadowTone * (1.0 - l) * 0.15 + uHighTone * l * 0.15;
  c = clamp(c, 0.0, 1.0);

  // LUT last, at its strength.
  if (uLutStrength > 0.0) c = mix(c, lutSample(c), uLutStrength);

  gl_FragColor = vec4(c, 1.0);
}
"""
  }
}
