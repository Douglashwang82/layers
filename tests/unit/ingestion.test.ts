import { describe, expect, it } from "vitest";
import {
  safeSlug,
  stableHash,
  validateFields,
} from "../../packages/database/src/ingestion";

const organization = {
  name: "Houston Taiwan Group",
  description: "Community events",
  image: "https://example.org/logo.png",
  category: "Culture",
};
describe("content collection boundaries", () => {
  it("requires evidence-backed fields for a new listing", () => {
    expect(validateFields("organizations", organization).issues).toEqual([]);
    expect(validateFields("organizations", { name: "Group" }).issues).toContain(
      "Missing image",
    );
    expect(
      validateFields("organizations", { ...organization, website: "" }).fields
        .website,
    ).toBeUndefined();
  });
  it("rejects markup, unknown fields, and invalid event time", () => {
    const event = validateFields("events", {
      ...organization,
      name: "<script>",
      organizerId: crypto.randomUUID(),
      venue: "Hall",
      neighborhood: "Westchase",
      address: "Houston",
      latitude: 29.7,
      longitude: -95.4,
      startTime: "2026-09-21T12:00:00Z",
      endTime: "2026-09-21T11:00:00Z",
      fakeVote: 100,
    });
    expect(event.issues).toContain("Invalid name");
    expect(event.issues).toContain("Event end must follow start");
    expect(event.issues).toContain("Unknown field: fakeVote");
  });
  it("keeps source identity stable", () => {
    expect(stableHash(organization)).toBe(stableHash(organization));
    expect(safeSlug("臺灣社團", "12345678-1234-1234-1234-123456789abc")).toBe(
      "listing-12345678",
    );
  });
});
