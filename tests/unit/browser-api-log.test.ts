import { describe, expect, it } from "vitest";
import {
  isBilledHost,
  shortenPath,
} from "../../apps/web/src/lib/browser-api-log";

describe("browser API log", () => {
  it("only treats billed provider hosts as reportable", () => {
    expect(isBilledHost("maps.googleapis.com")).toBe(true);
    expect(isBilledHost("api.mapbox.com")).toBe(true);
    expect(isBilledHost("events.mapbox.com")).toBe(true);
    expect(isBilledHost("evil.com")).toBe(false);
    expect(isBilledHost("mapbox.com.evil.com")).toBe(false);
  });

  it("cuts paths so search text in geocoding URLs is not kept", () => {
    expect(shortenPath("/maps/api/js")).toBe("/maps/api/js");
    expect(
      shortenPath("/geocoding/v5/mapbox.places/123 Main St Houston.json"),
    ).toBe("/geocoding/v5/mapbox.places/…");
  });
});
