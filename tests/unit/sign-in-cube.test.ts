import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CUBE_COUNT,
  CUBE_SIDE,
  CUBE_STEP_MS,
  createCubeModel,
  createCubeMotion,
  cubeBufferSize,
  rollingPose,
} from "../../apps/web/src/components/sign-in-cube-model";

describe("rolling sign-in cubes", () => {
  it("keeps both pivot corners on the ground throughout a quarter turn", () => {
    for (const fraction of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      const pose = rollingPose(3, fraction, 2);
      for (const x of [-CUBE_SIDE / 2, CUBE_SIDE / 2]) {
        const corner = new THREE.Vector3(x, -CUBE_SIDE / 2, CUBE_SIDE / 2)
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), pose.angle)
          .add(new THREE.Vector3(pose.x, pose.y, pose.z));
        expect(corner.y).toBeCloseTo(0);
        expect(corner.z).toBeCloseTo(pose.pivotZ);
      }
      // No corner may sink below the ground.
      for (const y of [-1, 1])
        for (const z of [-1, 1]) {
          const corner = new THREE.Vector3(
            0,
            (y * CUBE_SIDE) / 2,
            (z * CUBE_SIDE) / 2,
          ).applyAxisAngle(new THREE.Vector3(1, 0, 0), pose.angle);
          expect(corner.y + pose.y).toBeGreaterThanOrEqual(-1e-10);
        }
    }
    expect(rollingPose(3, 1, 2).z).toBeCloseTo(rollingPose(4, 0, 2).z);
  });
  it("uses exactly three fixed lanes with identical motion and no overtaking", () => {
    const model = createCubeModel(() => 0.5);
    expect(model.cubes).toHaveLength(CUBE_COUNT);
    expect(new Set(model.cubes.map((c) => c.x)).size).toBe(3);
    model.applyPose(100);
    const positions = model.cubes.map((c) => c.mesh.position.clone());
    model.applyPose(800);
    const movement = model.cubes.map((c, i) =>
      c.mesh.position.clone().sub(positions[i]),
    );
    movement.forEach((v) =>
      expect(v.distanceTo(movement[0])).toBeLessThan(1e-10),
    );
    for (const time of [5000, 50000, 100000]) {
      model.applyPose(time);
      expect(new Set(model.cubes.map((c) => c.mesh.position.x)).size).toBe(3);
      model.cubes.forEach((c) => expect(c.mesh.position.x).toBe(c.x));
    }
    model.dispose();
  });
  it("leaves complete face-sized squares fixed on the ground until the next landing", () => {
    const model = createCubeModel(() => 0.5);
    model.applyPose(200);
    const trail = model.cubes[0].trails[0];
    const position = trail.group.position.clone();
    expect(trail.group.children).toHaveLength(4);
    expect(position.y).toBe(0);
    const opacity = trail.material.opacity;
    model.applyPose(800);
    expect(trail.group.position.equals(position)).toBe(true);
    expect(trail.material.opacity).toBeLessThan(opacity);
    model.applyPose(CUBE_STEP_MS);
    expect(trail.group.position.z - position.z).toBeCloseTo(CUBE_SIDE);
    model.dispose();
  });
  it("freezes and resumes without jumping, and resets deterministically", () => {
    const motion = createCubeMotion();
    motion.advance(2400);
    motion.setQuiet(true);
    motion.advance(5000);
    expect(motion.pose).toBe(2400);
    expect(motion.running).toBe(false);
    motion.setQuiet(false);
    motion.advance(100);
    expect(motion.pose).toBe(2500);
    const model = createCubeModel(() => 0.5);
    const initial = model.cubes.map((c) => c.mesh.position.clone());
    model.applyPose(motion.pose);
    motion.reset();
    model.applyPose(motion.pose);
    model.cubes.forEach((c, i) =>
      expect(c.mesh.position.equals(initial[i])).toBe(true),
    );
    model.dispose();
  });
  it("caps the full rectangular buffer to hardware limits", () => {
    expect(cubeBufferSize(600, 900, 8192)).toEqual({
      width: 2560,
      height: 3840,
    });
    expect(cubeBufferSize(760, 760, 2048)).toEqual({
      width: 2048,
      height: 2048,
    });
  });
});
