import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { AppError } from "@taiwanhub/shared";
import { maxImportBytes } from "@taiwanhub/shared/map-import";

export function myMapsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      400,
      "INVALID_URL",
      "Paste a Google My Maps viewer link.",
    );
  }
  const mid = url.searchParams.get("mid");
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.google.com" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/maps\/d\/(?:u\/\d+\/)?(?:viewer|edit)$/.test(url.pathname) ||
    !mid ||
    !/^[\w-]{10,200}$/.test(mid)
  )
    throw new AppError(
      400,
      "INVALID_URL",
      "Paste a Google My Maps viewer link.",
    );
  return `https://www.google.com/maps/d/viewer?mid=${mid}`;
}
export function publicIPv4(address: string) {
  const n = address.split(".").map(Number);
  return (
    n.length === 4 &&
    n.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) &&
    n[0] > 0 &&
    n[0] < 224 &&
    ![10, 127, 169].includes(n[0]) &&
    !(n[0] === 172 && n[1] >= 16 && n[1] <= 31) &&
    !(n[0] === 192 && [0, 168].includes(n[1])) &&
    !(n[0] === 100 && n[1] >= 64 && n[1] <= 127) &&
    !(n[0] === 198 && [18, 19, 51].includes(n[1])) &&
    !(n[0] === 203 && n[1] === 0)
  );
}
/** Fixed Google origin; pin validated DNS, reject every redirect, bound time and bytes. */
export async function downloadMap(value: string) {
  const canonical = myMapsUrl(value);
  const url = new URL(canonical.replace("/viewer?", "/kml?"));
  url.searchParams.set("forcekml", "1");
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true, family: 4 }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("DNS timeout")), 5000);
      timer.unref();
    }),
  ]);
  if (!addresses.length || addresses.some((a) => !publicIPv4(a.address)))
    throw new Error("Unsafe destination");
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const request = get(
      url,
      {
        family: 4,
        lookup: (_host, opts, callback) => {
          if (opts.all) callback(null, addresses);
          else callback(null, addresses[0].address, 4);
        },
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/vnd.google-earth.kml+xml, application/xml",
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          reject(
            new AppError(
              400,
              "MAP_UNAVAILABLE",
              "This map cannot be downloaded. Upload its KML/KMZ export instead.",
            ),
          );
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxImportBytes) {
            response.destroy(
              new AppError(413, "TOO_LARGE", "Map exceeds 5 MB."),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    request.on("error", reject);
  });
  return { bytes, sourceUrl: canonical };
}
