import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { ReviewStore } from "../src/review/ReviewStore.js";
import { ReviewRunner, createRedactor } from "../src/review/ReviewRunner.js";
import {
  CodexReviewer,
  ReviewError,
  runProcess,
} from "../src/review/CodexReviewer.js";
import { PlaceholderImageGenerator } from "../src/review/PlaceholderImageGenerator.js";
import { loadEnv } from "../src/config/env.js";
import { createConfigManager } from "../src/config/index.js";

export function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      resume: { type: "string" },
      turns: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.resume && !/^[\w-]+$/.test(values.resume))
    throw new Error("--resume에는 실행 ID만 지정하세요.");
  if (
    values.turns !== undefined &&
    (!/^[1-9]\d*$/.test(values.turns) ||
      !Number.isSafeInteger(Number(values.turns)))
  )
    throw new Error("--turns는 대화별 양의 정수입니다.");
  return {
    resume: values.resume,
    turns: values.turns ? Number(values.turns) : Infinity,
    help: values.help,
  };
}

export async function acquireLock(directory) {
  const lockPath = path.join(directory, "run.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.close();
      return () => fs.unlink(lockPath);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let lock;
      try {
        lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
      } catch {
        throw new Error("실행 잠금 파일을 읽을 수 없습니다.");
      }
      if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0)
        throw new Error("잘못된 실행 잠금 파일입니다.");
      try {
        process.kill(lock.pid, 0);
        throw new Error("이 점검은 이미 실행 중입니다.");
      } catch (probe) {
        if (probe.code !== "ESRCH") throw probe;
      }
      await fs.unlink(lockPath);
    }
  }
  throw new Error("점검 실행 잠금을 얻지 못했습니다.");
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log(
      "npm run chat:review [-- --resume <run-id>] [-- --turns <대화별 턴 수>]\n기본값: 3개 대화 지속. Ctrl+C 또는 Codex 한도 오류로 중지. --turns는 짧은 실제 검증용입니다.",
    );
    return;
  }
  loadEnv();
  const configManager = createConfigManager({ watch: false });
  const redact = createRedactor([
    ...Object.values(configManager.get("secrets") ?? {}),
    ...Object.entries(process.env)
      .filter(([key]) =>
        /(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)$/i.test(key),
      )
      .map(([, value]) => value),
  ]);
  const runId =
    options.resume ??
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const root = path.resolve(".local", "chat-review");
  const directory = path.join(root, runId);
  await fs.mkdir(root, { recursive: true });
  const controller = new AbortController();
  const stop = () =>
    controller.abort(new DOMException("Manual stop", "AbortError"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const store = new ReviewStore(directory, redact);
  let unlock;
  let prisma;
  let chat;
  try {
    if (options.resume) unlock = await acquireLock(directory);
    await store.open({
      runId,
      resume: !!options.resume,
      settings: {
        character: configManager.get("character"),
        chat: {
          provider: configManager.get("ai.chat.provider"),
          model: configManager.get("ai.chat.model"),
          prompt: configManager.get("ai.chat.prompt"),
          nativeTools: configManager.get("ai.chat.nativeTools"),
        },
        imageMode: "placeholder",
        codexModel: "user_default",
        maxTurnsPerChannel: Number.isFinite(options.turns)
          ? options.turns
          : null,
      },
    });
    if (!unlock) unlock = await acquireLock(directory);
    const database = path.join(directory, "review.db");
    if (options.resume) await fs.access(database);
    // Must precede importing any module that constructs the Prisma singleton.
    process.env.DATABASE_URL = `file:${database.replaceAll("\\", "/")}`;
    process.env.PLATFORM = "cli";
    if (!options.resume) {
      await fs.writeFile(database, "", { flag: "wx" });
      const result = await runProcess(
        process.execPath,
        [
          path.resolve("node_modules/prisma/build/index.js"),
          "db",
          "push",
          "--skip-generate",
          "--schema",
          "prisma/schema.prisma",
        ],
        { signal: controller.signal },
      );
      if (result.code !== 0)
        throw new ReviewError(
          "database_init",
          "점검 전용 DB를 초기화하지 못했습니다.",
        );
    }
    configManager.setInMemory("logging.level", "silent");
    const { configureLogger } = await import("../src/core/logger.js");
    configureLogger(configManager);
    ({ prisma } = await import("../src/database/client.js"));
    const { createContainer } = await import("../src/core/container.js");
    const { createMockClient } = await import("../src/platforms/cli/mocks.js");
    const { CLI_BOT_ID } = await import("../src/platforms/cli/constants.js");
    const { HeadlessChat } = await import("../src/platforms/cli/headless.js");
    const mockClient = createMockClient({ botId: CLI_BOT_ID });
    const container = await createContainer({
      configManager,
      platformClients: new Map([["cli", mockClient]]),
      imageGenerator: new PlaceholderImageGenerator(),
    });
    // Old PROCESSING/GENERATED records cannot own a turn in this new process.
    await container.generationRepository.cancelInProgress();
    chat = new HeadlessChat({
      container,
      mockClient,
      onDelivery: (message) => store.record({ type: "delivered", message }),
    });
    const reviewer = new CodexReviewer({ directory });
    const runner = new ReviewRunner({
      store,
      reviewer,
      chat,
      progress: (state) => {
        const latest =
          state.channels[(state.cursor + 2) % 3].recentFindings.at(-1);
        console.log(
          `${state.channels.map((channel) => `${channel.userName} ${channel.turnCount}턴`).join(" · ")}${latest ? ` | ${latest.description.replace(/\s+/g, " ").slice(0, 120)}` : ""}`,
        );
      },
    });
    console.log(
      `점검 실행: ${runId}\n결과: ${directory}\nCtrl+C로 중지합니다. AiMate 모델·검색 비용은 별도이며 이미지 AI 호출은 없습니다.`,
    );
    await runner.run({ signal: controller.signal, maxTurns: options.turns });
    console.log(
      `점검 종료: ${store.state.stopReason}\n보고서: ${path.join(directory, "report.md")}`,
    );
  } catch (error) {
    if (store.file && store.state.status !== "stopped")
      await store.record({
        type: "stopped",
        reason: controller.signal.aborted
          ? "manual_stop"
          : (error.code ?? "startup_failed"),
      });
    if (!controller.signal.aborted) throw error;
  } finally {
    await chat?.close();
    await prisma?.$disconnect();
    configManager.close();
    await store.close();
    await unlock?.();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    // Do not print SDK errors: they can contain provider headers and prompts.
    console.error(
      error instanceof ReviewError
        ? error.message
        : "점검을 완료하지 못했습니다. 실행 인자·설정·로컬 기록을 확인하세요.",
    );
    process.exitCode = 1;
  });
}
