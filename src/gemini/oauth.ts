import { generatePKCE } from "@openauthjs/openauth/pkce";
import { randomBytes } from "node:crypto";

import {
  GEMINI_CLIENT_ID,
  getGeminiClientSecret,
  GEMINI_REDIRECT_URI,
  GEMINI_SCOPES,
} from "../constants";
import {
  isGeminiDebugEnabled,
  logGeminiDebugMessage,
} from "../plugin/debug";
import { geminiFetch } from "../fetch";

interface PkcePair {
  challenge: string;
  verifier: string;
}

/**
 * Result returned to the caller after constructing an OAuth authorization URL.
 */
export interface GeminiAuthorization {
  url: string;
  verifier: string;
  state: string;
}

interface GeminiTokenExchangeSuccess {
  type: "success";
  refresh: string;
  access: string;
  expires: number;
  email?: string;
}

interface GeminiTokenExchangeFailure {
  type: "failed";
  error: string;
}

export type GeminiTokenExchangeResult =
  | GeminiTokenExchangeSuccess
  | GeminiTokenExchangeFailure;

interface GeminiTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

interface GeminiUserInfo {
  email?: string;
}

/**
 * Build the Gemini OAuth authorization URL including PKCE.
 */
export async function authorizeGemini(): Promise<GeminiAuthorization> {
  const pkce = (await generatePKCE()) as PkcePair;
  const state = randomBytes(32).toString("hex");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GEMINI_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", GEMINI_REDIRECT_URI);
  url.searchParams.set("scope", GEMINI_SCOPES.join(" "));
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  // Add a fragment so any stray terminal glyphs are ignored by the auth server.
  url.hash = "opencode";

  return {
    url: url.toString(),
    verifier: pkce.verifier,
    state,
  };
}

/**
 * Exchange an authorization code using a known PKCE verifier.
 */
export async function exchangeGeminiWithVerifier(
  code: string,
  verifier: string,
): Promise<GeminiTokenExchangeResult> {
  try {
    return await exchangeGeminiWithVerifierInternal(code, verifier);
  } catch (error) {
    if (error instanceof Error && error.message.includes("OPENCODE_GEMINI_OAUTH_CLIENT_SECRET")) {
      return { type: "failed", error: error.message };
    }
    return { type: "failed", error: "Gemini OAuth exchange failed" };
  }
}

async function exchangeGeminiWithVerifierInternal(
  code: string,
  verifier: string,
): Promise<GeminiTokenExchangeResult> {
  if (isGeminiDebugEnabled()) {
    logGeminiDebugMessage("OAuth exchange: POST https://oauth2.googleapis.com/token");
  }
  const tokenResponse = await geminiFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GEMINI_CLIENT_ID,
      client_secret: getGeminiClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: GEMINI_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!tokenResponse.ok) {
    if (isGeminiDebugEnabled()) {
      logGeminiDebugMessage(`OAuth exchange response: ${tokenResponse.status}`);
    }
    // Preserve the listener's malformed-code retry without exposing Google's body.
    try {
      const payload = (await tokenResponse.json()) as { error?: unknown; error_description?: unknown };
      if (payload.error === "invalid_grant" &&
          typeof payload.error_description === "string" &&
          /malformed auth code/i.test(payload.error_description)) {
        return { type: "failed", error: "invalid_grant: malformed auth code" };
      }
    } catch {
      // Keep the HTTP status as the only public error detail.
    }
    return { type: "failed", error: `Gemini OAuth exchange failed (${tokenResponse.status})` };
  }

  const tokenPayload = (await tokenResponse.json()) as GeminiTokenResponse;
  if (isGeminiDebugEnabled()) {
    logGeminiDebugMessage(
      `OAuth exchange success: expires_in=${tokenPayload.expires_in}s refresh_token=${tokenPayload.refresh_token ? "yes" : "no"}`,
    );
  }

  if (isGeminiDebugEnabled()) {
    logGeminiDebugMessage("OAuth userinfo: GET https://www.googleapis.com/oauth2/v1/userinfo");
  }
  const userInfoResponse = await geminiFetch(
    "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
      },
    },
  );
  if (isGeminiDebugEnabled()) {
    logGeminiDebugMessage(
      `OAuth userinfo response: ${userInfoResponse.status} ${userInfoResponse.statusText}`,
    );
  }

  const userInfo = userInfoResponse.ok
    ? ((await userInfoResponse.json()) as GeminiUserInfo)
    : {};

  const refreshToken = tokenPayload.refresh_token;
  if (!refreshToken) {
    return { type: "failed", error: "Missing refresh token in response" };
  }

  return {
    type: "success",
    refresh: refreshToken,
    access: tokenPayload.access_token,
    expires: Date.now() + tokenPayload.expires_in * 1000,
    email: userInfo.email,
  };
}
