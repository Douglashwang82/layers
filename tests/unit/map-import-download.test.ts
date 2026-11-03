import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { beforeEach, expect, it, vi } from "vitest";
import { downloadMap } from "../../apps/web/src/features/map-import/download";
import { maxImportBytes } from "../../packages/shared/src/map-import";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ get: vi.fn() }));
const url = "https://www.google.com/maps/d/viewer?mid=abcdefghijk";
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(lookup).mockResolvedValue([
    { address: "142.250.1.1", family: 4 },
  ] as never);
});
function response(status: number, body: Buffer) {
  vi.mocked(get).mockImplementation(((
    target: URL,
    options: {
      lookup: (
        host: string,
        options: { all: boolean },
        callback: (...args: unknown[]) => void,
      ) => void;
      signal: AbortSignal;
    },
    receive: (stream: PassThrough & { statusCode: number }) => void,
  ) => {
    expect(target.origin).toBe("https://www.google.com");
    expect(target.pathname).toBe("/maps/d/kml");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const callback = vi.fn();
    options.lookup("www.google.com", { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, "142.250.1.1", 4);
    const stream = Object.assign(new PassThrough(), { statusCode: status });
    queueMicrotask(() => {
      receive(stream);
      if (!stream.destroyed) stream.end(body);
    });
    return new EventEmitter();
  }) as never);
}
it("pins a validated address and reads the bounded response", async () => {
  response(200, Buffer.from("<kml/>"));
  const result = await downloadMap(url);
  expect(result.bytes.toString()).toBe("<kml/>");
  expect(lookup).toHaveBeenCalledTimes(1);
});
it("rejects redirect and authorization responses rather than following them", async () => {
  for (const status of [302, 403]) {
    response(status, Buffer.from("redirect"));
    await expect(downloadMap(url)).rejects.toMatchObject({
      code: "MAP_UNAVAILABLE",
    });
  }
  expect(get).toHaveBeenCalledTimes(2);
});
it("rejects mixed public/private DNS answers before making a request", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "142.250.1.1", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ] as never);
  await expect(downloadMap(url)).rejects.toThrow("Unsafe destination");
  expect(get).not.toHaveBeenCalled();
});
it("bounds response size even without a content-length header", async () => {
  response(200, Buffer.alloc(maxImportBytes + 1));
  await expect(downloadMap(url)).rejects.toMatchObject({ code: "TOO_LARGE" });
});
