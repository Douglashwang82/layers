import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
/**
 * Removes this run's capture-mail directory (created by playwright.config.ts)
 * after every run, passing or failing. Refuses anything that is not a direct
 * `taiwanhub-e2e-mail-*` child of the OS temp directory, so a stray or
 * hostile E2E_MAIL_CAPTURE_DIR can never trigger a recursive delete elsewhere.
 */
export default function globalTeardown() {
  const raw = process.env.E2E_MAIL_CAPTURE_DIR;
  if (!raw) return;
  const target = path.resolve(raw);
  const root = path.resolve(tmpdir());
  if (
    path.dirname(target) !== root ||
    !path.basename(target).startsWith("taiwanhub-e2e-mail-")
  ) {
    console.warn("Skipping capture-mail cleanup: unexpected directory.");
    return;
  }
  rmSync(target, { recursive: true, force: true });
}
