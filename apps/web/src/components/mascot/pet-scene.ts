import * as THREE from "three";
import { createPetModel } from "./pet-model";
import type { PetPose } from "./marker-pet";

/**
 * Reflection studio for the glossy skin: one large softbox at the upper left
 * (where the key light sits) gives a single sleek highlight, a warm floor
 * tints the belly, and a dim card on the right draws the far rim.
 */
function studio() {
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
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#fff4ea").multiplyScalar(brightness),
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(...at);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  card(3.6, 3, 20, [-4.4, 6.2, -1]);
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

export function createPetScene(host: HTMLElement, unavailable: () => void) {
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
  const model = createPetModel();
  scene.add(model.root);
  const room = studio(),
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
  scene.environmentIntensity = 0.6;
  // V2 lighting: soft key from the upper left, warm floor bounce on the belly.
  scene.add(new THREE.HemisphereLight(0xfff0e6, 0xf6b090, 0.4));
  const key = new THREE.DirectionalLight(0xfff0e4, 2.9);
  key.position.set(-5, 1.4, 3);
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
    lastFrame = 0;
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
    model.squish(squish);
    const settling = render(now);
    if (flowing || settling || squishing || yaw !== target)
      raf = requestAnimationFrame(frame);
  }
  function update(next: PetPose, enabled: boolean) {
    from = yaw;
    started = performance.now();
    target = next === "front" ? 0 : next === "happy" ? 0.29 : 0.27;
    model.expression(next === "happy");
    squishTarget = next === "curious" ? 1 : 0;
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
    flowing = enabled;
    lastFrame = started;
    if (!enabled) {
      from = target;
      started -= 240;
      jiggleAt = -Infinity;
      squish = squishTarget;
      squishVelocity = 0;
    }
    if (!raf) frame();
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
  return { update, dispose };
}
