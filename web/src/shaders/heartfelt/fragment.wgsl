// Heartfelt - by Martijn Steinrucken aka BigWings - 2017
// https://www.shadertoy.com/view/ltffzl
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
// This WGSL port is shared under the same license.
//
// Ported from GLSL to WGSL for this project (see README "Original shaders"):
//  - mainImage → fn heartfelt(...) -> vec4f, plain function for three.js' wgslFn:
//    the main function comes first, the helper functions follow below
//  - Shadertoy inputs come in as parameters (fragCoord, iTime, iMouse, iResolution,
//    iChannel0 + iChannel0Sampler); iChannel0 is the rendered scene behind the window glass
//  - textureLod(iChannel0, UV + n, focus) samples the scene behind the glass in screen space:
//    n is mapped from glass space to the screen with screenU / screenV
//  - the automatic rain (sin(T*.05)*.3+.7) is replaced by the live weather (weatherRain);
//    dragging on the window is iMouse, exactly like on Shadertoy
//  - fog scales the blur so a dry window is clear; storm gates the lightning
//  - #define S(a, b, t) → fn S(); HAS_HEART (story mode), the zoom animation and the
//    vignette are not used (USE_POST_PROCESSING keeps the colour shift and lightning)

fn heartfelt(
  fragCoord: vec2f,
  iTime: f32,
  iMouse: vec4f,
  iResolution: vec2f,
  iChannel0: texture_2d<f32>,
  iChannel0Sampler: sampler,
  screenUV: vec2f,
  screenU: vec2f,
  screenV: vec2f,
  weatherRain: f32,
  fog: f32,
  storm: f32
) -> vec4f {
  var uv = (fragCoord - 0.5 * iResolution) / iResolution.y;
  let M = vec3f(iMouse.xy / iResolution, iMouse.z);
  let T = iTime + M.x * 2.0;

  var t = T * 0.2;

  let rainAmount = select(weatherRain, M.y, iMouse.z > 0.0);

  let maxBlur = mix(3.0, 6.0, rainAmount);
  let minBlur = 2.0;

  // original: zoom = -cos(T*.2) slowly zooms the camera in and out; frozen at 1.0 for a window
  let zoom = 1.0;
  uv *= 0.7 + zoom * 0.3;

  let staticDrops = S(-0.5, 1.0, rainAmount) * 2.0;
  let layer1 = S(0.25, 0.75, rainAmount);
  let layer2 = S(0.0, 0.5, rainAmount);

  let c = Drops(uv, t, staticDrops, layer1, layer2);
  // expensive normals
  let e = vec2f(0.001, 0.0);
  let cx = Drops(uv + e, t, staticDrops, layer1, layer2).x;
  let cy = Drops(uv + e.yx, t, staticDrops, layer1, layer2).x;
  let n = vec2f(cx - c.x, cy - c.x);

  let focus = mix(maxBlur - c.y, minBlur, S(0.1, 0.2, c.x));
  // GLSL: texture(iChannel0, UV + n, focus) — here the scene behind the glass, in screen space
  let sampleUV = screenUV + screenU * n.x + screenV * n.y;
  var col = textureSampleLevel(iChannel0, iChannel0Sampler, sampleUV, focus * fog).rgb;

  // USE_POST_PROCESSING
  t = (T + 3.0) * 0.5;                                      // make time sync with first lightning
  let colFade = sin(t * 0.2) * 0.5 + 0.5;                   // + story (0 without HAS_HEART)
  col *= mix(vec3f(1.0), vec3f(0.8, 0.9, 1.3), colFade * fog); // subtle color shift (scaled by fog)
  let fade = S(0.0, 10.0, T);                               // fade in at the start
  var lightning = sin(t * sin(t * 10.0));                   // lighting flicker
  lightning *= pow(max(0.0, sin(t + sin(t))), 10.0);        // lightning flash
  col *= 1.0 + lightning * fade * storm;                    // composite lightning (storms only)

  return vec4f(col, 1.0);
}

// #define S(a, b, t) smoothstep(a, b, t) — written out, because Heartfelt often calls it with
// reversed edges (a > b), which WGSL's smoothstep doesn't promise to support
fn S(a: f32, b: f32, t: f32) -> f32 {
  let x = clamp((t - a) / (b - a), 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

fn N13(p: f32) -> vec3f {
  //  from DAVE HOSKINS
  var p3 = fract(vec3f(p) * vec3f(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec3f((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
}

fn N(t: f32) -> f32 {
  return fract(sin(t * 12345.564) * 7658.76);
}

fn Saw(b: f32, t: f32) -> f32 {
  return S(0.0, b, t) * S(1.0, b, t);
}

fn DropLayer2(uvIn: vec2f, t: f32) -> vec2f {
  let UV = uvIn;
  var uv = uvIn;

  uv.y += t * 0.75;
  let a = vec2f(6.0, 1.0);
  let grid = a * 2.0;
  var id = floor(uv * grid);

  let colShift = N(id.x);
  uv.y += colShift;

  id = floor(uv * grid);
  let n = N13(id.x * 35.2 + id.y * 2376.1);
  let st = fract(uv * grid) - vec2f(0.5, 0.0);

  var x = n.x - 0.5;

  var y = UV.y * 20.0;
  let wiggle = sin(y + sin(y));
  x += wiggle * (0.5 - abs(x)) * (n.z - 0.5);
  x *= 0.7;
  let ti = fract(t + n.z);
  y = (Saw(0.85, ti) - 0.5) * 0.9 + 0.5;
  let p = vec2f(x, y);

  let d = length((st - p) * a.yx);

  let mainDrop = S(0.4, 0.0, d);

  let r = sqrt(S(1.0, y, st.y));
  let cd = abs(st.x - x);
  var trail = S(0.23 * r, 0.15 * r * r, cd);
  let trailFront = S(-0.02, 0.02, st.y - y);
  trail *= trailFront * r * r;

  y = UV.y;
  let trail2 = S(0.2 * r, 0.0, cd);
  var droplets = max(0.0, (sin(y * (1.0 - y) * 120.0) - st.y)) * trail2 * trailFront * n.z;
  y = fract(y * 10.0) + (st.y - 0.5);
  let dd = length(st - vec2f(x, y));
  droplets = S(0.3, 0.0, dd);
  let m = mainDrop + droplets * r * trailFront;

  return vec2f(m, trail);
}

fn StaticDrops(uvIn: vec2f, t: f32) -> f32 {
  var uv = uvIn * 40.0;

  let id = floor(uv);
  uv = fract(uv) - 0.5;
  let n = N13(id.x * 107.45 + id.y * 3543.654);
  let p = (n.xy - 0.5) * 0.7;
  let d = length(uv - p);

  let fade = Saw(0.025, fract(t + n.z));
  let c = S(0.3, 0.0, d) * fract(n.z * 10.0) * fade;
  return c;
}

fn Drops(uv: vec2f, t: f32, l0: f32, l1: f32, l2: f32) -> vec2f {
  let s = StaticDrops(uv, t) * l0;
  let m1 = DropLayer2(uv, t) * l1;
  let m2 = DropLayer2(uv * 1.85, t) * l2;

  var c = s + m1.x + m2.x;
  c = S(0.3, 1.0, c);

  return vec2f(c, max(m1.y * l0, m2.y * l1));
}
