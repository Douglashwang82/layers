import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
vi.mock("@/lib/auth", () => ({ auth: {}, codeDelivery: {} }));
vi.mock("@taiwanhub/database", () => ({ pool: {} }));
vi.mock("@/lib/config", () => ({
  membershipMode: "invite_only",
  membershipIssuancePaused: false,
  appUrl: "http://localhost",
  flags: { layerWrites: true },
}));
import {
  GROUP_OWNER_INVITATION_QUOTA,
  issueGroupOwnerInvitation,
} from "../../apps/web/src/features/membership/service";

type Row = Record<string, unknown>;
/** A scripted client: answers by matching a fragment of the SQL text. */
function fakeTx(answers: Array<[string, Row[]]>) {
  const calls: string[] = [];
  const tx = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql.trim().split("\n")[0]);
      const hit = answers.find(([frag]) => sql.includes(frag));
      return { rows: hit?.[1] ?? [], rowCount: hit?.[1].length ?? 0 };
    }),
  };
  return { tx: tx as unknown as PoolClient, calls };
}
const input = { email: " New@Example.com ", ownerId: "o", groupInviteId: "g" };
describe("issueGroupOwnerInvitation", () => {
  it("returns pending without creating anything when a nomination is open", async () => {
    const { tx, calls } = fakeTx([["membership_nomination WHERE", [{}]]]);
    await expect(issueGroupOwnerInvitation(tx, input)).resolves.toEqual({
      membership: "pending",
    });
    expect(calls.some((c) => c.startsWith("INSERT"))).toBe(false);
  });
  it("is unavailable when no batch is open", async () => {
    const { tx } = fakeTx([]);
    await expect(issueGroupOwnerInvitation(tx, input)).resolves.toEqual({
      membership: "unavailable",
    });
  });
  it("enforces the per-owner quota", async () => {
    const { tx } = fakeTx([
      ["FROM membership_batch", [{ id: "b", capacity: 100 }]],
      ["AS redeemed", [{ redeemed: 0, active_issued: 0 }]],
      ["source = 'group_owner'", [{ count: GROUP_OWNER_INVITATION_QUOTA }]],
    ]);
    await expect(issueGroupOwnerInvitation(tx, input)).resolves.toEqual({
      membership: "quota",
    });
  });
  it("maps an open-email unique violation to pending after rolling back", async () => {
    const calls: string[] = [];
    const tx = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes("FROM membership_batch"))
          throw Object.assign(new Error("dup"), {
            code: "23505",
            constraint: "membership_nomination_open_email",
          });
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;
    await expect(issueGroupOwnerInvitation(tx, input)).resolves.toEqual({
      membership: "pending",
    });
    expect(calls).toContain("ROLLBACK TO SAVEPOINT group_owner_invitation");
  });
});
