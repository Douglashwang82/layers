import * as THREE from "three";
import {
  CITY_BUILDINGS,
  CITY_COLORS,
  PARK_BLOCKS,
  layerLift,
  smoothStep,
} from "./layout";

export type CityScene = {
  setActive: (active: boolean) => void;
  setMotion: (enabled: boolean) => void;
  dispose: () => void;
};
type Part = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color?: string;
};

/** Loaded only for a visible desktop scene. No React updates in the frame loop. */
export function createCityScene(
  host: HTMLElement,
  onUnavailable: () => void,
): CityScene {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = "sign-in-city-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const scene = new THREE.Scene();
  const city = new THREE.Group();
  scene.add(city);
  const camera = new THREE.OrthographicCamera(-20, 20, 17, -17, 0.1, 150);
  scene.add(new THREE.HemisphereLight(0xfffbef, 0x688d7c, 1.9));
  const sun = new THREE.DirectionalLight(0xfff1d7, 2);
  sun.position.set(-16, 24, 14);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd8edff, 1);
  fill.position.set(12, 8, -16);
  scene.add(fill);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const instances: THREE.InstancedMesh[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  const tree = new THREE.IcosahedronGeometry(0.5, 1);
  geometries.add(box);
  geometries.add(tree);
  const matrix = new THREE.Object3D();
  const color = new THREE.Color();
  function batch(
    parent: THREE.Group,
    parts: Part[],
    base: string,
    geometry: THREE.BufferGeometry = box,
    opacity = 1,
  ) {
    // Matte architecture needs diffuse lighting, not costly PBR reflections.
    const material = new THREE.MeshLambertMaterial({
      color: base,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity === 1,
    });
    materials.add(material);
    const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
    parts.forEach((part, index) => {
      matrix.position.set(part.x, part.y, part.z);
      matrix.scale.set(part.w, part.h, part.d);
      matrix.updateMatrix();
      mesh.setMatrixAt(index, matrix.matrix);
      if (part.color) mesh.setColorAt(index, color.set(part.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
    instances.push(mesh);
    return mesh;
  }
  batch(
    city,
    [
      { x: 0, y: -0.38, z: 0, w: 25.3, h: 0.6, d: 21.3 },
      { x: 0, y: -0.045, z: 0, w: 25.7, h: 0.08, d: 21.7 },
    ],
    "#d6e3db",
  );
  batch(city, [{ x: 0, y: 0.01, z: 0, w: 25, h: 0.025, d: 21 }], "#b4c9bf");
  const sidewalks: Part[] = [],
    lawns: Part[] = [],
    trunks: Part[] = [],
    crowns: Part[] = [],
    laneMarks: Part[] = [];
  for (let block = 0; block < 30; block++) {
    const x = (block % 6) * 4 - 10,
      z = Math.floor(block / 6) * 4 - 8;
    sidewalks.push({ x, y: 0.07, z, w: 3.42, h: 0.12, d: 3.42 });
    if (PARK_BLOCKS.has(block))
      lawns.push({ x, y: 0.14, z, w: 3.1, h: 0.04, d: 3.1 });
    for (let t = 0; t < (PARK_BLOCKS.has(block) ? 7 : 2); t++) {
      const tx =
        x +
        (PARK_BLOCKS.has(block) ? Math.sin(t * 2.4) * 1.05 : t ? 1.47 : -1.47);
      const tz = z + (PARK_BLOCKS.has(block) ? Math.cos(t * 2.4) * 1.05 : 1.45);
      trunks.push({ x: tx, y: 0.37, z: tz, w: 0.07, h: 0.5, d: 0.07 });
      crowns.push({
        x: tx,
        y: 0.77,
        z: tz,
        w: 0.58,
        h: 0.85,
        d: 0.58,
        color: t % 2 ? "#92bc81" : "#64a68c",
      });
    }
  }
  for (let z = -10; z <= 10; z += 4) {
    for (let x = -11.5; x < 12; x += 0.8)
      laneMarks.push({ x, y: 0.04, z, w: 0.32, h: 0.012, d: 0.035 });
  }
  for (let x = -12; x <= 12; x += 4) {
    for (let z = -9.5; z < 10; z += 0.8)
      laneMarks.push({ x, y: 0.04, z, w: 0.035, h: 0.012, d: 0.32 });
  }
  batch(city, sidewalks, "#f2eee0");
  batch(city, lawns, "#b5cf94");
  batch(city, trunks, "#a39d80");
  batch(city, crowns, "#ffffff", tree);
  batch(city, laneMarks, "#edf3de");
  const layers = CITY_COLORS.map((tone, layer) => {
    const group = new THREE.Group();
    city.add(group);
    const bodies: Part[] = [],
      roofs: Part[] = [],
      windows: Part[] = [],
      shops: Part[] = [],
      shadows: Part[] = [];
    CITY_BUILDINGS.filter((b) => b.layer === layer).forEach((b, index) => {
      const y = 0.14;
      bodies.push({
        x: b.x,
        y: y + b.h / 2,
        z: b.z,
        w: b.w,
        h: b.h,
        d: b.d,
        color: index % 3 ? tone : "#e1e5d9",
      });
      roofs.push({
        x: b.x,
        y: y + b.h + 0.055,
        z: b.z,
        w: b.w + 0.07,
        h: 0.11,
        d: b.d + 0.07,
      });
      roofs.push({
        x: b.x + 0.17,
        y: y + b.h + 0.18,
        z: b.z,
        w: b.w * 0.4,
        h: 0.2,
        d: b.d * 0.45,
      });
      shadows.push({
        x: b.x + 0.12,
        y: 0.139,
        z: b.z - 0.12,
        w: b.w + 0.35,
        h: 0.008,
        d: b.d + 0.35,
      });
      for (let floor = 0.42; floor < b.h - 0.15; floor += 0.4) {
        for (const offset of [-0.3, 0, 0.3]) {
          windows.push({
            x: b.x + offset,
            y: y + floor,
            z: b.z + b.d / 2 + 0.008,
            w: 0.13,
            h: 0.21,
            d: 0.015,
          });
          windows.push({
            x: b.x + b.w / 2 + 0.008,
            y: y + floor,
            z: b.z + offset,
            w: 0.015,
            h: 0.21,
            d: 0.13,
          });
        }
      }
      if (layer === 0 && index % 2 === 0)
        shops.push({
          x: b.x,
          y: 0.58,
          z: b.z + b.d / 2 + 0.16,
          w: b.w * 0.88,
          h: 0.09,
          d: 0.38,
        });
    });
    batch(group, shadows, "#496f5d", box, 0.16);
    batch(group, bodies, "#ffffff");
    batch(group, roofs, "#f6f1df");
    batch(group, windows, "#547e78");
    if (shops.length) batch(group, shops, "#e79877");
    // Thin sheets and perimeter rails communicate layers without glass refraction.
    const sheet = batch(
      group,
      [{ x: 0, y: 0.095, z: 0, w: 25, h: 0.02, d: 21 }],
      tone,
      box,
      0.055,
    );
    const edges = batch(
      group,
      [
        { x: 0, y: 0.1, z: -10.5, w: 25, h: 0.035, d: 0.035 },
        { x: 0, y: 0.1, z: 10.5, w: 25, h: 0.035, d: 0.035 },
        { x: -12.5, y: 0.1, z: 0, w: 0.035, h: 0.035, d: 21 },
        { x: 12.5, y: 0.1, z: 0, w: 0.035, h: 0.035, d: 21 },
        { x: -10 + layer * 1.7, y: 0.12, z: 10.5, w: 1.2, h: 0.06, d: 0.22 },
      ],
      tone,
    );
    return { group, sheet, edges };
  });
  const carParts = Array.from({ length: 12 }, (_, i) => ({
    x: i * 2 - 12,
    y: 0.18,
    z: (i % 5) * 4 - 9.8,
    w: 0.48,
    h: 0.23,
    d: 0.23,
    color: ["#f6f1dd", "#dd8d76", "#46796e"][i % 3],
  }));
  const cars = batch(city, carParts, "#ffffff");
  cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cars.frustumCulled = false;
  let disposed = false,
    active = false,
    motion = true,
    focused = false;
  let elapsed = 0,
    previous = 0,
    slowTime = 0,
    pointerX = 0,
    pointerY = 0,
    rotation = 0,
    tilt = 0;
  let width = 1,
    height = 1;
  function render() {
    const t = motion ? elapsed : 0;
    layers.forEach(({ group, sheet, edges }, index) => {
      const lift = motion ? layerLift(t, index) : 0;
      group.position.y = lift + index * 0.006;
      sheet.visible = lift > 0.1;
      edges.visible = lift > 0.1;
    });
    carParts.forEach((car, i) => {
      const direction = i % 2 ? 1 : -1;
      matrix.position.set(
        ((((car.x + 12 + t * direction * 0.55) % 24) + 24) % 24) - 12,
        car.y,
        car.z,
      );
      matrix.scale.set(car.w, car.h, car.d);
      matrix.updateMatrix();
      cars.setMatrixAt(i, matrix.matrix);
    });
    cars.instanceMatrix.needsUpdate = true;
    city.rotation.y = motion ? rotation + Math.sin(t * 0.16) * 0.025 : 0;
    city.rotation.x = motion ? tilt : 0;
    // One small introductory pull-back, then a stable architectural camera.
    camera.zoom = motion ? 1.09 - smoothStep(t / 3) * 0.09 : 1;
    camera.position.set(29, 26, 33);
    camera.lookAt(0, 2.5, 0);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  function frame(now: number) {
    const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
    previous = now;
    elapsed += dt;
    const blend = 1 - Math.exp(-dt * 3);
    rotation += (pointerX * 0.07 - rotation) * blend;
    tilt += (pointerY * 0.025 - tilt) * blend;
    // Sustained slow frames reduce pixel work, never the intended animation speed.
    slowTime = dt > 0.024 ? slowTime + dt : Math.max(0, slowTime - dt);
    if (slowTime > 3 && renderer.getPixelRatio() > 0.8) {
      renderer.setPixelRatio(Math.max(0.8, renderer.getPixelRatio() - 0.25));
      renderer.setSize(width, height, false);
      slowTime = 0;
    }
    render();
  }
  function updateLoop() {
    if (disposed) return;
    previous = 0;
    renderer.setAnimationLoop(active && motion && !focused ? frame : null);
    if (active) render();
  }
  function resize() {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    const aspect = width / height,
      halfHeight = Math.max(16.5, 18 / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    renderer.setSize(width, height, false);
    if (active) render();
  }
  function pointer(event: PointerEvent) {
    const bounds = host.getBoundingClientRect();
    pointerX = (event.clientX - bounds.left) / bounds.width - 0.5;
    pointerY = (event.clientY - bounds.top) / bounds.height - 0.5;
  }
  function resetPointer() {
    pointerX = 0;
    pointerY = 0;
  }
  const stage = host.closest(".auth-stage");
  function focus() {
    const next = !!stage
      ?.querySelector(".form-panel")
      ?.contains(document.activeElement);
    if (focused !== next) {
      focused = next;
      updateLoop();
    }
  }
  function focusOut() {
    queueMicrotask(focus);
  }
  function contextLost(event: Event) {
    event.preventDefault();
    onUnavailable();
  }
  const observer = new ResizeObserver(resize);
  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    observer.disconnect();
    host.removeEventListener("pointermove", pointer);
    host.removeEventListener("pointerleave", resetPointer);
    stage?.removeEventListener("focusin", focus);
    stage?.removeEventListener("focusout", focusOut);
    canvas.removeEventListener("webglcontextlost", contextLost);
    instances.forEach((mesh) => mesh.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }
  try {
    resize();
    render();
    host.append(canvas);
    observer.observe(host);
    host.addEventListener("pointermove", pointer, { passive: true });
    host.addEventListener("pointerleave", resetPointer);
    stage?.addEventListener("focusin", focus);
    stage?.addEventListener("focusout", focusOut);
    canvas.addEventListener("webglcontextlost", contextLost);
    focus();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    setActive(value) {
      if (active !== value) {
        active = value;
        updateLoop();
      }
    },
    setMotion(value) {
      if (motion !== value) {
        motion = value;
        updateLoop();
      }
    },
    dispose,
  };
}
