/**
 * Windows: kill processes LISTENING on ports 4000 (API) and 3000 (Next dev).
 * Safe no-op if nothing is listening. Used before `npm run dev`.
 */
import { execSync } from "node:child_process";
import os from "node:os";

if (os.platform() !== "win32") {
  process.exit(0);
}

function killListenersOnPort(port) {
  let out;
  try {
    out = execSync("netstat -ano", { encoding: "utf8" });
  } catch {
    return;
  }
  const pids = new Set();
  for (const line of out.split("\n")) {
    if (!line.includes("LISTENING")) continue;
    if (!line.includes(`:${port}`)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid)) pids.add(pid);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "pipe" });
      console.log(`[free-dev-ports] freed :${port} (PID ${pid})`);
    } catch {
      /* ignore */
    }
  }
}

killListenersOnPort(4000);
killListenersOnPort(3000);
