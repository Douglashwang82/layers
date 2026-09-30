import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { cityCameraPose } from "./layout";
import { createCityWorld } from "./world";

export type CityScene = {
  setActive: (active: boolean) => void;
  setMotion: (enabled: boolean) => void;
  dispose: () => void;
};

/** The scene owns its GPU lifetime; React never participates in the frame loop. */
export function createCityScene(
  host: HTMLElement,
  onUnavailable: () => void,
): CityScene {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const canvas = renderer.domElement;
  canvas.className = "sign-in-city-canvas";
  canvas.setAttribute("aria-hidden", "true");
  let world: ReturnType<typeof createCityWorld>;
  try {
    world = createCityWorld(renderer);
  } catch (error) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  }
  const camera = new THREE.PerspectiveCamera(39, 1, 0.5, 180);
  // Environment capture renders first; now cache the static city shadows.
  renderer.shadowMap.needsUpdate = true;
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(world.scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.55, 1.6);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
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
  const stage = host.closest(".auth-stage");

  function render() {
    const seconds = motion ? elapsed : 5;
    const pose = cityCameraPose(seconds);
    const angle = pose.azimuth + (motion ? rotation : 0);
    const elevation = pose.elevation + (motion ? tilt : 0);
    const distance = pose.distance * Math.max(1, 1.08 / camera.aspect);
    camera.position.set(
      Math.sin(angle) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance + 3,
      Math.cos(angle) * Math.cos(elevation) * distance,
    );
    camera.lookAt(0, 3, 0);
    world.animate(seconds);
    if (bloom.enabled) composer.render(0);
    else renderer.render(world.scene, camera);
  }
  function frame(now: number) {
    const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
    previous = now;
    elapsed += dt;
    const blend = 1 - Math.exp(-dt * 2.5);
    rotation += (pointerX * 0.16 - rotation) * blend;
    tilt += (pointerY * 0.07 - tilt) * blend;
    slowTime = dt > 0.024 ? slowTime + dt : Math.max(0, slowTime - dt);
    if (slowTime > 2.5) {
      if (renderer.getPixelRatio() > 0.8) {
        const ratio = Math.max(0.8, renderer.getPixelRatio() - 0.25);
        renderer.setPixelRatio(ratio);
        composer.setPixelRatio(ratio);
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
      } else bloom.enabled = false;
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
    camera.aspect = width / height;
    // Architectural scene sits below the editorial headline.
    camera.setViewOffset(width, height, 0, -height * 0.04, width, height);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
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
    renderPass.dispose();
    bloom.dispose();
    output.dispose();
    composer.dispose();
    world.dispose();
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
