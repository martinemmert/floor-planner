// The 3D view: a small WebGL renderer with an orbit camera.
//
// Written against raw WebGL because a published Artifact cannot load a library, and
// because a depth buffer is the only honest way to draw a building — a painter's
// algorithm falls apart wherever a stair passes a wall.

export const FOV_DEG = 42;

const VERTEX_SHADER = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec4 aColor;
attribute vec3 aSurface;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uSunView;
uniform float uNudge;
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vSurface;
varying vec3 vWorld;
varying vec4 vSun;
varying float vDepth;
void main() {
  vec4 eye = uView * vec4(aPos, 1.0);
  gl_Position = uProj * eye;
  // An outline lies exactly on the face it bounds, so without a pull towards the eye
  // the two fight over every pixel of it.
  gl_Position.z -= uNudge * gl_Position.w;
  vNormal = aNormal;
  vColor = aColor;
  vSurface = aSurface;
  vWorld = aPos;
  vSun = uSunView * vec4(aPos, 1.0);
  vDepth = -eye.z;
}
`;

// The depth of the scene as the sun sees it, packed across four eight-bit channels
// because WebGL 1 cannot be relied on to hand back a depth texture.
const SHADOW_VERTEX = `
attribute vec3 aPos;
uniform mat4 uSunView;
varying float vZ;
void main() {
  gl_Position = uSunView * vec4(aPos, 1.0);
  vZ = gl_Position.z * 0.5 + 0.5;
}
`;

const SHADOW_FRAGMENT = `
precision highp float;
varying float vZ;
void main() {
  vec4 enc = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * vZ);
  enc -= enc.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  gl_FragColor = enc;
}
`;

const FRAGMENT_BODY = `
precision highp float;
uniform vec3 uLight;
uniform float uUnlit;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform float uToon;
uniform vec3 uPaper;
uniform float uWash;
uniform float uShadow;
uniform sampler2D uSunDepth;
uniform vec2 uSunTexel;
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vSurface;
varying vec3 vWorld;
varying vec4 vSun;
varying float vDepth;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Where a surface is, flattened onto whichever pair of axes it most faces. A floor
// takes the plan, a wall takes its own length and its height — so nothing needs
// texture coordinates and a pattern crosses a doorway without a seam.
//
// The world seen from the surface's own direction, so a finish runs with the thing it
// is on. Turned before the plane is chosen — and the normal turned with it — so the
// choice is made in the surface's frame too: a wall on a skew then picks the same plane
// a wall square to the page would, and its tiles run along it rather than across it.
vec2 planar(vec3 w, vec3 n, float turn) {
  float c = cos(turn);
  float s = sin(turn);
  vec3 p = vec3(w.x * c + w.y * s, -w.x * s + w.y * c, w.z);
  vec3 m = vec3(n.x * c + n.y * s, -n.x * s + n.y * c, n.z);
  vec3 a = abs(m);
  if (a.z >= a.x && a.z >= a.y) return p.xy;
  if (a.x >= a.y) return p.yz;
  return p.xz;
}

// How far the coordinate moves from one pixel to the next. WebGL 1 only promises
// this if an extension says so, and a fixed guess is a poor but survivable stand-in.
vec2 perPixel(vec2 uv) {
#ifdef HAVE_DERIVATIVES
  return fwidth(uv);
#else
  return vec2(0.004);
#endif
}

/**
 * The joints in a finish, as a drawing rules them: a hair of a line and nothing else.
 *
 * The width of one pixel in the finish's own coordinates is what keeps the line a
 * line: the same weight whether the floor fills the screen or is the size of a stamp,
 * which is what a drawn line does and what a texture cannot.
 */
float joints(float kind, float rep, float turn, vec3 w, vec3 n) {
  // Anything not asked for is left plain. Written the other way round — plain only
  // when the number matches — a finish that resolved to nothing fell through to the
  // last case and ruled lines nobody asked for over everything.
  if (!(kind > 0.5 && kind < 3.5)) return 1.0;
  vec2 uv = planar(w, n, turn) / max(1.0, rep);
  vec2 px = perPixel(uv);
  float line = 1.0;
  if (kind < 1.5) {
    // Boards: along every joint, and across at the staggered ends.
    float board = floor(uv.y);
    float run = uv.x / 9.0 + hash21(vec2(board, 3.0)) * 5.0;
    float along = min(fract(uv.y), 1.0 - fract(uv.y)) / max(px.y, 1e-5);
    float across = min(fract(run), 1.0 - fract(run)) / max(px.x / 9.0, 1e-5);
    line = min(smoothstep(0.0, 1.2, along), smoothstep(0.0, 1.2, across));
  } else if (kind < 2.5) {
    vec2 edge = min(fract(uv), 1.0 - fract(uv)) / max(px, vec2(1e-5));
    line = smoothstep(0.0, 1.2, min(edge.x, edge.y));
  } else {
    float edge = min(fract(uv.x), 1.0 - fract(uv.x)) / max(px.x, 1e-5);
    line = smoothstep(0.0, 1.2, edge);
  }
  return mix(0.80, 1.0, line);
}

/**
 * Pencil hatching, ruled across the picture rather than across the model.
 *
 * A drawing shades with lines at a constant spacing on the paper, so the hatch is set
 * out in screen space: it does not swim about as the model turns, and it stays the
 * same weight whatever the thing being shaded is.
 */
float hatching(float amount) {
  if (amount < 0.01) return 1.0;
  float d = (gl_FragCoord.x + gl_FragCoord.y) * 0.16;
  float line = smoothstep(0.30, 0.52, abs(fract(d) - 0.5));
  float second = amount > 0.55
    ? smoothstep(0.30, 0.52, abs(fract((gl_FragCoord.x - gl_FragCoord.y) * 0.16) - 0.5))
    : 1.0;
  // A pencil line on paper is grey, not black, and hatching is mostly the paper
  // showing between the strokes. Anything heavier reads as a fill.
  return mix(1.0, mix(0.86, 1.0, min(line, second)), clamp(amount, 0.0, 1.0));
}

float unpack(vec4 c) {
  return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

/** How much of the sun reaches here: 1 in the open, 0 in shadow, soft at the edge. */
float sunlit(float slope) {
  if (uShadow < 0.5) return 1.0;
  vec3 p = vSun.xyz / vSun.w;
  if (abs(p.x) > 1.0 || abs(p.y) > 1.0 || p.z > 1.0) return 1.0;
  vec2 uv = p.xy * 0.5 + 0.5;
  float here = p.z * 0.5 + 0.5;
  // A surface all but edge-on to the sun needs far more slack before it is judged to
  // be shading itself, which is what the slope term carries.
  float bias = 0.0012 + 0.006 * slope;
  float lit = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 at = uv + vec2(float(x), float(y)) * uSunTexel;
      lit += step(here - bias, unpack(texture2D(uSunDepth, at)));
    }
  }
  return lit / 9.0;
}

void main() {
  vec3 colour = vColor.rgb;
  if (uUnlit < 0.5) {
    vec3 n = normalize(vNormal);
    vec3 sun = normalize(uLight);
    // Two sided: a sloping ceiling and a wall face should both catch the light.
    float key = abs(dot(n, sun));
    float fill = abs(dot(n, normalize(vec3(-0.5, 0.8, 0.25))));
    // A sky term, so what faces up is not read as the same surface as what faces out.
    float sky = n.z * 0.5 + 0.5;
    float tone = 0.34 + 0.46 * key + 0.12 * fill + 0.12 * sky;

    // Colour is a wash laid over the paper, never the colour of a thing. A drawing
    // that gets this wrong stops looking like a proposal and starts looking like a
    // photograph of a room that does not exist, which is a promise it cannot keep.
    colour = mix(uPaper, colour, uWash);

    // The shading barely moves. On a drawing the modelling is carried by the outlines
    // and by which way a surface faces, not by a gradient across it — so this only
    // has to be enough to tell a wall from the floor it stands on.
    float shade = mix(0.80 + 0.20 * tone, 0.86 + 0.14 * (floor(tone * 4.0) / 4.0), uToon);

    // What the sun cannot reach is hatched rather than darkened. A pencil has no black
    // to put in a shadow; it has strokes, and more of them where it is darker.
    float shut = 1.0 - sunlit(1.0 - key);
    colour *= joints(vSurface.x, vSurface.y, vSurface.z, vWorld, n) * shade * hatching(shut * 0.5);
  }
  float fog = clamp((vDepth - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(colour, uFog, fog * 0.75), vColor.a);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader failed to compile: ${log}`);
  }
  return shader;
}

function unit3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function perspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const nf = 1 / (near - far);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye, target, up) {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
  const xl = Math.hypot(...x) || 1;
  x = x.map((v) => v / xl);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  // prettier-ignore
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

function ortho(l, r, b, t, n, f) {
  // prettier-ignore
  return new Float32Array([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, -2 / (f - n), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/**
 * How the sun sees the building: straight down its own rays, framed so the whole
 * model fits and nothing else is wasted.
 *
 * The box is sized from the model's bounding sphere, which does not change as the sun
 * moves — so the shadows do not swim about as the time of day is dragged.
 */
function sunMatrix(direction, centre, radius) {
  const d = unit3(direction);
  const far = radius * 4;
  const eye = [centre[0] + d[0] * radius * 2, centre[1] + d[1] * radius * 2, centre[2] + d[2] * radius * 2];
  const up = Math.abs(d[2]) > 0.98 ? [0, 1, 0] : [0, 0, 1];
  return multiply(ortho(-radius, radius, -radius, radius, radius * 0.05, far), lookAt(eye, centre, up));
}

export class View3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.mesh = null;
    this.grid = null;
    this.camera = { azimuth: -0.7, elevation: 0.55, distance: 20000, target: [0, 0, 0] };
    // Standing in the building rather than looking at it. Null unless you are walking.
    this.walker = null;
    this.theme = 'light';
    this.background = [0.93, 0.94, 0.95];
    this.failure = null;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.wash = 0.26;
    this.outlined = true;
    // The sun: a direction to it, and whether it is up at all. Overwritten by the
    // sun study; this is a fair afternoon in the northern hemisphere until then.
    this.sun = { dir: [0.4, -0.7, 0.9], up: true };
    this.shadowSize = 1024;
    this.shadows = true;
  }

  init() {
    if (this.gl) return true;
    this.watchForContextLoss();
    // preserveDrawingBuffer because this renderer draws on demand rather than
    // every frame: without it the buffer is thrown away after compositing and the
    // canvas reads back empty between draws.
    const options = { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true };
    const gl = this.canvas.getContext('webgl', options) ?? this.canvas.getContext('experimental-webgl', options);
    if (!gl) {
      this.failure = 'This browser will not give the page a 3D drawing context.';
      return false;
    }
    try {
      // The pragma has to come before anything else in the source, so the shader is
      // put together here rather than written out whole.
      const derivatives = gl.getExtension('OES_standard_derivatives');
      const fragment = derivatives
        ? `#extension GL_OES_standard_derivatives : enable\n#define HAVE_DERIVATIVES 1\n${FRAGMENT_BODY}`
        : FRAGMENT_BODY;
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
      }
      this.program = program;
      this.attribs = {
        pos: gl.getAttribLocation(program, 'aPos'),
        normal: gl.getAttribLocation(program, 'aNormal'),
        colour: gl.getAttribLocation(program, 'aColor'),
        surface: gl.getAttribLocation(program, 'aSurface'),
      };
      this.uniforms = {
        proj: gl.getUniformLocation(program, 'uProj'),
        view: gl.getUniformLocation(program, 'uView'),
        light: gl.getUniformLocation(program, 'uLight'),
        unlit: gl.getUniformLocation(program, 'uUnlit'),
        fog: gl.getUniformLocation(program, 'uFog'),
        fogNear: gl.getUniformLocation(program, 'uFogNear'),
        fogFar: gl.getUniformLocation(program, 'uFogFar'),
        toon: gl.getUniformLocation(program, 'uToon'),
        nudge: gl.getUniformLocation(program, 'uNudge'),
        paper: gl.getUniformLocation(program, 'uPaper'),
        wash: gl.getUniformLocation(program, 'uWash'),
        shadow: gl.getUniformLocation(program, 'uShadow'),
        sunView: gl.getUniformLocation(program, 'uSunView'),
        sunDepth: gl.getUniformLocation(program, 'uSunDepth'),
        sunTexel: gl.getUniformLocation(program, 'uSunTexel'),
      };
      this.shadowProgram = gl.createProgram();
      gl.attachShader(this.shadowProgram, compile(gl, gl.VERTEX_SHADER, SHADOW_VERTEX));
      gl.attachShader(this.shadowProgram, compile(gl, gl.FRAGMENT_SHADER, SHADOW_FRAGMENT));
      gl.linkProgram(this.shadowProgram);
      if (!gl.getProgramParameter(this.shadowProgram, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(this.shadowProgram) ?? 'shadow link failed');
      }
      this.shadowAttribs = { pos: gl.getAttribLocation(this.shadowProgram, 'aPos') };
      this.shadowUniforms = { sunView: gl.getUniformLocation(this.shadowProgram, 'uSunView') };
      this.buffers = {
        pos: gl.createBuffer(),
        normal: gl.createBuffer(),
        colour: gl.createBuffer(),
        gridPos: gl.createBuffer(),
        gridNormal: gl.createBuffer(),
        gridColour: gl.createBuffer(),
        surface: gl.createBuffer(),
        gridSurface: gl.createBuffer(),
        lineSurface: gl.createBuffer(),
        linePos: gl.createBuffer(),
        lineNormal: gl.createBuffer(),
        lineColour: gl.createBuffer(),
      };
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE); // surfaces are drawn from both sides
      this.gl = gl;
      return true;
    } catch (err) {
      this.failure = err.message;
      return false;
    }
  }

  setTheme(theme, background) {
    this.theme = theme;
    if (background) this.background = background;
  }

  setMesh(mesh) {
    this.mesh = mesh;
    if (!this.gl || !mesh) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.normal);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.colour);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.surface);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.surfaces ?? new Float32Array(mesh.count * 2), gl.STATIC_DRAW);

    // The outlines. They take the same attributes as everything else so one program
    // draws both; the normals are unused and the colour is the ink of the drawing.
    const count = mesh.lineCount ?? 0;
    if (count) {
      const ink = this.theme === 'dark' ? [0.62, 0.69, 0.74] : [0.13, 0.19, 0.24];
      const colours = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        colours[i * 4] = ink[0];
        colours[i * 4 + 1] = ink[1];
        colours[i * 4 + 2] = ink[2];
        colours[i * 4 + 3] = 1;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.linePos);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.lines, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.lineNormal);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(count * 3), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.lineColour);
      gl.bufferData(gl.ARRAY_BUFFER, colours, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.lineSurface);
      // Three per vertex now the surface carries a direction as well. Left at two, the
      // attribute ran off the end of its buffer and the outlines took whatever the
      // driver had there.
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(count * 3), gl.STATIC_DRAW);
    }
  }

  /**
   * A graphics context can be taken away, and it is worth surviving.
   *
   * The browser drops it when the machine wakes from sleep, when another tab wants the
   * GPU, or when a driver restarts. Everything built on it — programs, buffers,
   * textures — goes with it, and every later call silently does nothing: the model
   * simply stops drawing and the only way back was to reload the page and lose the
   * drawing. So the loss is caught, the built state is thrown away, and the next draw
   * builds it again from scratch.
   */
  watchForContextLoss() {
    if (this.watching) return;
    this.watching = true;
    this.canvas.addEventListener('webglcontextlost', (event) => {
      // Without this the browser will not give the context back at all.
      event.preventDefault();
      this.gl = null;
      this.program = null;
      this.buffers = null;
      this.shadow = null;
      this.mesh = null;
      this.grid = null;
      this.failure = 'The 3D context was lost — it comes back on its own.';
      this.onContextLost?.();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.failure = null;
      if (this.init()) this.onContextRestored?.();
    });
  }

  /** Where the sun is, as a direction towards it, and whether it is above the horizon. */
  setSun(dir, up = true) {
    this.sun = { dir: unit3(dir), up };
  }

  /**
   * Somewhere to render the scene from the sun's point of view.
   *
   * A colour texture rather than a depth one: WebGL 1 only hands back a real depth
   * texture if an extension says so, and the depth packs into four eight-bit channels
   * perfectly well without it.
   */
  shadowTarget() {
    if (this.shadow) return this.shadow;
    const gl = this.gl;
    const size = this.shadowSize;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
    const frame = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const ready = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadow = ready ? { frame, texture, size } : { frame: null };
    return this.shadow;
  }

  /** The scene as the sun sees it, so the main pass can ask what it could not see. */
  castShadows(matrix) {
    const gl = this.gl;
    const target = this.shadowTarget();
    if (!target.frame) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.frame);
    gl.viewport(0, 0, target.size, target.size);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // These four channels are a number, not a colour. Left blended — and blending is
    // on for the glass — each one is mixed with the white it was cleared to, and the
    // number that comes back out is always "further away than anything", so the whole
    // model reads as standing in open sun.
    gl.disable(gl.BLEND);
    gl.useProgram(this.shadowProgram);
    gl.uniformMatrix4fv(this.shadowUniforms.sunView, false, matrix);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
    gl.enableVertexAttribArray(this.shadowAttribs.pos);
    gl.vertexAttribPointer(this.shadowAttribs.pos, 3, gl.FLOAT, false, 0, 0);
    // Only the solids cast: glass does not, and the ground would shadow itself.
    gl.drawArrays(gl.TRIANGLES, 0, this.mesh.opaqueCount ?? this.mesh.count);
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  /** A ground grid, one line every metre, to give the model a floor to sit on. */
  setGrid(bounds) {
    if (!this.gl) return;
    const step = 1000;
    const pad = 4000;
    const x0 = Math.floor((bounds.min?.[0] ?? -5000) / step) * step - pad;
    const x1 = Math.ceil((bounds.max?.[0] ?? 5000) / step) * step + pad;
    const y0 = Math.floor((bounds.min?.[1] ?? -5000) / step) * step - pad;
    const y1 = Math.ceil((bounds.max?.[1] ?? 5000) / step) * step + pad;
    const pos = [];
    const colour = [];
    const shade = this.theme === 'dark' ? [0.24, 0.28, 0.32] : [0.82, 0.84, 0.86];
    const push = (a, b) => {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      colour.push(...shade, 1, ...shade, 1);
    };
    for (let x = x0; x <= x1; x += step) push([x, y0, 0], [x, y1, 0]);
    for (let y = y0; y <= y1; y += step) push([x0, y, 0], [x1, y, 0]);
    const gl = this.gl;
    const positions = new Float32Array(pos);
    const colours = new Float32Array(colour);
    const normals = new Float32Array(positions.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.gridPos);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.gridNormal);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.gridColour);
    gl.bufferData(gl.ARRAY_BUFFER, colours, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.gridSurface);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions.length), gl.STATIC_DRAW);
    this.grid = { count: positions.length / 3 };
  }

  frame(bounds) {
    this.camera.target = [...bounds.centre];
    this.camera.distance = bounds.size * 2.1;
  }

  resize() {
    const host = this.canvas.parentElement ?? this.canvas;
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === this.width && h === this.height && dpr === this.dpr) return false;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    return true;
  }

  /**
   * Draw at a size of your choosing rather than the one the layout wants.
   *
   * For exporting a picture bigger than the screen. The outlines and the hatching are
   * set out in pixels, so an image scaled up afterwards comes out with thick soft lines
   * instead of drawn ones — it has to be drawn at the size it is wanted.
   */
  setSize(width, height, dpr = 1) {
    this.width = Math.max(1, Math.round(width / dpr));
    this.height = Math.max(1, Math.round(height / dpr));
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width));
    this.canvas.height = Math.max(1, Math.round(height));
  }

  orbit(dx, dy) {
    this.camera.azimuth -= dx * 0.006;
    this.camera.elevation = Math.max(-0.2, Math.min(1.5, this.camera.elevation + dy * 0.006));
  }

  zoom(factor) {
    this.camera.distance = Math.max(1500, Math.min(400000, this.camera.distance * factor));
  }

  /**
   * Where a point on the canvas lands in the model, on the level the view is
   * looking at. Used to zoom towards whatever is under the pointer.
   */
  /**
   * The ray from the eye through a point on the canvas.
   *
   * Everything that asks the view a question about a place on screen — what is under
   * the cursor, where on the floor it lands, what to zoom towards — is asking about
   * this ray, so it is worked out once.
   */
  rayThrough(sx, sy) {
    const eye = this.eye();
    const target = this.camera.target;
    const forward = unit3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    const right = unit3(cross(forward, [0, 0, 1]));
    const up = cross(right, forward);
    const aspect = Math.max(0.2, this.width / Math.max(1, this.height));
    const tan = Math.tan((FOV_DEG * Math.PI) / 360);
    const ndcX = (sx / Math.max(1, this.width)) * 2 - 1;
    const ndcY = 1 - (sy / Math.max(1, this.height)) * 2;
    const dir = unit3([
      forward[0] + right[0] * ndcX * tan * aspect + up[0] * ndcY * tan,
      forward[1] + right[1] * ndcX * tan * aspect + up[1] * ndcY * tan,
      forward[2] + right[2] * ndcX * tan * aspect + up[2] * ndcY * tan,
    ]);
    return { from: eye, dir };
  }

  /** Where a point on the canvas lands on a level plane at height z. */
  pointOnHeight(sx, sy, z) {
    const ray = this.rayThrough(sx, sy);
    if (!ray || Math.abs(ray.dir[2]) < 1e-6) return null;
    const t = (z - ray.from[2]) / ray.dir[2];
    if (!(t > 0)) return null;
    return [ray.from[0] + ray.dir[0] * t, ray.from[1] + ray.dir[1] * t, z];
  }

  pointOn(sx, sy) {
    return this.pointOnHeight(sx, sy, this.camera.target[2]);
  }

  /**
   * Zooms towards a point on the canvas rather than the middle of it — the thing
   * that makes moving about feel like Blender or Max rather than like a slideshow.
   */
  zoomAt(factor, sx, sy) {
    // Where the pointer is aiming has to be read before the camera moves, or the
    // reading is of the new view and the point drifts out from under the cursor.
    const hit = this.pointOn(sx, sy);
    const before = this.camera.distance;
    this.zoom(factor);
    const applied = this.camera.distance / before;
    if (!hit) return;
    // Scaling the whole camera about that point leaves it exactly where it was on
    // screen, which is what makes a scroll feel like it is pulling the model.
    for (let i = 0; i < 3; i++) {
      this.camera.target[i] = hit[i] + (this.camera.target[i] - hit[i]) * applied;
    }
  }

  /** Dollies in and out by dragging, the way a middle-drag with a modifier does. */
  dolly(dy) {
    this.zoom(Math.exp(dy * 0.005));
  }

  pan(dx, dy) {
    const { azimuth } = this.camera;
    const scale = this.camera.distance / Math.max(200, this.height);
    const right = [Math.cos(azimuth), Math.sin(azimuth), 0];
    const forward = [-Math.sin(azimuth), Math.cos(azimuth), 0];
    for (let i = 0; i < 3; i++) {
      this.camera.target[i] -= right[i] * dx * scale;
      this.camera.target[i] += forward[i] * dy * scale * Math.cos(this.camera.elevation);
    }
    this.camera.target[2] += dy * scale * Math.sin(this.camera.elevation);
  }

  /** Where a point in the model lands on the canvas, or null if it is behind you. */
  project(point) {
    const eye = this.eye();
    const target = this.camera.target;
    const forward = unit3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    const right = unit3(cross(forward, [0, 0, 1]));
    const up = cross(right, forward);
    const rel = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
    const depth = rel[0] * forward[0] + rel[1] * forward[1] + rel[2] * forward[2];
    if (depth <= 1) return null;
    const x = rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2];
    const y = rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2];
    const aspect = Math.max(0.2, this.width / Math.max(1, this.height));
    const tan = Math.tan((FOV_DEG * Math.PI) / 360);
    return {
      x: (x / (depth * tan * aspect) + 1) * 0.5 * this.width,
      y: (1 - y / (depth * tan)) * 0.5 * this.height,
      depth,
    };
  }

  /**
   * Where you are standing and which way you are looking, or null to go back to
   * orbiting. The object is kept, not copied: `lookAround` turns it and the walker
   * moves it, and a copy meant every step put the view back where it started.
   */
  walk(at) {
    this.walker = at ?? null;
  }

  /** Turn on the spot: yaw round, pitch up and down but never over the top. */
  lookAround(dx, dy) {
    if (!this.walker) return;
    this.walker.yaw -= dx * 0.0032;
    this.walker.pitch = Math.max(-1.35, Math.min(1.35, (this.walker.pitch ?? 0) - dy * 0.0032));
  }

  /** What the walker is looking at: a point one metre ahead of the eye. */
  walkTarget() {
    const { x, y, z, yaw, pitch = 0 } = this.walker;
    const flat = Math.cos(pitch);
    return [x + Math.cos(yaw) * flat * 1000, y + Math.sin(yaw) * flat * 1000, z + Math.sin(pitch) * 1000];
  }

  eye() {
    if (this.walker) return [this.walker.x, this.walker.y, this.walker.z];
    const { azimuth, elevation, distance, target } = this.camera;
    const horizontal = Math.cos(elevation) * distance;
    return [
      target[0] + Math.cos(azimuth) * horizontal,
      target[1] + Math.sin(azimuth) * horizontal,
      target[2] + Math.sin(elevation) * distance,
    ];
  }

  draw() {
    const gl = this.gl;
    if (!gl) return;
    if (!this.mesh || !this.mesh.count) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(this.background[0], this.background[1], this.background[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return;
    }

    // The sun's own view of the scene comes first, while the screen is still free.
    const centre = [
      (this.mesh.min[0] + this.mesh.max[0]) / 2,
      (this.mesh.min[1] + this.mesh.max[1]) / 2,
      (this.mesh.min[2] + this.mesh.max[2]) / 2,
    ];
    const radius = Math.max(
      2000,
      0.5 * Math.hypot(
        this.mesh.max[0] - this.mesh.min[0],
        this.mesh.max[1] - this.mesh.min[1],
        this.mesh.max[2] - this.mesh.min[2]
      )
    );
    const wantsSun = this.shadows !== false && this.sun.up;
    const sunView = sunMatrix(this.sun.dir, centre, radius);
    const casting = wantsSun ? this.castShadows(sunView) : false;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this.background[0], this.background[1], this.background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const far = this.camera.distance * 6 + 40000;
    // The near plane decides how much of the depth buffer the model actually gets.
    // At a hundredth of the orbit distance the range was 2600:1 and a depth unit out
    // at the far side of the building was worth more millimetres than a partition is
    // thick — which is why the outlines behind one came through it. A twentieth is
    // still far closer than anything can get: the camera orbits at twice the model's
    // own size, so nothing is ever within 5% of that distance of the eye.
    // Walking, the eye is in the room and a wall can be an arm's length away, so the
    // near plane has to come right in — a twentieth of the orbit distance would clip
    // away the doorway you are standing in.
    const near = this.walker ? 60 : Math.max(100, this.camera.distance * 0.05);
    const proj = perspective(FOV_DEG, aspect, near, far);
    // z is up in the model, so the camera's up vector is z
    const view = lookAt(this.eye(), this.walker ? this.walkTarget() : this.camera.target, [0, 0, 1]);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.proj, false, proj);
    gl.uniformMatrix4fv(this.uniforms.view, false, view);
    gl.uniform3f(this.uniforms.light, this.sun.dir[0], this.sun.dir[1], this.sun.dir[2]);
    gl.uniform3f(this.uniforms.fog, this.background[0], this.background[1], this.background[2]);
    gl.uniform1f(this.uniforms.fogNear, this.walker ? 30000 : this.camera.distance * 1.1);
    gl.uniform1f(this.uniforms.fogFar, far * 0.75);
    gl.uniform1f(this.uniforms.toon, this.outlined ? 1 : 0);
    gl.uniform1f(this.uniforms.nudge, 0);
    // How far the colour is allowed off the paper. A quarter is enough to tell a
    // clay wall from a sage one and not enough to be mistaken for a rendering.
    const paper = this.theme === 'dark' ? [0.20, 0.23, 0.26] : [0.975, 0.972, 0.965];
    gl.uniform3f(this.uniforms.paper, paper[0], paper[1], paper[2]);
    gl.uniform1f(this.uniforms.wash, this.wash ?? 0.26);
    gl.uniformMatrix4fv(this.uniforms.sunView, false, sunView);
    gl.uniform1f(this.uniforms.shadow, casting ? 1 : 0);
    if (casting) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.shadow.texture);
      gl.uniform1i(this.uniforms.sunDepth, 0);
      gl.uniform2f(this.uniforms.sunTexel, 1 / this.shadow.size, 1 / this.shadow.size);
    }

    const bind = (buffer, location, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };

    if (this.grid) {
      gl.uniform1f(this.uniforms.unlit, 1);
      bind(this.buffers.gridPos, this.attribs.pos, 3);
      bind(this.buffers.gridNormal, this.attribs.normal, 3);
      bind(this.buffers.gridColour, this.attribs.colour, 4);
      bind(this.buffers.gridSurface, this.attribs.surface, 3);
      gl.drawArrays(gl.LINES, 0, this.grid.count);
    }

    gl.uniform1f(this.uniforms.unlit, 0);
    bind(this.buffers.pos, this.attribs.pos, 3);
    bind(this.buffers.normal, this.attribs.normal, 3);
    bind(this.buffers.colour, this.attribs.colour, 4);
    bind(this.buffers.surface, this.attribs.surface, 3);
    const solid = this.mesh.opaqueCount ?? this.mesh.count;
    // The surfaces are pushed away from the eye so their own outlines win the pixels
    // along them. It has to be this way round: pulling the lines forward instead is a
    // fixed distance in clip space, and out where the drawing is small that distance
    // is thicker than a wall — every edge behind one then comes through it.
    if (this.outlined && this.mesh.lineCount) {
      // One depth unit, and no more. The offset only has to beat the quantisation at
      // the edge itself; every unit beyond that is a distance behind the surface
      // through which the edges of whatever is back there will show.
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
    }
    gl.drawArrays(gl.TRIANGLES, 0, solid);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // The outlines go on after the solids and before the glass, so a pane still
    // blends over the edges of what is behind it rather than under them.
    if (this.outlined && this.mesh.lineCount) {
      gl.uniform1f(this.uniforms.unlit, 1);
      gl.lineWidth(1);
      bind(this.buffers.linePos, this.attribs.pos, 3);
      bind(this.buffers.lineNormal, this.attribs.normal, 3);
      bind(this.buffers.lineColour, this.attribs.colour, 4);
      bind(this.buffers.lineSurface, this.attribs.surface, 3);
      gl.drawArrays(gl.LINES, 0, this.mesh.lineCount);
      gl.uniform1f(this.uniforms.unlit, 0);
      bind(this.buffers.pos, this.attribs.pos, 3);
      bind(this.buffers.normal, this.attribs.normal, 3);
      bind(this.buffers.colour, this.attribs.colour, 4);
      bind(this.buffers.surface, this.attribs.surface, 3);
    }

    if (this.mesh.count > solid) {
      // Glass: blended over what is already there, and not written to the depth
      // buffer, so a pane never hides the pane or the room behind it.
      gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, solid, this.mesh.count - solid);
      gl.depthMask(true);
    }
  }
}
