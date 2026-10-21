// Simple Water Ripple Effect - by Polygon - 2020
// https://www.shadertoy.com/view/wdtyDH  (the "Image" pass)
// License: Shadertoy's default, Creative Commons Attribution-NonCommercial-ShareAlike 3.0.
// This WGSL port is shared under the same license.
//
// Ported from GLSL to WGSL for the coffee in the mug (see web/src/scene/coffee.ts):
//  - mainImage → fn ripple(...) -> vec4f for three.js' wgslFn
//  - iChannel0 = Buffer A (the ripple heights), iChannel1 = the coffee and crema texture;
//    texture(...) → textureSample(...) with each texture's sampler passed in
//  - fragCoord comes from the coffee disc's uv, in the buffer's top-left pixel space
//  - `strength` scales the refraction and the slope used for the glint. The original bends a
//    full-screen image by 0.2 × slope (several pixels on screen); the cup is only a few dozen
//    pixels wide, so with strength 1 the ripples would move the coffee by less than a pixel.
//    The glint exponent is softened (60 → 24) for the same reason.

fn ripple(fragCoord: vec2f, iResolution: vec2f, iChannel0: texture_2d<f32>, iChannel0Sampler: sampler, iChannel1: texture_2d<f32>, iChannel1Sampler: sampler, strength: f32) -> vec4f {
  // Normalized pixel coordinates (from 0 to 1)
  let uv = fragCoord / iResolution;

  let data = textureSample(iChannel0, iChannel0Sampler, uv);

  // Color = texture
  var fragColor = textureSample(iChannel1, iChannel1Sampler, uv + 0.2 * strength * data.zw);

  // Sunlight glint
  let normal = normalize(vec3f(-data.z * strength, 0.2, -data.w * strength));
  fragColor += vec4f(1.0) * pow(max(0.0, dot(normal, normalize(vec3f(-3.0, 10.0, 3.0)))), 24.0);
  return fragColor;
}
