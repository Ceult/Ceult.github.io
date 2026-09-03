/**
 * bLiquidGlass - WebGL Liquid Glass Effect Library
 * @version 1.0.3 (onDrag 支持阻止按压动画)
 * @license MIT
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.bLiquidGlass = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================
  // GLSL Shaders
  // ============================================================

  const VERT = `
  attribute vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const SDF_GLSL = `
  float sdRoundedRect(vec2 coord, vec2 halfSize, float radius) {
      vec2 cornerCoord = abs(coord) - (halfSize - vec2(radius));
      float outside = length(max(cornerCoord, 0.0)) - radius;
      float inside = min(max(cornerCoord.x, cornerCoord.y), 0.0);
      return outside + inside;
  }

  float sdCircle(vec2 coord, float radius) {
      return length(coord) - radius;
  }

  float sdEllipse(vec2 coord, vec2 radii) {
      float k0 = length(coord / radii);
      float k1 = length(coord / (radii * radii));
      return k0 * (k0 - 1.0) / k1;
  }

  vec2 gradSdRoundedRect(vec2 coord, vec2 halfSize, float radius) {
      vec2 cornerCoord = abs(coord) - (halfSize - vec2(radius));
      if (cornerCoord.x >= 0.0 || cornerCoord.y >= 0.0) {
          vec2 v = max(cornerCoord, vec2(0.0));
          float len = length(v);
          if (len < 1e-6) return vec2(0.0);
          return sign(coord) * (v / len);
      } else {
          float gradX = step(cornerCoord.y, cornerCoord.x);
          return sign(coord) * vec2(gradX, 1.0 - gradX);
      }
  }

  vec2 gradSdCircle(vec2 coord, float radius) {
      float len = length(coord);
      if (len < 1e-6) return vec2(0.0);
      return coord / len;
  }

  vec2 gradSdEllipse(vec2 coord, vec2 radii) {
      vec2 p = coord / (radii * radii);
      float len = length(p);
      if (len < 1e-6) return vec2(0.0);
      return p / len;
  }

  vec2 rotateBy(vec2 v, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  }

  float circleMap(float x) {
      return 1.0 - sqrt(1.0 - x * x);
  }
  `;

  const BLUR_TAPS = [
    {x:0.0000,y:0.0000,w:0.141847},
    {x:0.5000,y:0.0000,w:0.115431}, {x:-0.5000,y:0.0000,w:0.115431},
    {x:0.0000,y:0.5000,w:0.115431}, {x:0.0000,y:-0.5000,w:0.115431},
    {x:0.3536,y:0.3536,w:0.077241}, {x:-0.3536,y:0.3536,w:0.077241},
    {x:0.3536,y:-0.3536,w:0.077241}, {x:-0.3536,y:-0.3536,w:0.077241},
    {x:0.7071,y:0.0000,w:0.040490}, {x:-0.7071,y:0.0000,w:0.040490},
    {x:0.0000,y:0.7071,w:0.040490}, {x:0.0000,y:-0.7071,w:0.040490},
    {x:0.5000,y:0.5000,w:0.013932}, {x:-0.5000,y:0.5000,w:0.013932},
    {x:0.5000,y:-0.5000,w:0.013932}, {x:-0.5000,y:-0.5000,w:0.013932}
  ];

  let blurCode = '';
  for (const t of BLUR_TAPS) {
    blurCode += `sum += texture2D(uBackdrop, uv + vec2(${t.x.toFixed(4)}, ${t.y.toFixed(4)}) * pxToUv) * ${t.w.toFixed(6)};\n`;
  }

  const FRAG = `
  precision highp float;
  uniform sampler2D uBackdrop;
  uniform vec2  uCanvasSize;
  uniform vec2  uElementOffset;
  uniform vec2  uElementSize;
  uniform float uShapeType;
  uniform vec2  uShapeParams;
  uniform float uRefractionHeight;
  uniform float uRefractionAmount;
  uniform float uDepthEffect;
  uniform float uChromaticAberration;
  uniform float uBlurRadius;
  uniform float uSaturation;
  uniform float uBrightness;
  uniform float uContrast;
  uniform vec4  uTintColor;
  uniform vec4  uSurfaceColor;
  uniform float uInnerShadowRadius;
  uniform float uInnerShadowAlpha;
  uniform vec2  uInnerShadowOffset;
  uniform float uElementAlpha;
  uniform float uRotation;
  uniform float uScale;

  ${SDF_GLSL}

  vec2 sceneUv(vec2 canvasPx) {
      return vec2(canvasPx.x / uCanvasSize.x, 1.0 - canvasPx.y / uCanvasSize.y);
  }

  vec4 sampleBackdrop(vec2 canvasPx, float radius) {
      vec2 uv = sceneUv(canvasPx);
      if (radius < 0.5) return texture2D(uBackdrop, uv);
      vec2 pxToUv = radius / uCanvasSize;
      vec4 sum = vec4(0.0);
      ${blurCode}
      return sum;
  }

  vec3 applyColorControls(vec3 c, float brightness, float contrast, float saturation) {
      float invSat = 1.0 - saturation;
      float r = 0.213 * invSat;
      float g = 0.715 * invSat;
      float b = 0.072 * invSat;
      float t = (0.5 - contrast * 0.5 + brightness);
      float cs = contrast * saturation;
      float cr = contrast * r;
      float cg = contrast * g;
      float cb = contrast * b;
      vec3 outc;
      outc.r = (cr + cs) * c.r + cg * c.g + cb * c.b + t;
      outc.g = cr * c.r + (cg + cs) * c.g + cb * c.b + t;
      outc.b = cr * c.r + cg * c.g + (cb + cs) * c.b + t;
      return outc;
  }

  void main() {
      vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
      vec2 elementCenter = uElementOffset + uElementSize * 0.5;
      vec2 centeredScreen = screenCoord - elementCenter;

      centeredScreen = rotateBy(centeredScreen, -uRotation) / uScale;

      float sd;
      vec2 grad;

      if (uShapeType < 0.5) {
          vec2 halfSize = uElementSize * 0.5;
          float cornerRadius = uShapeParams.x;
          sd = sdRoundedRect(centeredScreen, halfSize / uScale, cornerRadius);
          grad = gradSdRoundedRect(centeredScreen, halfSize / uScale, cornerRadius);
      } else if (uShapeType < 1.5) {
          float radius = uShapeParams.x;
          sd = sdCircle(centeredScreen, radius);
          grad = gradSdCircle(centeredScreen, radius);
      } else {
          vec2 radii = uShapeParams;
          sd = sdEllipse(centeredScreen, radii);
          grad = gradSdEllipse(centeredScreen, radii);
      }

      if (sd > 0.5) discard;
      float edgeAlpha = 1.0 - smoothstep(-0.5, 0.5, sd);

      vec4 backdrop = sampleBackdrop(screenCoord, uBlurRadius);
      vec3 color = applyColorControls(backdrop.rgb, uBrightness, uContrast, uSaturation);
      float alpha = backdrop.a;

      if (uRefractionHeight > 0.5 && (-sd) < uRefractionHeight) {
          float sdClamped = min(sd, 0.0);
          float d = circleMap(1.0 - (-sdClamped) / uRefractionHeight) * uRefractionAmount;

          vec2 depthVec = vec2(0.0);
          if (uDepthEffect > 0.5) {
              float dirLen = length(centeredScreen);
              if (dirLen > 1e-6) depthVec = centeredScreen / dirLen;
          }
          vec2 gradSum = grad + uDepthEffect * depthVec;
          float gradLen = length(gradSum);
          if (gradLen > 1e-6) grad = gradSum / gradLen;

          vec2 refractedOffsetScreen = rotateBy(d * grad, uRotation) * uScale;
          vec2 refractedScreen = screenCoord + refractedOffsetScreen;

          if (uChromaticAberration > 0.5) {
              float dispersionIntensity = 0.5;
              vec2 dispersedOffsetScreen = refractedOffsetScreen * dispersionIntensity;

              vec4 sRed    = sampleBackdrop(refractedScreen +  dispersedOffsetScreen, uBlurRadius);
              vec4 sOrange = sampleBackdrop(refractedScreen +  dispersedOffsetScreen * (2.0/3.0), uBlurRadius);
              vec4 sYellow = sampleBackdrop(refractedScreen +  dispersedOffsetScreen * (1.0/3.0), uBlurRadius);
              vec4 sGreen  = sampleBackdrop(refractedScreen, uBlurRadius);
              vec4 sCyan   = sampleBackdrop(refractedScreen -  dispersedOffsetScreen * (1.0/3.0), uBlurRadius);
              vec4 sBlue   = sampleBackdrop(refractedScreen -  dispersedOffsetScreen * (2.0/3.0), uBlurRadius);
              vec4 sPurple = sampleBackdrop(refractedScreen -  dispersedOffsetScreen, uBlurRadius);

              vec3 dispColor = vec3(0.0);
              float dispAlpha = 0.0;
              dispColor.r += sRed.r    / 3.5;  dispAlpha += sRed.a    / 7.0;
              dispColor.r += sOrange.r / 3.5;  dispColor.g += sOrange.g / 7.0;  dispAlpha += sOrange.a / 7.0;
              dispColor.r += sYellow.r / 3.5;  dispColor.g += sYellow.g / 3.5;  dispAlpha += sYellow.a / 7.0;
              dispColor.g += sGreen.g  / 3.5;  dispAlpha += sGreen.a  / 7.0;
              dispColor.g += sCyan.g   / 3.5;  dispColor.b += sCyan.b   / 3.0;  dispAlpha += sCyan.a   / 7.0;
              dispColor.b += sBlue.b   / 3.0;  dispAlpha += sBlue.a   / 7.0;
              dispColor.r += sPurple.r / 7.0;  dispColor.b += sPurple.b / 3.0;  dispAlpha += sPurple.a / 7.0;

              color = applyColorControls(dispColor, uBrightness, uContrast, uSaturation);
              alpha = dispAlpha;
          } else {
              vec4 refracted = sampleBackdrop(refractedScreen, uBlurRadius);
              color = applyColorControls(refracted.rgb, uBrightness, uContrast, uSaturation);
              alpha = refracted.a;
          }
      }

      if (uTintColor.a > 0.001) {
          color = mix(color, uTintColor.rgb, uTintColor.a);
          color = mix(color, uTintColor.rgb, 0.75 * uTintColor.a);
      }
      if (uSurfaceColor.a > 0.001) {
          color = mix(color, uSurfaceColor.rgb, uSurfaceColor.a);
      }

      if (uInnerShadowAlpha > 0.001 && uInnerShadowRadius > 0.5) {
          vec2 offsetCentered = centeredScreen - uInnerShadowOffset;
          float offsetSd;
          if (uShapeType < 0.5) {
              vec2 halfSize = uElementSize * 0.5;
              offsetSd = sdRoundedRect(offsetCentered, halfSize / uScale, uShapeParams.x);
          } else if (uShapeType < 1.5) {
              offsetSd = sdCircle(offsetCentered, uShapeParams.x);
          } else {
              offsetSd = sdEllipse(offsetCentered, uShapeParams);
          }
          float ring = smoothstep(0.0, uInnerShadowRadius, offsetSd) *
                       (1.0 - smoothstep(-uInnerShadowRadius, 0.0, sd));
          color *= 1.0 - ring * uInnerShadowAlpha;
      }

      gl_FragColor = vec4(color, alpha * edgeAlpha * uElementAlpha);
  }
  `;

  const RIM_FRAG = `
  precision highp float;
  uniform vec2  uCanvasSize;
  uniform vec2  uOffset;
  uniform vec2  uSize;
  uniform float uShapeType;
  uniform vec2  uShapeParams;
  uniform vec4  uHighlightColor;
  uniform float uHighlightAngle;
  uniform float uHighlightFalloff;
  uniform float uHighlightAlpha;
  uniform float uRotation;
  uniform float uScale;

  ${SDF_GLSL}

  void main() {
      vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
      vec2 elementCenter = uOffset + uSize * 0.5;
      vec2 centeredScreen = screenCoord - elementCenter;
      centeredScreen = rotateBy(centeredScreen, -uRotation) / uScale;

      float sd;
      vec2 grad;

      if (uShapeType < 0.5) {
          vec2 halfSize = uSize * 0.5;
          sd = sdRoundedRect(centeredScreen, halfSize / uScale, uShapeParams.x);
          grad = gradSdRoundedRect(centeredScreen, halfSize / uScale, uShapeParams.x);
      } else if (uShapeType < 1.5) {
          sd = sdCircle(centeredScreen, uShapeParams.x);
          grad = gradSdCircle(centeredScreen, uShapeParams.x);
      } else {
          sd = sdEllipse(centeredScreen, uShapeParams);
          grad = gradSdEllipse(centeredScreen, uShapeParams);
      }

      if (sd > 0.0) discard;

      float strokeHalf = 1.0;
      float sigma = 0.5;
      float strokeMask = 0.0;
      float wSum = 0.0;
      for (int i = -1; i <= 1; i++) {
          float offset = float(i) * sigma;
          float sampleSd = sd - offset;
          float hard = (abs(sampleSd) < strokeHalf) ? 1.0 : 0.0;
          float w = exp(-0.5 * (offset * offset) / (sigma * sigma));
          strokeMask += hard * w;
          wSum += w;
      }
      strokeMask /= wSum;
      strokeMask *= 0.5;

      vec2 normal = vec2(cos(uHighlightAngle), sin(uHighlightAngle));
      float d = dot(grad, normal);
      float intensity = pow(abs(d), uHighlightFalloff);

      vec3 c = uHighlightColor.rgb * intensity * strokeMask * uHighlightAlpha;
      gl_FragColor = vec4(c, 1.0);
  }
  `;

  const SHADOW_FRAG = `
  precision highp float;
  uniform vec2 uCanvasSize;
  uniform vec2 uElementOffset;
  uniform vec2 uElementSize;
  uniform float uShapeType;
  uniform vec2 uShapeParams;
  uniform float uShadowRadius;
  uniform vec2 uShadowOffset;
  uniform vec4 uShadowColor;
  uniform float uRotation;
  uniform float uScale;

  ${SDF_GLSL}

  void main() {
      vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);

      vec2 elementCenter = uElementOffset + uElementSize * 0.5;
      vec2 centeredScreen = screenCoord - elementCenter;
      centeredScreen = rotateBy(centeredScreen, -uRotation) / uScale;

      vec2 shadowCenteredScreen = centeredScreen - uShadowOffset;

      float sd, elementSd;
      if (uShapeType < 0.5) {
          vec2 halfSize = uElementSize * 0.5;
          sd = sdRoundedRect(shadowCenteredScreen, halfSize / uScale, uShapeParams.x);
          elementSd = sdRoundedRect(centeredScreen, halfSize / uScale, uShapeParams.x);
      } else if (uShapeType < 1.5) {
          sd = sdCircle(shadowCenteredScreen, uShapeParams.x);
          elementSd = sdCircle(centeredScreen, uShapeParams.x);
      } else {
          sd = sdEllipse(shadowCenteredScreen, uShapeParams);
          elementSd = sdEllipse(centeredScreen, uShapeParams);
      }

      float sigma = max(uShadowRadius / 3.0, 1.0);
      float shadow = 0.5 * exp(-sd * sd / (2.0 * sigma * sigma));
      shadow *= smoothstep(-1.0, 1.0, elementSd);

      gl_FragColor = vec4(uShadowColor.rgb, uShadowColor.a * shadow);
  }
  `;

  const COPY_FRAG = `
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uSize;
  void main() {
      vec2 uv = vec2(gl_FragCoord.x / uSize.x, gl_FragCoord.y / uSize.y);
      gl_FragColor = texture2D(uTex, uv);
  }
  `;

  // ============================================================
  // Utility Functions
  // ============================================================

  function parseUnit(value, canvasSize) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      if (value.endsWith('%')) {
        return parseFloat(value) / 100 * canvasSize;
      }
      if (value.endsWith('px')) {
        return parseFloat(value);
      }
      return parseFloat(value);
    }
    return 0;
  }

  function springStep(current, velocity, target, dt, omega) {
    const x0 = current - target;
    const v0 = velocity;
    const decay = Math.exp(-omega * dt);
    const offset = x0 * decay + (v0 + omega * x0) * dt * decay;
    const newVel = -omega * x0 * decay + (v0 + omega * x0) * (decay - omega * dt * decay);
    return { current: target + offset, velocity: newVel };
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function linear(t) {
    return t;
  }

  // ============================================================
  // Main Class
  // ============================================================

  class bLiquidGlass {
    constructor(canvas, elements = [], options = {}) {
      this.canvas = canvas;
      this.options = Object.assign({
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        background: null,
      }, options);

      this.dpr = this.options.dpr;
      this.elements = [];
      this.elementIdCounter = 0;
      this.groupTransforms = {};
      this.paused = false;
      this.destroyed = false;

      this.mouse = { x: 0, y: 0 };
      this.activeElement = null;
      this.activeElementIndex = -1;
      this.isDragging = false;
      this.dragStartMouse = null;
      this.dragStartElement = null;
      this.pointerId = null;
      this.gravityAngle = 45 * Math.PI / 180;

      this.initWebGL();
      this.createBackground();
      this.resize();
      this.bindEvents();

      if (elements.length > 0) {
        this.setElements(elements);
      }

      this.render();
    }

    initWebGL() {
      const gl = this.canvas.getContext('webgl', {
        premultipliedAlpha: false,
        alpha: true,
        antialias: true
      });
      if (!gl) {
        throw new Error('WebGL not supported');
      }
      this.gl = gl;

      this.prog = this.createProgram(VERT, FRAG);
      this.rimProg = this.createProgram(VERT, RIM_FRAG);
      this.shadowProg = this.createProgram(VERT, SHADOW_FRAG);
      this.copyProg = this.createProgram(VERT, COPY_FRAG);

      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
      ]), gl.STATIC_DRAW);

      this.fbo = [this.createFBO(), this.createFBO()];

      this.cacheUniformLocations();
    }

    createProgram(vertSrc, fragSrc) {
      const gl = this.gl;
      const vert = this.compileShader(gl.VERTEX_SHADER, vertSrc);
      const frag = this.compileShader(gl.FRAGMENT_SHADER, fragSrc);
      const prog = gl.createProgram();
      gl.attachShader(prog, vert);
      gl.attachShader(prog, frag);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(prog));
        throw new Error('Program link error');
      }
      return prog;
    }

    compileShader(type, src) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        throw new Error('Shader compile error');
      }
      return shader;
    }

    createFBO() {
      const gl = this.gl;
      const fbo = gl.createFramebuffer();
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fbo, tex };
    }

    cacheUniformLocations() {
      const gl = this.gl;
      const get = (prog, name) => gl.getUniformLocation(prog, name);

      this.u = {};
      [
        'uBackdrop', 'uCanvasSize', 'uElementOffset', 'uElementSize', 'uShapeType', 'uShapeParams',
        'uRefractionHeight', 'uRefractionAmount', 'uDepthEffect', 'uChromaticAberration',
        'uBlurRadius', 'uSaturation', 'uBrightness', 'uContrast', 'uTintColor', 'uSurfaceColor',
        'uInnerShadowRadius', 'uInnerShadowAlpha', 'uInnerShadowOffset', 'uElementAlpha',
        'uRotation', 'uScale'
      ].forEach(n => this.u[n] = get(this.prog, n));

      this.uRim = {};
      [
        'uCanvasSize', 'uOffset', 'uSize', 'uShapeType', 'uShapeParams', 'uHighlightColor',
        'uHighlightAngle', 'uHighlightFalloff', 'uHighlightAlpha', 'uRotation', 'uScale'
      ].forEach(n => this.uRim[n] = get(this.rimProg, n));

      this.uSh = {};
      [
        'uCanvasSize', 'uElementOffset', 'uElementSize', 'uShapeType', 'uShapeParams',
        'uShadowRadius', 'uShadowOffset', 'uShadowColor', 'uRotation', 'uScale'
      ].forEach(n => this.uSh[n] = get(this.shadowProg, n));

      this.uCopy = {
        uTex: get(this.copyProg, 'uTex'),
        uSize: get(this.copyProg, 'uSize')
      };
    }

    createBackground() {
      const gl = this.gl;
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 1024;
      const ctx = c.getContext('2d');

      const g = ctx.createLinearGradient(0, 0, 1024, 1024);
      g.addColorStop(0, '#0f62fe');
      g.addColorStop(0.3, '#8a3ffc');
      g.addColorStop(0.6, '#ff6b9d');
      g.addColorStop(1, '#ffd166');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1024, 1024);

      ctx.globalCompositeOperation = 'overlay';
      for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * 1024, Math.random() * 1024, 30 + Math.random() * 150, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.12})`;
        ctx.fill();
      }

      this.bgTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    resize() {
      const w = Math.round(this.canvas.clientWidth * this.dpr);
      const h = Math.round(this.canvas.clientHeight * this.dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.gl.viewport(0, 0, w, h);

        const gl = this.gl;
        for (const fb of this.fbo) {
          gl.bindTexture(gl.TEXTURE_2D, fb.tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      this.w = w;
      this.h = h;
    }

    // ============================================================
    // Events
    // ============================================================

    bindEvents() {
      this._onPointerDown = this.onPointerDown.bind(this);
      this._onPointerMove = this.onPointerMove.bind(this);
      this._onPointerUp = this.onPointerUp.bind(this);
      this._onPointerCancel = this.onPointerCancel.bind(this);
      this._onResize = this.onResize.bind(this);

      this.canvas.addEventListener('pointerdown', this._onPointerDown);
      this.canvas.addEventListener('pointermove', this._onPointerMove);
      this.canvas.addEventListener('pointerup', this._onPointerUp);
      this.canvas.addEventListener('pointercancel', this._onPointerCancel);
      this.canvas.addEventListener('lostpointercapture', this._onPointerCancel);
      window.addEventListener('resize', this._onResize);
    }

    unbindEvents() {
      this.canvas.removeEventListener('pointerdown', this._onPointerDown);
      this.canvas.removeEventListener('pointermove', this._onPointerMove);
      this.canvas.removeEventListener('pointerup', this._onPointerUp);
      this.canvas.removeEventListener('pointercancel', this._onPointerCancel);
      this.canvas.removeEventListener('lostpointercapture', this._onPointerCancel);
      window.removeEventListener('resize', this._onResize);
    }

    toCanvasCoords(e) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = rect.width > 0 ? this.canvas.width / rect.width : this.dpr;
      const scaleY = rect.height > 0 ? this.canvas.height / rect.height : this.dpr;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    }

    onPointerDown(e) {
      if (e.cancelable) e.preventDefault();

      const p = this.toCanvasCoords(e);
      this.mouse.x = p.x;
      this.mouse.y = p.y;

      for (let i = this.elements.length - 1; i >= 0; i--) {
        const elem = this.elements[i];
        if (this.isPointInElement(p.x, p.y, elem)) {
          this.pointerId = e.pointerId;
          if (this.canvas.setPointerCapture) {
            try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
          }

          this.activeElement = elem;
          this.activeElementIndex = i;
          this.isDragging = false;
          this.dragStartMouse = { x: p.x, y: p.y };

          this.dragStartElement = {
            x: parseUnit(elem.x, this.w),
            y: parseUnit(elem.y, this.h)
          };

          elem._targetPress = 1;
          break;
        }
      }
    }

    onPointerMove(e) {
      if (this.pointerId != null && e.pointerId !== this.pointerId) return;

      if (this.activeElement && e.cancelable) e.preventDefault();

      const p = this.toCanvasCoords(e);
      this.mouse.x = p.x;
      this.mouse.y = p.y;

      if (!this.activeElement || !this.dragStartMouse) return;

      const dx = p.x - this.dragStartMouse.x;
      const dy = p.y - this.dragStartMouse.y;

      if (!this.isDragging && (dx * dx + dy * dy) > 25) {
        this.isDragging = true;
        // 关键：拖动时关掉按压动画
        this.activeElement._targetPress = 0;
      }

      if (this.isDragging && typeof this.activeElement.onDrag === 'function') {
        const elem = this.activeElement;
        const evt = {
          element: elem,
          index: this.activeElementIndex,
          mouse: { x: e.clientX, y: e.clientY },
          delta: { x: dx, y: dy },
          elementStart: this.dragStartElement,
          _preventAnimation: false,  // 新增：支持阻止动画
          preventDefault: function() { this._preventAnimation = true; },
          updatePosition: (newX, newY) => {
            elem.x = newX;
            elem.y = newY;
          }
        };
        try { 
          elem.onDrag(evt); 
          // 如果用户调用了 preventDefault，确保按压动画关闭
          if (evt._preventAnimation) {
            elem._targetPress = 0;
          }
        } catch (err) { 
          console.error(err); 
        }
      }
    }

    onPointerUp(e) {
      if (e && this.pointerId != null && e.pointerId !== this.pointerId) return;

      const elem = this.activeElement;

      if (elem) {
        if (!this.isDragging && typeof elem.onClick === 'function') {
          const evt = {
            element: elem,
            index: this.activeElementIndex,
            mouse: e ? { x: e.clientX, y: e.clientY } : { x: 0, y: 0 },
            _preventAnimation: false,
            preventDefault: function () { this._preventAnimation = true; }
          };
          try { elem.onClick(evt); } catch (err) { console.error(err); }
        }
        elem._targetPress = 0;
      }

      if (this.pointerId != null && this.canvas.releasePointerCapture) {
        try { this.canvas.releasePointerCapture(this.pointerId); } catch (err) {}
      }

      this.resetPointerState();
    }

    onPointerCancel(e) {
      if (this.activeElement) this.activeElement._targetPress = 0;
      this.resetPointerState();
    }

    resetPointerState() {
      this.activeElement = null;
      this.activeElementIndex = -1;
      this.isDragging = false;
      this.dragStartMouse = null;
      this.dragStartElement = null;
      this.pointerId = null;
    }

    onResize() {
      this.resize();
    }

    isPointInElement(x, y, elem) {
      const computed = this.computeElementTransform(elem);
      const dx = x - computed.x;
      const dy = y - computed.y;

      const halfW = computed.width / 2;
      const halfH = computed.height / 2;
      return Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;
    }

    // ============================================================
    // Element Management
    // ============================================================

    setElements(elements) {
      this.elements = elements.map(e => this.normalizeElement(e));
    }

    addElement(element, index) {
      const elem = this.normalizeElement(element);
      if (index === undefined) {
        this.elements.push(elem);
      } else {
        this.elements.splice(index, 0, elem);
      }
      return elem;
    }

    removeElement(index) {
      return this.elements.splice(index, 1)[0];
    }

    updateElement(index, props, animate = true) {
      const elem = this.elements[index];
      if (!elem) return;

      Object.assign(elem, props);
      if (!animate) {
        this.syncElementState(elem);
      }
    }

    getElement(index) {
      return this.elements[index];
    }

    getElementById(id) {
      return this.elements.find(e => e.id === id);
    }

    updateElementById(id, props, animate = true) {
      const index = this.elements.findIndex(e => e.id === id);
      if (index !== -1) {
        this.updateElement(index, props, animate);
      }
    }

    getElementsByGroup(groupName) {
      return this.elements.filter(e => e.group === groupName);
    }

    normalizeElement(elem) {
      const defaults = {
        id: elem.id || `element_${this.elementIdCounter++}`,
        type: elem.type || 'rect',
        group: elem.group || null,

        x: elem.x !== undefined ? elem.x : '50%',
        y: elem.y !== undefined ? elem.y : '50%',

        width: elem.width !== undefined ? elem.width : 200,
        height: elem.height !== undefined ? elem.height : 200,
        radius: elem.radius !== undefined ? elem.radius : 100,
        radiusX: elem.radiusX !== undefined ? elem.radiusX : 150,
        radiusY: elem.radiusY !== undefined ? elem.radiusY : 100,
        cornerRadius: elem.cornerRadius !== undefined ? elem.cornerRadius : 36,

        refractionHeight: elem.refractionHeight !== undefined ? elem.refractionHeight : 16,
        refractionAmount: elem.refractionAmount !== undefined ? elem.refractionAmount : -36,
        depthEffect: elem.depthEffect !== undefined ? elem.depthEffect : 1.0,
        chromaticAberration: elem.chromaticAberration !== undefined ? elem.chromaticAberration : 1.0,
        blur: elem.blur !== undefined ? elem.blur : 3,
        saturation: elem.saturation !== undefined ? elem.saturation : 1.5,
        brightness: elem.brightness !== undefined ? elem.brightness : 0.0,
        contrast: elem.contrast !== undefined ? elem.contrast : 1.0,
        surfaceOpacity: elem.surfaceOpacity !== undefined ? elem.surfaceOpacity : 0.22,

        shadowRadius: elem.shadowRadius !== undefined ? elem.shadowRadius : 48,
        shadowOffsetX: elem.shadowOffsetX !== undefined ? elem.shadowOffsetX : 0,
        shadowOffsetY: elem.shadowOffsetY !== undefined ? elem.shadowOffsetY : 18,
        shadowColor: elem.shadowColor || [0, 0, 0, 0.22],

        innerShadowRadius: elem.innerShadowRadius !== undefined ? elem.innerShadowRadius : 10,
        innerShadowAlpha: elem.innerShadowAlpha !== undefined ? elem.innerShadowAlpha : 0.18,
        innerShadowOffsetX: elem.innerShadowOffsetX !== undefined ? elem.innerShadowOffsetX : 0,
        innerShadowOffsetY: elem.innerShadowOffsetY !== undefined ? elem.innerShadowOffsetY : 8,

        highlightColor: elem.highlightColor || [1, 1, 1, 1],
        highlightFalloff: elem.highlightFalloff !== undefined ? elem.highlightFalloff : 1.0,
        highlightAlpha: elem.highlightAlpha !== undefined ? elem.highlightAlpha : 0.55,

        onClick: elem.onClick !== undefined ? elem.onClick : false,
        onDrag: elem.onDrag !== undefined ? elem.onDrag : false,

        transition: Object.assign({
          duration: 0.3,
          easing: 'spring'
        }, elem.transition || {}),

        _pressProgress: 0,
        _pressVelocity: 0,
        _targetPress: 0,
        _animatedProps: {}
      };

      this.syncElementState(defaults);
      return defaults;
    }

    syncElementState(elem) {
      elem._animatedProps = {
        x: parseUnit(elem.x, this.w),
        y: parseUnit(elem.y, this.h),
        width: parseUnit(elem.width, this.w),
        height: parseUnit(elem.height, this.h),
        rotation: 0,
        scale: 1
      };
    }

    // ============================================================
    // Group Transform
    // ============================================================

    setGroupTransform(groupName, transform) {
      this.groupTransforms[groupName] = Object.assign({
        x: 0,
        y: 0,
        rotation: 0,
        scale: 1
      }, transform);
    }

    getGroupTransform(groupName) {
      return this.groupTransforms[groupName] || null;
    }

    removeGroupTransform(groupName) {
      delete this.groupTransforms[groupName];
    }

    // ============================================================
    // Rendering
    // ============================================================

    computeElementTransform(elem) {
      let x = parseUnit(elem.x, this.w);
      let y = parseUnit(elem.y, this.h);
      let rotation = 0;
      let scale = 1;

      if (elem.group && this.groupTransforms[elem.group]) {
        const gt = this.groupTransforms[elem.group];
        x += gt.x || 0;
        y += gt.y || 0;
        rotation += (gt.rotation || 0) * Math.PI / 180;
        scale *= gt.scale || 1;
      }

      const pressScale = 1 + 0.06 * elem._pressProgress;
      scale *= pressScale;

      let width, height;
      if (elem.type === 'rect') {
        width = parseUnit(elem.width, this.w) * scale;
        height = parseUnit(elem.height, this.h) * scale;
      } else if (elem.type === 'circle') {
        const r = parseUnit(elem.radius, Math.min(this.w, this.h));
        width = height = r * 2 * scale;
      } else if (elem.type === 'ellipse') {
        width = parseUnit(elem.radiusX, this.w) * 2 * scale;
        height = parseUnit(elem.radiusY, this.h) * 2 * scale;
      }

      const mouseInfluence = 0.03 * elem._pressProgress;
      x += (this.mouse.x - this.w / 2) * mouseInfluence;
      y += (this.mouse.y - this.h / 2) * mouseInfluence;

      return { x, y, width, height, rotation, scale };
    }

    updateAnimations(dt) {
      for (const elem of this.elements) {
        if (elem.onClick !== false || elem.onDrag !== false) {
          const sp = springStep(elem._pressProgress, elem._pressVelocity, elem._targetPress, dt, 30);
          elem._pressProgress = sp.current;
          elem._pressVelocity = sp.velocity;
        }
      }

      this.gravityAngle += ((this.mouse.x / this.w) * Math.PI - this.gravityAngle) * 0.1;
    }

    drawQuad(prog) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    renderElement(elem, srcTexture) {
      const gl = this.gl;
      const computed = this.computeElementTransform(elem);
      const dpr = this.dpr;

      let shapeType, shapeParams;
      if (elem.type === 'rect') {
        shapeType = 0;
        shapeParams = [elem.cornerRadius * dpr, 0];
      } else if (elem.type === 'circle') {
        shapeType = 1;
        const r = parseUnit(elem.radius, Math.min(this.w, this.h));
        shapeParams = [r, 0];
      } else if (elem.type === 'ellipse') {
        shapeType = 2;
        shapeParams = [
          parseUnit(elem.radiusX, this.w),
          parseUnit(elem.radiusY, this.h)
        ];
      }

      const sx = computed.x - computed.width / 2;
      const sy = computed.y - computed.height / 2;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.shadowProg);
      this.drawQuad(this.shadowProg);

      gl.uniform2f(this.uSh.uCanvasSize, this.w, this.h);
      gl.uniform2f(this.uSh.uElementOffset, sx, sy);
      gl.uniform2f(this.uSh.uElementSize, computed.width, computed.height);
      gl.uniform1f(this.uSh.uShapeType, shapeType);
      gl.uniform2f(this.uSh.uShapeParams, shapeParams[0], shapeParams[1]);
      gl.uniform1f(this.uSh.uShadowRadius, elem.shadowRadius * dpr);
      gl.uniform2f(this.uSh.uShadowOffset, elem.shadowOffsetX * dpr, elem.shadowOffsetY * dpr);
      gl.uniform4f(this.uSh.uShadowColor, ...elem.shadowColor);
      gl.uniform1f(this.uSh.uRotation, computed.rotation);
      gl.uniform1f(this.uSh.uScale, computed.scale);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.prog);
      this.drawQuad(this.prog);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTexture);
      gl.uniform1i(this.u.uBackdrop, 0);

      gl.uniform2f(this.u.uCanvasSize, this.w, this.h);
      gl.uniform2f(this.u.uElementOffset, sx, sy);
      gl.uniform2f(this.u.uElementSize, computed.width, computed.height);
      gl.uniform1f(this.u.uShapeType, shapeType);
      gl.uniform2f(this.u.uShapeParams, shapeParams[0], shapeParams[1]);
      gl.uniform1f(this.u.uRefractionHeight, elem.refractionHeight * dpr);
      gl.uniform1f(this.u.uRefractionAmount, elem.refractionAmount * dpr);
      gl.uniform1f(this.u.uDepthEffect, elem.depthEffect);
      gl.uniform1f(this.u.uChromaticAberration, elem.chromaticAberration);
      gl.uniform1f(this.u.uBlurRadius, elem.blur * dpr);
      gl.uniform1f(this.u.uSaturation, elem.saturation);
      gl.uniform1f(this.u.uBrightness, elem.brightness);
      gl.uniform1f(this.u.uContrast, elem.contrast);
      gl.uniform4f(this.u.uTintColor, 1, 1, 1, 0);
      gl.uniform4f(this.u.uSurfaceColor, 1, 1, 1, elem.surfaceOpacity + 0.08 * elem._pressProgress);
      gl.uniform1f(this.u.uInnerShadowRadius, elem.innerShadowRadius * dpr);
      gl.uniform1f(this.u.uInnerShadowAlpha, elem.innerShadowAlpha);
      gl.uniform2f(this.u.uInnerShadowOffset, elem.innerShadowOffsetX * dpr, elem.innerShadowOffsetY * dpr);
      gl.uniform1f(this.u.uElementAlpha, 1.0);
      gl.uniform1f(this.u.uRotation, computed.rotation);
      gl.uniform1f(this.u.uScale, computed.scale);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.rimProg);
      this.drawQuad(this.rimProg);

      gl.uniform2f(this.uRim.uCanvasSize, this.w, this.h);
      gl.uniform2f(this.uRim.uOffset, sx, sy);
      gl.uniform2f(this.uRim.uSize, computed.width, computed.height);
      gl.uniform1f(this.uRim.uShapeType, shapeType);
      gl.uniform2f(this.uRim.uShapeParams, shapeParams[0], shapeParams[1]);
      gl.uniform4f(this.uRim.uHighlightColor, ...elem.highlightColor);
      gl.uniform1f(this.uRim.uHighlightAngle, this.gravityAngle);
      gl.uniform1f(this.uRim.uHighlightFalloff, elem.highlightFalloff);
      gl.uniform1f(this.uRim.uHighlightAlpha, elem.highlightAlpha + 0.25 * elem._pressProgress);
      gl.uniform1f(this.uRim.uRotation, computed.rotation);
      gl.uniform1f(this.uRim.uScale, computed.scale);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    render() {
      if (this.destroyed || this.paused) {
        if (!this.destroyed) requestAnimationFrame(() => this.render());
        return;
      }

      const gl = this.gl;
      const dt = 1 / 60;

      this.updateAnimations(dt);

      let src = 0, dst = 1;

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[dst].fbo);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.copyProg);
      this.drawQuad(this.copyProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      gl.uniform1i(this.uCopy.uTex, 0);
      gl.uniform2f(this.uCopy.uSize, this.w, this.h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      [src, dst] = [dst, src];

      for (const elem of this.elements) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[dst].fbo);
        gl.disable(gl.BLEND);
        gl.useProgram(this.copyProg);
        this.drawQuad(this.copyProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fbo[src].tex);
        gl.uniform1i(this.uCopy.uTex, 0);
        gl.uniform2f(this.uCopy.uSize, this.w, this.h);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        this.renderElement(elem, this.fbo[src].tex);

        [src, dst] = [dst, src];
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.BLEND);
      gl.useProgram(this.copyProg);
      this.drawQuad(this.copyProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fbo[src].tex);
      gl.uniform1i(this.uCopy.uTex, 0);
      gl.uniform2f(this.uCopy.uSize, this.w, this.h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      requestAnimationFrame(() => this.render());
    }

    // ============================================================
    // Control Methods
    // ============================================================

    pause() {
      this.paused = true;
    }

    resume() {
      this.paused = false;
      this.render();
    }

    destroy() {
      this.destroyed = true;
      this.unbindEvents();

      const gl = this.gl;
      gl.deleteProgram(this.prog);
      gl.deleteProgram(this.rimProg);
      gl.deleteProgram(this.shadowProg);
      gl.deleteProgram(this.copyProg);
      gl.deleteBuffer(this.quad);
      gl.deleteTexture(this.bgTex);
      for (const fb of this.fbo) {
        gl.deleteFramebuffer(fb.fbo);
        gl.deleteTexture(fb.tex);
      }
    }
  }

  return bLiquidGlass;
}));
