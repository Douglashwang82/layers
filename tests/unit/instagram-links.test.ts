import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveInstagramLink,
  requestInstagramExtraction,
} from "../../apps/web/src/features/google-links/instagram";
import { createInstagramWorker } from "../../packages/database/src/instagram-worker";
import { startInstagramProxy } from "../../packages/database/src/instagram-browser-proxy";
import { connect } from "node:net";
import { AppError } from "../../packages/shared/src";
const url = "https://www.instagram.com/p/test123/";
const extraction = {
  sourceUrl: url,
  potentiallyTruncated: true,
  restaurants: [{ name: "Sample Cafe", address: "123 Test Street" }],
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Instagram to Google matching", () => {
  it("searches with source name and address, preserving review information", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ places: [{ id: "place-123" }] }));
    const results = await resolveInstagramLink(
      url,
      { fetch: request, apiKey: "test" },
      async () => extraction,
    );
    expect(results[0]).toMatchObject({
      source: "instagram",
      sourceUrl: url,
      name: "Sample Cafe",
      address: "123 Test Street",
      providerPlaceId: "place-123",
      status: "resolved",
      potentiallyTruncated: true,
    });
    expect(JSON.parse(request.mock.calls[0][1]!.body as string).textQuery).toBe(
      "Sample Cafe 123 Test Street",
    );
  });
  it("does not search for missing facts, empty captions or oversized lists", async () => {
    const request = vi.fn<typeof fetch>();
    for (const restaurants of [
      [],
      [{ name: "Cafe", address: null }],
      Array.from({ length: 6 }, () => extraction.restaurants[0]),
    ]) {
      const results = await resolveInstagramLink(
        url,
        { fetch: request, apiKey: "test" },
        async () => ({ ...extraction, restaurants }),
      );
      expect(results[0].status).not.toBe("resolved");
    }
    expect(request).not.toHaveBeenCalled();
  });
  it("preserves partial results and handles busy/unavailable workers", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ places: [{ id: "place-1" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(
      (
        await resolveInstagramLink(
          url,
          { fetch: request, apiKey: "test" },
          async () => ({
            ...extraction,
            restaurants: [
              ...extraction.restaurants,
              { name: "Second", address: "Second street" },
            ],
          }),
        )
      ).map((r) => r.status),
    ).toEqual(["resolved", "failed"]);
    expect(
      (
        await resolveInstagramLink(
          url,
          { fetch: request, apiKey: "test" },
          async () => {
            throw new AppError(429, "INSTAGRAM_BUSY", "Busy");
          },
        )
      )[0].reason,
    ).toBe("instagram_busy");
    vi.stubEnv("INSTAGRAM_WORKER_URL", "");
    await expect(requestInstagramExtraction(url)).rejects.toMatchObject({
      code: "INSTAGRAM_UNAVAILABLE",
    });
  });
  it("rejects worker source mismatches and malformed responses", async () => {
    vi.stubEnv("INSTAGRAM_WORKER_URL", "http://127.0.0.1:11435");
    vi.stubEnv(
      "INSTAGRAM_WORKER_TOKEN",
      "test-only-token-012345678901234567890",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            ...extraction,
            sourceUrl: "https://www.instagram.com/p/other/",
          }),
        ),
    );
    await expect(requestInstagramExtraction(url)).rejects.toThrow(
      "source mismatch",
    );
  });
});
describe("local worker", () => {
  it("requires auth, validates URLs, bounds concurrency and releases its slot", async () => {
    let finish!: (value: typeof extraction) => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const extract = vi.fn(() => {
      started();
      return new Promise<typeof extraction>((resolve) => {
        finish = resolve;
      });
    });
    const token = "test-only-worker-token-01234567890123456789";
    const server = createInstagramWorker(token, extract);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const endpoint = `http://127.0.0.1:${address.port}/extract`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    try {
      expect(
        (
          await fetch(endpoint, {
            method: "POST",
            body: JSON.stringify({ url }),
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({ url: "http://127.0.0.1/" }),
          })
        ).status,
      ).toBe(400);
      const active = fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ url }),
      });
      await began;
      expect(
        (
          await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({ url }),
          })
        ).status,
      ).toBe(429);
      finish(extraction);
      expect(await (await active).json()).toEqual(extraction);
      expect(
        (
          await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({ url: "bad" }),
          })
        ).status,
      ).toBe(400);
      expect(extract).toHaveBeenCalledTimes(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("blocks a CONNECT tunnel to loopback before connecting", async () => {
    const proxy = await startInstagramProxy();
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const socket = connect({
          host: "127.0.0.1",
          port: Number(new URL(proxy.server).port),
        });
        let received = "";
        socket.on("connect", () =>
          socket.write(
            "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n",
          ),
        );
        socket.on("data", (chunk) => {
          received += chunk;
        });
        socket.on("close", () => resolve(received));
        socket.on("error", reject);
      });
      expect(data).not.toContain("200 Connection Established");
    } finally {
      proxy.close();
    }
  });
});
