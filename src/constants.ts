import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/**
 * Constants used for Google Gemini OAuth flows and Cloud Code Assist API integration.
 */
export const GEMINI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";

/** Public installed-app client configuration is read only at runtime. */
let installedClientSecret: string | undefined;

export function readInstalledGeminiClientSecret(executablePaths: readonly string[]): string | undefined {
  for (const executablePath of executablePaths) {
    try {
      const executable = realpathSync(executablePath);
      const bundle = dirname(executable);
      const packageRoot = dirname(bundle);
      const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { name?: string };
      if (manifest.name !== "@google/gemini-cli") continue;
      const sources = [executable, ...readdirSync(bundle)
        .filter((file) => /^chunk-.*\.js$/.test(file))
        .map((file) => join(bundle, file))];
      for (const source of sources) {
        const text = readFileSync(source, "utf8");
        if (!text.includes(GEMINI_CLIENT_ID)) continue;
        const matches = [...text.matchAll(/["'](GOCSPX-[A-Za-z0-9_-]{8,})["']/g)].map((match) => match[1]);
        const distinct = [...new Set(matches)];
        if (distinct.length === 1) return distinct[0];
      }
    } catch {
      // Unavailable or incompatible CLI installations are not evaluated.
    }
  }
  return undefined;
}

export function getGeminiClientSecret(): string {
  const configured = process.env.OPENCODE_GEMINI_OAUTH_CLIENT_SECRET?.trim();
  if (configured) return configured;
  if (!installedClientSecret) {
    const candidates = (process.env.PATH ?? "").split(delimiter)
      .filter(Boolean).map((directory) => join(directory, "gemini"));
    installedClientSecret = readInstalledGeminiClientSecret(candidates);
  }
  if (!installedClientSecret) {
    throw new Error("OPENCODE_GEMINI_OAUTH_CLIENT_SECRET is required when a matching Gemini CLI client configuration is unavailable");
  }
  return installedClientSecret;
}

/**
 * Scopes required for Gemini CLI integrations.
 */
export const GEMINI_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

/**
 * OAuth redirect URI used by the local CLI callback server.
 */
export const GEMINI_REDIRECT_URI = "http://localhost:8085/oauth2callback";

/**
 * Root endpoint for the Cloud Code Assist API which backs Gemini CLI traffic.
 */
export const GEMINI_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";

/**
 * Provider identifier shared between the plugin loader and credential store.
 */
export const GEMINI_PROVIDER_ID = "google";
