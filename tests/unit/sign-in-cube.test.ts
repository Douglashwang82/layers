import { describe, expect, it } from "vitest";
import {
  CUBE_COUNT,
  createCubeModel,
  createCubeMotion,
  cubeBufferSize,
  rollingPosition,
} from "../../apps/web/src/components/sign-in-cube-model";

describe("rolling sign-in cubes", () => {
  it("moves toward the bottom left on every lane", () => {
    for (const lane of [-1, 0, 1]) {
      const start = rollingPosition(0.2, lane);
      const end = rollingPosition(0.8, lane);
      expect(end.x).toBeLessThan(start.x);
      expect(end.y).toBeLessThan(start.y);
    }
  });
  it("stops without jumping on input focus and resumes from the same pose", () => {
    const motion = createCubeMotion();
    motion.advance(2400);
    motion.setQuiet(true);
    motion.advance(5000);
    expect(motion.pose).toBe(2400);
    expect(motion.running).toBe(false);
    motion.setQuiet(false);
    motion.advance(100);
    expect(motion.pose).toBe(2500);
    motion.reset();
    expect(motion.pose).toBe(0);
  });
  it("staggers multiple cubes and leaves fading curved traces", () => {
    const model = createCubeModel(() => 0.5);
    expect(model.cubes).toHaveLength(CUBE_COUNT);
    expect(new Set(model.cubes.map((cube) => cube.start)).size).toBe(
      CUBE_COUNT,
    );
    model.applyPose(3000);
    const cube = model.cubes[2];
    expect(cube.mesh.visible).toBe(true);
    expect(cube.trails[0].position.x).toBeGreaterThan(cube.mesh.position.x);
    expect(cube.trails[0].position.y).toBeGreaterThan(cube.mesh.position.y);
    expect(cube.trails[0].material.opacity).toBeGreaterThan(
      cube.trails[4].material.opacity,
    );
    const rotation = cube.mesh.quaternion.clone();
    model.applyPose(3500);
    expect(cube.mesh.quaternion.equals(rotation)).toBe(false);
    model.dispose();
  });
  it("waits a random interval before recycling an offscreen cube", () => {
    const model = createCubeModel(() => 0.5);
    model.applyPose(20000);
    const cube = model.cubes[0];
    expect(cube.start).toBe(22400);
    expect(cube.mesh.visible).toBe(false);
    expect(cube.trails.every((line) => !line.visible)).toBe(true);
    model.applyPose(23000);
    expect(cube.mesh.visible).toBe(true);
    model.applyPose(0);
    expect(model.cubes[0].start).toBeCloseTo(0);
    model.dispose();
  });
  it("caps the render buffer to hardware limits", () => {
    expect(cubeBufferSize(760, 760, 8192)).toEqual({
      width: 3840,
      height: 3840,
    });
    expect(cubeBufferSize(760, 760, 2048)).toEqual({
      width: 2048,
      height: 2048,
    });
  });
});
