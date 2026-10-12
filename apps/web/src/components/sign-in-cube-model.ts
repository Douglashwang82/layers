import * as THREE from "three";

export const CUBE_FPS = 30;
export const CUBE_COUNT = 5;

export function createCubeMotion() {
  let elapsed = 0;
  let quiet = false;
  return {
    get elapsed() {
      return elapsed;
    },
    get pose() {
      return elapsed;
    },
    get running() {
      return !quiet;
    },
    get phase() {
      return quiet ? "quiet" : "rolling";
    },
    setQuiet(value: boolean) {
      quiet = value;
    },
    reset() {
      elapsed = 0;
    },
    advance(delta: number) {
      if (!quiet) elapsed += Math.max(0, delta);
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

/** Screen-space diagonal, shared by the travel, tumble axis and trail. */
export function rollingPosition(progress: number, lane: number) {
  return { x: 3.4 - progress * 6.8 + lane, y: 2.8 - progress * 5.6 - lane };
}

export function createCubeModel(random = Math.random) {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = ["#e4e4e4", "#ccc", "#fff", "#ccc", "#f2f2f2", "#ddd"].map(
    (color) => new THREE.MeshBasicMaterial({ color }),
  );
  const arcGeometry = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(
      Array.from({ length: 25 }, (_, index) => {
        const t = index / 24;
        // A short quarter-turn trace, bowed above the diagonal travel path.
        return new THREE.Vector3(
          -t * 0.26,
          -t * 0.21 + Math.sin(t * Math.PI) * 0.12,
          -0.6,
        );
      }),
    ),
    24,
    0.006,
    4,
    false,
  );
  const axis = new THREE.Vector3(5.6, -6.8, 0).normalize();
  const initialRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0.45, -0.55, 0),
  );
  const cubes = Array.from({ length: CUBE_COUNT }, (_, index) => {
    const mesh = new THREE.Mesh(geometry, materials);
    root.add(mesh);
    const trails = Array.from({ length: 5 }, () => {
      const line = new THREE.Mesh(
        arcGeometry,
        new THREE.MeshBasicMaterial({
          color: "#fff",
          transparent: true,
          depthWrite: false,
        }),
      );
      root.add(line);
      return line;
    });
    return {
      mesh,
      trails,
      start: -index * 2300,
      duration: 13000 + random() * 5000,
      lane: (((index * 3) % CUBE_COUNT) - 2) * 0.68,
      size: 0.3 + random() * 0.16,
    };
  });
  let previous = 0;
  const applyPose = (elapsed: number) => {
    // Reset to a composed still scene when reduced motion is enabled.
    if (elapsed < previous)
      cubes.forEach((cube, index) => {
        cube.start = -index * 2300;
      });
    previous = elapsed;
    cubes.forEach((cube) => {
      if (elapsed > cube.start + cube.duration) {
        cube.start = elapsed + 600 + random() * 3600;
        cube.duration = 13000 + random() * 5000;
        cube.lane = (random() - 0.5) * 2.8;
        cube.size = 0.3 + random() * 0.16;
      }
      const p = (elapsed - cube.start) / cube.duration;
      cube.mesh.visible = p >= 0 && p <= 1;
      const position = rollingPosition(p, cube.lane);
      cube.mesh.position.set(position.x, position.y, 0);
      cube.mesh.scale.setScalar(cube.size);
      cube.mesh.quaternion
        .setFromAxisAngle(axis, p * Math.PI * 10)
        .multiply(initialRotation);
      cube.trails.forEach((line, index) => {
        // Leave strokes at past rolling positions; older strokes fade away.
        const age = (index + 1 + ((p * 22) % 1)) / 22;
        const trailProgress = p - age;
        const point = rollingPosition(trailProgress, cube.lane);
        line.position.set(point.x, point.y, 0);
        line.visible = cube.mesh.visible && trailProgress >= 0;
        line.material.opacity = Math.max(0, 0.65 * (1 - age * 3.6));
      });
    });
  };
  applyPose(0);
  return {
    root,
    cubes,
    applyPose,
    dispose() {
      geometry.dispose();
      arcGeometry.dispose();
      materials.forEach((material) => material.dispose());
      cubes.forEach((cube) =>
        cube.trails.forEach((line) => line.material.dispose()),
      );
    },
  };
}
