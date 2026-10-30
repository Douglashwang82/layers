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
  has_body: false,
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
      row({ custom_place_id: "c", catalog_id: "q", has_body: true }),
      // A hidden subject.
      row({ subject_id: "s", stars: 5 }),
    ];
    const visible = new Map([
      ["place:p", new Set(["L1"])],
      ["place:q", new Set(["L1"])],
    ]);
    expect(aggregateReviewPreviews(rows, visible)).toEqual({
      "place:p": {
        averageStars: 4,
        ratedCount: 1,
        commentCount: 0,
        reviewerCount: 1,
        reviewers: [{ name: "Ann", image: null }],
      },
      "place:q": {
        averageStars: null,
        ratedCount: 0,
        commentCount: 1,
        reviewerCount: 1,
        reviewers: [{ name: "Ann", image: null }],
      },
    });
  });

  it("merges layers by raw reviews and caps distinct reviewers", () => {
    const at = (day: number) => new Date(`2026-10-0${day}T00:00:00Z`);
    const rows = [
      row({ place_id: "p", stars: 5, user_id: "u1", created_at: at(1) }),
      row({
        layer_id: "L2",
        place_id: "p",
        stars: 4,
        user_id: "u1",
        created_at: at(2),
      }),
      row({
        place_id: "p",
        stars: 4,
        user_id: "u2",
        author_name: "Bo",
        created_at: at(3),
      }),
      row({
        place_id: "p",
        user_id: "u3",
        author_name: "Cy",
        created_at: at(4),
        has_body: true,
      }),
      row({
        place_id: "p",
        user_id: "u4",
        author_name: "Di",
        created_at: at(5),
      }),
    ];
    const preview = aggregateReviewPreviews(
      rows,
      new Map([["place:p", new Set(["L1", "L2"])]]),
    )["place:p"];
    expect(preview).toMatchObject({
      averageStars: 4.3,
      ratedCount: 3,
      commentCount: 1,
      reviewerCount: 4,
    });
    expect(preview.reviewers.map((r) => r.name)).toEqual(["Di", "Cy", "Bo"]);
  });
});
