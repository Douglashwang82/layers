import { describe, expect, it } from "vitest";
import { Box3, Mesh, ShaderMaterial, Vector3 } from "three";
import {
  createCubeModel,
  createCubeMotion,
  cubeBufferSize,
  cubeFrame,
  surfaceFrame,
  CUBE_LOOP_MS,
  QUIET_RETURN_MS,
} from "../../apps/web/src/components/sign-in-cube-model";

describe("sign-in cube", () => {
  it("stages distinct local morphs, clockwise/counterclockwise turns and polarity sweeps", () => {
    expect(surfaceFrame(1600)).toMatchObject({
      face: 2,
      layer: 3,
      tile: 6,
      morph: 1,
      wipe: 0,
      spin: Math.PI / 2,
    });
    expect(surfaceFrame(3250)).toMatchObject({
      face: 0,
      layer: 2,
      tile: 5,
      morph: 0,
      wipe: 1,
      spin: -Math.PI / 2,
    });
    expect(surfaceFrame(4975)).toMatchObject({
      face: 4,
      layer: 1,
      tile: 10,
      morph: 1,
      wipe: 1,
      spin: Math.PI,
    });
    for (const time of [0, 800, 2400, 4100, 5900, 7999, 8000]) {
      expect(surfaceFrame(time)).toMatchObject({
        tile: -1,
        spin: 0,
        morph: 0,
        wipe: 0,
      });
    }
    for (const boundary of [900, 2300, 2500, 4000, 4200, 5750]) {
      for (const key of ["spin", "morph", "wipe"] as const) {
        expect(surfaceFrame(boundary - 0.1)[key]).toBeCloseTo(
          surfaceFrame(boundary + 0.1)[key],
          5,
        );
      }
    }
  });
  it("targets one slice surface and preserves the same effect on the recessed top tile", () => {
    const model = createCubeModel();
    model.applyPose(cubeFrame(3250));
    const active: ShaderMaterial[] = [];
    model.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (
          material instanceof ShaderMaterial &&
          material.uniforms.activeTile?.value >= 0
        )
          active.push(material);
      }
    });
    expect(active).toHaveLength(1);
    expect(active[0].uniforms.wipe.value).toBe(1);
    model.applyPose(cubeFrame(1600));
    const top = (model.layers[3].children[0] as Mesh)
      .material as ShaderMaterial[];
    const recess = model.tile.material[2] as ShaderMaterial;
    expect(recess.uniforms.activeTile.value).toBe(
      top[2].uniforms.activeTile.value,
    );
    expect(recess.uniforms.morph.value).toBe(1);
    model.dispose();
  });
  it("runs the complete eight-second narrative and rests seamlessly at the boundary", () => {
    expect(CUBE_LOOP_MS).toBe(8000);
    expect(cubeFrame(0)).toMatchObject({ sink: 0, spread: 0, phase: "whole" });
    expect(cubeFrame(2000)).toMatchObject({
      sink: 1,
      spread: 0,
      phase: "sink",
    });
    expect(cubeFrame(4000)).toMatchObject({
      sink: 0,
      spread: 1,
      phase: "open",
    });
    expect(cubeFrame(5000).spread).toBeGreaterThan(0);
    expect(cubeFrame(5000).spread).toBeLessThan(1);
    expect(cubeFrame(7900)).toMatchObject({
      sink: 0,
      spread: 0,
      phase: "rest",
    });
    expect(cubeFrame(8000)).toEqual(cubeFrame(0));
    for (const boundary of [1100, 1900, 2500, 3100, 3600, 4400, 5900, 8000]) {
      expect(cubeFrame(boundary - 0.1).spread).toBeCloseTo(
        cubeFrame(boundary + 0.1).spread,
        3,
      );
      expect(cubeFrame(boundary - 0.1).sink).toBeCloseTo(
        cubeFrame(boundary + 0.1).sink,
        3,
      );
    }
  });
  it("has four true slices, a recessed tile, and exact reassembly at 85% size", () => {
    const model = createCubeModel();
    const initial = model.layers.map((layer) => layer.position.clone());
    const restBounds = new Box3().setFromObject(model.layers[0].parent!);
    expect(model.root.scale.toArray()).toEqual([0.85, 0.85, 0.85]);
    expect(model.layers).toHaveLength(4);
    model.applyPose(cubeFrame(2000));
    expect(model.tile.position.y).toBeCloseTo(0.03);
    model.applyPose(cubeFrame(4000));
    expect(model.layers[2].position.x).toBeCloseTo(0.66);
    expect(model.layers[2].rotation.y).toBeCloseTo(0.18);
    expect(model.shadow.position.x).toBeGreaterThan(0);
    expect(model.movingShadow.material.uniforms.opacity.value).toBeGreaterThan(
      0,
    );
    model.applyPose(cubeFrame(8000));
    model.layers.forEach((layer, index) => {
      expect(layer.position.toArray()).toEqual(initial[index].toArray());
      expect(layer.rotation.y).toBe(0);
    });
    expect(
      new Box3().setFromObject(model.root).getSize(new Vector3()).toArray(),
    ).toEqual(restBounds.getSize(new Vector3()).toArray());
    expect(model.tile.position.y).toBeCloseTo(0.23);
    model.dispose();
  });
  it("maps each slice to its original row, preserving 4x4 face continuity", () => {
    const model = createCubeModel();
    model.layers.forEach((layer, index) => {
      const mesh = layer.children[0] as Mesh;
      const materials = mesh.material as ShaderMaterial[];
      for (const face of [0, 1, 4, 5]) {
        expect(materials[face].uniforms.uvScale.value.toArray()).toEqual([
          1, 0.25,
        ]);
        expect(materials[face].uniforms.uvOffset.value.toArray()).toEqual([
          0,
          index / 4,
        ]);
      }
    });
    model.dispose();
  });
  it("returns smoothly from any pose when focusing and stays quiet until leaving", () => {
    for (const at of [1600, 2800, 4000, 5000]) {
      const motion = createCubeMotion();
      motion.advance(at);
      const before = { ...motion.pose };
      motion.setQuiet(true);
      expect(motion.pose).toEqual(before);
      motion.advance(QUIET_RETURN_MS / 2);
      expect(motion.pose.sink).toBeCloseTo(before.sink / 2);
      expect(motion.pose.spread).toBeCloseTo(before.spread / 2);
      expect(motion.pose.surface.spin).toBeCloseTo(before.surface.spin / 2);
      expect(motion.pose.surface.morph).toBeCloseTo(before.surface.morph / 2);
      expect(motion.pose.surface.wipe).toBeCloseTo(before.surface.wipe / 2);
      motion.advance(QUIET_RETURN_MS / 2);
      expect(motion.pose).toMatchObject({
        sink: 0,
        spread: 0,
        surface: { spin: 0, morph: 0, wipe: 0 },
      });
      expect(motion.running).toBe(false);
      expect(motion.phase).toBe("quiet");
      motion.advance(8000);
      expect(motion.pose).toMatchObject({
        sink: 0,
        spread: 0,
        surface: { spin: 0, morph: 0, wipe: 0 },
      });
      motion.setQuiet(false);
      motion.advance(4000);
      expect(motion.phase).toBe("open");
    }
  });
  it("finishes the return if focus leaves early, and reduced motion reset assembles immediately", () => {
    const motion = createCubeMotion();
    motion.advance(4000);
    motion.setQuiet(true);
    motion.advance(100);
    const partial = { ...motion.pose };
    motion.setQuiet(false);
    expect(motion.pose).toEqual(partial);
    motion.advance(500);
    expect(motion.pose.spread).toBe(0);
    motion.advance(4000);
    motion.reset();
    expect(motion.pose.spread).toBe(0);
    expect(motion.elapsed).toBe(0);
  });
  it("uses a 4K long edge, preserves aspect ratio, and respects GPU limits", () => {
    expect(cubeBufferSize(1920, 1080, 8192)).toEqual({
      width: 3840,
      height: 2160,
    });
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
