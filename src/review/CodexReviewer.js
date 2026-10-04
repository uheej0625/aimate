import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { reviewSchema, reviewPrompt, validateReview } from "./contracts.js";

export class ReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function codexEnvironment(source = process.env) {
  // The reviewer uses ChatGPT login, not AiMate's provider credentials.
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        !/(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)$/i.test(key) &&
        !/^(?:OPENAI_BASE_URL|OPENAI_ORG_ID|OPENAI_PROJECT_ID)$/i.test(key),
    ),
  );
}

/** No shell: prompts travel through stdin and CLI options remain literal args. */
export function runProcess(
  command,
  args,
  {
    cwd,
    env = process.env,
    input = "",
    signal,
    onEvent = null,
    spawnFn = spawn,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const child = spawnFn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let pending = "";
    let aborted = false;
    let overflow = false;
    let killer = null;
    const kill = () => {
      if (process.platform === "win32" && child.pid) {
        killer = new Promise((done) => {
          const taskkill = spawn(
            "taskkill",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
          taskkill.once("error", () => {
            child.kill();
            done();
          });
          taskkill.once("close", done);
        });
      } else child.kill("SIGKILL");
    };
    const abort = () => {
      aborted = true;
      kill();
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (overflow) return;
      stdout += chunk;
      if (stdout.length > 10_000_000) {
        overflow = true;
        kill();
        return;
      }
      if (onEvent) {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) {
          try {
            onEvent(JSON.parse(line));
          } catch {
            /* Ignore non-JSON CLI diagnostics. */
          }
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-20_000);
    });
    child.stdin.on("error", () => {});
    child.once("error", () => {
      signal?.removeEventListener("abort", abort);
      reject(
        new ReviewError(
          "process_start",
          `실행 파일을 시작하지 못했습니다: ${path.basename(command)}`,
        ),
      );
    });
    child.once("close", async (code) => {
      signal?.removeEventListener("abort", abort);
      if (killer) await killer;
      if (aborted) reject(signal.reason);
      else if (overflow)
        reject(
          new ReviewError(
            "process_output",
            "프로세스 출력 한도를 초과했습니다.",
          ),
        );
      else resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export function classifyCodexFailure(text) {
  if (
    /model.{0,120}(?:not supported|not found|does not exist)|unsupported.{0,40}model/i.test(
      text,
    )
  )
    return new ReviewError(
      "codex_model",
      "Codex CLI 기본 모델을 현재 ChatGPT 로그인에서 사용할 수 없습니다. CLI 모델 설정을 확인하세요.",
    );
  if (
    /usage[_ ]limit|rate[_ ]limit|quota|limit.{0,30}(?:reached|exceeded)|too many requests|429/i.test(
      text,
    )
  )
    return new ReviewError(
      "codex_limit",
      "Codex 사용량 한도 오류로 중지했습니다.",
    );
  if (/auth|unauthoriz|login|sign.?in|401|403/i.test(text))
    return new ReviewError("codex_auth", "Codex 인증 오류로 중지했습니다.");
  return new ReviewError(
    "codex_failed",
    "Codex 실행이 실패했습니다. 자동 재시도하지 않습니다.",
  );
}

export class CodexReviewer {
  constructor({
    directory,
    command = "codex",
    run = runProcess,
    env = process.env,
  } = {}) {
    Object.assign(this, { directory, command, run });
    this.env = codexEnvironment(env);
    this.schemaPath = path.join(directory, "review-schema.json");
  }

  async initialize({ signal } = {}) {
    const result = await this.run(this.command, ["login", "status"], {
      env: this.env,
      signal,
    });
    if (result.code !== 0 || !/ChatGPT/i.test(result.stdout + result.stderr)) {
      throw new ReviewError(
        "codex_auth",
        "ChatGPT로 로그인한 Codex CLI가 필요합니다. codex login으로 로그인하세요.",
      );
    }
    await fs.writeFile(
      this.schemaPath,
      JSON.stringify(reviewSchema, null, 2) + "\n",
    );
    // Direct user-configured MCP servers must not act on conversation contents.
    const mcp = await this.run(
      this.command,
      [
        "-c",
        "features.plugins=false",
        "-c",
        "features.apps=false",
        "mcp",
        "list",
        "--json",
      ],
      {
        env: this.env,
        signal,
      },
    );
    if (mcp.code !== 0)
      throw new ReviewError(
        "codex_config",
        "Codex MCP 설정을 확인하지 못했습니다.",
      );
    let servers;
    try {
      servers = JSON.parse(mcp.stdout);
    } catch {
      throw new ReviewError(
        "codex_config",
        "Codex MCP 목록을 읽지 못했습니다.",
      );
    }
    if (
      !Array.isArray(servers) ||
      servers.some(
        (server) =>
          typeof server.name !== "string" || !/^[\w-]+$/.test(server.name),
      )
    )
      throw new ReviewError(
        "codex_config",
        "Codex MCP 목록 형식이 올바르지 않습니다.",
      );
    this.mcpOverrides = servers.flatMap((server) => [
      "-c",
      `mcp_servers.${server.name}.enabled=false`,
    ]);
  }

  async review(channel, { signal, final = false } = {}) {
    let output = null;
    let usage = null;
    let completed = false;
    const errors = [];
    const args = [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--json",
      "--color",
      "never",
      "--output-schema",
      this.schemaPath,
      "-c",
      'forced_login_method="chatgpt"',
      "-c",
      "features.shell_tool=false",
      "-c",
      "features.multi_agent=false",
      "-c",
      "features.apps=false",
      "-c",
      "features.plugins=false",
      "-c",
      "features.hooks=false",
      "-c",
      "features.browser_use=false",
      "-c",
      "features.computer_use=false",
      "-c",
      "features.image_generation=false",
      "-c",
      'web_search="disabled"',
      ...(this.mcpOverrides ?? []),
      "-",
    ];
    const result = await this.run(this.command, args, {
      cwd: path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
      env: this.env,
      input: reviewPrompt(channel, { final }),
      signal,
      onEvent: (event) => {
        if (
          event.type === "item.completed" &&
          event.item?.type === "agent_message"
        )
          output = event.item.text;
        if (event.type === "turn.completed") {
          usage = event.usage;
          completed = true;
        }
        if (event.type === "error" || event.type === "turn.failed")
          errors.push(JSON.stringify(event));
      },
    });
    if (result.code !== 0 || errors.length)
      throw classifyCodexFailure(
        errors.length ? errors.join("\n") : result.stderr,
      );
    if (!completed)
      throw new ReviewError(
        "codex_output",
        "Codex 평가 완료 이벤트가 없습니다.",
      );
    let value;
    try {
      value = JSON.parse(output);
    } catch {
      throw new ReviewError(
        "codex_output",
        "Codex가 유효한 JSON 평가를 반환하지 않았습니다.",
      );
    }
    try {
      validateReview(value, channel.turnCount);
    } catch {
      throw new ReviewError(
        "codex_output",
        "Codex 평가가 반환 계약을 지키지 않았습니다.",
      );
    }
    return {
      review: value,
      usage: usage
        ? {
            inputTokens: usage.input_tokens ?? null,
            cachedInputTokens: usage.cached_input_tokens ?? null,
            outputTokens: usage.output_tokens ?? null,
          }
        : null,
    };
  }
}
