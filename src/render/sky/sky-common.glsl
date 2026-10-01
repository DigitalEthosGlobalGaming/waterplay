// Shared by the sky dome and the water reflection so the horizon always matches.
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
/** Sun colour × visibility; zero at night. */
uniform vec3 uSunGlow;

vec3 skyGradient(vec3 dir) {
  float e = dir.y;
  vec3 c = mix(uHorizon, uZenith, pow(clamp(e, 0.0, 1.0), 0.45));
  // Below the horizon (rarely seen past the water) stays horizon-coloured.
  c = mix(c, uHorizon * 0.9, smoothstep(0.0, -0.25, e));
  // Warm glow around the sun, wider near the horizon at dawn and dusk.
  float s = max(dot(dir, uSunDir), 0.0);
  c += uSunGlow * (0.18 * pow(s, 6.0) + 0.35 * pow(s, 48.0));
  return c;
}
