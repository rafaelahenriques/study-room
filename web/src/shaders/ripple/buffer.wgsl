// Simple Water Ripple Effect - by Polygon - 2020
// https://www.shadertoy.com/view/wdtyDH  (the "Buffer A" pass)
// License: Shadertoy's default, Creative Commons Attribution-NonCommercial-ShareAlike 3.0.
// This WGSL port is shared under the same license.
//
// Ported from GLSL to WGSL for the coffee in the mug (see web/src/scene/coffee.ts):
//  - mainImage → fn rippleBuffer(...) -> vec4f for three.js' wgslFn; Buffer A reads its own
//    previous frame as iChannel0, so the website keeps two render targets and swaps them
//  - texelFetch(iChannel0, ivec2(fragCoord), 0) → textureLoad(...), with the coordinates
//    clamped to the texture (WGSL doesn't define reads outside it)
//  - fragCoord is the pixel position (@builtin(position)), which starts at the top left in
//    WebGPU, like the texture rows: reads and writes line up, nothing to flip
//  - the edge tests `fragCoord.x == 0.5` become `< 1.0` / `> size - 1.0` (no float equality)
//  - iMouse.xy is in the same top-left pixel space; z > 1 while the coffee is being touched

fn rippleBuffer(fragCoord: vec2f, iResolution: vec2f, iMouse: vec4f, iFrame: f32, iChannel0: texture_2d<f32>) -> vec4f {
  // Make this a smaller number for a smaller timestep.
  // Don't make it bigger than 1.4 or the universe will explode.
  let delta = 1.0;

  if (iFrame < 0.5) {
    return vec4f(0.0);
  }

  let size = vec2i(iResolution);
  let p = vec2i(fragCoord);
  let here = texel(iChannel0, p, size);
  var pressure = here.x;
  var pVel = here.y;

  var p_right = texel(iChannel0, p + vec2i(1, 0), size).x;
  var p_left = texel(iChannel0, p + vec2i(-1, 0), size).x;
  var p_up = texel(iChannel0, p + vec2i(0, 1), size).x;
  var p_down = texel(iChannel0, p + vec2i(0, -1), size).x;

  // Change values so the screen boundaries aren't fixed.
  if (fragCoord.x < 1.0) { p_left = p_right; }
  if (fragCoord.x > iResolution.x - 1.0) { p_right = p_left; }
  if (fragCoord.y < 1.0) { p_down = p_up; }
  if (fragCoord.y > iResolution.y - 1.0) { p_up = p_down; }

  // Apply horizontal wave function
  pVel += delta * (-2.0 * pressure + p_right + p_left) / 4.0;
  // Apply vertical wave function (these could just as easily have been one line)
  pVel += delta * (-2.0 * pressure + p_up + p_down) / 4.0;

  // Change pressure by pressure velocity
  pressure += delta * pVel;

  // "Spring" motion. This makes the waves look more like water waves and less like sound waves.
  pVel -= 0.005 * delta * pressure;

  // Velocity damping so things eventually calm down
  pVel *= 1.0 - 0.002 * delta;

  // Pressure damping to prevent it from building up forever.
  pressure *= 0.999;

  // x = pressure. y = pressure velocity. Z and W = X and Y gradient
  var fragColor = vec4f(pressure, pVel, (p_right - p_left) / 2.0, (p_up - p_down) / 2.0);

  if (iMouse.z > 1.0) {
    let dist = distance(fragCoord, iMouse.xy);
    if (dist <= 20.0) {
      fragColor.x += 1.0 - dist / 20.0;
    }
  }
  return fragColor;
}

// texelFetch with the coordinates kept inside the texture
fn texel(tex: texture_2d<f32>, p: vec2i, size: vec2i) -> vec4f {
  return textureLoad(tex, clamp(p, vec2i(0), size - vec2i(1)), 0);
}
