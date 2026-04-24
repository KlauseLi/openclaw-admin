import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTextPayload(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("Missing text payload in tool result");
  }
  return JSON.parse(text);
}

async function waitForTerminalStatus(client, jobId, attempts = 20, intervalMs = 3000) {
  let lastJob = null;

  for (let i = 0; i < attempts; i += 1) {
    await sleep(intervalMs);
    lastJob = parseTextPayload(await client.callTool({
      name: "get_claude_job",
      arguments: { job_id: jobId }
    }));

    console.log(`[poll ${i + 1}]`, JSON.stringify({
      job_id: jobId,
      status: lastJob.status,
      started_at: lastJob.started_at,
      finished_at: lastJob.finished_at,
      exit_code: lastJob.exit_code
    }));

    if (["succeeded", "failed", "cancelled", "timed_out"].includes(lastJob.status)) {
      return lastJob;
    }
  }

  throw new Error(`Job ${jobId} did not reach a terminal status in time`);
}

async function main() {
  const bridgeEnv = {
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY || "",
    MINIMAX_API_HOST: process.env.MINIMAX_API_HOST || "",
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || "http://localhost:3040",
    HOME: "/home/claude",
    USER: "claude",
    LOGNAME: "claude",
    CLAUDE_WORK_DIR: "/home/claude/workspaces/demo"
  };

  const transport = new StdioClientTransport({
    command: "/usr/bin/sudo",
    args: [
      "-u", "claude", "env",
      `MINIMAX_API_KEY=${bridgeEnv.MINIMAX_API_KEY}`,
      `MINIMAX_API_HOST=${bridgeEnv.MINIMAX_API_HOST}`,
      `ANTHROPIC_BASE_URL=${bridgeEnv.ANTHROPIC_BASE_URL}`,
      "HOME=/home/claude",
      "USER=claude",
      "LOGNAME=claude",
      "CLAUDE_WORK_DIR=/home/claude/workspaces/demo",
      "/usr/bin/node",
      "/home/claude/ai-lab/bridge/claude-bridge.codex-test.mjs"
    ],
    env: bridgeEnv,
    stderr: "pipe"
  });

  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      process.stderr.write(`[bridge-stderr] ${chunk}`);
    });
  }

  const client = new Client({
    name: "codex-async-bridge-test",
    version: "1.0.0"
  });

  client.onerror = (error) => {
    console.error("[client-error]", error);
  };

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();
    console.log("TOOLS", JSON.stringify(toolNames));

    const syncResult = await client.callTool({
      name: "run_claude",
      arguments: {
        prompt: "执行 shell 命令：echo sync-sdk-ok。只返回最终输出。"
      }
    });
    console.log("SYNC", syncResult.content?.[0]?.text || "");

    const started = parseTextPayload(await client.callTool({
      name: "run_claude_async",
      arguments: {
        prompt: "执行 shell 命令：sleep 15 && echo async-sdk-ok。只返回最终输出。"
      }
    }));
    console.log("ASYNC_START", JSON.stringify(started));

    const asyncJob = await waitForTerminalStatus(client, started.job_id);
    const asyncResult = parseTextPayload(await client.callTool({
      name: "read_claude_job_result",
      arguments: {
        job_id: started.job_id,
        max_chars: 4000
      }
    }));
    console.log("ASYNC_RESULT", JSON.stringify({
      status: asyncJob.status,
      parsed_result: asyncResult.parsed_result,
      stdout_preview: asyncResult.stdout_preview
    }));

    const cancelStarted = parseTextPayload(await client.callTool({
      name: "run_claude_async",
      arguments: {
        prompt: "执行 shell 命令：sleep 60 && echo should-not-finish。只返回最终输出。"
      }
    }));
    console.log("CANCEL_START", JSON.stringify(cancelStarted));

    await sleep(3000);
    const cancelRequest = parseTextPayload(await client.callTool({
      name: "cancel_claude_job",
      arguments: {
        job_id: cancelStarted.job_id
      }
    }));
    console.log("CANCEL_REQUEST", JSON.stringify(cancelRequest));

    const cancelledJob = await waitForTerminalStatus(client, cancelStarted.job_id, 15, 2000);
    console.log("CANCEL_RESULT", JSON.stringify({
      status: cancelledJob.status,
      cancelled_at: cancelledJob.cancelled_at,
      exit_code: cancelledJob.exit_code,
      signal: cancelledJob.signal
    }));
  } finally {
    await transport.close();
  }
}

main().catch((error) => {
  console.error("TEST_FAILED", error);
  process.exit(1);
});
