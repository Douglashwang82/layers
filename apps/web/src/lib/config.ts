export const flags = {
  products: process.env.FEATURE_PRODUCTS !== "false",
  organizations: process.env.FEATURE_ORGANIZATIONS !== "false",
  submissions: process.env.FEATURE_SUBMISSIONS !== "false",
};
export const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
