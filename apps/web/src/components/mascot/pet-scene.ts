import * as THREE from "three";
import { createPetModel, type PetShape } from "./pet-model";
import type { PetPose } from "./marker-pet";

/**
 * Reflection studio for the glossy skin: one large softbox at the upper left
 * (where the key light sits) gives a single sleek highlight, a warm floor
 * tints the belly, and a dim card on the right draws the far rim.
 */
function studio(lighting: PetLighting) {
  const scene = new THREE.Scene();
  const dome = new THREE.SphereGeometry(10, 32, 16);
  const tones: number[] = [];
  const floor = new THREE.Color("#f1a483").multiplyScalar(0.55),
    horizon = new THREE.Color("#fde9dd").multiplyScalar(0.45),
    sky = new THREE.Color("#fff6ef").multiplyScalar(0.35);
  for (let i = 0; i < dome.attributes.position.count; i++) {
    const y = dome.attributes.position.getY(i) / 10;
    const tone =
      y < 0
        ? horizon.clone().lerp(floor, THREE.MathUtils.smoothstep(-y, 0, 0.5))
        : horizon.clone().lerp(sky, THREE.MathUtils.smoothstep(y, 0, 0.6));
    tones.push(tone.r, tone.g, tone.b);
  }
  dome.setAttribute("color", new THREE.Float32BufferAttribute(tones, 3));
  scene.add(
    new THREE.Mesh(
      dome,
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }),
    ),
  );
  const card = (
    width: number,
    height: number,
    brightness: number,
    at: [number, number, number],
    round = false,
  ) => {
    // A round softbox mirrors as a soft oval highlight, like light on jelly.
    const geometry = round
      ? new THREE.CircleGeometry(0.5, 48).scale(width, height, 1)
      : new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#fff4ea").multiplyScalar(brightness),
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(...at);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  // The stage's jelly finish wants a crisp, bright softbox; the map's matte
  // finish a broad, dim one. Both sit up-left so the highlight lands on the
  // upper-left shoulder, where V2's hero is brightest.
  if (lighting === "stage") card(3.6, 2.8, 24, [-4.2, 6.4, -0.6], true);
  else card(6, 5, 5, [-4.4, 6.2, -1]);
  card(1.6, 5, 1.6, [5.5, 0.8, -1.5]);
  return {
    scene,
    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    },
  };
}

/**
 * `map` is the small marker; `stage` is the sign-in hero, lit like V2's large
 * render: a high upper-left key, a long shadow to the lower right (drawn by
 * the page), and a warm floor bounce.
 */
export type PetLighting = "map" | "stage";

export function createPetScene(
  host: HTMLElement,
  unavailable: () => void,
  {
    lighting = "map",
    shape,
  }: { lighting?: PetLighting; shape?: PetShape } = {},
) {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  let model = createPetModel(shape);
  scene.add(model.root);
  const room = studio(lighting),
    generator = new THREE.PMREMGenerator(renderer);
  let environment: THREE.WebGLRenderTarget;
  try {
    environment = generator.fromScene(room.scene, 0.04);
  } catch (error) {
    model.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  } finally {
    room.dispose();
    generator.dispose();
  }
  scene.environment = environment.texture;
  scene.environmentIntensity = lighting === "stage" ? 0.7 : 0.6;
  // V2 lighting: soft key from the upper left, warm floor bounce on the belly.
  scene.add(new THREE.HemisphereLight(0xfff0e6, 0xf6b090, 0.4));
  const key = new THREE.DirectionalLight(0xfff0e4, 2.9);
  if (lighting === "stage") key.position.set(-4, 4.2, 3.2);
  else key.position.set(-5, 1.4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(3, 1, 2);
  scene.add(fill);
  const bounce = new THREE.DirectionalLight(0xffb48e, 1.6);
  bounce.position.set(-0.5, -3, 2.2);
  scene.add(bounce);
  // y=0 projects to 93.75% of the frame, including during yaw transitions.
  const height = 2.9;
  const camera = new THREE.OrthographicCamera(
    -1.36,
    1.36,
    height * 0.9375,
    -height * 0.0625,
    0.1,
    20,
  );
  camera.position.set(0, 0, 6);
  // Compile every program now, including the hidden happy eyes; compiling on
  // the first tap stalls the main thread on slow or software-rendered GPUs.
  model.expression(true);
  renderer.compile(scene, camera);
  model.expression(false);
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  let disposed = false,
    onscreen = true,
    flowing = false,
    raf = 0,
    yaw = 0,
    target = 0,
    from = 0,
    started = 0,
    jiggleAt = -Infinity,
    pose: PetPose | null = null,
    // Curious squish runs on an underdamped spring so it settles like jelly.
    squish = 0,
    squishVelocity = 0,
    squishTarget = 0,
    // The 3/4 face turn has its own spring: hero turns without squishing.
    turn = 0,
    turnVelocity = 0,
    turnTarget = 0,
    lastFrame = 0,
    rebuild = 0,
    pendingShape: PetShape | null = null;
  // Every flow frequency is a multiple of 0.1 rad/s, so wrapping time at
  // 20π seconds is seamless and keeps shader floats precise.
  const loop = 20 * Math.PI;
  function render(now = performance.now()) {
    const t = (now - jiggleAt) / 1000;
    // A damped spring: stretch up, settle back like a drop of liquid.
    const jiggle = t < 1.2 ? 0.07 * Math.exp(-5 * t) * Math.sin(16 * t) : 0;
    model.flow(flowing ? (now / 1000) % loop : 0, flowing ? 1 : 0, jiggle);
    model.aim(key.position);
    renderer.render(scene, camera);
    return t < 1.2;
  }
  function frame(now = performance.now()) {
    raf = 0;
    if (disposed || document.hidden || !onscreen) return;
    const progress = Math.min(1, (now - started) / 240);
    yaw = THREE.MathUtils.lerp(from, target, 1 - Math.pow(1 - progress, 3));
    model.root.rotation.y = yaw;
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    squishVelocity +=
      (170 * (squishTarget - squish) - 13 * squishVelocity) * dt;
    squish += squishVelocity * dt;
    const squishing =
      Math.abs(squishTarget - squish) > 1e-3 || Math.abs(squishVelocity) > 1e-3;
    if (!squishing) {
      squish = squishTarget;
      squishVelocity = 0;
    }
    turnVelocity += (170 * (turnTarget - turn) - 13 * turnVelocity) * dt;
    turn += turnVelocity * dt;
    const turning =
      Math.abs(turnTarget - turn) > 1e-3 || Math.abs(turnVelocity) > 1e-3;
    if (!turning) {
      turn = turnTarget;
      turnVelocity = 0;
    }
    model.squish(squish * 0.35);
    model.curious(turn);
    const settling = render(now);
    if (flowing || settling || squishing || turning || yaw !== target)
      raf = requestAnimationFrame(frame);
  }
  function update(next: PetPose, enabled: boolean, idle = true) {
    from = yaw;
    started = performance.now();
    // V2's three-quarter view exposes the left cheek and foreshortens the far eye.
    target = next === "front" ? 0 : next === "happy" ? 0.29 : 0.16;
    model.expression(next === "happy");
    // V2's hero is fuller than the upright drop: it carries part of the squish.
    squishTarget = next === "curious" ? 1 : next === "hero" ? 0.55 : 0;
    turnTarget = next === "curious" || next === "hero" ? 1 : 0;
    // The squish spring brings its own wobble in and out of curious.
    if (
      enabled &&
      pose &&
      pose !== next &&
      pose !== "curious" &&
      next !== "curious"
    )
      jiggleAt = started;
    pose = next;
    flowing = enabled && idle;
    lastFrame = started;
    if (!enabled) {
      from = target;
      started -= 240;
      jiggleAt = -Infinity;
      squish = squishTarget;
      squishVelocity = 0;
      turn = turnTarget;
      turnVelocity = 0;
    }
    if (!raf) frame();
  }
  /** Swap in a model built from new tuning values, at most once per frame. */
  function setShape(shape: PetShape) {
    pendingShape = shape;
    if (!rebuild) rebuild = requestAnimationFrame(applyShape);
  }
  function applyShape() {
    rebuild = 0;
    if (disposed || !pendingShape) return;
    const next = createPetModel(pendingShape);
    pendingShape = null;
    scene.remove(model.root);
    model.dispose();
    model = next;
    scene.add(model.root);
    model.root.rotation.y = yaw;
    model.expression(pose === "happy");
    model.squish(squish * 0.35);
    model.curious(turn);
    render();
  }
  function resize() {
    const width = Math.max(1, host.clientWidth),
      h = Math.max(1, host.clientHeight);
    camera.left = (-height * width) / h / 2;
    camera.right = -camera.left;
    camera.updateProjectionMatrix();
    renderer.setSize(width, h, false);
    render();
  }
  function visibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) frame();
  }
  function lost(event: Event) {
    event.preventDefault();
    unavailable();
  }
  const observer = new ResizeObserver(resize);
  const intersection = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen && !raf) frame();
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    cancelAnimationFrame(rebuild);
    observer.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    canvas.removeEventListener("webglcontextlost", lost);
    model.dispose();
    environment.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }
  try {
    resize();
    host.append(canvas);
    observer.observe(host);
    intersection.observe(host);
    document.addEventListener("visibilitychange", visibility);
    canvas.addEventListener("webglcontextlost", lost);
  } catch (error) {
    dispose();
    throw error;
  }
  return { update, setShape, dispose };
}
