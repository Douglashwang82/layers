import * as THREE from "three";

export const CUBE_FPS = 30;
export const CUBE_LANES = 3;
export const CUBE_COUNT = CUBE_LANES * 2;
export const CUBE_SIDE = 0.65;
export const CUBE_STEP_MS = 1200;
const TRAIL_COUNT = 5;

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

/** Ground is Y=0. Roll toward +Z around the full leading X edge. */
export function rollingPose(step: number, fraction: number, lane: number) {
  const angle = (fraction * Math.PI) / 2;
  const half = CUBE_SIDE / 2;
  const pivotZ = (step + 0.5) * CUBE_SIDE;
  return {
    x: lane,
    y: half * (Math.cos(angle) + Math.sin(angle)),
    z: pivotZ + half * (Math.sin(angle) - Math.cos(angle)),
    angle,
    pivotZ,
  };
}

export function createCubeModel(random = Math.random) {
  const root = new THREE.Group();
  const boxGeometry = new THREE.BoxGeometry(CUBE_SIDE, CUBE_SIDE, CUBE_SIDE);
  // Occlude rear edges and stamps without painting filled faces over the page.
  const depthMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: "#fff" });
  const edges = new THREE.EdgesGeometry(boxGeometry);
  const points = edges.getAttribute("position");
  const edgeGeometries = Array.from(
    { length: points.count / 2 },
    (_, index) =>
      new THREE.TubeGeometry(
        new THREE.LineCurve3(
          new THREE.Vector3().fromBufferAttribute(points, index * 2),
          new THREE.Vector3().fromBufferAttribute(points, index * 2 + 1),
        ),
        1,
        0.007,
        4,
        false,
      ),
  );
  edges.dispose();
  const half = CUBE_SIDE / 2;
  const stampPoints = [
    new THREE.Vector3(-half, 0, -half),
    new THREE.Vector3(half, 0, -half),
    new THREE.Vector3(half, 0, half),
    new THREE.Vector3(-half, 0, half),
  ];
  const stampGeometries = stampPoints.map(
    (point, index) =>
      new THREE.TubeGeometry(
        new THREE.LineCurve3(point, stampPoints[(index + 1) % 4]),
        1,
        0.005,
        4,
        false,
      ),
  );
  const seeds = Array.from({ length: CUBE_LANES }, () => random());
  const cubes = Array.from({ length: CUBE_COUNT }, (_, index) => {
    const mesh = new THREE.Group();
    const depth = new THREE.Mesh(boxGeometry, depthMaterial);
    depth.renderOrder = -1;
    mesh.add(depth);
    edgeGeometries.forEach((geometry) =>
      mesh.add(new THREE.Mesh(geometry, edgeMaterial)),
    );
    root.add(mesh);
    const trails = Array.from({ length: TRAIL_COUNT }, () => {
      const group = new THREE.Group();
      const material = new THREE.MeshBasicMaterial({
        color: "#fff",
        transparent: true,
        depthWrite: false,
      });
      stampGeometries.forEach((geometry) =>
        group.add(new THREE.Mesh(geometry, material)),
      );
      root.add(group);
      return { group, material };
    });
    return {
      mesh,
      trails,
      lane: index % CUBE_LANES,
      slot: Math.floor(index / CUBE_LANES),
      offset: 0,
      start: 0,
      period: 0,
      x: 0,
    };
  });
  const setViewport = (halfWidth: number, halfHeight: number) => {
    cubes.forEach((cube) => {
      // Three parallel, immutable lanes; +Z projects from top-right to bottom-left.
      cube.x = (cube.lane - 1) * Math.min(halfWidth, halfHeight) * 0.85;
      const entry = Math.max(
        cube.x - halfWidth * Math.SQRT2,
        -cube.x - halfHeight * Math.sqrt(6),
      );
      const exit = Math.min(
        cube.x + halfWidth * Math.SQRT2,
        -cube.x + halfHeight * Math.sqrt(6),
      );
      cube.start = Math.floor(entry / CUBE_SIDE) - 3;
      const end = Math.ceil(exit / CUBE_SIDE) + TRAIL_COUNT + 3;
      const spacing = Math.max(
        TRAIL_COUNT + 3,
        Math.ceil((end - cube.start) / 2),
      );
      cube.period = spacing * 2;
      // Whole-step offsets preserve the same angular phase and velocity for every cube.
      cube.offset =
        Math.floor(seeds[cube.lane] * spacing) + cube.slot * spacing;
    });
  };
  const applyPose = (elapsed: number) => {
    const time = Math.max(0, elapsed) / CUBE_STEP_MS;
    const whole = Math.floor(time);
    const fraction = time - whole;
    cubes.forEach((cube) => {
      const step = cube.start + ((whole + cube.offset) % cube.period);
      const pose = rollingPose(step, fraction, cube.x);
      cube.mesh.position.set(pose.x, pose.y, pose.z);
      cube.mesh.rotation.x = pose.angle;
      cube.trails.forEach(({ group, material }, index) => {
        // A new complete square is stamped only when a face lands, once per step.
        group.position.set(cube.x, 0, (step - index) * CUBE_SIDE);
        group.visible = step - index >= cube.start;
        material.opacity =
          0.46 * Math.max(0, 1 - (index + fraction) / TRAIL_COUNT);
      });
    });
  };
  setViewport(4, 5);
  applyPose(0);
  return {
    root,
    cubes,
    setViewport,
    applyPose,
    dispose() {
      boxGeometry.dispose();
      depthMaterial.dispose();
      edgeMaterial.dispose();
      edgeGeometries.forEach((geometry) => geometry.dispose());
      stampGeometries.forEach((geometry) => geometry.dispose());
      cubes.forEach((cube) =>
        cube.trails.forEach(({ material }) => material.dispose()),
      );
    },
  };
}
