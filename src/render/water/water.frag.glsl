// Low-poly water look (§6.3). skyGradient() comes from render/sky/sky-common.glsl.

uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
/** Direction toward the sun (day) or moon (night), and its colour × intensity. */
uniform vec3 uLightDir;
uniform vec3 uLightColour;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform float uDiffuse;
uniform float uAmplitude;
uniform float uFoamStart;
uniform float uFoamEnd;
uniform float uFresnel;
uniform float uReflection;
uniform float uSpecular;
uniform float uShininess;
uniform float uScatter;
uniform float uNormalFadeStart;
uniform float uNormalFadeEnd;

varying vec3 vWorldPos;
varying float vHeight;
varying float vFold;

#include <common>
#include <fog_pars_fragment>

void main() {
  // Face normal from screen-space derivatives: one flat facet per triangle.
  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  if (n.y < 0.0) n = -n;
  vec3 toCamera = cameraPosition - vWorldPos;
  float dist = length(toCamera);
  vec3 v = toCamera / dist;
  // Far facets are smaller than a pixel; calm them toward flat to stop shimmer.
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(uNormalFadeStart, uNormalFadeEnd, dist)));

  float h = clamp(vHeight / max(uAmplitude, 1e-3) * 0.5 + 0.5, 0.0, 1.0);
  vec3 albedo = mix(uDeep, uShallow, h * h);

  vec3 ambient = mix(uAmbientGround, uAmbientSky, n.y * 0.5 + 0.5);
  float ndl = max(dot(n, uLightDir), 0.0);
  vec3 lit = ambient + uLightColour * ndl * uDiffuse;
  vec3 col = albedo * lit;

  // Light shining through thin crests when looking toward the sun.
  float backlit = pow(max(dot(-v, uLightDir), 0.0), 4.0) * h;
  col += uShallow * uLightColour * backlit * uScatter;

  // Sky reflection (Schlick fresnel), using the same gradient as the sky dome.
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  float fresnel = uFresnel + (1.0 - uFresnel) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  col = mix(col, skyGradient(r), clamp(fresnel * uReflection, 0.0, 1.0));

  // Sun (or moon) glints: sharp per-facet sparkles.
  float glint = pow(max(dot(reflect(-uLightDir, n), v), 0.0), uShininess);
  col += uLightColour * glint * uSpecular;

  // Foam where crests pinch together. Lit, so it dims at night.
  float foam = 1.0 - smoothstep(uFoamStart, uFoamEnd, vFold);
  col = mix(col, uFoam * lit, foam);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
