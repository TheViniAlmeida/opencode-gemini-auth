import { expect, test } from "bun:test";
import { Host } from "@opencode/plugin/host";
import { resolve } from "node:path";

const packageDirectory = resolve(import.meta.dir, "..");

test("OpenCode V2 resolves and loads the real directory package", async () => {
  const entries = Host.resolve({ directory: packageDirectory });
  expect(entries.server).toMatch(/\/server\.(ts|js)$/);
  const namedEntries = Host.resolve({ name: "opencode-gemini-auth", directory: packageDirectory });
  expect(namedEntries.server).toBe(new URL("../server.js", import.meta.url).href);
  const loaded = await Host.load(namedEntries.server!);
  expect((loaded as { default?: { id?: string } }).default?.id).toBe("opencode.provider.google-gemini-cli");
});
