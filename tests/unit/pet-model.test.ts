import { describe, expect, it } from "vitest";
import { Box3, Mesh, Vector3 } from "three";
import {
  createPetModel,
  frontZ,
  petShape,
} from "../../apps/web/src/components/mascot/pet-model";

describe("sculpted map pet", () => {
  it("keeps the geographic tip at the origin through every turn", () => {
    const model = createPetModel();
    for (const yaw of [0, 0.42, -0.42, Math.PI]) {
      model.root.rotation.y = yaw;
      model.root.updateMatrixWorld(true);
      expect(model.root.localToWorld(new Vector3()).length()).toBe(0);
      const bounds = new Box3().setFromObject(model.root);
      expect(bounds.min.y).toBeCloseTo(0, 5);
      expect(bounds.max.y).toBeGreaterThan(2.5);
      expect(bounds.max.z - bounds.min.z).toBeGreaterThan(1);
    }
    model.root.traverse((object) => {
      if (object instanceof Mesh) {
        expect(
          Array.from(object.geometry.attributes.position.array).every(
            Number.isFinite,
          ),
        ).toBe(true);
      }
    });
    model.dispose();
  });
  it("matches the traced V2 front silhouette", () => {
    const model = createPetModel();
    const body = model.root.children[0] as Mesh;
    const position = body.geometry.attributes.position;
    const px = 2.52 / 225.5;
    for (const [h, r] of petShape.outline) {
      if (h < 20 || h > 210) continue;
      let halfWidth = 0;
      for (let i = 0; i < position.count; i++)
        if (Math.abs(position.getY(i) - h * px) < 0.01)
          halfWidth = Math.max(halfWidth, Math.abs(position.getX(i)));
      // Within ~2 reference px after smoothing.
      expect(Math.abs(halfWidth - r * px)).toBeLessThan(0.022);
    }
    model.dispose();
  });
  it("shades the skin outward and seats the eyes on the face", () => {
    const model = createPetModel();
    const body = model.root.children[0] as Mesh;
    const { position, normal } = body.geometry.attributes;
    let inward = 0;
    for (let i = 0; i < position.count; i++) {
      const out = new Vector3(position.getX(i), 0, position.getZ(i));
      if (
        out.length() > 0.2 &&
        out.dot(new Vector3().fromBufferAttribute(normal, i)) < 0
      )
        inward++;
    }
    expect(inward).toBe(0);
    const eyes = model.root.children[1].children;
    expect(eyes).toHaveLength(2);
    for (const eye of eyes) {
      expect(eye.position.z).toBeCloseTo(
        frontZ(eye.position.x, eye.position.y) + 0.02,
        5,
      );
      expect(eye.position.z).toBeGreaterThan(1);
    }
    model.dispose();
  });
  it("disposes shared GPU resources once", () => {
    const model = createPetModel();
    const resources = new Set<object>();
    let releases = 0;
    model.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const resource of [
        object.geometry,
        ...(Array.isArray(object.material)
          ? object.material
          : [object.material]),
      ]) {
        if (resources.has(resource)) continue;
        resources.add(resource);
        resource.addEventListener("dispose", () => releases++);
      }
    });
    model.dispose();
    expect(releases).toBe(resources.size);
  });
});
