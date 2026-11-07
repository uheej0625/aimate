import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

await mkdir("test/.tmp", { recursive: true });
const directory = await mkdtemp(path.resolve("test/.tmp/accounts-"));
const databaseUrl = `file:../test/.tmp/${path.basename(directory)}/accounts.db`;
await writeFile(path.join(directory, "accounts.db"), "");
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  },
);
process.env.DATABASE_URL = databaseUrl;

const { prisma } = await import("../../src/database/client.js");
const { PlatformAccountRepository } = await import(
  "../../src/repositories/PlatformAccountRepository.js"
);
const { BotAccountService } = await import(
  "../../src/accounts/BotAccountService.js"
);

test.after(async () => {
  await prisma.$disconnect();
  await rm(directory, { recursive: true, force: true });
});

const service = (characterId) =>
  new BotAccountService(new PlatformAccountRepository(), {
    get: (key) => (key === "character" ? characterId : undefined),
  });

test("one character owns its Discord and CLI accounts through one User, including after restart", async () => {
  const character = service("alice");
  const discord = await character.initBotAccount({
    platform: "discord",
    platformId: "alice-discord",
    handle: "alice",
  });
  const cli = await character.initBotAccount({
    platform: "cli",
    platformId: "alice-cli",
  });
  assert.equal(discord.created, true);
  assert.equal(cli.created, true);
  assert.equal(discord.account.userId, cli.account.userId);
  assert.equal(
    (await prisma.user.findUnique({ where: { id: cli.account.userId } }))
      .characterId,
    "alice",
  );

  const repeated = await service("alice").initBotAccount({
    platform: "discord",
    platformId: "alice-discord",
    handle: "renamed",
  });
  assert.equal(repeated.created, false);
  assert.equal(repeated.account.id, discord.account.id);
  assert.equal(repeated.account.handle, "renamed");
  assert.equal(await prisma.user.count({ where: { characterId: "alice" } }), 1);
});

test("another character cannot take an owned account or modify its profile", async () => {
  const first = await service("owner").initBotAccount({
    platform: "discord",
    platformId: "owned",
    handle: "original",
  });
  await assert.rejects(
    service("intruder").initBotAccount({
      platform: "discord",
      platformId: "owned",
      handle: "stolen",
    }),
    /ownership conflict/i,
  );
  const stored = await prisma.platformAccount.findUnique({
    where: { id: first.account.id },
  });
  assert.equal(stored.userId, first.account.userId);
  assert.equal(stored.handle, "original");
  assert.equal(
    await prisma.user.count({ where: { characterId: "intruder" } }),
    0,
  );
});

test("external accounts are never adopted or merged into a character", async () => {
  const external = await prisma.user.create({ data: {} });
  const account = await prisma.platformAccount.create({
    data: {
      userId: external.id,
      platform: "discord",
      platformId: "external",
      handle: "external",
    },
  });
  await assert.rejects(
    service("new-character").initBotAccount({
      platform: "discord",
      platformId: "external",
    }),
    /ownership conflict/i,
  );
  assert.equal(
    (await prisma.platformAccount.findUnique({ where: { id: account.id } }))
      .userId,
    external.id,
  );
  assert.equal(
    (await prisma.user.findUnique({ where: { id: external.id } })).characterId,
    null,
  );
});

test("a character cannot attach a second account on the same platform, including after restart", async () => {
  await service("single-account").initBotAccount({
    platform: "discord",
    platformId: "first-account",
  });
  await assert.rejects(
    service("single-account").initBotAccount({
      platform: "discord",
      platformId: "second-account",
    }),
    /one account per platform/i,
  );
  assert.equal(
    await prisma.platformAccount.count({
      where: { platformId: "second-account" },
    }),
    0,
  );
});

test("failed account creation rolls back the character User", async () => {
  await assert.rejects(
    service("failed-account").initBotAccount({
      platform: "discord",
      platformId: "invalid-account",
      handle: null,
    }),
  );
  assert.equal(
    await prisma.user.count({ where: { characterId: "failed-account" } }),
    0,
  );
});

test("account initialization requires a valid character ID", () => {
  assert.throws(() => service(""), /Missing required configuration: character/);
  assert.throws(() => service("../invalid"), /Invalid character ID/);
});
