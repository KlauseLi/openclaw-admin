import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const WORK_DIR = process.env.CLAUDE_WORK_DIR || "/root/workspaces/demo";
const TIMEOUT  = parseInt(process.env.CLAUDE_TIMEOUT || "300000", 10);
const LOG_FILE = "/root/ai-lab/bridge/bridge.log";

function ensureLogDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function log(msg) {
  ensureLogDir(LOG_FILE);
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

const server = new McpServer({
  name: "claude-bridge",
  version: "1.0.2"
});

server.tool(
  "run_claude",
  "使用 Claude Code 在本地创建/修改/运行文件。所有涉及文件操作的任务都必须调用此工具，不要自己假装生成文件。",
  { prompt: z.string().describe("要执行的任务描述") },
  async ({ prompt }) => {
    log(`tool called, cwd=${WORK_DIR}, prompt=${JSON.stringify(prompt)}`);

    return new Promise((resolve) => {
      const child = spawn("claude", [
        "-p", prompt,
        "--output-format", "json",
        "--dangerously-skip-permissions",
        "--bare"
      ], {
        cwd: WORK_DIR,
        timeout: TIMEOUT,
        env: { ...process.env }
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", d => stdout += d.toString());
      child.stderr.on("data", d => stderr += d.toString());

      child.on("close", (code, signal) => {
        log(`close code=${code} signal=${signal ?? "none"} stdout_len=${stdout.length} stderr_len=${stderr.length}`);
        if (stdout.trim()) log(`stdout=${stdout.slice(0, 4000)}`);
        if (stderr.trim()) log(`stderr=${stderr.slice(0, 4000)}`);

        let text;
        if (stdout.trim()) {
          try { text = JSON.parse(stdout).result || stdout; }
          catch { text = stdout; }
        }
        if (!text && stderr.trim()) {
          try { text = JSON.parse(stderr).result || stderr; }
          catch { text = stderr; }
        }
        if (!text) {
          text = `Exit code: ${code}, signal: ${signal ?? "none"}`;
        }

        resolve({
          content: [{ type: "text", text }],
          isError: code !== 0
        });
      });

      child.on("error", (err) => {
        log(`spawn error: ${err.message}`);
        resolve({
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true
        });
      });
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
log("bridge: transport connected, waiting for messages...");
await new Promise((resolve) => setTimeout(resolve, 200));
log("bridge: transport closed");
