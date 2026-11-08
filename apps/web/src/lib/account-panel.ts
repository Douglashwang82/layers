/**
 * The account sidebar is map URL state, `?account=1`, independent of the
 * layer and trip screens: opening or closing it keeps every other key, and
 * those screens keep it.
 */
export const accountPanelKey = "account";

export function readAccountPanel(params: URLSearchParams): boolean {
  return params.has(accountPanelKey);
}

function href(params: URLSearchParams) {
  return "/" + (params.size ? "?" + params.toString() : "");
}

/** The map URL with the account sidebar open, keeping the current map state. */
export function accountPanelHref(current = ""): string {
  const params = new URLSearchParams(current.replace(/^\?/, ""));
  params.set(accountPanelKey, "1");
  return href(params);
}

/** The map URL with the account sidebar closed, keeping the current map state. */
export function withoutAccountPanel(current = ""): string {
  const params = new URLSearchParams(current.replace(/^\?/, ""));
  params.delete(accountPanelKey);
  return href(params);
}
