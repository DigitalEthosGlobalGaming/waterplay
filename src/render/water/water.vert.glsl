// Shared water function, GLSL half (§6.1). MUST match src/core/water/gerstner.ts:
//   theta_i = k_i * dot(dir_i, p0) - phase_i
//   offset  = sum dir_i * horiz_i * cos(theta_i)   (xz)
//   height  = sum amplitude_i * sin(theta_i)
// Constants and phases come from waveConstants()/wavePhases() on the CPU.
// The jitter below only moves WHERE the surface is sampled; every vertex still
// lies exactly on the shared surface.

#define MAX_WAVES 6
// Same cap as MAX_WAKE_EMITTERS in src/core/water/wakes.ts.
#define MAX_WAKES 256

uniform vec4 uWaveA[MAX_WAVES]; // dirX, dirZ, k, phase
uniform vec2 uWaveB[MAX_WAVES]; // amplitude, horiz
uniform int uWaveCount;
uniform vec2 uCentre;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uCell;
uniform float uJitter;
uniform float uJitterRadius;

// Boat wakes (§6.2). One texel per emitter: x, z, age (s), amplitude.
uniform sampler2D uWakeTex;
uniform int uWakeCount;
uniform vec4 uWakeParams; // ringSpeed, width, lifetime, fadeIn
uniform float uWakeSpread;

varying vec3 vWorldPos;
varying float vHeight;
/** Jacobian of the horizontal displacement: < 1 where crests pinch together (foam). */
varying float vFold;
/** Wake height here, for wake foam. */
varying float vWake;

#include <common>
#include <fog_pars_vertex>

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// One wake ring. MUST match wakeRingHeight() in src/core/water/wakes.ts.
float wakeHeight(float d, float age, float amplitude) {
  float lifetime = uWakeParams.z;
  if (age <= 0.0 || age >= lifetime) return 0.0;
  float r = uWakeParams.x * age;
  float s = (d - r) / uWakeParams.y;
  if (abs(s) > 4.0) return 0.0;
  float life = 1.0 - age / lifetime;
  float env = life * life * smoothstep(0.0, uWakeParams.w, age) / sqrt(1.0 + r / uWakeSpread);
  float s2 = s * s;
  return amplitude * env * (1.0 - s2) * exp(-0.5 * s2);
}

float wakeSum(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < MAX_WAKES; i++) {
    if (i >= uWakeCount) break;
    vec4 w = texelFetch(uWakeTex, ivec2(i, 0), 0);
    h += wakeHeight(length(p - w.xy), w.z, w.w);
  }
  return h;
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 p0 = world.xz;
  float centreDist = length(p0 - uCentre);

  // Stable per-vertex jitter keyed on the world grid point, so it never swims as the mesh follows the camera.
  vec2 key = floor(p0 / uCell + 0.5);
  vec2 jitter = vec2(hash12(key), hash12(key + 17.31)) - 0.5;
  p0 += jitter * uJitter * uCell * (1.0 - smoothstep(uJitterRadius * 0.8, uJitterRadius, centreDist));

  vec3 offset = vec3(0.0);
  float jxx = 1.0;
  float jzz = 1.0;
  float jxz = 0.0;
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= uWaveCount) break;
    vec4 a = uWaveA[i];
    vec2 b = uWaveB[i];
    float theta = a.z * dot(a.xy, p0) - a.w;
    float c = cos(theta);
    float s = sin(theta);
    offset.x += a.x * b.y * c;
    offset.z += a.y * b.y * c;
    offset.y += b.x * s;
    float pinch = b.y * a.z * s;
    jxx -= pinch * a.x * a.x;
    jzz -= pinch * a.y * a.y;
    jxz -= pinch * a.x * a.y;
  }

  // Render-only: waves flatten toward the edge of the mesh so it meets the horizon cleanly.
  float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, centreDist);
  offset *= fade;

  world.x = p0.x + offset.x;
  world.z = p0.y + offset.z;
  // Wakes are purely vertical, evaluated where the vertex ends up (as buoyancy samples them).
  float wake = wakeSum(world.xz);
  world.y = offset.y + wake;
  vWorldPos = world.xyz;
  vHeight = offset.y;
  vWake = wake;
  vFold = mix(1.0, jxx * jzz - jxz * jxz, fade);

  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
