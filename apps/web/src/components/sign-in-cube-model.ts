import * as THREE from "three";

export const CUBE_FPS = 30;
export const CUBE_LOOP_MS = 8000;
export const CUBE_SCALE = 0.85;
export const QUIET_RETURN_MS = 600;
export type CubePose = { sink: number; spread: number };

function ease(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t ** 3 * (t * (t * 6 - 15) + 10);
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
  return { sink, spread, phase };
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
        };
        if (returning.elapsed >= QUIET_RETURN_MS) returning = null;
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
      interior: {
        value:
          !tile && ((face === 2 && layer < 3) || (face === 3 && layer > 0))
            ? 1
            : 0,
      },
      paper: { value: face === 2 ? 1 : face === 4 ? 0.92 : 0.8 },
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
      uniform float interior;
      void main() {
        if (interior > 0.5) {
          vec2 edge = min(faceUv, 1.0 - faceUv);
          float rim = smoothstep(0.0, 0.008, min(edge.x, edge.y));
          gl_FragColor = vec4(vec3(mix(0.25, paper * 0.77, rim)), 1.0);
          #include <colorspace_fragment>
          return;
        }
        vec2 mapped = faceUv * uvScale + uvOffset;
        vec2 grid = vec2(mapped.x, 1.0 - mapped.y) * 4.0;
        vec2 cell = min(floor(grid), vec2(3.0));
        if (hole > 0.5 && cell.x == 2.0 && cell.y == 1.0) discard;
        vec2 point = grid - cell - 0.5;
        float distanceToEdge = abs(point.x) + abs(point.y) - 0.5;
        float aa = max(fwidth(distanceToEdge), 0.00001);
        float diamond = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, distanceToEdge);
        float inverted = mod(cell.x + cell.y, 2.0);
        float ink = mix(diamond, 1.0 - diamond, inverted);
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
  const root = new THREE.Group();
  root.scale.setScalar(CUBE_SCALE);
  const geometry = new THREE.BoxGeometry(2, 0.5, 2);
  const layers = Array.from({ length: 4 }, (_, layer) => {
    const group = new THREE.Group();
    const materials = Array.from({ length: 6 }, (_, face) =>
      patternMaterial(face, layer),
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
        ? patternMaterial(face, 3, true)
        : new THREE.MeshBasicMaterial({ color: "#aaa" }),
    ),
  );
  tile.position.set(0.25, 0.23, -0.25);
  layers[3].add(tile);
  const shadow = contactShadow(0.17);
  const movingShadow = contactShadow(0);
  movingShadow.position.y -= 0.002;
  root.add(shadow, movingShadow);

  const applyPose = ({ sink, spread }: CubePose) => {
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
