import { createWriteStream, fchmodSync, openSync, constants } from "node:fs";
import { join } from "node:path";
import { cwd, env } from "node:process";

const debugEnabled = env.OPENCODE_GEMINI_DEBUG?.trim() === "1";
const logWriter = createLogWriter(debugEnabled ? defaultLogFilePath() : undefined);

export interface GeminiDebugContext {
  id: string;
  streaming: boolean;
  startedAt: number;
}

interface GeminiDebugRequestMeta {
  originalUrl: string;
  resolvedUrl: string;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  streaming: boolean;
  projectId?: string;
}

interface GeminiDebugResponseMeta {
  body?: string;
  note?: string;
  error?: unknown;
  headersOverride?: HeadersInit;
}

let requestCounter = 0;

export function isGeminiDebugEnabled(): boolean {
  return debugEnabled;
}

/** Messages from callers may contain project names or server payloads. */
export function logGeminiDebugMessage(_message: string): void {
  if (debugEnabled) logDebug("[Gemini Debug] Event (details omitted)");
}

export function startGeminiDebugRequest(meta: GeminiDebugRequestMeta): GeminiDebugContext | null {
  if (!debugEnabled) return null;
  const id = `GEMINI-${++requestCounter}`;
  // URLs, headers and bodies can carry auth codes, cookies and user content.
  const method = /^[A-Z]+$/.test(meta.method ?? "GET") ? meta.method ?? "GET" : "OTHER";
  logDebug(`[Gemini Debug ${id}] Request ${method}; streaming=${meta.streaming ? "yes" : "no"}`);
  return { id, streaming: meta.streaming, startedAt: Date.now() };
}

export function logGeminiDebugResponse(
  context: GeminiDebugContext | null | undefined,
  response: Response,
  _meta: GeminiDebugResponseMeta = {},
): void {
  if (!debugEnabled || !context) return;
  const durationMs = Date.now() - context.startedAt;
  logDebug(`[Gemini Debug ${context.id}] Response ${response.status} (${durationMs}ms)`);
}

function logDebug(line: string): void {
  logWriter(line);
}

function defaultLogFilePath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(cwd(), `gemini-debug-${timestamp}.log`);
}

function createLogWriter(filePath?: string): (line: string) => void {
  if (!filePath) return () => {};
  const fd = openSync(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  fchmodSync(fd, 0o600);
  const stream = createWriteStream(filePath, { fd, autoClose: true });
  return (line: string) => stream.write(`${line}\n`);
}
