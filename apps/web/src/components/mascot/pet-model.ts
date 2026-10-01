import * as THREE from "three";

// Front view in reference-v2.jpg: the pin is 225.5 px tall from tip to crown.
const PX = 2.52 / 225.5;

/**
 * Tuning knobs. Lengths are model units (the pin is 2.52 tall) unless noted.
 * The origin is the geographic tip; all poses and motion keep it planted.
 */
export const petShape = {
  /** Front silhouette traced from V2: [height above tip, half-width] in reference px. */
  outline: [
    [0, 0],
    [1, 4.5],
    [5, 12.5],
    [9, 15.5],
    [13, 19.5],
    [17, 22],
    [21, 25],
    [25, 28],
    [29, 31],
    [33, 35],
    [37, 38],
    [41, 42],
    [45, 46],
    [49, 49.5],
    [53, 53],
    [57, 56.5],
    [61, 60],
    [65, 63],
    [69, 65.5],
    [73, 68],
    [77, 70.5],
    [81, 72],
    [85, 74],
    [89, 76],
    [93, 77],
    [97, 78.5],
    [101, 79.5],
    [105, 81],
    [109, 81],
    [113, 82],
    [117, 82.5],
    [121, 82.5],
    [125, 83],
    [129, 82.5],
    [133, 82.5],
    [137, 82],
    [141, 81.5],
    [145, 81],
    [149, 80.5],
    [153, 79.5],
    [157, 78.5],
    [161, 76.5],
    [165, 75.5],
    [169, 74],
    [173, 72],
    [177, 69.5],
    [181, 67.5],
    [185, 65.5],
    [189, 62.5],
    [193, 59.5],
    [197, 56.5],
    [201, 52.5],
    [205, 48],
    [209, 43.5],
    [213, 38],
    [217, 31],
    [221, 22],
    [223, 16],
    [224, 12],
    [225, 5.5],
    [225.5, 0],
  ] as [number, number][],
  /** Front-to-back thickness relative to the front silhouette width. */
  depth: 1.15,
  /** How far the belly bulges forward over the tip (V2 3/4 and hero views). */
  lean: 0.42,
  skin: "#f07c5c",
  face: {
    color: "#f9cbb1",
    y: 1.305,
    halfWidth: 0.594,
    halfHeight: 0.521,
    /** How far the face sits inside the skin, and the soft lip around it. */
    inset: 0.065,
    rim: 0.02,
    /** Painted occlusion: the lip shading the face edge, and the border crease. */
    shade: 0.32,
    crease: 0.3,
  },
  eyes: { x: 0.297, y: 1.294, halfWidth: 0.142, halfHeight: 0.224 },
  /** Glossy jelly skin: grazing-angle glow and saturated inner light. */
  jelly: {
    rim: "#ff9b78",
    rimStrength: 0.22,
    core: "#e85a4c",
    coreStrength: 0.1,
    roughness: 0.3,
    clearcoatRoughness: 0.08,
  },
  /** Idle liquid motion amplitudes. */
  flow: { breathe: 0.018, sway: 0.035, ripple: 0.022 },
};

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
function centerZ(y: number) {
  const h = THREE.MathUtils.clamp(y / HEIGHT, 0, 1);
  return petShape.lean * Math.pow(Math.sin(Math.PI * h), 1.1);
}

/** The nub stays round; the body above it is deeper than it is wide. */
function depthAt(y: number) {
  return 1 + (petShape.depth - 1) * smooth(y / HEIGHT, 0, 0.25);
}

function faceDistance(x: number, y: number) {
  const { y: cy, halfWidth, halfHeight } = petShape.face;
  return Math.hypot(x / halfWidth, (y - cy) / halfHeight);
}

function inset(x: number, y: number) {
  const d = faceDistance(x, y),
    { inset, rim } = petShape.face;
  return (
    -inset * (1 - smooth(d, 0.9, 1.01)) +
    rim * Math.exp(-(((d - 1.04) / 0.05) ** 2))
  );
}

/** Front skin surface depth at a front-view point, including the face recess. */
export function frontZ(x: number, y: number) {
  const a = radiusAt(y);
  return (
    centerZ(y) +
    depthAt(y) * a * Math.sqrt(Math.max(0, 1 - (x * x) / (a * a))) +
    inset(x, y)
  );
}

function bodyGeometry() {
  const positions: number[] = [0, 0, 0],
    indices: number[] = [];
  for (let r = 1; r < RINGS; r++) {
    const { x: a, y } = profile[r];
    const b = a * depthAt(y),
      zc = centerZ(y);
    for (let s = 0; s < SEGMENTS; s++) {
      const angle = (s / SEGMENTS) * Math.PI * 2;
      const x = a * Math.cos(angle),
        front = Math.sin(angle);
      let z = zc + b * front;
      if (front > 0) z += inset(x, y) * smooth(front, 0.1, 0.4);
      positions.push(x, y, z);
    }
  }
  positions.push(0, HEIGHT, centerZ(HEIGHT));
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
vec3 petDeform(vec3 p) {
#ifdef PET_IN_ROOT
  return petFlow(p);
#else
  mat4 toRoot = inverse(uRoot) * modelMatrix;
  vec4 r = toRoot * vec4(p, 1.0);
  r.xyz = petFlow(r.xyz);
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
  petDeform(position + restTangent * 0.01) - flowed,
  petDeform(position + restBitangent * 0.01) - flowed));
`;

const faceGLSL = /* glsl */ `
#include <color_fragment>
float faceD = length(vec2(vRest.x / uFace.y, (vRest.y - uFace.x) / uFace.z));
float faceAA = fwidth(faceD);
float faceMask = (1.0 - smoothstep(0.985 - faceAA, 0.985 + faceAA, faceD)) * step(uFace.w, vRest.z);
diffuseColor.rgb = mix(diffuseColor.rgb, uFaceColor, faceMask);
// Painted occlusion for the recess (the scene casts no shadows): the skin lip
// shades the face just inside its edge, most on the side facing the upper-left
// key light, and a thin crease darkens the skin where it folds into the face.
vec2 faceQ = vec2(vRest.x / uFace.y, (vRest.y - uFace.x) / uFace.z);
float faceSide = 0.45 + 0.55 * dot(normalize(faceQ + vec2(1e-5)), vec2(-0.85, 0.53));
float faceFront = step(uFace.w, vRest.z);
float lipShade = smoothstep(0.72, 0.985, faceD) * faceMask * max(faceSide, 0.15);
float crease = (1.0 - smoothstep(0.985, 1.05, faceD)) * (1.0 - faceMask) * faceFront;
diffuseColor.rgb *= 1.0 - uFaceShade.x * lipShade - uFaceShade.y * crease;
`;

// Jelly: light scattered inside the body glows at grazing angles and keeps
// the shadow side saturated instead of grey. The face stays matte.
const jellyGLSL = /* glsl */ `
#include <emissivemap_fragment>
vec3 jellyView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
float jellyFacing = saturate(dot(normal, jellyView));
totalEmissiveRadiance += (1.0 - faceMask) * (
  uJellyRim * pow(1.0 - jellyFacing, 2.5) + uJellyCore * (1.0 - 0.6 * jellyFacing));
`;

type FlowUniforms = {
  uTime: THREE.IUniform<number>;
  uFlow: THREE.IUniform<number>;
  uJiggle: THREE.IUniform<number>;
  uLean: THREE.IUniform<number>;
  uAmp: THREE.IUniform<THREE.Vector3>;
  uRoot: THREE.IUniform<THREE.Matrix4>;
};

function liquid<T extends THREE.Material>(
  material: T,
  uniforms: FlowUniforms,
  options: { root?: boolean; face?: boolean } = {},
) {
  if (options.root) material.defines = { ...material.defines, PET_IN_ROOT: "" };
  if (options.face) material.defines = { ...material.defines, PET_FACE: "" };
  const { y, halfWidth, halfHeight, color } = petShape.face;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${flowGLSL}`)
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = petDeform(position);${options.face ? "\nvRest = position;" : ""}`,
      );
    if (options.root)
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        normalGLSL,
      );
    if (options.face) {
      shader.uniforms.uFace = {
        value: new THREE.Vector4(y, halfWidth, halfHeight, centerZ(y)),
      };
      shader.uniforms.uFaceColor = { value: new THREE.Color(color) };
      shader.uniforms.uFaceShade = {
        value: new THREE.Vector2(petShape.face.shade, petShape.face.crease),
      };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vRest;\nuniform vec4 uFace;\nuniform vec3 uFaceColor;\nuniform vec2 uFaceShade;\nuniform vec3 uJellyRim;\nuniform vec3 uJellyCore;",
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
      shader.uniforms.uJellyRim = {
        value: new THREE.Color(petShape.jelly.rim).multiplyScalar(
          petShape.jelly.rimStrength,
        ),
      };
      shader.uniforms.uJellyCore = {
        value: new THREE.Color(petShape.jelly.core).multiplyScalar(
          petShape.jelly.coreStrength,
        ),
      };
    }
  };
  material.customProgramCacheKey = () =>
    `pet-${options.root ? 1 : 0}${options.face ? 1 : 0}`;
  return material;
}

export function createPetModel() {
  const root = new THREE.Group();
  const uniforms: FlowUniforms = {
    uTime: { value: 0 },
    uFlow: { value: 0 },
    uJiggle: { value: 0 },
    uLean: { value: petShape.lean },
    uAmp: {
      value: new THREE.Vector3(
        petShape.flow.breathe,
        petShape.flow.sway,
        petShape.flow.ripple,
      ),
    },
    uRoot: { value: new THREE.Matrix4() },
  };
  root.add(
    new THREE.Mesh(
      bodyGeometry(),
      liquid(
        new THREE.MeshPhysicalMaterial({
          color: petShape.skin,
          roughness: petShape.jelly.roughness,
          clearcoat: 1,
          clearcoatRoughness: petShape.jelly.clearcoatRoughness,
          sheen: 0.25,
          sheenColor: "#ffc4aa",
          sheenRoughness: 0.4,
        }),
        uniforms,
        { root: true, face: true },
      ),
    ),
  );
  const open = new THREE.Group(),
    closed = new THREE.Group();
  const eyeMaterial = liquid(
    new THREE.MeshPhysicalMaterial({
      color: "#251310",
      envMapIntensity: 0.08,
      roughness: 0.16,
      specularIntensity: 0.2,
      clearcoat: 0.12,
      clearcoatRoughness: 0.1,
    }),
    uniforms,
  );
  const highlight = liquid(
    new THREE.MeshBasicMaterial({ color: "#fff8ee" }),
    uniforms,
  );
  const sphere = new THREE.SphereGeometry(1, 40, 32);
  const eyeColors: number[] = [];
  for (let i = 0; i < sphere.attributes.position.count; i++) {
    const color = new THREE.Color("#180e13").lerp(
      new THREE.Color("#8e4330"),
      smooth(-sphere.attributes.position.getY(i), 0.2, 1),
    );
    eyeColors.push(color.r, color.g, color.b);
  }
  sphere.setAttribute("color", new THREE.Float32BufferAttribute(eyeColors, 3));
  const globeMaterial = liquid(eyeMaterial.clone(), uniforms);
  globeMaterial.color.set("white");
  globeMaterial.vertexColors = true;
  const { eyes } = petShape;
  const glints: { glint: THREE.Mesh; globe: THREE.Mesh }[] = [];
  for (const x of [-eyes.x, eyes.x]) {
    const e = 0.01,
      y = eyes.y;
    const slopeX = (frontZ(x + e, y) - frontZ(x - e, y)) / (2 * e),
      slopeY = (frontZ(x, y + e) - frontZ(x, y - e)) / (2 * e);
    const eye = new THREE.Group();
    eye.position.set(x, y, frontZ(x, y) + 0.02);
    eye.rotation.set(Math.atan(slopeY), Math.atan(-slopeX), 0, "YXZ");
    const globe = new THREE.Mesh(sphere, globeMaterial);
    // Sized so the front-view projection matches the V2 eye.
    globe.scale.set(
      eyes.halfWidth / Math.cos(eye.rotation.y),
      eyes.halfHeight / Math.cos(eye.rotation.x),
      0.1,
    );
    eye.add(globe);
    const glint = new THREE.Mesh(sphere, highlight);
    glint.scale.set(0.043, 0.057, 0.012);
    eye.add(glint);
    glints.push({ glint, globe });
    open.add(eye);
    const points = Array.from({ length: 25 }, (_, i) => {
      const t = (i / 24) * Math.PI;
      const px = x + Math.cos(t) * 0.15,
        py = y - 0.04 + Math.sin(t) * 0.13;
      return new THREE.Vector3(px, py, frontZ(px, py) + 0.03);
    });
    closed.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points),
          32,
          0.032,
          10,
          false,
        ),
        eyeMaterial,
      ),
    );
  }
  root.add(open, closed);
  closed.visible = false;
  return {
    root,
    expression(happy: boolean) {
      open.visible = !happy;
      closed.visible = happy;
    },
    /**
     * Seat each catchlight where the key light mirrors into the camera: the
     * point on the eye ellipsoid whose normal is the light/view half-vector.
     * Call after `flow`, which refreshes the world matrices.
     */
    aim(light: THREE.Vector3, view = new THREE.Vector3(0, 0, 1)) {
      const half = new THREE.Vector3(),
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
        glint.position
          .set(
            (a * a * half.x) / reach,
            (b * b * half.y) / reach,
            (c * c * half.z) / reach,
          )
          .addScaledVector(half, glint.scale.z * 0.5);
        glint.quaternion.setFromUnitVectors(z, half);
      }
    },
    /** time in seconds, flow 0..1 idle amount, jiggle a signed stretch impulse. */
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
