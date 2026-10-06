import {
  GEMINI_CLIENT_ID,
  getGeminiClientSecret,
  GEMINI_PROVIDER_ID,
} from "../constants";
import { geminiFetch } from "../fetch";
import { formatRefreshParts, parseRefreshParts } from "./auth";
import { clearCachedAuth, storeCachedAuth } from "./cache";
import {
  isGeminiDebugEnabled,
  logGeminiDebugMessage,
} from "./debug";
import { invalidateProjectContextCache } from "./project";
import {
  DEFAULT_MAX_ATTEMPTS,
  getExponentialDelayWithJitter,
  isRetryableNetworkError,
  isRetryableStatus,
  resolveRetryDelayMs,
  wait,
} from "./retry/helpers";
import type { OAuthAuthDetails, PluginClient, RefreshParts } from "./types";

const refreshInFlight = new Map<string, Promise<OAuthAuthDetails | undefined>>();

/**
 * Refreshes a Gemini OAuth access token, updates persisted credentials, and handles revocation.
 */
export async function refreshAccessToken(
  auth: OAuthAuthDetails,
  client: PluginClient,
): Promise<OAuthAuthDetails | undefined> {
  const parts = parseRefreshParts(auth.refresh);
  if (!parts.refreshToken) {
    return undefined;
  }
  getGeminiClientSecret();

  const pending = refreshInFlight.get(parts.refreshToken);
  if (pending) {
    return pending;
  }

  const refreshPromise = refreshAccessTokenInternal(auth, client, parts);
  refreshInFlight.set(parts.refreshToken, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    refreshInFlight.delete(parts.refreshToken);
  }
}

async function refreshAccessTokenInternal(
  auth: OAuthAuthDetails,
  client: PluginClient,
  parts: RefreshParts,
): Promise<OAuthAuthDetails | undefined> {
  try {
    const response = await fetchTokenRefresh(parts.refreshToken);

    if (!response.ok) {
      // Only the OAuth error code is needed to detect a revoked grant.
      // Descriptions and raw bodies may contain credentials or personal data.
      let code: string | undefined;
      try {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload.error === "string") code = payload.error;
      } catch {
        // An invalid error body is still reported by HTTP status.
      }
      if (isGeminiDebugEnabled()) {
        logGeminiDebugMessage(`OAuth refresh response: ${response.status}`);
      }
      console.warn(`[Gemini OAuth] Token refresh failed (${response.status})`);

      if (code === "invalid_grant") {
        console.warn(
          "[Gemini OAuth] Google revoked the stored refresh token. Run `opencode auth login` and reauthenticate the Google provider.",
        );
        clearCachedAuth(auth.refresh);
        invalidateProjectContextCache(auth.refresh);
        try {
          const clearedAuth: OAuthAuthDetails = {
            type: "oauth",
            refresh: formatRefreshParts({
              refreshToken: "",
              projectId: parts.projectId,
              managedProjectId: parts.managedProjectId,
            }),
          };
          await client.auth.set({
            path: { id: GEMINI_PROVIDER_ID },
            body: clearedAuth,
          });
        } catch {
          console.error("Failed to clear stored Gemini OAuth credentials");
        }
      }

      return undefined;
    }

    const payload = (await response.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    if (isGeminiDebugEnabled()) {
      const rotated = payload.refresh_token && payload.refresh_token !== parts.refreshToken;
      logGeminiDebugMessage(
        `OAuth refresh success: expires_in=${payload.expires_in}s refresh_rotated=${rotated ? "yes" : "no"}`,
      );
    }

    const refreshedParts: RefreshParts = {
      refreshToken: payload.refresh_token ?? parts.refreshToken,
      projectId: parts.projectId,
      managedProjectId: parts.managedProjectId,
    };

    const updatedAuth: OAuthAuthDetails = {
      ...auth,
      access: payload.access_token,
      expires: Date.now() + payload.expires_in * 1000,
      refresh: formatRefreshParts(refreshedParts),
    };

    clearCachedAuth(auth.refresh);
    storeCachedAuth(updatedAuth);
    invalidateProjectContextCache(auth.refresh);

    if (refreshedParts.refreshToken !== parts.refreshToken) {
      try {
        await client.auth.set({
          path: { id: GEMINI_PROVIDER_ID },
          body: updatedAuth,
        });
      } catch {
        console.error("Failed to persist refreshed Gemini OAuth credentials");
      }
    }

    return updatedAuth;
  } catch {
    console.error("Failed to refresh Gemini access token due to an unexpected error");
    return undefined;
  }
}

async function fetchTokenRefresh(refreshToken: string): Promise<Response> {
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: GEMINI_CLIENT_ID,
      client_secret: getGeminiClientSecret(),
    }),
  };

  let attempt = 1;
  while (attempt <= DEFAULT_MAX_ATTEMPTS) {
    if (isGeminiDebugEnabled()) {
      logGeminiDebugMessage(`OAuth refresh attempt ${attempt}: POST ${tokenUrl}`);
    }

    try {
      const response = await geminiFetch(tokenUrl, init);
      if (!isRetryableStatus(response.status) || attempt >= DEFAULT_MAX_ATTEMPTS) {
        return response;
      }

      const delayMs = await resolveRetryDelayMs(response, attempt);
      if (delayMs > 0) {
        await wait(delayMs);
      }
      attempt += 1;
      continue;
    } catch (error) {
      if (attempt >= DEFAULT_MAX_ATTEMPTS || !isRetryableNetworkError(error)) {
        throw error;
      }
      await wait(getExponentialDelayWithJitter(attempt));
      attempt += 1;
    }
  }

  return geminiFetch(tokenUrl, init);
}
