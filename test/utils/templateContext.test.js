import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemContext,
  buildTemplateContext,
} from "../../src/utils/templateContext.js";

test("time of day follows local hour boundaries, including midnight", () => {
  const cases = [
    ["00:00", "night"],
    ["04:59", "night"],
    ["05:00", "morning"],
    ["11:59", "morning"],
    ["12:00", "afternoon"],
    ["16:59", "afternoon"],
    ["17:00", "evening"],
    ["20:59", "evening"],
    ["21:00", "night"],
    ["23:59", "night"],
  ];

  for (const [time, expected] of cases) {
    const date = new Date(`2026-09-29T${time}:00+09:00`);
    const { now } = buildSystemContext(date, "Asia/Seoul");
    assert.equal(now.time, time);
    assert.equal(now.timeOfDay, expected, time);
  }
});

test("template context preserves data and uses the supplied instant and timezone", () => {
  const data = { scene: "night sky" };
  const context = buildTemplateContext(data, {
    referenceDate: new Date("2026-12-31T19:00:00Z"),
    timeZone: "Asia/Seoul",
  });

  assert.equal(context.data, data);
  assert.deepEqual(context.system.now, {
    timezone: "Asia/Seoul",
    raw: "2027-01-01T04:00:00+09:00",
    time: "04:00",
    date: "2027-01-01",
    weekday: "금요일",
    timeOfDay: "night",
    year: 2027,
  });
});
