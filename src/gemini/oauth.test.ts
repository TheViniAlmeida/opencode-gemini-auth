import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { exchangeGeminiWithVerifier } from "./oauth";

const originalSecret = process.env.OPENCODE_GEMINI_OAUTH_CLIENT_SECRET;
const originalPath = process.env.PATH;

afterEach(() => {
  mock.restore();
  process.env.PATH = originalPath;
  if (originalSecret === undefined) delete process.env.OPENCODE_GEMINI_OAUTH_CLIENT_SECRET;
  else process.env.OPENCODE_GEMINI_OAUTH_CLIENT_SECRET = originalSecret;
});

test("OAuth exchange reports a missing runtime secret by variable name", async () => {
  delete process.env.OPENCODE_GEMINI_OAUTH_CLIENT_SECRET;
  process.env.PATH = "";
  const fetchMock = spyOn(globalThis, "fetch");
  const result = await exchangeGeminiWithVerifier("test-code", "test-verifier");
  expect(result).toEqual({
    type: "failed",
    error: "OPENCODE_GEMINI_OAUTH_CLIENT_SECRET is required when a matching Gemini CLI client configuration is unavailable",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("OAuth exchange never returns a server error body to the caller", async () => {
  process.env.OPENCODE_GEMINI_OAUTH_CLIENT_SECRET = "test-only-secret";
  spyOn(globalThis, "fetch").mockResolvedValue(new Response("private-test-payload", { status: 400 }));
  const result = await exchangeGeminiWithVerifier("test-code", "test-verifier");
  expect(result).toEqual({ type: "failed", error: "Gemini OAuth exchange failed (400)" });
  expect(JSON.stringify(result)).not.toContain("private-test-payload");
});

test("OAuth exchange keeps malformed-code retry classification without returning the server description", async () => {
  process.env.OPENCODE_GEMINI_OAUTH_CLIENT_SECRET = "test-only-secret";
  spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    error: "invalid_grant", error_description: "malformed auth code private-test-payload",
  }, { status: 400 }));
  const result = await exchangeGeminiWithVerifier("test-code", "test-verifier");
  expect(result).toEqual({ type: "failed", error: "invalid_grant: malformed auth code" });
  expect(JSON.stringify(result)).not.toContain("private-test-payload");
});
