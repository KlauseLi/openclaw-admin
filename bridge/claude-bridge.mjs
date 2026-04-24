import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const WORK_DIR = process.env.CLAUDE_WORK_DIR || "/home/claude/workspaces/demo";
const TIMEOUT = parseInt(process.env.CLAUDE_TIMEOUT || "300000", 10);
const LOG_FILE = process.env.BRIDGE_LOG_FILE || "/home/claude/ai-lab/bridge/bridge.log";
const JOBS_DIR = process.env.CLAUDE_JOBS_DIR || "/home/claude/ai-lab/bridge/jobs";
const DEFAULT_RESULT_CHARS = parseInt(process.env.CLAUDE_RESULT_MAX_CHARS || "12000", 10);

const activeJobs = new Map();

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureLogDir(filePath) {
  ensureDir(path.dirname(filePath));
}

function log(msg) {
  ensureLogDir(LOG_FILE);
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

function ensureJobsDir() {
  ensureDir(JOBS_DIR);
}

function buildClaudeEnv() {
  return {
    HOME: "/home/claude",
    USER: "claude",
    LOGNAME: "claude",
    PATH: process.env.PATH,
    ANTHROPIC_API_KEY: process.env.MINIMAX_API_KEY || "",
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || "http://localhost:3040",
    MINIMAX_API_HOST: process.env.MINIMAX_API_HOST || "",
  };
}

function parseClaudeText(raw) {
  if (!raw || !raw.trim()) {
    return "";
  }

  try {
    return JSON.parse(raw).result || raw;
  } catch {
    return raw;
  }
}

function clampText(text, maxChars = 4000) {
  if (!text) {
    return "";
  }
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`;
}

function buildClaudeArgs(prompt) {
  return [
    "--bare",
    "-p",
    prompt,
    "--output-format",
    "json"
  ];
}

function generateJobId() {
  const now = new Date();
  const parts = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ];
  const random = Math.random().toString(36).slice(2, 8);
  return `${parts.join("")}-${random}`;
}

function getJobPaths(jobId) {
  return {
    meta: path.join(JOBS_DIR, `${jobId}.json`),
    stdout: path.join(JOBS_DIR, `${jobId}.stdout.log`),
    stderr: path.join(JOBS_DIR, `${jobId}.stderr.log`)
  };
}

function atomicWriteJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath, maxChars = DEFAULT_RESULT_CHARS) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const content = fs.readFileSync(filePath, "utf8");
  return content.length <= maxChars ? content : `${content.slice(0, maxChars)}...`;
}

function createBaseJob(prompt) {
  ensureJobsDir();
  const jobId = generateJobId();
  const paths = getJobPaths(jobId);
  const now = new Date().toISOString();

  const job = {
    job_id: jobId,
    prompt,
    status: "queued",
    created_at: now,
    started_at: null,
    finished_at: null,
    work_dir: WORK_DIR,
    pid: null,
    exit_code: null,
    signal: null,
    cancelled_at: null,
    stdout_path: paths.stdout,
    stderr_path: paths.stderr,
    result_path: paths.meta,
    parsed_result: null,
    stdout_preview: "",
    stderr_preview: "",
    error: null
  };

  atomicWriteJson(paths.meta, job);
  return job;
}

function writeJobMeta(job) {
  atomicWriteJson(job.result_path, job);
}

function getStoredJob(jobId) {
  const paths = getJobPaths(jobId);
  if (!fs.existsSync(paths.meta)) {
    return null;
  }
  return readJson(paths.meta);
}

function summarizeJob(job) {
  return {
    job_id: job.job_id,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    work_dir: job.work_dir,
    pid: job.pid,
    exit_code: job.exit_code,
    signal: job.signal,
    cancelled_at: job.cancelled_at,
    stdout_path: job.stdout_path,
    stderr_path: job.stderr_path,
    result_path: job.result_path,
    parsed_result: job.parsed_result,
    stdout_preview: job.stdout_preview,
    stderr_preview: job.stderr_preview,
    error: job.error
  };
}

function startAsyncJob(prompt) {
  const job = createBaseJob(prompt);
  const stdoutStream = fs.createWriteStream(job.stdout_path, { flags: "a" });
  const stderrStream = fs.createWriteStream(job.stderr_path, { flags: "a" });
  const child = spawn("/usr/bin/claude", buildClaudeArgs(prompt), {
    cwd: WORK_DIR,
    timeout: TIMEOUT,
    stdio: ["ignore", "pipe", "pipe"],
    env: buildClaudeEnv()
  });

  const runtime = {
    child,
    stdoutStream,
    stderrStream,
    stdoutBuffer: "",
    stderrBuffer: "",
    cancelled: false
  };

  job.status = "running";
  job.started_at = new Date().toISOString();
  job.pid = child.pid ?? null;
  writeJobMeta(job);
  activeJobs.set(job.job_id, runtime);

  log(`async job started id=${job.job_id} pid=${job.pid ?? "unknown"} cwd=${WORK_DIR}`);

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdoutStream.write(chunk);
    runtime.stdoutBuffer += text;
    job.stdout_preview = clampText(runtime.stdoutBuffer);
    writeJobMeta(job);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderrStream.write(chunk);
    runtime.stderrBuffer += text;
    job.stderr_preview = clampText(runtime.stderrBuffer);
    writeJobMeta(job);
  });

  child.on("close", (code, signal) => {
    stdoutStream.end();
    stderrStream.end();
    activeJobs.delete(job.job_id);

    job.finished_at = new Date().toISOString();
    job.exit_code = code;
    job.signal = signal ?? null;

    const stdoutText = fs.existsSync(job.stdout_path) ? fs.readFileSync(job.stdout_path, "utf8") : runtime.stdoutBuffer;
    const stderrText = fs.existsSync(job.stderr_path) ? fs.readFileSync(job.stderr_path, "utf8") : runtime.stderrBuffer;
    const parsedText = parseClaudeText(stdoutText) || parseClaudeText(stderrText) || "";

    job.stdout_preview = clampText(stdoutText);
    job.stderr_preview = clampText(stderrText);
    job.parsed_result = clampText(parsedText, DEFAULT_RESULT_CHARS);

    if (runtime.cancelled) {
      job.status = "cancelled";
      job.cancelled_at = job.cancelled_at || job.finished_at;
    } else if (signal === "SIGTERM" || signal === "SIGKILL") {
      job.status = "cancelled";
    } else if (code === 0) {
      job.status = "succeeded";
    } else if (signal === "SIGXCPU") {
      job.status = "timed_out";
      job.error = `Exit signal: ${signal}`;
    } else {
      job.status = "failed";
      job.error = clampText(stderrText || `Exit code: ${code}, signal: ${signal ?? "none"}`, DEFAULT_RESULT_CHARS);
    }

    writeJobMeta(job);
    log(`async job finished id=${job.job_id} status=${job.status} code=${code} signal=${signal ?? "none"}`);
  });

  child.on("error", (err) => {
    stdoutStream.end();
    stderrStream.end();
    activeJobs.delete(job.job_id);

    job.finished_at = new Date().toISOString();
    job.status = "failed";
    job.error = err.message;
    writeJobMeta(job);
    log(`async job spawn error id=${job.job_id} error=${err.message}`);
  });

  return summarizeJob(job);
}

function cancelJob(jobId) {
  const stored = getStoredJob(jobId);
  if (!stored) {
    return null;
  }

  const runtime = activeJobs.get(jobId);
  if (runtime?.child) {
    runtime.cancelled = true;
    stored.cancelled_at = new Date().toISOString();
    stored.status = "cancelling";
    writeJobMeta(stored);
    runtime.child.kill("SIGTERM");
    log(`async job cancel requested id=${jobId}`);
    return summarizeJob(stored);
  }

  if (stored.pid && stored.status === "running") {
    try {
      process.kill(stored.pid, "SIGTERM");
      stored.cancelled_at = new Date().toISOString();
      stored.status = "cancelling";
      writeJobMeta(stored);
      log(`async job external cancel requested id=${jobId} pid=${stored.pid}`);
    } catch (err) {
      stored.error = `cancel failed: ${err.message}`;
      writeJobMeta(stored);
    }
  }

  return summarizeJob(stored);
}

function listJobs(limit = 20) {
  ensureJobsDir();
  return fs.readdirSync(JOBS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(JOBS_DIR, name)))
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, limit)
    .map(summarizeJob);
}

async function runClaudeSync(prompt) {
  log(`tool called, cwd=${WORK_DIR}, prompt=${JSON.stringify(prompt)}`);

  return new Promise((resolve) => {
    const child = spawn("/usr/bin/claude", buildClaudeArgs(prompt), {
      cwd: WORK_DIR,
      timeout: TIMEOUT,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildClaudeEnv()
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

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

const server = new McpServer({
  name: "claude-bridge",
  version: "1.1.0"
});

server.tool(
  "run_claude",
  "同步执行 Claude Code。适合几十秒内能完成的短任务。",
  { prompt: z.string().describe("要执行的任务描述") },
  async ({ prompt }) => runClaudeSync(prompt)
);

server.tool(
  "run_claude_async",
  "异步启动 Claude Code 长任务，立即返回 job_id，后续可轮询状态和结果。",
  { prompt: z.string().describe("要异步执行的任务描述") },
  async ({ prompt }) => ({
    content: [{
      type: "text",
      text: JSON.stringify(startAsyncJob(prompt), null, 2)
    }],
    isError: false
  })
);

server.tool(
  "get_claude_job",
  "查询异步 Claude 任务状态。",
  { job_id: z.string().describe("run_claude_async 返回的 job_id") },
  async ({ job_id }) => {
    const job = getStoredJob(job_id);
    if (!job) {
      return {
        content: [{ type: "text", text: `Job not found: ${job_id}` }],
        isError: true
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(summarizeJob(job), null, 2) }],
      isError: false
    };
  }
);

server.tool(
  "read_claude_job_result",
  "读取异步 Claude 任务的详细输出结果。",
  {
    job_id: z.string().describe("异步任务的 job_id"),
    max_chars: z.number().int().positive().optional().describe("stdout/stderr 最大返回字符数")
  },
  async ({ job_id, max_chars }) => {
    const job = getStoredJob(job_id);
    if (!job) {
      return {
        content: [{ type: "text", text: `Job not found: ${job_id}` }],
        isError: true
      };
    }

    const maxChars = max_chars || DEFAULT_RESULT_CHARS;
    const payload = {
      ...summarizeJob(job),
      stdout: readTextIfExists(job.stdout_path, maxChars),
      stderr: readTextIfExists(job.stderr_path, maxChars)
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: false
    };
  }
);

server.tool(
  "cancel_claude_job",
  "取消正在运行的异步 Claude 任务。",
  { job_id: z.string().describe("要取消的 job_id") },
  async ({ job_id }) => {
    const job = cancelJob(job_id);
    if (!job) {
      return {
        content: [{ type: "text", text: `Job not found: ${job_id}` }],
        isError: true
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
      isError: false
    };
  }
);

server.tool(
  "list_claude_jobs",
  "列出最近的异步 Claude 任务。",
  {
    limit: z.number().int().positive().max(100).optional().describe("最多返回多少个任务")
  },
  async ({ limit }) => ({
    content: [{ type: "text", text: JSON.stringify(listJobs(limit || 20), null, 2) }],
    isError: false
  })
);

ensureJobsDir();

const transport = new StdioServerTransport();
await server.connect(transport);
log("bridge: transport connected, serving MCP tools");
