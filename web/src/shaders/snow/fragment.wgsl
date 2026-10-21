// https://www.shadertoy.com/view/Mdt3Df
// "I started playing around with some other things and then I looked out the window
//  and felt inspired :)"
// License: Shadertoy's default, Creative Commons Attribution-NonCommercial-ShareAlike 3.0.
// This WGSL port is shared under the same license.
//
// Ported from GLSL to WGSL for this project (see README "Original shaders"):
//  - mainImage → fn snowfall(...) -> vec4f, plain function for three.js' wgslFn
//  - `amount` (0–1 snow intensity) skips all the work while it isn't snowing, and scales the
//    share of cells that hold a flake (the original's fixed 8 %: 2–8 %)
//  - the inner loop starts at i = 1: in the original, i = 0 divides by zero
//    (5.0/float(i), 1.0/float(i)) and never produces a flake
//  - the original's blue gradient and grain are dropped: the result is composited
//    over the sky outside the window (see outside.ts)

fn snowfall(fragCoord: vec2f, iTime: f32, iResolution: vec2f, amount: f32) -> vec4f {
  if (amount <= 0.001) {
    return vec4f(0.0);
  }

  var snow = 0.0;
  for (var k = 0; k < 6; k++) {
    for (var i = 1; i < 12; i++) {
      let kf = f32(k);
      let fi = f32(i);
      let cellSize = 2.0 + (fi * 3.0);
      let downSpeed = 0.3 + (sin(iTime * 0.4 + f32(k + i * 20)) + 1.0) * 0.00008;
      let uv = (fragCoord / iResolution.x) + vec2f(
        0.01 * sin((iTime + f32(k * 6185)) * 0.6 + fi) * (5.0 / fi),
        downSpeed * (iTime + f32(k * 1352)) * (1.0 / fi)
      );
      let uvStep = ceil(uv * cellSize - vec2f(0.5, 0.5)) / cellSize;
      let x = fract(sin(dot(uvStep, vec2f(12.9898 + kf * 12.0, 78.233 + kf * 315.156))) * 43758.5453 + kf * 12.0) - 0.5;
      let y = fract(sin(dot(uvStep, vec2f(62.2364 + kf * 23.0, 94.674 + kf * 95.0))) * 62159.8432 + kf * 12.0) - 0.5;

      let randomMagnitude1 = sin(iTime * 2.5) * 0.7 / cellSize;
      let randomMagnitude2 = cos(iTime * 2.5) * 0.7 / cellSize;

      let d = 5.0 * distance((uvStep + vec2f(x * sin(y), y) * randomMagnitude1 + vec2f(y, x) * randomMagnitude2), uv);

      let omiVal = fract(sin(dot(uvStep, vec2f(32.4691, 94.615))) * 31572.1684);
      if (omiVal < 0.08 * (0.25 + 0.75 * amount)) {
        let newd = (x + 1.0) * 0.4 * clamp(1.9 - d * (15.0 + (x * 6.3)) * (cellSize / 1.4), 0.0, 1.0);
        snow += newd;
      }
    }
  }

  return vec4f(vec3f(snow), 1.0);
}
