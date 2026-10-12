import test from "node:test";
import assert from "node:assert/strict";
import { MessageActionService } from "../../src/tools/MessageActionService.js";

function harness() {
  const receipts = new Map();
  let dispatched = 0;
  let saved = 0;
  const target = {
    platform: "discord",
    platformId: "platform-message",
    channelMessageNo: 11,
  };
  const message = {
    platform: "discord",
    platformMessageId: "output",
    content: "reply",
    author: { isBot: true },
  };
  const dependencies = {
    messageRepository: {
      findByChannelMessageNo: async (id, no) =>
        id === "channel" && no === 11 ? target : null,
    },
    messageService: {
      saveMessage: async () => {
        saved++;
        return { message: { channelMessageNo: 12 } };
      },
    },
    generationRepository: {
      findById: async () => ({
        status: "PROCESSING",
        channelId: "channel",
        characterId: "fixture",
        input: JSON.stringify({
          eventSnapshot: { events: [{ channelMessageNo: 11 }] },
        }),
      }),
    },
    actionRepository: {
      claim: async (generationId, key) => {
        const id = `${generationId}:${key}`;
        if (receipts.has(id))
          return { receipt: receipts.get(id), claimed: false };
        const receipt = { id, resultJson: null };
        receipts.set(id, receipt);
        return { receipt, claimed: true };
      },
      recordResult: async (id, result) => {
        receipts.get(id).resultJson = JSON.stringify(result);
      },
    },
  };
  const context = {
    characterId: "fixture",
    generationId: 1,
    channel: {
      id: "channel",
      platform: "discord",
      platformId: "platform-channel",
    },
    channelPort: {
      platform: "discord",
      platformChannelId: "platform-channel",
      reply: async (id) => {
        assert.equal(id, "platform-message");
        dispatched++;
        return message;
      },
      react: async () => {
        dispatched++;
      },
    },
    delivery: {
      run: (operation) => operation(),
      isCurrent: () => true,
      onDelivered: () => {},
    },
  };
  return {
    dependencies,
    context,
    target,
    receipts,
    service: new MessageActionService(dependencies),
    dispatched: () => dispatched,
    saved: () => saved,
  };
}
const input = { targetMessageNo: 11, text: "reply" };

test("message actions reject invalid numbers, missing/deleted targets and mismatched channels", async () => {
  const h = harness();
  for (const targetMessageNo of [0, -1, 1.5, "11", NaN])
    assert.throws(
      () => h.service.reply({ ...input, targetMessageNo }, h.context),
      /positive integer/,
    );
  await assert.rejects(
    h.service.reply({ ...input, targetMessageNo: 12 }, h.context),
    /unavailable/,
  );
  h.target.deletedAt = new Date();
  await assert.rejects(h.service.reply(input, h.context), /unavailable/);
  assert.throws(
    () =>
      h.service.reply(input, {
        ...h.context,
        channel: { ...h.context.channel, platformId: "other" },
      }),
    /active channel/,
  );
  assert.equal(h.dispatched(), 0);
});

test("cancelled generations never dispatch message actions", async () => {
  for (const cancel of [
    (h) => {
      h.context.delivery.isCurrent = () => false;
    },
    (h) => {
      h.dependencies.generationRepository.findById = async () => ({
        status: "CANCELLED",
      });
    },
    (h) => {
      const controller = new AbortController();
      controller.abort();
      h.context.abortSignal = controller.signal;
    },
  ]) {
    const h = harness();
    cancel(h);
    await assert.rejects(
      h.service.reply(input, h.context),
      /cancelled|no longer active/,
    );
    assert.equal(h.dispatched(), 0);
  }
});

test("guessing a stored but unobserved reference cannot trigger an action", async () => {
  const h = harness();
  const find = h.dependencies.generationRepository.findById;
  h.dependencies.generationRepository.findById = async () => ({
    ...(await find()),
    input: JSON.stringify({ eventSnapshot: { events: [] } }),
  });
  await assert.rejects(
    h.service.reply(input, h.context),
    /has not been observed/,
  );
  assert.equal(h.dispatched(), 0);
});

test("confirmed reply receipts recover storage after service recreation without sending again", async () => {
  const h = harness();
  h.dependencies.messageService.saveMessage = async () => {
    throw new Error("storage down");
  };
  await assert.rejects(h.service.reply(input, h.context), /storage down/);
  assert.equal(h.dispatched(), 1);
  h.dependencies.messageService.saveMessage = async () => ({
    message: { channelMessageNo: 12 },
  });
  const service = new MessageActionService(h.dependencies);
  assert.deepEqual(await service.reply(input, h.context), {
    success: true,
    action: "reply",
    targetMessageNo: 11,
    messageNo: 12,
  });
  assert.equal(h.dispatched(), 1);
});

test("an unfinished or failed external action is not repeated", async () => {
  const h = harness();
  h.dependencies.actionRepository.recordResult = async () => {
    throw new Error("receipt storage down");
  };
  await assert.rejects(
    h.service.reply(input, h.context),
    /receipt storage down/,
  );
  await assert.rejects(
    new MessageActionService(h.dependencies).reply(input, h.context),
    /outcome is unknown/,
  );
  assert.equal(h.dispatched(), 1);
  const failed = harness();
  failed.context.channelPort.reply = async () => {
    throw new Error("target deleted on platform");
  };
  assert.deepEqual(await failed.service.reply(input, failed.context), {
    error: "target deleted on platform",
  });
  assert.deepEqual(await failed.service.reply(input, failed.context), {
    error: "target deleted on platform",
  });
});

test("reply and reaction validation also runs for recovered text calls", () => {
  const h = harness();
  for (const text of ["", " ", "x".repeat(2001), null])
    assert.throws(
      () => h.service.reply({ ...input, text }, h.context),
      /Reply text/,
    );
  for (const emoji of ["", " ", "x".repeat(101), null])
    assert.throws(
      () => h.service.react({ targetMessageNo: 11, emoji }, h.context),
      /emoji/,
    );
});
