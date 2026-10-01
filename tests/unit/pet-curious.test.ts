import { describe, expect, it } from "vitest";
import { createPetModel } from "../../apps/web/src/components/mascot/pet-model";

describe("V2 curious perspective", () => {
  it("enlarges the near eye and narrows the far eye only while curious", () => {
    const model = createPetModel();
    const [near, far] = model.root.children[1].children;
    const positions = [near.position.clone(), far.position.clone()];
    model.curious(0.5);
    const intermediate = near.scale.x;
    model.curious(1);
    expect(near.scale.x).toBeGreaterThan(intermediate);
    expect(near.scale.x / far.scale.x).toBeGreaterThan(1.2);
    expect(near.scale.y).toBeGreaterThan(far.scale.y);
    // Scale about each eye's center; the shared shader tilts the whole face.
    expect(near.position.equals(positions[0])).toBe(true);
    expect(far.position.equals(positions[1])).toBe(true);
    model.curious(0);
    expect(near.scale.toArray()).toEqual([1, 1, 1]);
    expect(far.scale.toArray()).toEqual([1, 1, 1]);
    model.dispose();
  });

  it("bounds the eye perspective during spring overshoot", () => {
    const model = createPetModel();
    const eyes = model.root.children[1].children;
    model.curious(1);
    const settled = eyes.map((eye) => eye.scale.toArray());
    model.curious(1.2);
    expect(eyes.map((eye) => eye.scale.toArray())).toEqual(settled);
    model.curious(-0.1);
    expect(eyes.map((eye) => eye.scale.toArray())).toEqual([
      [1, 1, 1],
      [1, 1, 1],
    ]);
    model.dispose();
  });
});
