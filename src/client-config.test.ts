import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GEMINI_CLIENT_ID, readInstalledGeminiClientSecret } from "./constants";

function fixture(name: string, source: string) {
  const root = mkdtempSync(join(tmpdir(), "gemini-public-client-fixture-"));
  const bundle = join(root, "bundle"); mkdirSync(bundle);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name }));
  const entry = join(bundle, "gemini.js"); writeFileSync(entry, "// fixture entry");
  writeFileSync(join(bundle, "chunk-fixture.js"), source);
  return entry;
}

test("reads matching public CLI client configuration as data without evaluating code", () => {
  const file = fixture("@google/gemini-cli", `throw new Error("must not execute"); const client = "${GEMINI_CLIENT_ID}"; const secret = "GOCSPX-FAKE-FIXTURE-VALUE";`);
  expect(readInstalledGeminiClientSecret([file])).toBe("GOCSPX-FAKE-FIXTURE-VALUE");
});

test("does not adopt a client configuration for another client ID or package", () => {
  const wrong = fixture("@google/gemini-cli", 'const client = "fixture-other-client"; const secret = "GOCSPX-FAKE-FIXTURE-VALUE";');
  const other = fixture("fixture-other-package", `const client = "${GEMINI_CLIENT_ID}"; const secret = "GOCSPX-FAKE-FIXTURE-VALUE";`);
  expect(readInstalledGeminiClientSecret([wrong, other])).toBeUndefined();
});

test("does not guess when a module has multiple distinct client configurations", () => {
  const file = fixture("@google/gemini-cli", `const client = "${GEMINI_CLIENT_ID}"; const a = "GOCSPX-FAKE-FIXTURE-ONE"; const b = "GOCSPX-FAKE-FIXTURE-TWO";`);
  expect(readInstalledGeminiClientSecret([file])).toBeUndefined();
});
