import { XMLParser, XMLValidator } from "fast-xml-parser";
import { Unzip, UnzipInflate } from "fflate";
import { AppError } from "@taiwanhub/shared";
import {
  importDocument,
  maxImportBytes,
  type ImportDocument,
} from "@taiwanhub/shared/map-import";

function invalid(message: string): never {
  throw new AppError(400, "INVALID_MAP", message);
}
type XmlNode = Record<string, unknown>;
function object(value: unknown): XmlNode {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlNode)
    : {};
}
function list(value: unknown): unknown[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}
function plain(value: unknown, max: number): string {
  const text =
    typeof value === "string" ? value : String(object(value)["#text"] ?? "");
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
/** No external entities, network links, HTML rendering, or coordinate guessing. */
export function parseKml(xml: string, sourceUrl = ""): ImportDocument {
  if (Buffer.byteLength(xml) > maxImportBytes) invalid("Map exceeds 5 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    invalid("XML entities and document types are not supported.");
  if (XMLValidator.validate(xml) !== true) invalid("Invalid KML XML.");
  // Bound depth before invoking the recursive XML parser.
  let depth = 0;
  for (const tag of xml
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, "")
    .matchAll(/<\/?[A-Za-z][^>]*>/g)) {
    if (tag[0].startsWith("</")) depth--;
    else if (!tag[0].endsWith("/>")) depth++;
    if (depth > 32) invalid("KML nesting is too deep.");
  }
  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: true,
  }).parse(xml);
  const root = object(object(parsed).kml);
  if (!Object.keys(root).length)
    invalid("Choose a KML export, not a web page.");
  const doc = object(root.Document ?? root);
  const result: ImportDocument = {
    title: plain(doc.name, 80) || "Imported map",
    sourceUrl,
    layers: [],
    skipped: 0,
  };
  let count = 0;
  function visit(node: XmlNode, path: string, level: number) {
    if (level > 20) invalid("Too many nested folders.");
    const layer: ImportDocument["layers"][number] = {
      id: `layer-${result.layers.length}`,
      name: (path || result.title).slice(0, 80),
      points: [],
    };
    if (node.Placemark) {
      result.layers.push(layer);
      for (const raw of list(node.Placemark)) {
        if (++count > 1000) invalid("Import at most 1,000 markers at a time.");
        const p = object(raw);
        const coordinates = plain(object(p.Point).coordinates, 200).split(
          /\s+/,
        );
        const tuple = coordinates[0]?.split(",");
        const lon = Number(tuple?.[0]),
          lat = Number(tuple?.[1]);
        const name = plain(p.name, 160);
        if (
          !name ||
          coordinates.length !== 1 ||
          !tuple?.[0] ||
          !tuple?.[1] ||
          !Number.isFinite(lon) ||
          !Number.isFinite(lat) ||
          Math.abs(lon) > 180 ||
          Math.abs(lat) > 90
        ) {
          result.skipped++;
          continue;
        }
        layer.points.push({
          id: `point-${count}`,
          name,
          longitude: lon,
          latitude: lat,
          description: plain(p.description, 2000),
          address: plain(p.address, 300),
        });
      }
    }
    result.skipped +=
      list(node.NetworkLink).length + list(node.GroundOverlay).length;
    for (const child of [...list(node.Folder), ...list(node.Document)]) {
      const folder = object(child);
      const name = plain(folder.name, 80) || "Untitled layer";
      visit(folder, path ? `${path} / ${name}` : name, level + 1);
    }
  }
  visit(doc, "", 0);
  if (!result.layers.some((l) => l.points.length))
    invalid("No named point markers with valid coordinates were found.");
  return importDocument.parse(result);
}

/** Streaming inflate bounds actual output, including archives with dishonest sizes. */
export function decodeMap(bytes: Uint8Array): string {
  if (bytes.length > maxImportBytes) invalid("Map exceeds 5 MB.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let entries = 0,
    expanded = 0;
  const files: Uint8Array[] = [];
  const unzip = new Unzip((file) => {
    if (++entries > 200) invalid("KMZ contains too many files.");
    if (!/\.kml$/i.test(file.name)) return;
    if (file.originalSize && file.originalSize > maxImportBytes)
      invalid("Expanded KML exceeds 5 MB.");
    const chunks: Uint8Array[] = [];
    file.ondata = (error, data, final) => {
      if (error) invalid("Invalid KMZ archive.");
      expanded += data.length;
      if (expanded > maxImportBytes) {
        file.terminate();
        invalid("Expanded KML exceeds 5 MB.");
      }
      chunks.push(data);
      if (final) files.push(Buffer.concat(chunks));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 4096)
    unzip.push(bytes.subarray(i, i + 4096), i + 4096 >= bytes.length);
  if (files.length !== 1)
    invalid(
      "KMZ must contain exactly one KML file. Export the entire map as KML instead.",
    );
  return new TextDecoder("utf-8", { fatal: true }).decode(files[0]);
}
