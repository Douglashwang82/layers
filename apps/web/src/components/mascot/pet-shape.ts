/**
 * Tuning knobs. Lengths are model units (the pin is 2.52 tall) unless noted.
 * The origin is the geographic tip; all poses and motion keep it planted.
 * Kept free of Three.js so the /mascot tuning panel can read the defaults
 * without loading the renderer.
 */
export const petShape = {
  /** Front silhouette traced from V2: [height above tip, half-width] in reference px. */
  outline: [
    [0, 0],
    [1, 4.5],
    [5, 12.5],
    [9, 15.5],
    [13, 19.5],
    [17, 22],
    [21, 25],
    [25, 28],
    [29, 31],
    [33, 35],
    [37, 38],
    [41, 42],
    [45, 46],
    [49, 49.5],
    [53, 53],
    [57, 56.5],
    [61, 60],
    [65, 63],
    [69, 65.5],
    [73, 68],
    [77, 70.5],
    [81, 72],
    [85, 74],
    [89, 76],
    [93, 77],
    [97, 78.5],
    [101, 79.5],
    [105, 81],
    [109, 81],
    [113, 82],
    [117, 82.5],
    [121, 82.5],
    [125, 83],
    [129, 82.5],
    [133, 82.5],
    [137, 82],
    [141, 81.5],
    [145, 81],
    [149, 80.5],
    [153, 79.5],
    [157, 78.5],
    [161, 76.5],
    [165, 75.5],
    [169, 74],
    [173, 72],
    [177, 69.5],
    [181, 67.5],
    [185, 65.5],
    [189, 62.5],
    [193, 59.5],
    [197, 56.5],
    [201, 52.5],
    [205, 48],
    [209, 43.5],
    [213, 38],
    [217, 31],
    [221, 22],
    [223, 16],
    [224, 12],
    [225, 5.5],
    [225.5, 0],
  ] as [number, number][],
  /** Front-to-back thickness relative to the front silhouette width. */
  depth: 1.15,
  /** Front cross-section superellipse exponent (2 = ellipse, higher = broader front). */
  squareness: 2.6,
  /** How far the belly bulges forward over the tip (V2 3/4 and hero views). */
  lean: 0.4,
  skin: "#f07c5c",
  face: {
    color: "#f8d2bd",
    /** The pad darkens toward its edge, as in V2. */
    edgeColor: "#efb59a",
    y: 1.305,
    halfWidth: 0.594,
    halfHeight: 0.521,
    /** How far the face sits inside the skin, and the soft lip around it. */
    inset: 0.025,
    rim: 0.004,
    /** Painted occlusion: the lip shading the face edge, and the border crease. */
    shade: 0.16,
    crease: 0.42,
  },
  eyes: {
    x: 0.297,
    y: 1.294,
    halfWidth: 0.142,
    halfHeight: 0.224,
    /** Dark brown iris warming toward the bottom, inside a light bevel rim. */
    top: "#22130f",
    bottom: "#7d4834",
    rimColor: "#f1dccd",
    rimWidth: 0.015,
  },
  /** Happy-eye arcs: thickest at the crest, tapering to rounded ends. */
  smile: { thickness: 0.046, taper: 0.4 },
  /**
   * Skin finish (key kept for the tuning panel): V2's soft satin. `rim` is the
   * deeper coral the silhouette edges shade toward and `rimStrength` how much;
   * `core` is a faint inner light that keeps shadows warm instead of grey.
   */
  jelly: {
    rim: "#d4563c",
    rimStrength: 0.3,
    core: "#e85a4c",
    coreStrength: 0.05,
    roughness: 0.62,
    clearcoat: 0.12,
    clearcoatRoughness: 0.55,
    sheen: 0.35,
  },
  /** Idle liquid motion amplitudes. */
  flow: { breathe: 0.018, sway: 0.035, ripple: 0.022 },
  /** Curious pose: settle lower and wider, lean forward and to the side. */
  squish: {
    compress: 0.35,
    bulge: 0.07,
    blunt: 0.3,
    shear: -0.03,
    lean: 0.035,
    tilt: 0.07,
  },
};

export type PetShape = typeof petShape;
