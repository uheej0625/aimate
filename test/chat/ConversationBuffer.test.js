import test from "node:test";
import assert from "node:assert";
import { ConversationSession } from "../../src/chat/ConversationSession.js";
import { ConversationBuffer } from "../../src/chat/ConversationBuffer.js";

test("ConversationBuffer tests", async (t) => {
  const mockConfigManager = {
    get: () => 10, // 10ms timeout for testing
  };

  await t.test("add should trigger chatFlow after timeout", async () => {
    let executedRequest = null;
    const mockChatFlow = {
      execute: async (request) => {
        executedRequest = request;
      },
    };

    const buffer = new ConversationBuffer(
      mockChatFlow,
      mockConfigManager,
      new ConversationSession(),
    );
    const request = createRequest("cli", "chan-1", "bot-1");
    await buffer.add(request);

    assert.strictEqual(executedRequest, null, "Should not execute immediately");

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.deepStrictEqual(executedRequest, {
      ...request,
      turnId: executedRequest.turnId,
    });
    assert.equal(
      buffer.conversationSession.isCurrent(
        buffer.conversationSession.key(request.channelPort),
        executedRequest.turnId,
      ),
      true,
    );
  });

  await t.test("add should debounce subsequent calls", async () => {
    let callCount = 0;
    const mockChatFlow = {
      execute: async () => {
        callCount++;
      },
    };

    const buffer = new ConversationBuffer(
      mockChatFlow,
      mockConfigManager,
      new ConversationSession(),
    );
    await buffer.add(createRequest("cli", "chan-2", "bot-1"));

    await new Promise((resolve) => setTimeout(resolve, 5));
    await buffer.add(createRequest("cli", "chan-2", "bot-1")); // reset timer

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(callCount, 1, "Should only execute once if debounced");
  });

  await t.test(
    "add should keep same channel IDs on different platforms separate",
    async () => {
      let callCount = 0;
      const mockChatFlow = {
        execute: async () => {
          callCount++;
        },
      };

      const buffer = new ConversationBuffer(
        mockChatFlow,
        mockConfigManager,
        new ConversationSession(),
      );
      await buffer.add(createRequest("discord", "same-id", "discord-bot"));
      await buffer.add(createRequest("cli", "same-id", "cli-bot"));

      await new Promise((resolve) => setTimeout(resolve, 30));

      assert.strictEqual(callCount, 2);
    },
  );

  await t.test("clear should prevent execution", async () => {
    let executed = false;
    const mockChatFlow = {
      execute: async () => {
        executed = true;
      },
    };

    const buffer = new ConversationBuffer(
      mockChatFlow,
      mockConfigManager,
      new ConversationSession(),
    );
    const request = createRequest("cli", "chan-3", "bot-1");
    await buffer.add(request);
    assert.strictEqual(buffer.has(request.channelPort), true);
    assert.strictEqual(buffer.clear(request.channelPort), true);
    assert.strictEqual(buffer.has(request.channelPort), false);
    assert.strictEqual(buffer.clear(request.channelPort), false);

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(executed, false, "Should not execute if cleared");
  });
});

test("clearAll settles buffered turns without clearing unrelated sessions", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 100;
  const session = new ConversationSession({
    now: () => now,
    watchDuration: 50,
  });
  const execute = t.mock.fn();
  const buffer = new ConversationBuffer(
    { execute },
    { get: () => 10 },
    session,
  );
  const requests = [
    createRequest("cli", "same-id", "bot"),
    createRequest("discord", "same-id", "bot"),
  ];
  for (const request of requests) await buffer.add(request);
  const activeTurn = session.begin("active-generation");
  // A newer turn must not be settled by an older buffered request.
  const newerKey = session.key(requests[1].channelPort);
  const newerTurn = session.begin(newerKey);

  buffer.clearAll();
  buffer.clearAll();
  t.mock.timers.tick(100);

  assert.equal(execute.mock.callCount(), 0);
  assert.equal(buffer.buffers.size, 0);
  assert.equal(session.isCurrent("active-generation", activeTurn), true);
  assert.equal(session.isCurrent(newerKey, newerTurn), true);
  const clearedKey = session.key(requests[0].channelPort);
  assert.equal(session.states.get(clearedKey).active, false);
  assert.equal(session.isWatching(clearedKey), true);
  now = 150;
  assert.equal(session.isWatching(clearedKey), false);
});

function createRequest(platform, platformChannelId, botId) {
  return {
    channelPort: { platform, platformChannelId },
    internalChannelId: `internal-${platformChannelId}`,
    botId,
  };
}
