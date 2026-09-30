import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CITY_BUILDINGS, PARK_BLOCKS } from "./layout";

type Part = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  rotation?: number;
};

/** A procedural architectural miniature: no network assets or geographic claims. */
export function createCityWorld(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#061916");
  scene.fog = new THREE.FogExp2("#061916", 0.013);
  const city = new THREE.Group();
  scene.add(city);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const instances: THREE.InstancedMesh[] = [];
  const textures: THREE.Texture[] = [];
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment, 0.04);
  scene.environment = environmentMap.texture;
  scene.environmentIntensity = 0.35;
  environment.dispose();
  pmrem.dispose();
  const hemisphere = new THREE.HemisphereLight(0x9be5d1, 0x122923, 0.7);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xffd5a5, 2.8);
  key.position.set(-16, 28, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, {
    left: -20,
    right: 20,
    top: 20,
    bottom: -20,
    near: 1,
    far: 80,
  });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.04;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x64ffd0, 3.5);
  rim.position.set(8, 14, -20);
  scene.add(rim);

  function geometry<T extends THREE.BufferGeometry>(value: T) {
    geometries.add(value);
    return value;
  }
  function material<T extends THREE.Material>(value: T) {
    materials.add(value);
    return value;
  }
  const box = geometry(new THREE.BoxGeometry(1, 1, 1));
  const rounded = geometry(new RoundedBoxGeometry(1, 1, 1, 1, 0.07));
  const cylinder = geometry(new THREE.CylinderGeometry(0.42, 0.5, 1, 12));
  const matrix = new THREE.Object3D();
  const stone = material(
    new THREE.MeshStandardMaterial({
      color: "#153c33",
      roughness: 0.6,
      metalness: 0.35,
    }),
  );
  const metal = material(
    new THREE.MeshStandardMaterial({
      color: "#648c7c",
      roughness: 0.25,
      metalness: 0.85,
    }),
  );
  const glass = ["#276e61", "#577c73", "#a48b74"].map((color) =>
    material(
      new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.58,
        roughness: 0.24,
        clearcoat: 0.8,
        clearcoatRoughness: 0.19,
      }),
    ),
  );
  const warm = material(
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.3, 0.48) }),
  );
  const mint = material(
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 2.4, 1.4) }),
  );
  const dim = material(
    new THREE.MeshStandardMaterial({
      color: "#173b34",
      roughness: 0.25,
      metalness: 0.6,
    }),
  );
  function batch(
    parts: Part[],
    mat: THREE.Material,
    geo: THREE.BufferGeometry = box,
    shadow = false,
  ) {
    if (!parts.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, parts.length);
    parts.forEach((p, i) => {
      matrix.position.set(p.x, p.y, p.z);
      matrix.scale.set(p.w, p.h, p.d);
      matrix.rotation.set(0, p.rotation ?? 0, 0);
      matrix.updateMatrix();
      mesh.setMatrixAt(i, matrix.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    city.add(mesh);
    instances.push(mesh);
    return mesh;
  }
  function mesh(geo: THREE.BufferGeometry, mat: THREE.Material) {
    const object = new THREE.Mesh(geo, mat);
    city.add(object);
    return object;
  }
  // A carved, floating plinth with metallic laminations and an illuminated edge.
  batch(
    [{ x: 0, y: -0.8, z: 0, w: 26.2, h: 1.3, d: 22.2 }],
    stone,
    rounded,
    true,
  );
  batch([{ x: 0, y: -0.17, z: 0, w: 26.3, h: 0.065, d: 22.3 }], metal, rounded);
  batch(
    [{ x: 0, y: -0.08, z: 0, w: 25.8, h: 0.14, d: 21.8 }],
    stone,
    rounded,
    true,
  );
  const roads: Part[] = [],
    blocks: Part[] = [],
    lanes: Part[] = [],
    trees: Part[] = [];
  for (let block = 0; block < 30; block++) {
    const x = (block % 6) * 4 - 10,
      z = Math.floor(block / 6) * 4 - 8;
    blocks.push({ x, y: 0.045, z, w: 3.5, h: 0.08, d: 3.5 });
    for (let i = 0; i < (PARK_BLOCKS.has(block) ? 8 : 2); i++) {
      trees.push({
        x:
          x +
          (PARK_BLOCKS.has(block) ? Math.sin(i * 2.4) * 1.15 : i ? 1.5 : -1.5),
        y: 0.55,
        z: z + (PARK_BLOCKS.has(block) ? Math.cos(i * 2.4) * 1.15 : 1.5),
        w: 0.38,
        h: 0.85,
        d: 0.38,
      });
    }
  }
  for (let z = -10; z <= 10; z += 4) {
    roads.push({ x: 0, y: 0.03, z, w: 25.5, h: 0.025, d: 0.045 });
    for (let x = -12; x <= 12; x += 0.9)
      lanes.push({ x, y: 0.04, z: z + 0.18, w: 0.3, h: 0.02, d: 0.022 });
  }
  for (let x = -12; x <= 12; x += 4)
    roads.push({ x, y: 0.03, z: 0, w: 0.035, h: 0.025, d: 21.5 });
  batch(blocks, dim, rounded, true);
  batch(roads, material(new THREE.MeshBasicMaterial({ color: "#608e65" })));
  batch(lanes, warm);
  batch(
    trees,
    material(
      new THREE.MeshStandardMaterial({ color: "#3e8268", roughness: 0.9 }),
    ),
    geometry(new THREE.IcosahedronGeometry(0.5, 1)),
    true,
  );

  const bodies: Part[][] = [[], [], []],
    roundTowers: Part[] = [],
    crowns: Part[] = [],
    mullions: Part[] = [],
    darkWindows: Part[] = [],
    warmWindows: Part[] = [],
    greenWindows: Part[] = [];
  CITY_BUILDINGS.forEach((b, index) => {
    const base = 0.12;
    const round = b.h > 4 && index % 7 === 0;
    const tiers = b.h > 5 ? 3 : 1;
    for (let tier = 0; tier < tiers; tier++) {
      const scale = 1 - tier * 0.15;
      const h = b.h / tiers;
      const part = {
        x: b.x,
        y: base + tier * h + h / 2,
        z: b.z,
        w: b.w * scale,
        h,
        d: b.d * scale,
      };
      (round ? roundTowers : bodies[index % 3]).push(part);
      crowns.push({
        ...part,
        y: base + (tier + 1) * h,
        h: 0.065,
        w: part.w + 0.035,
        d: part.d + 0.035,
      });
      if (round) continue;
      for (let floor = 0.22; floor < h - 0.1; floor += 0.3) {
        for (let col = -1; col <= 1; col++) {
          const target =
            (index * 7 + Math.floor(floor * 10) + col) % 5 === 0
              ? warmWindows
              : (index + col) % 7 === 0
                ? greenWindows
                : darkWindows;
          target.push({
            x: b.x + col * part.w * 0.27,
            y: base + tier * h + floor,
            z: b.z + part.d / 2 + 0.012,
            w: part.w * 0.19,
            h: 0.16,
            d: 0.014,
          });
          target.push({
            x: b.x + part.w / 2 + 0.012,
            y: base + tier * h + floor,
            z: b.z + col * part.d * 0.27,
            w: 0.014,
            h: 0.16,
            d: part.d * 0.19,
          });
        }
      }
      if (b.h > 4)
        for (const edge of [-1, 1])
          mullions.push({
            x: b.x + edge * part.w * 0.46,
            y: part.y,
            z: b.z + part.d / 2 + 0.018,
            w: 0.025,
            h,
            d: 0.025,
          });
    }
    if (b.h > 7)
      crowns.push({
        x: b.x,
        y: base + b.h + 0.5,
        z: b.z,
        w: 0.035,
        h: 1,
        d: 0.035,
      });
  });
  bodies.forEach((parts, i) => batch(parts, glass[i], rounded, true));
  batch(roundTowers, glass[0], cylinder, true);
  batch(crowns, metal);
  batch(mullions, metal);
  batch(darkWindows, dim);
  batch(warmWindows, warm);
  batch(greenWindows, mint);

  // A sculptural, twisting landmark occupies one of the otherwise empty parks.
  const landmark: Part[] = [];
  for (let floor = 0; floor < 22; floor++)
    landmark.push({
      x: 10,
      y: 0.2 + floor * 0.37,
      z: 0,
      w: 1.7 - floor * 0.024,
      h: 0.22,
      d: 1.7 - floor * 0.024,
      rotation: floor * 0.065,
    });
  batch(landmark, metal, rounded, true);
  batch(
    [{ x: 10, y: 4.1, z: 0, w: 0.55, h: 8.2, d: 0.55 }],
    glass[0],
    rounded,
    true,
  );

  // An elevated transit ribbon winds around the district, with flowing light.
  const routePoints = Array.from({ length: 96 }, (_, i) => {
    const a = (i / 96) * Math.PI * 2;
    return new THREE.Vector3(
      Math.cos(a) * 14.6,
      0.7 + (Math.sin(a - 0.6) + 1) * 1.5,
      Math.sin(a) * 12.1,
    );
  });
  const route = new THREE.CatmullRomCurve3(routePoints, true);
  mesh(geometry(new THREE.TubeGeometry(route, 192, 0.055, 5, true)), metal);
  const ribbon = material(
    new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vUv; uniform float time; void main(){ float head=fract(vUv.x-time*.027); float streak=pow(1.-head,24.); float bead=pow(.5+.5*cos((vUv.x-time*.018)*100.),24.); vec3 light=mix(vec3(.13,.32,.22),vec3(1.8,3.8,1.4),streak); gl_FragColor=vec4(light+bead*vec3(.12,.35,.2),1.); }`,
    }),
  );
  mesh(
    geometry(new THREE.TubeGeometry(route, 256, 0.031, 4, true)),
    ribbon,
  ).position.y = 0.07;
  const supports: Part[] = [];
  for (let i = 0; i < 16; i++) {
    const p = route.getPointAt(i / 16);
    supports.push({
      x: p.x,
      y: (p.y - 0.5) / 2,
      z: p.z,
      w: 0.075,
      h: p.y + 0.5,
      d: 0.075,
    });
  }
  batch(supports, metal);

  // A fine orbit beyond the island adds depth without more large surfaces.
  const orbit = mesh(
    geometry(new THREE.TorusGeometry(17.2, 0.016, 3, 180)),
    material(
      new THREE.MeshBasicMaterial({
        color: "#57766a",
        transparent: true,
        opacity: 0.4,
      }),
    ),
  );
  orbit.rotation.x = Math.PI / 2;
  orbit.position.y = -1.3;
  const trafficParts = Array.from({ length: 28 }, (_, i) => ({
    x: (i % 7) * 3.5 - 12,
    y: 0.16,
    z: (i % 5) * 4 - 9.84,
    w: 0.32,
    h: 0.07,
    d: 0.06,
  }));
  const traffic = batch(trafficParts, warm)!;
  traffic.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  traffic.frustumCulled = false;

  // A soft pool of light beneath the suspended city, generated locally.
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(78,157,111,.25)");
  gradient.addColorStop(1, "rgba(78,157,111,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(shadowCanvas);
  textures.push(texture);
  const halo = mesh(
    geometry(new THREE.PlaneGeometry(65, 50)),
    material(
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    ),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -2.5;

  const particlePositions = new Float32Array(110 * 3);
  for (let i = 0; i < 110; i++) {
    particlePositions[i * 3] = Math.sin(i * 17.3) * 26;
    particlePositions[i * 3 + 1] = (i % 23) * 0.65 - 2;
    particlePositions[i * 3 + 2] = Math.cos(i * 7.9) * 20;
  }
  const particlesGeo = geometry(new THREE.BufferGeometry());
  particlesGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(particlePositions, 3),
  );
  const particles = new THREE.Points(
    particlesGeo,
    material(
      new THREE.PointsMaterial({
        color: "#b7e5c1",
        size: 0.045,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    ),
  );
  scene.add(particles);

  return {
    scene,
    animate(seconds: number) {
      ribbon.uniforms.time.value = seconds;
      particles.rotation.y = seconds * 0.009;
      trafficParts.forEach((part, i) => {
        matrix.position.set(
          ((((part.x + 12 + seconds * (i % 2 ? 0.9 : -0.7)) % 24) + 24) % 24) -
            12,
          part.y,
          part.z,
        );
        matrix.scale.set(part.w, part.h, part.d);
        matrix.rotation.set(0, 0, 0);
        matrix.updateMatrix();
        traffic.setMatrixAt(i, matrix.matrix);
      });
      traffic.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      instances.forEach((value) => value.dispose());
      geometries.forEach((value) => value.dispose());
      materials.forEach((value) => value.dispose());
      textures.forEach((value) => value.dispose());
      environmentMap.dispose();
      key.shadow.map?.dispose();
    },
  };
}
