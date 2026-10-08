import * as THREE from "three";
import {
  CUBE_FPS,
  createCubeModel,
  createCubeMotion,
  cubeBufferSize,
} from "./sign-in-cube-model";

export function createSignInCube(host: HTMLElement, unavailable: () => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const model = createCubeModel();
  const motion = createCubeMotion();
  const scene = new THREE.Scene();
  scene.add(model.root);
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 30);
  camera.position.set(6, 6, 6);
  camera.lookAt(0, 0, 0);
  renderer.setClearColor(0xffffff, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.debug.onShaderError = () => {
    throw new Error("Cube shader unavailable");
  };
  const canvas = renderer.domElement;
  canvas.dataset.targetFps = String(CUBE_FPS);
  const gl = renderer.getContext();
  const maxSize = Math.min(
    renderer.capabilities.maxTextureSize,
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
  );
  let disposed = false;
  let paused = true;
  let previous = 0;
  let lastRender = 0;
  let frame = 0;
  let visible = true;
  const panel = host.closest(".auth-stage")?.querySelector(".form-panel");
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const desktop = matchMedia("(min-width: 801px)");
  const draw = () => {
    model.applyPose(motion.pose);
    renderer.render(scene, camera);
    canvas.dataset.frame = String(Math.round(motion.elapsed));
    canvas.dataset.phase = motion.phase;
  };
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height || disposed) return;
    const size = cubeBufferSize(width, height, maxSize);
    renderer.setSize(size.width, size.height, false);
    const aspect = width / height;
    const halfHeight = 1.95 * Math.max(1, 1 / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    draw();
  };
  const shouldRun = () =>
    !disposed &&
    (!paused || motion.phase === "settling") &&
    motion.running &&
    !reduced.matches &&
    desktop.matches &&
    visible &&
    !document.hidden;
  const tick = (now: number) => {
    // The media value can change before its change event is dispatched.
    if (reduced.matches && !disposed) {
      motion.reset();
      draw();
      return;
    }
    if (!shouldRun()) return;
    if (!previous) previous = now;
    motion.advance(now - previous);
    previous = now;
    const interval = 1000 / CUBE_FPS;
    if (now - lastRender >= interval - 0.5 || !motion.running) {
      lastRender = now - ((now - lastRender) % interval);
      draw();
    }
    if (shouldRun()) frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    cancelAnimationFrame(frame);
    previous = 0;
    lastRender = 0;
    if (shouldRun()) frame = requestAnimationFrame(tick);
  };
  const preferenceChanged = () => {
    if (reduced.matches) {
      motion.reset();
      draw();
    }
    sync();
  };
  const focusChanged = () => {
    motion.setQuiet(!!panel?.contains(document.activeElement));
    if (reduced.matches) {
      motion.reset();
      draw();
    }
    sync();
  };
  const blur = () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(focusChanged, 0);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    intersection.disconnect();
    reduced.removeEventListener("change", preferenceChanged);
    desktop.removeEventListener("change", sync);
    document.removeEventListener("visibilitychange", sync);
    canvas.removeEventListener("webglcontextlost", lost);
    panel?.removeEventListener("focusin", focusChanged);
    panel?.removeEventListener("focusout", blur);
    clearTimeout(blurTimer);
    model.dispose();
    renderer.dispose();
    canvas.remove();
  };
  const lost = (event: Event) => {
    event.preventDefault();
    dispose();
    unavailable();
  };
  const observer = new ResizeObserver(resize);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  try {
    host.append(canvas);
    resize();
    observer.observe(host);
    intersection.observe(host);
    reduced.addEventListener("change", preferenceChanged);
    desktop.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    canvas.addEventListener("webglcontextlost", lost);
    panel?.addEventListener("focusin", focusChanged);
    panel?.addEventListener("focusout", blur);
    focusChanged();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    setPaused(value: boolean) {
      paused = value;
      sync();
    },
    dispose,
  };
}
