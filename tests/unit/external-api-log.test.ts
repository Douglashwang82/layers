import { describe, expect, it, vi } from "vitest";
import {
  describeError,
  describeUrl,
  loggedFetch,
  withExternalApiLog,
  type ExternalApiCall,
} from "../../packages/database/src/external-api-log";

describe("external API log", () => {
  it("keeps host and path but drops query strings and keys", () => {
    expect(describeUrl("https://api.example.com/v1/x?key=SECRET&q=a")).toEqual({
      host: "api.example.com",
      path: "/v1/x",
    });
  });

  it("redacts urls, emails and secrets from errors", () => {
    const text = describeError(
      new Error("fail https://a.com/?key=abc for me@x.com token=zzz"),
    );
    expect(text).not.toMatch(/abc|me@x\.com|zzz/);
  });

  it("records a successful fetch and returns the response untouched", async () => {
    const calls: ExternalApiCall[] = [];
    const response = new Response("{}", { status: 200 });
    const wrapped = loggedFetch(
      "p",
      "op",
      vi.fn().mockResolvedValue(response),
      async (c) => void calls.push(c),
    );
    expect(await wrapped("https://h.com/a?key=1", { method: "POST" })).toBe(
      response,
    );
    expect(calls[0]).toMatchObject({
      provider: "p",
      method: "POST",
      host: "h.com",
      path: "/a",
      status: 200,
      ok: true,
    });
  });

  it("records a failed fetch and rethrows", async () => {
    const calls: ExternalApiCall[] = [];
    const wrapped = loggedFetch(
      "p",
      "op",
      vi.fn().mockRejectedValue(new Error("boom")),
      async (c) => void calls.push(c),
    );
    await expect(wrapped("https://h.com/a")).rejects.toThrow("boom");
    expect(calls[0]).toMatchObject({ ok: false, status: null });
  });

  it("records SDK-style calls with status from the error", async () => {
    const calls: ExternalApiCall[] = [];
    await expect(
      withExternalApiLog(
        { provider: "a", operation: "o", host: "h" },
        () => Promise.reject(Object.assign(new Error("rate"), { status: 429 })),
        undefined,
        async (c) => void calls.push(c),
      ),
    ).rejects.toThrow("rate");
    expect(calls[0]).toMatchObject({ ok: false, status: 429 });
  });
});

describe("external API console line", () => {
  it("formats like a dev-server request line", async () => {
    const { formatExternalApiCall } =
      await import("../../packages/database/src/external-api-log");
    expect(
      formatExternalApiCall({
        provider: "google-places",
        operation: "text-search",
        method: "post",
        host: "places.googleapis.com",
        path: "/v1/places:searchText",
        status: 200,
        ok: true,
        durationMs: 311.6,
      }),
    ).toBe(
      " POST places.googleapis.com/v1/places:searchText 200 in 312ms (google-places: text-search)",
    );
  });
});

describe("external API console colors", () => {
  const base = {
    provider: "anthropic",
    operation: "o",
    method: "POST",
    host: "h",
    path: "/",
    status: 200,
    durationMs: 1,
  };
  it("is stable per provider and red on failure", async () => {
    const { colorizeExternalApiCall } =
      await import("../../packages/database/src/external-api-log");
    const ok = colorizeExternalApiCall({ ...base, ok: true }, "x");
    expect(colorizeExternalApiCall({ ...base, ok: true }, "x")).toBe(ok);
    expect(ok).not.toContain("\x1b[31m");
    expect(colorizeExternalApiCall({ ...base, ok: false }, "x")).toContain(
      "\x1b[31m",
    );
  });
});
