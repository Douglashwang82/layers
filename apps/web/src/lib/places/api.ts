"use client";
/** Local TaiwanHub API calls for place subjects, keeping the error code for flow decisions. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function subjectApi<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/v1/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      json.error?.code ?? "ERROR",
      json.error?.message ?? "Request failed",
    );
  return json.data as T;
}
export type OwnReview = {
  id: string;
  scope: string;
  stars: number | null;
  body: string;
  status: "pending" | "approved" | "rejected" | "hidden" | "deleted";
  removedByModerator: boolean;
  revision: number;
  updatedAt: string;
};
export type ReviewScopeSummary = {
  scope: string;
  kind: "layer" | "group";
  title: string;
  titleChinese: string;
  audience: "public" | "private" | "group";
  needsModeration: boolean;
  totalReviews: number;
  ratedCount: number;
  averageStars: number | null;
  ownReview: OwnReview | null;
};
export type Resolution = {
  subjectId: string;
  canonicalKey: string;
  cityReviewStatus: "unreviewed" | "approved";
  selectionGrant: string;
};
