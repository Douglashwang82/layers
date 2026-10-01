import * as THREE from "three";
import { petShape, type PetShape } from "./pet-shape";

export { petShape, type PetShape } from "./pet-shape";

// Front view in reference-v2.jpg: the pin is 225.5 px tall from tip to crown.
const PX = 2.52 / 225.5;

const HEIGHT = 2.52;
const RINGS = 200,
  SEGMENTS = 192;
const smooth = THREE.MathUtils.smoothstep;

// The traced outline carries half-pixel noise that shows up as bands of
// light, so the closed silhouette (mirrored across the axis, which keeps the
// tip and crown round) gets a Gaussian low-pass of about 5 reference px.
const profile = (() => {
  const n = RINGS * 2;
  const half = new THREE.CatmullRomCurve3(
    petShape.outline.map(([h, r]) => new THREE.Vector3(r * PX, h * PX, 0)),
    false,
    "centripetal",
  ).getSpacedPoints(n);
  const loop = [
    ...half,
    ...half
      .slice(1, -1)
      .reverse()
      .map((p) => new THREE.Vector3(-p.x, p.y, 0)),
  ];
  const sigma = 7,
    reach = sigma * 3;
  const weights = Array.from({ length: reach * 2 + 1 }, (_, i) =>
    Math.exp(-((i - reach) ** 2) / (2 * sigma * sigma)),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i += 2) {
    const p = new THREE.Vector3();
    weights.forEach((w, k) =>
      p.addScaledVector(
        loop[(i + k - reach + loop.length) % loop.length],
        w / total,
      ),
    );
    points.push(p);
  }
  // Smoothing lifts the end points off the poles; rescale so the ends land
  // exactly on the tip and crown, or the pole vertices leave a tiny spike.
  const low = points[0].y,
    high = points[points.length - 1].y;
  for (const p of points) p.y = ((p.y - low) / (high - low)) * HEIGHT;
  points[0].x = points[points.length - 1].x = 0;
  return points;
})();

function radiusAt(y: number) {
  const i = Math.min(
    profile.length - 1,
    Math.max(
      1,
      profile.findIndex((p) => p.y >= y),
    ),
  );
  const a = profile[i - 1],
    b = profile[i];
  return THREE.MathUtils.lerp(
    a.x,
    b.x,
    THREE.MathUtils.clamp((y - a.y) / (b.y - a.y || 1), 0, 1),
  );
}

/** Forward offset of each cross-section's center; zero at tip and crown. */
function centerZ(y: number, s: PetShape) {
  const h = THREE.MathUtils.clamp(y / HEIGHT, 0, 1);
  return s.lean * Math.pow(Math.sin(Math.PI * h), 1.1);
}

/** The nub stays round; the body above it is deeper than it is wide. */
function depthAt(y: number, s: PetShape) {
  return 1 + (s.depth - 1) * smooth(y / HEIGHT, 0, 0.25);
}

/**
 * Superellipse exponent of the front half of each cross-section: above 2 the
 * front is broader and flatter, so the face sits on a gentle plane and the
 * body's front corners wrap past it in 3/4 view, as in V2. Only the face band
 * is broadened: the lower body, nub and crown stay round like V2's, and a flat
 * front there reads as a dark crease down the belly.
 */
function squarenessAt(y: number, s: PetShape) {
  const h = y / HEIGHT;
  return (
    2 + (s.squareness - 2) * smooth(h, 0.16, 0.34) * (1 - smooth(h, 0.8, 0.96))
  );
}

function faceDistance(x: number, y: number, s: PetShape) {
  const { y: cy, halfWidth, halfHeight } = s.face;
  const v = (y - cy) / (halfHeight * 1.08);
  // The reference is a full cheek with a tapered forehead and a soft, flat chin.
  const u =
    x / (halfWidth * 1.08 * (1 - 0.18 * THREE.MathUtils.clamp(v, -1, 1)));
  const n = 2 + 0.3 * smooth(-v, 0, 0.8);
  return (Math.abs(u) ** n + Math.abs(v) ** n) ** (1 / n);
}

function inset(x: number, y: number, s: PetShape) {
  const d = faceDistance(x, y, s),
    { inset, rim } = s.face;
  return (
    -inset * (1 - smooth(d, 0.9, 1.01)) +
    rim * Math.exp(-(((d - 1.03) / 0.035) ** 2))
  );
}

/** Front skin surface depth at a front-view point, including the face recess. */
export function frontZ(x: number, y: number, s: PetShape = petShape) {
  const a = radiusAt(y),
    n = squarenessAt(y, s);
  return (
    centerZ(y, s) +
    depthAt(y, s) * a * Math.pow(Math.max(0, 1 - Math.abs(x / a) ** n), 1 / n) +
    inset(x, y, s)
  );
}

function bodyGeometry(shape: PetShape) {
  const positions: number[] = [0, 0, 0],
    indices: number[] = [];
  for (let r = 1; r < RINGS; r++) {
    const { x: a, y } = profile[r];
    const b = a * depthAt(y, shape),
      zc = centerZ(y, shape),
      power = 2 / squarenessAt(y, shape);
    for (let s = 0; s < SEGMENTS; s++) {
      const angle = (s / SEGMENTS) * Math.PI * 2;
      const side = Math.cos(angle),
        front = Math.sin(angle);
      // Superellipse on the front half (|x/a|^n + |z/b|^n = 1), ellipse behind.
      const x =
        front > 0 ? a * Math.sign(side) * Math.abs(side) ** power : a * side;
      let z = zc + b * (front > 0 ? front ** power : front);
      if (front > 0) z += inset(x, y, shape) * smooth(front, 0.1, 0.4);
      positions.push(x, y, z);
    }
  }
  positions.push(0, HEIGHT, centerZ(HEIGHT, shape));
  const ring = (r: number, s: number) =>
    1 + (r - 1) * SEGMENTS + (s % SEGMENTS);
  const top = positions.length / 3 - 1;
  for (let s = 0; s < SEGMENTS; s++) {
    indices.push(0, ring(1, s), ring(1, s + 1));
    for (let r = 1; r < RINGS - 1; r++) {
      const a = ring(r, s),
        next = ring(r, s + 1),
        up = ring(r + 1, s),
        upNext = ring(r + 1, s + 1);
      indices.push(a, up, next, next, up, upNext);
    }
    indices.push(ring(RINGS - 1, s), top, ring(RINGS - 1, s + 1));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Curious squish compresses only above the face's top edge (softplus ramp,
// softness 0.2); the rest term zeroes the ramp at the tip. Passed as a uniform
// (crown start, rest, face height) because every shape shares one program.
function squishFrame(s: PetShape) {
  const from = s.face.y + s.face.halfHeight;
  return new THREE.Vector3(
    from,
    0.5 * (-from + Math.hypot(from, 0.2)),
    s.face.y,
  );
}

// One contour drives both the skin recess and its painted face. Pose-specific
// shear restores V2's oblique oval instead of rotating a rounded triangle.
const faceContourGLSL = /* glsl */ `
uniform vec4 uFace;
uniform vec2 uFaceRelief;
vec4 petFaceForm() {
  vec4 form = mix(vec4(1.08, 1.08, 0.0, 0.18),
                  vec4(1.10, 0.94, 0.25, 0.04), uCurious);
  return mix(form, vec4(1.02, 1.02, 0.16, 0.06), uHappy);
}
vec2 petFaceQ(vec3 p, vec4 form) {
  float dy = p.y - uFace.x;
  float v = dy / (uFace.z * form.y);
  return vec2((p.x - form.z * dy) /
    (uFace.y * form.x * (1.0 - form.w * clamp(v, -1.0, 1.0))), v);
}
float petFaceD(vec2 q) {
  float n = 2.0 + 0.3 * smoothstep(0.0, 0.8, -q.y);
  return pow(pow(abs(q.x), n) + pow(abs(q.y), n), 1.0 / n);
}
float petFaceInset(float d) {
  return -uFaceRelief.x * (1.0 - smoothstep(0.9, 1.01, d))
    + uFaceRelief.y * exp(-pow((d - 1.03) / 0.035, 2.0));
}
`;

// Liquid motion runs on the GPU in root space, so the face, eyes and skin move
// together and the tip (y = 0) never leaves its map coordinate.
const flowGLSL = /* glsl */ `
uniform float uTime;
uniform float uFlow;
uniform float uJiggle;
uniform float uLean;
uniform vec3 uAmp;
uniform mat4 uRoot;
vec3 petFlow(vec3 p) {
  float h = clamp(p.y / ${HEIGHT.toFixed(2)}, 0.0, 1.0);
  float w = smoothstep(0.05, 0.65, h);
  float zc = uLean * pow(sin(3.14159265 * h), 1.1);
  vec2 axis = vec2(p.x, p.z - zc);
  float stretch = uAmp.x * sin(uTime * 1.7) * uFlow + uJiggle;
  p.y *= 1.0 + stretch * w;
  axis *= 1.0 - 0.5 * stretch * w;
  float ang = atan(axis.y, axis.x);
  float ripple = 0.6 * sin(2.0 * ang + 7.0 * h - 2.2 * uTime)
    + 0.4 * sin(3.0 * ang - 5.0 * h + 1.5 * uTime + 1.7);
  axis += normalize(axis + vec2(1e-5)) * ripple * uAmp.z * uFlow * w;
  float lag = w * w * uFlow * uAmp.y;
  axis.x += lag * sin(uTime * 1.1);
  axis.y += lag * 0.6 * sin(uTime * 0.8 + 1.3);
  return vec3(axis.x, p.y, axis.y + zc);
}
// Curious squish: the drop settles under its own weight. Every step scales
// or bends about the tip, so the map anchor (origin) never moves.
uniform float uSquish;
uniform vec4 uSquishShape; // compress, bulge, blunt, shear
uniform vec2 uSquishTilt; // forward lean, side tilt (radians)
uniform vec3 uSquishFrame; // crown start, crown rest, face height
uniform float uCurious;
uniform float uHappy;
#ifdef PET_FACE
${faceContourGLSL}
#endif
// Turn the face and its inset together, including the eyes and catchlights.
// Fade into the back and the anchored tip rather than rotating a floating plate.
vec3 petCurious(vec3 p) {
  float h = clamp(p.y / 2.52, 0.0, 1.0);
  float zc = uLean * pow(sin(3.14159265 * h), 1.1);
  float front = smoothstep(-0.25, 0.8, p.z - zc);
  float angle = (uCurious * 0.34 + uHappy * 0.18) * front * smoothstep(0.0, 0.58, h);
  vec2 face = vec2(p.x, p.y - uSquishFrame.z);
  p.xy = vec2(face.x * cos(angle) - face.y * sin(angle),
              face.x * sin(angle) + face.y * cos(angle));
  p.y += uSquishFrame.z;
  // Hero silhouette: full shoulders, a left-offset crown, and a right belly.
  // Both offsets vanish at the tip so the geographic anchor stays fixed.
  p.x *= 1.0 + 0.10 * uCurious * (1.0 - front);
  float bellySide = smoothstep(-0.4, 0.4, p.x) * (1.0 - front);
  p.x += uCurious * (0.08 * sin(3.14159265 * h) * bellySide - 0.24 * pow(h, 8.0));
  return p;
}
vec3 petSquish(vec3 p) {
  if (uSquish == 0.0) return p;
  float h = clamp(p.y / ${HEIGHT.toFixed(2)}, 0.0, 1.0);
  float zc = uLean * pow(sin(3.14159265 * h), 1.1);
  vec2 axis = vec2(p.x, p.z - zc);
  float belly = sin(3.14159265 * clamp(h * 1.1, 0.0, 1.0));
  float base = 1.0 - smoothstep(0.02, 0.32, h);
  axis *= 1.0 + uSquish * (uSquishShape.y * belly + uSquishShape.z * base);
  // The crown settles down onto the face (soft ramp from the face's top edge),
  // so the face plate keeps its V2 size and stays high on the body.
  float crown = p.y - uSquishFrame.x;
  float settle = 0.5 * (crown + sqrt(crown * crown + 0.04)) - uSquishFrame.y;
  p = vec3(axis.x, p.y - uSquish * uSquishShape.x * settle, axis.y + zc);
  // Shear around the face height so the face plate turns into an oblique oval.
  p.x += uSquish * uSquishShape.w * (p.y - uSquishFrame.z) * smoothstep(0.05, 0.35, h);
  // Bend: the base stays planted while the upper body leans.
  float bend = uSquish * smoothstep(0.0, 0.6, h);
  float a = bend * uSquishTilt.x, b = bend * uSquishTilt.y;
  p.yz = vec2(p.y * cos(a) - p.z * sin(a), p.y * sin(a) + p.z * cos(a));
  p.xy = vec2(p.x * cos(b) - p.y * sin(b), p.x * sin(b) + p.y * cos(b));
  return p;
}
vec3 petDeform(vec3 p) {
#ifdef PET_IN_ROOT
#ifdef PET_FACE
  if (p.z > uFace.w) {
    float rest = petFaceD(petFaceQ(p, vec4(1.08, 1.08, 0.0, 0.18)));
    float posed = petFaceD(petFaceQ(p, petFaceForm()));
    float poseBlend = max(uCurious, uHappy);
    float relief = mix(1.0, 0.65, poseBlend);
    float raisedLip = uFaceRelief.y * exp(-pow((posed - 1.03) / 0.035, 2.0));
    p.z += relief * (petFaceInset(posed) - 0.9 * poseBlend * raisedLip) - petFaceInset(rest);
  }
#endif
  return petSquish(petFlow(petCurious(p)));
#else
  mat4 toRoot = inverse(uRoot) * modelMatrix;
  vec4 r = toRoot * vec4(p, 1.0);
  r.xyz = petSquish(petFlow(petCurious(r.xyz)));
  return (inverse(toRoot) * r).xyz;
#endif
}
#ifdef PET_FACE
varying vec3 vRest;
#endif
`;

const normalGLSL = /* glsl */ `
vec3 restTangent = normalize(cross(normal, abs(normal.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
vec3 restBitangent = cross(normal, restTangent);
vec3 flowed = petDeform(position);
vec3 objectNormal = normalize(cross(
  petDeform(position + restTangent * 0.02) - flowed,
  petDeform(position + restBitangent * 0.02) - flowed));
`;

const faceGLSL = /* glsl */ `
#include <color_fragment>
vec2 faceQ = petFaceQ(vRest, petFaceForm());
float faceD = petFaceD(faceQ);
float faceAA = fwidth(faceD);
float faceMask = (1.0 - smoothstep(0.985 - faceAA, 0.985 + faceAA, faceD)) * step(uFace.w, vRest.z);
// V2's pad is a pinkish apricot that deepens toward its edge.
vec3 faceTone = mix(uFaceColor, uFaceEdge, smoothstep(0.45, 0.985, faceD));
diffuseColor.rgb = mix(diffuseColor.rgb, faceTone, faceMask);
// Painted occlusion for the recess (the scene casts no shadows): the skin
// shades the face just inside its edge, most on the side facing the upper-left
// key light, and a thin dark line marks where the skin folds into the face.
float faceSide = 0.45 + 0.55 * dot(normalize(faceQ + vec2(1e-5)), vec2(-0.85, 0.53));
float faceFront = step(uFace.w, vRest.z);
float lipShade = smoothstep(0.8, 0.985, faceD) * faceMask * max(faceSide, 0.15);
float crease = (1.0 - smoothstep(0.985, 1.02, faceD)) * (1.0 - faceMask) * faceFront;
diffuseColor.rgb *= 1.0 - uFaceShade.x * lipShade - uFaceShade.y * crease;
`;

// Satin skin as in V2: silhouette edges deepen toward a saturated coral (not a
// bright rim), and a faint inner light keeps the shadow side warm, not grey.
// Runs before lighting, so changing diffuseColor here shades the edge.
const jellyGLSL = /* glsl */ `
#include <emissivemap_fragment>
vec3 jellyView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
float jellyFacing = saturate(dot(normal, jellyView));
float skinEdge = pow(1.0 - jellyFacing, 2.0) * (1.0 - faceMask);
diffuseColor.rgb = mix(diffuseColor.rgb, uJellyRim, saturate(skinEdge * uJellyEdge));
totalEmissiveRadiance += (1.0 - faceMask) * uJellyCore * (1.0 - 0.6 * jellyFacing);
`;

type FlowUniforms = {
  uTime: THREE.IUniform<number>;
  uFlow: THREE.IUniform<number>;
  uJiggle: THREE.IUniform<number>;
  uLean: THREE.IUniform<number>;
  uAmp: THREE.IUniform<THREE.Vector3>;
  uRoot: THREE.IUniform<THREE.Matrix4>;
  uSquish: THREE.IUniform<number>;
  uCurious: THREE.IUniform<number>;
  uHappy: THREE.IUniform<number>;
  uSquishShape: THREE.IUniform<THREE.Vector4>;
  uSquishTilt: THREE.IUniform<THREE.Vector2>;
  uSquishFrame: THREE.IUniform<THREE.Vector3>;
};

function liquid<T extends THREE.Material>(
  material: T,
  uniforms: FlowUniforms,
  s: PetShape,
  options: { root?: boolean; face?: boolean } = {},
) {
  if (options.root) material.defines = { ...material.defines, PET_IN_ROOT: "" };
  if (options.face) material.defines = { ...material.defines, PET_FACE: "" };
  const { y, halfWidth, halfHeight, color } = s.face;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${flowGLSL}`)
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = petDeform(position);${options.face ? "\nvRest = position;" : ""}`,
      );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      normalGLSL,
    );
    if (options.face) {
      shader.uniforms.uFace = {
        value: new THREE.Vector4(y, halfWidth, halfHeight, centerZ(y, s)),
      };
      shader.uniforms.uFaceColor = { value: new THREE.Color(color) };
      shader.uniforms.uFaceEdge = { value: new THREE.Color(s.face.edgeColor) };
      shader.uniforms.uFaceRelief = {
        value: new THREE.Vector2(s.face.inset, s.face.rim),
      };
      shader.uniforms.uFaceShade = {
        value: new THREE.Vector2(s.face.shade, s.face.crease),
      };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\nvarying vec3 vRest;\nuniform float uCurious;\nuniform float uHappy;\nuniform vec3 uFaceColor;\nuniform vec3 uFaceEdge;\nuniform vec2 uFaceShade;\nuniform vec3 uJellyRim;\nuniform float uJellyEdge;\nuniform vec3 uJellyCore;\n${faceContourGLSL}`,
        )
        .replace("#include <color_fragment>", faceGLSL)
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.56, faceMask);",
        )
        .replace("#include <emissivemap_fragment>", jellyGLSL)
        .replace(
          "#include <lights_physical_fragment>",
          `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
material.clearcoat *= 1.0 - faceMask;
#endif
#ifdef USE_SHEEN
material.sheenColor *= 1.0 - faceMask;
#endif`,
        );
      shader.uniforms.uJellyRim = { value: new THREE.Color(s.jelly.rim) };
      shader.uniforms.uJellyEdge = { value: s.jelly.rimStrength * 2.5 };
      shader.uniforms.uJellyCore = {
        value: new THREE.Color(s.jelly.core).multiplyScalar(
          s.jelly.coreStrength,
        ),
      };
    }
  };
  material.customProgramCacheKey = () =>
    `pet-${options.root ? 1 : 0}${options.face ? 1 : 0}`;
  return material;
}

/** A happy-eye arc that is thickest at its crest and tapers to round ends. */
function smileGeometry(curve: THREE.Curve<THREE.Vector3>, s: PetShape) {
  const segments = 48,
    radial = 12,
    { thickness, taper } = s.smile;
  const tube = new THREE.TubeGeometry(curve, segments, thickness, radial);
  const position = tube.attributes.position,
    center = new THREE.Vector3(),
    point = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, center);
    const scale = taper + (1 - taper) * Math.pow(Math.sin(Math.PI * u), 0.6);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      point.fromBufferAttribute(position, k).sub(center).multiplyScalar(scale);
      position.setXYZ(
        k,
        center.x + point.x,
        center.y + point.y,
        center.z + point.z,
      );
    }
  }
  tube.computeVertexNormals();
  return {
    tube,
    cap: new THREE.SphereGeometry(thickness * taper, 12, 8),
    ends: [curve.getPointAt(0), curve.getPointAt(1)],
  };
}

export function createPetModel(s: PetShape = petShape) {
  const root = new THREE.Group();
  const uniforms: FlowUniforms = {
    uTime: { value: 0 },
    uFlow: { value: 0 },
    uJiggle: { value: 0 },
    uLean: { value: s.lean },
    uAmp: {
      value: new THREE.Vector3(s.flow.breathe, s.flow.sway, s.flow.ripple),
    },
    uRoot: { value: new THREE.Matrix4() },
    uSquish: { value: 0 },
    uCurious: { value: 0 },
    uHappy: { value: 0 },
    uSquishShape: {
      value: new THREE.Vector4(
        s.squish.compress,
        s.squish.bulge,
        s.squish.blunt,
        s.squish.shear,
      ),
    },
    uSquishTilt: {
      value: new THREE.Vector2(s.squish.lean, s.squish.tilt),
    },
    uSquishFrame: { value: squishFrame(s) },
  };
  root.add(
    new THREE.Mesh(
      bodyGeometry(s),
      liquid(
        new THREE.MeshPhysicalMaterial({
          color: s.skin,
          roughness: s.jelly.roughness,
          clearcoat: 0.12,
          clearcoatRoughness: s.jelly.clearcoatRoughness,
          sheen: 0.35,
          sheenColor: "#ffc9b2",
          sheenRoughness: 0.65,
        }),
        uniforms,
        s,
        { root: true, face: true },
      ),
    ),
  );
  const open = new THREE.Group(),
    closed = new THREE.Group();
  // Soft, low-specular eyes: the catchlight is the only bright spot, as in V2
  // (no streak reflections from the studio cards).
  const eyeMaterial = liquid(
    new THREE.MeshPhysicalMaterial({
      color: s.eyes.top,
      envMapIntensity: 0.03,
      roughness: 0.32,
      specularIntensity: 0.08,
    }),
    uniforms,
    s,
  );
  const rimMaterial = liquid(
    new THREE.MeshPhysicalMaterial({ color: s.eyes.rimColor, roughness: 0.5 }),
    uniforms,
    s,
  );
  const highlight = liquid(
    new THREE.MeshBasicMaterial({ color: "#fff8ee" }),
    uniforms,
    s,
  );
  const sphere = new THREE.SphereGeometry(1, 40, 32);
  const eyeColors: number[] = [];
  for (let i = 0; i < sphere.attributes.position.count; i++) {
    const color = new THREE.Color(s.eyes.top).lerp(
      new THREE.Color(s.eyes.bottom),
      smooth(-sphere.attributes.position.getY(i), 0.05, 1),
    );
    eyeColors.push(color.r, color.g, color.b);
  }
  sphere.setAttribute("color", new THREE.Float32BufferAttribute(eyeColors, 3));
  const globeMaterial = liquid(eyeMaterial.clone(), uniforms, s);
  globeMaterial.color.set("white");
  globeMaterial.vertexColors = true;
  const { eyes } = s;
  const glints: { glint: THREE.Mesh; globe: THREE.Mesh }[] = [];
  for (const x of [-eyes.x, eyes.x]) {
    const e = 0.01,
      y = eyes.y;
    const slopeX = (frontZ(x + e, y, s) - frontZ(x - e, y, s)) / (2 * e),
      slopeY = (frontZ(x, y + e, s) - frontZ(x, y - e, s)) / (2 * e);
    const eye = new THREE.Group();
    eye.position.set(x, y, frontZ(x, y, s) + 0.02);
    eye.rotation.set(Math.atan(slopeY), Math.atan(-slopeX), 0, "YXZ");
    const globe = new THREE.Mesh(sphere, globeMaterial);
    // Sized so the front-view projection matches the V2 eye.
    globe.scale.set(
      eyes.halfWidth / Math.cos(eye.rotation.y),
      eyes.halfHeight / Math.cos(eye.rotation.x),
      0.1,
    );
    eye.add(globe);
    // A light bevel just outside the iris, like V2's eye set into the face.
    const rim = new THREE.Mesh(sphere, rimMaterial);
    rim.scale.set(
      globe.scale.x + eyes.rimWidth,
      globe.scale.y + eyes.rimWidth,
      0.065,
    );
    // Set back so it never shares depth with the iris (no speckled seam).
    rim.position.z = -0.015;
    eye.add(rim);
    const glint = new THREE.Mesh(sphere, highlight);
    glint.scale.set(0.043, 0.057, 0.012);
    eye.add(glint);
    glints.push({ glint, globe });
    open.add(eye);
    const points = Array.from({ length: 25 }, (_, i) => {
      const t = (i / 24) * Math.PI;
      const px = x + Math.cos(t) * (x < 0 ? 0.15 : 0.12),
        py = y - 0.04 + Math.sin(t) * (x < 0 ? 0.13 : 0.12);
      return new THREE.Vector3(px, py, frontZ(px, py, s) + 0.03);
    });
    const arc = smileGeometry(new THREE.CatmullRomCurve3(points), s);
    closed.add(new THREE.Mesh(arc.tube, eyeMaterial));
    for (const end of arc.ends) {
      const cap = new THREE.Mesh(arc.cap, eyeMaterial);
      cap.position.copy(end);
      closed.add(cap);
    }
  }
  root.add(open, closed);
  closed.visible = false;
  return {
    root,
    expression(happy: boolean) {
      open.visible = !happy;
      closed.visible = happy;
      uniforms.uHappy.value = happy ? 1 : 0;
    },
    /** Art-directed perspective for the V2 hero's near and far eyes. */
    curious(amount: number) {
      const blend = THREE.MathUtils.clamp(amount, 0, 1);
      uniforms.uCurious.value = blend;
      open.children.forEach((eye, i) => {
        const near = i === 0;
        eye.scale.set(
          THREE.MathUtils.lerp(1, near ? 1.12 : 0.88, blend),
          THREE.MathUtils.lerp(1, near ? 1.06 : 0.94, blend),
          1,
        );
      });
    },
    /**
     * Seat each catchlight where the key light mirrors into the camera: the
     * point on the eye ellipsoid whose normal is the light/view half-vector.
     * Call after `flow`, which refreshes the world matrices.
     */
    aim(light: THREE.Vector3, view = new THREE.Vector3(0, 0, 1)) {
      const half = new THREE.Vector3(),
        normal = new THREE.Vector3(),
        local = new THREE.Quaternion(),
        z = new THREE.Vector3(0, 0, 1);
      for (const { glint, globe } of glints) {
        globe.getWorldQuaternion(local).invert();
        half
          .copy(light)
          .normalize()
          .add(view)
          .normalize()
          .applyQuaternion(local);
        const { x: a, y: b, z: c } = globe.scale;
        const reach = Math.hypot(a * half.x, b * half.y, c * half.z);
        let u = (a * half.x) / reach,
          v = (b * half.y) / reach;
        // Keep it inside the iris, as in V2, even when the eye turns away.
        const spread = Math.hypot(u, v);
        if (spread > 0.55) {
          u *= 0.55 / spread;
          v *= 0.55 / spread;
        }
        const w = Math.sqrt(Math.max(0, 1 - u * u - v * v));
        normal.set(u / a, v / b, w / c).normalize();
        glint.position
          .set(a * u, b * v, c * w)
          .addScaledVector(normal, glint.scale.z * 0.5);
        glint.quaternion.setFromUnitVectors(z, normal);
      }
    },
    /** time in seconds, flow 0..1 idle amount, jiggle a signed stretch impulse. */
    /** 0 = upright drop, 1 = settled curious squish (may overshoot). */
    squish(amount: number) {
      uniforms.uSquish.value = amount;
    },
    flow(time: number, flow: number, jiggle: number) {
      uniforms.uTime.value = time;
      uniforms.uFlow.value = flow;
      uniforms.uJiggle.value = jiggle;
      root.updateMatrixWorld();
      uniforms.uRoot.value.copy(root.matrixWorld);
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            materials.add(material);
        }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
