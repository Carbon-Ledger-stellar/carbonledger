/**
 * Browser-specific install links for the Freighter wallet extension.
 * Detected from navigator.userAgent since there's no portable "current browser" API.
 */

export type SupportedBrowser = "chrome" | "edge" | "firefox" | "brave" | "opera" | "safari" | "unknown";

const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk";
const FIREFOX_ADDONS_URL = "https://addons.mozilla.org/en-US/firefox/addon/freighter/";
const FREIGHTER_HOME_URL = "https://www.freighter.app/";

export function detectBrowser(userAgent: string): SupportedBrowser {
  const ua = userAgent.toLowerCase();
  if (ua.includes("edg/")) return "edge";
  if (ua.includes("opr/") || ua.includes("opera")) return "opera";
  if (ua.includes("brave")) return "brave";
  if (ua.includes("firefox")) return "firefox";
  // Safari's UA contains "safari" but so does every Chromium browser — Chromium UAs
  // also include "chrome", which Safari's never does, so exclude on that basis.
  if (ua.includes("safari") && !ua.includes("chrome") && !ua.includes("chromium")) return "safari";
  if (ua.includes("chrome") || ua.includes("chromium")) return "chrome";
  return "unknown";
}

export function getBrowserInstallUrl(browser: SupportedBrowser): string {
  switch (browser) {
    case "chrome":
    case "edge":
    case "brave":
    case "opera":
      return CHROME_WEB_STORE_URL;
    case "firefox":
      return FIREFOX_ADDONS_URL;
    case "safari":
    case "unknown":
    default:
      return FREIGHTER_HOME_URL;
  }
}

/** Freighter does not currently ship a Safari extension. */
export function isBrowserUnsupported(browser: SupportedBrowser): boolean {
  return browser === "safari";
}

export function getCurrentBrowserInstallUrl(): string {
  if (typeof navigator === "undefined") return FREIGHTER_HOME_URL;
  return getBrowserInstallUrl(detectBrowser(navigator.userAgent));
}
