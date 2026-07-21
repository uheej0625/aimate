import test from "node:test";
import assert from "node:assert/strict";
import {
  ChatTui,
  displayWidth,
  fitText,
  renderStatusLine,
  sanitizeText,
  wrapText,
} from "../../../src/platforms/cli/tui.js";

test("displayWidth accounts for Korean and ASCII terminal cells", () => {
  assert.equal(displayWidth("Ai메이트"), 8);
});

test("fitText pads and truncates to the requested terminal width", () => {
  assert.equal(displayWidth(fitText("hello", 8)), 8);
  assert.equal(fitText("아주 긴 채팅 제목", 8), "아주 긴…");
  assert.equal(displayWidth(fitText("아주 긴 채팅 제목", 8)), 8);
});

test("wrapText preserves explicit newlines and wraps wide characters", () => {
  assert.deepEqual(wrapText("가나다라\nhello", 4), [
    "가나",
    "다라",
    "hell",
    "o",
  ]);
});

test("sanitizeText removes terminal control sequences from model output", () => {
  assert.equal(sanitizeText("safe\u001b[2J text\u0007"), "safe text");
});

test("status line keeps the same terminal width for ready and busy states", () => {
  for (const width of [44, 56, 80, 100]) {
    const ready = renderStatusLine({ status: "● 준비됨", color: "", width });
    const busy = renderStatusLine({
      status: "● 답변을 준비하고 있어요",
      color: "",
      width,
    });

    assert.equal(displayWidth(sanitizeText(ready)), width);
    assert.equal(displayWidth(sanitizeText(busy)), width);
  }
});

test("ChatTui sends composer input and updates a new channel title", () => {
  const writes = [];
  const output = {
    columns: 100,
    rows: 30,
    write: (value) => writes.push(value),
  };
  const tui = new ChatTui({ output });
  tui.channels = [
    { id: "one", title: "새 채팅", messages: [], messageCount: 0 },
  ];
  let sent;
  tui.on("send", (message) => {
    sent = message;
  });

  tui.handleComposerKey("안녕", { name: undefined });
  tui.handleComposerKey(undefined, { name: "return" });
  tui.addMessage("one", { role: "user", content: "안녕 반가워" });

  assert.deepEqual(sent, { channelId: "one", content: "안녕" });
  assert.equal(tui.channels[0].title, "안녕 반가워");
  assert.ok(writes.length > 0);
});

test("ChatTui shows an author header only once for consecutive messages", () => {
  const tui = new ChatTui({
    output: { columns: 100, rows: 30, write: () => {} },
  });
  tui.channels = [
    {
      id: "one",
      messages: [
        { role: "user", content: "1", createdAt: new Date() },
        { role: "user", content: "2", createdAt: new Date() },
        { role: "assistant", content: "하나", createdAt: new Date() },
        { role: "assistant", content: "둘", createdAt: new Date() },
      ],
    },
  ];

  const lines = tui.renderMessages(60, 30).map(sanitizeText);
  assert.equal(lines.filter((line) => line.startsWith("나 ")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("AiMate ")).length, 1);
});
