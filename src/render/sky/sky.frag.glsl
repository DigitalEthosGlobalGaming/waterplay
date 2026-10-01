// Sky dome: gradient + sun disc + moon + stars. skyGradient() comes from sky-common.glsl.
uniform vec3 uSunDisc;
uniform float uSunDiscSize;
uniform float uNight;
uniform float uStarDensity;

varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyGradient(dir);

  float s = dot(dir, uSunDir);
  float sunEdge = cos(uSunDiscSize);
  col += uSunDisc * smoothstep(sunEdge - 0.0004, sunEdge + 0.0004, s);

  // Moon opposite the sun.
  float m = dot(dir, -uSunDir);
  float moonEdge = cos(uSunDiscSize * 0.8);
  col = mix(col, vec3(0.92, 0.94, 1.0), uNight * smoothstep(moonEdge - 0.0004, moonEdge + 0.0004, m));

  // Stars: one soft point per sky cell, only well above the horizon at night.
  vec3 d = dir * 180.0;
  vec3 cell = floor(d);
  float h = hash13(cell);
  float star = step(1.0 - 0.012 * uStarDensity, h);
  float r = length(fract(d) - 0.5);
  float twinkle = 0.6 + 0.4 * hash13(cell + 7.0);
  col += vec3(star * smoothstep(0.32, 0.0, r) * twinkle * uNight * smoothstep(0.05, 0.3, dir.y));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
