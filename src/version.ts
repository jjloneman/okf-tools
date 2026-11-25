/*
 * Which version of okf-tools is installed, and which OKF spec it supports,
 * for `okf --version` and `okf migrate`.
 */
import { readFileSync } from "node:fs";

/**
 * The newest OKF spec version okf-tools supports: the version `okf migrate`
 * writes, and the one `spec/upstream.json` pins.
 */
export const SUPPORTED_SPEC_VERSION = "0.3";

/** The line `okf --version` prints. */
export function formatVersion(): string {
  return `okf-tools ${readPackageVersion()} (OKF v${SUPPORTED_SPEC_VERSION})`;
}

/**
 * Read the installed package's version from its `package.json`, one folder
 * up from this module in `src/` and in `dist/` alike.
 *
 * @returns the version, or `unknown` when the file can't be read as one.
 */
export function readPackageVersion(
  packageUrl: URL = new URL("../package.json", import.meta.url)
): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageUrl, "utf8"));

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "string"
    ) {
      return parsed.version;
    }
  } catch {
    // An unreadable file reads as an unknown version, like a malformed one.
  }

  return "unknown";
}
