import * as THREE from "three";

export const CUBE_FPS = 30;
export const CUBE_LOOP_MS = 8000;
export const CUBE_SCALE = 0.85;
export const QUIET_RETURN_MS = 600;
export type SurfacePose = {
  face: number;
  layer: number;
  tile: number;
  spin: number;
  morph: number;
  wipe: number;
};
export type CubePose = { sink: number; spread: number; surface: SurfacePose };

function ease(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t ** 3 * (t * (t * 6 - 15) + 10);
}

/** One local accent at a time, returning to the original artwork before resting. */
export function surfaceFrame(elapsedMs: number): SurfacePose {
  const t = Math.max(0, elapsedMs) % CUBE_LOOP_MS;
  const windows = [
    {
      start: 900,
      end: 2300,
      face: 2,
      layer: 3,
      tile: 6,
      spin: Math.PI / 2,
      morph: 1,
      wipe: 0,
    },
    {
      start: 2500,
      end: 4000,
      face: 0,
      layer: 2,
      tile: 5,
      spin: -Math.PI / 2,
      morph: 0,
      wipe: 1,
    },
    {
      start: 4200,
      end: 5750,
      face: 4,
      layer: 1,
      tile: 10,
      spin: Math.PI,
      morph: 1,
      wipe: 1,
    },
  ];
  const accent = windows.find(({ start, end }) => t >= start && t < end);
  if (!accent)
    return { face: -1, layer: -1, tile: -1, spin: 0, morph: 0, wipe: 0 };
  const p = (t - accent.start) / (accent.end - accent.start);
  const amount = ease(p / 0.4) * (1 - ease((p - 0.6) / 0.4));
  return {
    face: accent.face,
    layer: accent.layer,
    tile: accent.tile,
    spin: accent.spin * amount,
    morph: accent.morph * amount,
    wipe: accent.wipe * amount,
  };
}

export function cubeFrame(elapsedMs: number) {
  const t = Math.max(0, elapsedMs) % CUBE_LOOP_MS;
  const sink = ease((t - 1100) / 800) * (1 - ease((t - 2500) / 600));
  const spread = ease((t - 2500) / 1100) * (1 - ease((t - 4400) / 1500));
  const phase =
    t < 1100
      ? "whole"
      : t < 2500
        ? "sink"
        : t < 3600
          ? "expand"
          : t < 4400
            ? "open"
            : t < 5900
              ? "reassemble"
              : "rest";
  return { sink, spread, phase, surface: surfaceFrame(elapsedMs) };
}

/** Focus may interrupt any phase. Finish a smooth return even if focus leaves early. */
export function createCubeMotion() {
  let elapsed = 0;
  let pose: CubePose = cubeFrame(0);
  let quiet = false;
  let returning: { from: CubePose; elapsed: number } | null = null;
  return {
    get pose() {
      return pose;
    },
    get elapsed() {
      return elapsed;
    },
    get running() {
      return !quiet || returning !== null;
    },
    get phase() {
      return returning
        ? "settling"
        : quiet
          ? "quiet"
          : cubeFrame(elapsed).phase;
    },
    setQuiet(value: boolean) {
      if (quiet === value) return;
      quiet = value;
      elapsed = 0;
      if (value) returning = { from: { ...pose }, elapsed: 0 };
    },
    reset() {
      elapsed = 0;
      returning = null;
      pose = cubeFrame(0);
    },
    advance(delta: number) {
      if (returning) {
        returning.elapsed += delta;
        const amount = 1 - ease(returning.elapsed / QUIET_RETURN_MS);
        pose = {
          sink: returning.from.sink * amount,
          spread: returning.from.spread * amount,
          surface: {
            ...returning.from.surface,
            spin: returning.from.surface.spin * amount,
            morph: returning.from.surface.morph * amount,
            wipe: returning.from.surface.wipe * amount,
          },
        };
        if (returning.elapsed >= QUIET_RETURN_MS) {
          returning = null;
          pose = cubeFrame(0);
        }
      } else if (!quiet) {
        elapsed = (elapsed + delta) % CUBE_LOOP_MS;
        pose = cubeFrame(elapsed);
      }
    },
  };
}

export function cubeBufferSize(width: number, height: number, maxSize: number) {
  const scale = Math.min(3840, maxSize) / Math.max(width, height, 1);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/** Shared face coordinates keep the original 4×4 pattern continuous across cuts. */
function patternMaterial(face: number, layer: number, tile = false) {
  const vertical = face !== 2 && face !== 3;
  return new THREE.ShaderMaterial({
    uniforms: {
      uvScale: {
        value: new THREE.Vector2(tile ? 0.25 : 1, tile || vertical ? 0.25 : 1),
      },
      uvOffset: {
        value: new THREE.Vector2(
          tile ? 0.5 : 0,
          tile ? 0.5 : vertical ? layer / 4 : 0,
        ),
      },
      hole: { value: !tile && face === 2 && layer === 3 ? 1 : 0 },
      paper: { value: face === 2 ? 1 : face === 4 ? 0.92 : 0.8 },
      activeTile: { value: -1 },
      spin: { value: 0 },
      morph: { value: 0 },
      wipe: { value: 0 },
    },
    vertexShader: `
      varying vec2 faceUv;
      void main() {
        faceUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 faceUv;
      uniform vec2 uvScale;
      uniform vec2 uvOffset;
      uniform float hole;
      uniform float paper;
      uniform float activeTile;
      uniform float spin;
      uniform float morph;
      uniform float wipe;
      float shapeDistance(vec2 point, float motif) {
        float distanceToEdge = abs(point.x) + abs(point.y) - 0.5;
        if (motif > 3.5) {
          // Three bold parallel lines, contained within their own cell.
          float stripe = abs(mod(point.x + 0.12, 0.24) - 0.12) - 0.05;
          distanceToEdge = max(stripe, max(abs(point.x) - 0.34, abs(point.y) - 0.38));
        } else if (motif > 2.5) {
          float square = max(abs(point.x), abs(point.y));
          distanceToEdge = min(abs(square - 0.29) - 0.055, square - 0.085);
        } else if (motif > 1.5) {
          distanceToEdge = max(abs(point.x) - (point.y + 0.4) * 0.525, point.y - 0.4);
        } else if (motif > 0.5) {
          distanceToEdge = length(point) - 0.36;
        }
        return distanceToEdge;
      }
      void main() {
        vec2 mapped = faceUv * uvScale + uvOffset;
        vec2 grid = vec2(mapped.x, 1.0 - mapped.y) * 4.0;
        vec2 cell = min(floor(grid), vec2(3.0));
        if (hole > 0.5 && cell.x == 2.0 && cell.y == 1.0) discard;
        vec2 point = grid - cell - 0.5;
        float localX = point.x + 0.5;
        float cellActive = 1.0 - step(0.5, abs(cell.y * 4.0 + cell.x - activeTile));
        float angle = mod(cell.x + 2.0 * cell.y, 4.0) * 1.5707963268 + spin * cellActive;
        point = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * point;
        point /= 1.0 - 0.12 * morph * cellActive;
        float motif = mod(cell.x + 3.0 * cell.y, 5.0);
        float distanceToEdge = mix(shapeDistance(point, motif), shapeDistance(point, mod(motif + 1.0, 5.0)), morph * cellActive);
        float aa = max(fwidth(distanceToEdge), 0.00001);
        float shape = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, distanceToEdge);
        float inverted = mod(cell.x + cell.y, 2.0);
        float ink = mix(shape, 1.0 - shape, inverted);
        // Sweep the polarity across the cell instead of flashing or fading to gray.
        float inversion = wipe > 0.999 ? 1.0 : wipe > 0.001 ? 1.0 - smoothstep(wipe - 0.015, wipe + 0.015, localX) : 0.0;
        ink = mix(ink, 1.0 - ink, inversion * cellActive);
        gl_FragColor = vec4(vec3(mix(paper, 0.0027, ink)), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

function contactShadow(opacity: number) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { opacity: { value: opacity } },
    vertexShader: `varying vec2 shadowUv;
      void main() { shadowUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 shadowUv; uniform float opacity;
      void main() {
        float radius = length((shadowUv - 0.5) * 2.0);
        float alpha = exp(-4.5 * radius * radius) * (1.0 - smoothstep(0.65, 1.0, radius));
        gl_FragColor = vec4(0.0, 0.0, 0.0, alpha * opacity);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -1.22;
  return mesh;
}

export function createCubeModel() {
  const surfaces: {
    face: number;
    layer: number;
    material: THREE.ShaderMaterial;
  }[] = [];
  const surfaceMaterial = (face: number, layer: number, tile = false) => {
    const material = patternMaterial(face, layer, tile);
    surfaces.push({ face, layer, material });
    return material;
  };
  const root = new THREE.Group();
  root.scale.setScalar(CUBE_SCALE);
  const geometry = new THREE.BoxGeometry(2, 0.5, 2);
  const layers = Array.from({ length: 4 }, (_, layer) => {
    const group = new THREE.Group();
    const materials = Array.from({ length: 6 }, (_, face) =>
      surfaceMaterial(face, layer),
    );
    group.add(new THREE.Mesh(geometry, materials));
    root.add(group);
    return group;
  });
  // A real recessed cell in the upper face, with interior walls and a floor.
  const cavity = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.5),
    new THREE.MeshBasicMaterial({ color: "#777", side: THREE.BackSide }),
  );
  cavity.position.set(0.25, 0.1, -0.25);
  layers[3].add(cavity);
  const tile = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.04, 0.5),
    Array.from({ length: 6 }, (_, face) =>
      face === 2
        ? surfaceMaterial(face, 3, true)
        : new THREE.MeshBasicMaterial({ color: "#aaa" }),
    ),
  );
  tile.position.set(0.25, 0.23, -0.25);
  layers[3].add(tile);
  const shadow = contactShadow(0.17);
  const movingShadow = contactShadow(0);
  movingShadow.position.y -= 0.002;
  root.add(shadow, movingShadow);

  const applyPose = ({ sink, spread, surface }: CubePose) => {
    surfaces.forEach(({ face, layer, material }) => {
      material.uniforms.activeTile.value =
        face === surface.face && layer === surface.layer ? surface.tile : -1;
      material.uniforms.spin.value = surface.spin;
      material.uniforms.morph.value = surface.morph;
      material.uniforms.wipe.value = surface.wipe;
    });
    layers.forEach((layer, index) => {
      layer.position.set(0, -0.75 + index * 0.5 + index * 0.105 * spread, 0);
      layer.rotation.y = 0;
    });
    layers[2].position.x = 0.66 * spread;
    layers[2].position.z = -0.66 * spread;
    layers[2].rotation.y = 0.18 * spread;
    tile.position.y = 0.23 - sink * 0.2;
    shadow.position.x = 0.1 * spread;
    shadow.position.z = -0.1 * spread;
    shadow.scale.setScalar(1 + 0.08 * spread);
    shadow.material.uniforms.opacity.value = 0.17 - 0.025 * spread;
    movingShadow.position.x = layers[2].position.x * 0.9;
    movingShadow.position.z = layers[2].position.z * 0.9;
    movingShadow.scale.setScalar(0.88 + 0.12 * spread);
    movingShadow.material.uniforms.opacity.value = 0.085 * spread;
  };
  applyPose(cubeFrame(0));
  return {
    root,
    layers,
    tile,
    shadow,
    movingShadow,
    applyPose,
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          (Array.isArray(object.material)
            ? object.material
            : [object.material]
          ).forEach((material) => materials.add(material));
        }
      });
      geometries.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
    },
  };
}
