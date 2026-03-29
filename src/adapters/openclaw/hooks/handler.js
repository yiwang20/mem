import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function readServerPort() {
  try {
    const portFile = join(homedir(), ".mindflow", "server.port");
    const content = readFileSync(portFile, "utf8").trim();
    const port = parseInt(content, 10);
    return Number.isFinite(port) ? port : 3456;
  } catch {
    return 3456; // Fallback if port file doesn't exist yet
  }
}

const handler = async (event) => {
  if (event.type !== "message") return;

  const port = readServerPort();
  const url = `http://127.0.0.1:${port}/api/ingest`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Server not running or timeout — fail silently
  }
};

export default handler;
