import { beforeAll, describe, expect, it } from "vitest";
import {
  aggregateReviewPreviews,
  type PreviewRow,
} from "../../apps/web/src/features/reviews/map-previews";
import { flags } from "../../apps/web/src/lib/config";

beforeAll(() => {
  flags.layerCustomPlaces = true;
});

const row = (patch: Partial<PreviewRow>): PreviewRow => ({
  review_id: crypto.randomUUID(),
  layer_id: "L1",
  place_id: null,
  event_id: null,
  subject_id: null,
  custom_place_id: null,
  catalog_id: null,
  user_id: "u1",
  stars: null,
  body: "",
  author_name: "Ann",
  author_image: null,
  created_at: new Date("2026-10-01T00:00:00Z"),
  ...patch,
});

describe("aggregateReviewPreviews", () => {
  it("keys rows only where the map renders them, per layer", () => {
    const rows = [
      row({ place_id: "p", stars: 4 }),
      // Same place reviewed in a layer where it is not rendered.
      row({ layer_id: "L2", place_id: "p", stars: 1, user_id: "u2" }),
      // A custom place shown as its approved catalog place.
      row({ custom_place_id: "c", catalog_id: "q", body: "Nice" }),
      // A hidden subject.
      row({ subject_id: "s", stars: 5 }),
    ];
    const visible = new Map([
      ["place:p", new Set(["L1"])],
      ["place:q", new Set(["L1"])],
    ]);
    expect(aggregateReviewPreviews(rows, visible)).toEqual({
      "place:p": {
        reviewerCount: 1,
        reviews: [{ name: "Ann", image: null, stars: 4, comment: "" }],
      },
      "place:q": {
        reviewerCount: 1,
        reviews: [{ name: "Ann", image: null, stars: null, comment: "Nice" }],
      },
    });
  });

  it("shows each reviewer's newest review, capped, with a short comment", () => {
    const at = (day: number) => new Date(`2026-10-0${day}T00:00:00Z`);
    const visible = new Map([["place:p", new Set(["L1", "L2"])]]);
    const ann = [
      row({ place_id: "p", stars: 5, created_at: at(1) }),
      row({
        layer_id: "L2",
        place_id: "p",
        stars: 4,
        body: "Second visit",
        created_at: at(2),
      }),
    ];
    // Ann's newer review (layer L2) wins over the older one.
    expect(aggregateReviewPreviews(ann, visible)["place:p"].reviews).toEqual([
      { name: "Ann", image: null, stars: 4, comment: "Second visit" },
    ]);
    const rows = [
      ...ann,
      row({
        place_id: "p",
        stars: 2,
        user_id: "u2",
        author_name: "Bo",
        body: "好".repeat(200),
        created_at: at(3),
      }),
      row({
        place_id: "p",
        user_id: "u3",
        author_name: "Cy",
        created_at: at(4),
      }),
      row({
        place_id: "p",
        user_id: "u4",
        author_name: "Di",
        created_at: at(5),
      }),
    ];
    const preview = aggregateReviewPreviews(rows, visible)["place:p"];
    expect(preview.reviewerCount).toBe(4);
    expect(preview.reviews.map((r) => r.name)).toEqual(["Di", "Cy", "Bo"]);
    expect(preview.reviews[2].stars).toBe(2);
    expect(Array.from(preview.reviews[2].comment)).toHaveLength(140);
    expect(preview.reviews[2].comment.endsWith("…")).toBe(true);
  });
});
