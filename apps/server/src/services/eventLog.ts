import fs from "fs";
import path from "path";

/** Append-only JSONL for grading / debugging — no DB required */
let dirEnsured = false;
const LOG_PATH = path.join(process.cwd(), "logs", "strait-command-events.jsonl");

function ensureDir(): void {
  if (dirEnsured) return;
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  dirEnsured = true;
}

/** Writes one JSON object per line (best-effort; never throws to callers). */
export function appendServerEvent(event: Record<string, unknown>): void {
  try {
    ensureDir();
    const line = JSON.stringify({ ts: Date.now(), ...event }) + "\n";
    fs.appendFileSync(LOG_PATH, line, "utf8");
  } catch {
    /* disk optional e.g. read-only container */
  }
}
