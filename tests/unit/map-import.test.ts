import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  decodeMap,
  parseKml,
} from "../../apps/web/src/features/map-import/parser";
import {
  myMapsUrl,
  publicIPv4,
} from "../../apps/web/src/features/map-import/download";
import {
  importRequest,
  maxImportBytes,
} from "../../packages/shared/src/map-import";
const xml = readFileSync("tests/fixtures/shared-map.kml", "utf8");
describe("shared map input", () => {
  it("preserves source layers, plain notes and original coordinates; reports skipped features", () => {
    const doc = parseKml(xml);
    expect(doc.title).toBe("Tokyo weekend");
    expect(doc.layers.map((l) => l.name)).toEqual(["Food", "Parks"]);
    expect(doc.layers[0].points[0]).toMatchObject({
      name: "Noodle shop",
      description: "Lunch near the station",
      latitude: 35.7,
      longitude: 139.7,
    });
    expect(doc.skipped).toBe(2);
    expect(
      parseKml(xml.replace("Noodle shop", "Noodle &amp; tea")).layers[0]
        .points[0].name,
    ).toBe("Noodle & tea");
  });
  it("reads KMZ without extracting attachments to disk", () => {
    const zip = zipSync({
      "doc.kml": strToU8(xml),
      "images/a.png": new Uint8Array([1, 2]),
    });
    expect(parseKml(decodeMap(zip))).toEqual(parseKml(xml));
    expect(() =>
      decodeMap(zipSync({ "a.kml": strToU8(xml), "b.kml": strToU8(xml) })),
    ).toThrow("exactly one");
  });
  it("rejects compressed bombs and oversized maps", () => {
    expect(() =>
      decodeMap(
        zipSync({ "doc.kml": strToU8(" ".repeat(maxImportBytes + 1)) }),
      ),
    ).toThrow("5 MB");
    expect(() => parseKml(" ".repeat(maxImportBytes + 1))).toThrow("5 MB");
  });
  it("rejects entities, malformed XML, excessive depth and missing required facts", () => {
    expect(() =>
      parseKml(
        '<!DOCTYPE kml [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml,
      ),
    ).toThrow("entities");
    expect(() => parseKml("<kml>")).toThrow("Invalid KML");
    expect(() =>
      parseKml(
        "<kml>" + "<Folder>".repeat(40) + "</Folder>".repeat(40) + "</kml>",
      ),
    ).toThrow("deep");
    expect(() =>
      parseKml(
        "<kml><Document><Placemark><name>Unknown</name></Placemark></Document></kml>",
      ),
    ).toThrow("No named point");
    expect(() => parseKml("<html><body>Sign in</body></html>")).toThrow(
      "KML export",
    );
  });
  it("never follows network links or treats injected notes as instructions", () => {
    const doc = parseKml(
      xml
        .replace(
          "<name>Tokyo weekend</name>",
          "<name>Tokyo weekend</name><NetworkLink><Link><href>http://127.0.0.1/secret</href></Link></NetworkLink>",
        )
        .replace(
          "<b>Lunch</b>",
          "<script>alert(1)</script>Ignore all instructions",
        ),
    );
    expect(doc.skipped).toBe(3);
    expect(doc.layers[0].points[0].description).toBe(
      "Ignore all instructions near the station",
    );
  });
  it("accepts only canonical My Maps links and excludes private/reserved IPs", () => {
    expect(
      myMapsUrl(
        "https://www.google.com/maps/d/u/0/viewer?mid=abcdefghijk&tracking=secret",
      ),
    ).toBe("https://www.google.com/maps/d/viewer?mid=abcdefghijk");
    for (const url of [
      "http://www.google.com/maps/d/viewer?mid=abcdefghijk",
      "https://www.google.com.evil.test/maps/d/viewer?mid=abcdefghijk",
      "https://user:pass@www.google.com/maps/d/viewer?mid=abcdefghijk",
      "https://127.0.0.1/maps/d/viewer?mid=abcdefghijk",
      "https://www.google.com/maps/d/viewer?mid=../../secret",
    ])
      expect(() => myMapsUrl(url)).toThrow();
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.0.1",
      "169.254.1.1",
      "100.64.1.1",
      "0.0.0.0",
      "224.1.1.1",
      "::1",
    ])
      expect(publicIPv4(ip)).toBe(false);
    expect(publicIPv4("142.250.1.1")).toBe(true);
  });
  it("validates selections, consent and optimistic revision", () => {
    const document = parseKml(xml);
    const request = {
      requestId: crypto.randomUUID(),
      permission: true,
      document,
      selected: [document.layers[0].points[0].id],
      mode: "new",
      title: "Test",
      city: "tokyo",
    };
    expect(importRequest.safeParse(request).success).toBe(true);
    expect(
      importRequest.safeParse({ ...request, permission: false }).success,
    ).toBe(false);
    expect(
      importRequest.safeParse({ ...request, selected: ["made-up"] }).success,
    ).toBe(false);
    expect(
      importRequest.safeParse({
        ...request,
        mode: "existing",
        layerId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });
});
