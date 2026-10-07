import * as THREE from "three";

export const CUBE_FPS = 30;
export const TILE_DURATION_MS = 1200;
const TILE_ORDER = [0, 11, 6, 13, 3, 8, 15, 4, 10, 1, 12, 7, 5, 14, 9, 2];
// BoxGeometry material indices: +X, -X, +Y, -Y, +Z, -Z.
const VISIBLE_FACES = [4, 2, 0];

export function cubeFrame(elapsedMs: number) {
  const slot = Math.floor(elapsedMs / TILE_DURATION_MS);
  const progress = Math.min((elapsedMs % TILE_DURATION_MS) / 900, 1);
  return {
    face: VISIBLE_FACES[slot % 3],
    tile: TILE_ORDER[Math.floor(slot / 3) % 16],
    // Quintic easing has zero velocity and acceleration at both ends.
    progress: progress ** 3 * (progress * (progress * 6 - 15) + 10),
  };
}

export function cubeBufferSize(width: number, height: number, maxSize: number) {
  const scale = Math.min(3840, maxSize) / Math.max(width, height, 1);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export function createCubeModel() {
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const materials = Array.from(
    { length: 6 },
    (_, face) =>
      new THREE.ShaderMaterial({
        uniforms: {
          activeTile: { value: -1 },
          progress: { value: 0 },
          // Very slight paper shading makes the three planes readable.
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
        uniform float activeTile;
        uniform float progress;
        uniform float paper;
        void main() {
          vec2 grid = vec2(faceUv.x, 1.0 - faceUv.y) * 4.0;
          vec2 cell = min(floor(grid), vec2(3.0));
          vec2 point = grid - cell - 0.5;
          float tile = cell.y * 4.0 + cell.x;
          float moving = 1.0 - step(0.5, abs(tile - activeTile));
          float turn = progress * moving;
          float angle = 0.7853981634 + turn * 1.5707963268;
          float size = 0.3535533906 * (1.0 - 0.22 * sin(turn * 3.1415926536));
          vec2 rotated = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * point;
          float distanceToEdge = max(abs(rotated.x), abs(rotated.y)) - size;
          float aa = max(fwidth(distanceToEdge), 0.00001);
          float diamond = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, distanceToEdge);
          float inverted = mod(cell.x + cell.y, 2.0);
          float ink = mix(diamond, 1.0 - diamond, inverted);
          gl_FragColor = vec4(vec3(mix(paper, 0.0027, ink)), 1.0);
          #include <colorspace_fragment>
        }
      `,
      }),
  );
  const mesh = new THREE.Mesh(geometry, materials);
  return {
    mesh,
    update(elapsedMs: number) {
      const frame = cubeFrame(elapsedMs);
      materials.forEach((material, face) => {
        material.uniforms.activeTile.value =
          face === frame.face ? frame.tile : -1;
        material.uniforms.progress.value = frame.progress;
      });
    },
    dispose() {
      geometry.dispose();
      materials.forEach((material) => material.dispose());
    },
  };
}
