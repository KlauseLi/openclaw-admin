import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const WORK_DIR = process.env.CLAUDE_WORK_DIR || "/root/workspaces/demo";
const TIMEOUT = Number.parseInt(process.env.CLAUDE_TIMEOUT || "300000", 10);
const LOG_FILE =
  process.env.BRIDGE_LOG_FILE || "/root/ai-lab/bridge/bridge.log";

function ensureLogDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function log(message) {
  ensureLogDir(LOG_FILE);
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
}

function parseClaudeOutput(raw) {
  if (!raw.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed.result || raw;
  } catch {
    return raw;
  }
}

const server = new McpServer({
  name: "claude-bridge",
  version: "1.0.0"
});

server.tool(
  "run_claude",
  "使用 Claude Code 在本地创建、修改或运行文件。涉及真实文件操作时必须调用此工具。",
  {
    prompt: z.string().min(1).describe("Claude Code 要执行的任务描述")
  },
  async ({ prompt }) =>
    new Promise((resolve) => {
      log(`tool called cwd=${WORK_DIR} prompt=${JSON.stringify(prompt)}`);

      const child = spawn(
        "claude",
        [
          "-p",
          prompt,
          "--output-format",
          "json",
          "--dangerously-skip-permissions"
        ],
        {
          cwd: WORK_DIR,
          timeout: TIMEOUT,
          env: { ...process.env }
        }
      );

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code, signal) => {
        log(
          `close code=${code} signal=${signal ?? "none"} stdout_len=${stdout.length} stderr_len=${stderr.length}`
        );

        if (stdout.trim()) {
          log(`stdout=${stdout.slice(0, 4000)}`);
        }

        if (stderr.trim()) {
          log(`stderr=${stderr.slice(0, 4000)}`);
        }

        const stdoutText = parseClaudeOutput(stdout);
        const stderrText = parseClaudeOutput(stderr);
        const text =
          stdoutText ||
          stderrText ||
          `Exit code: ${code}, signal: ${signal ?? "none"}`;

        resolve({
          content: [{ type: "text", text }],
          isError: code !== 0
        });
      });

      child.on("error", (error) => {
        log(`spawn error=${error.message}`);
        resolve({
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true
        });
      });
    })
);

const transport = new StdioServerTransport();
await server.connect(transport);
