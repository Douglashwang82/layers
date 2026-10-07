import { describe, expect, it } from "vitest";
import {
  createCubeModel,
  cubeBufferSize,
  cubeFrame,
  TILE_DURATION_MS,
} from "../../apps/web/src/components/sign-in-cube-model";

describe("sign-in cube", () => {
  it("visits every tile on all three visible faces exactly once per cycle", () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < 48; slot++) {
      const frame = cubeFrame(slot * TILE_DURATION_MS);
      expect([0, 2, 4]).toContain(frame.face);
      expect(frame.tile).toBeGreaterThanOrEqual(0);
      expect(frame.tile).toBeLessThan(16);
      expect(frame.progress).toBe(0);
      seen.add(`${frame.face}:${frame.tile}`);
    }
    expect(seen.size).toBe(48);
    expect(cubeFrame(48 * TILE_DURATION_MS)).toEqual(cubeFrame(0));
  });
  it("settles before switching cells and only animates one material", () => {
    const model = createCubeModel();
    expect(model.mesh.geometry.groups).toHaveLength(6);
    for (let time = 0; time < 6000; time += 100) {
      model.update(time);
      expect(
        model.mesh.material.filter((m) => m.uniforms.activeTile.value >= 0),
      ).toHaveLength(1);
      expect(cubeFrame(time).progress).toBeGreaterThanOrEqual(0);
      expect(cubeFrame(time).progress).toBeLessThanOrEqual(1);
    }
    expect(cubeFrame(450).progress).toBeCloseTo(0.5);
    expect(cubeFrame(900).progress).toBe(1);
    expect(cubeFrame(1199).progress).toBe(1);
    model.dispose();
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
