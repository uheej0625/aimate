import fs from "fs/promises";
import Handlebars from "handlebars";

const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"]; //prettier-ignore

export const buildSystemContext = (date = new Date(), timeZone) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const dateText = `${parts.year}-${parts.month}-${parts.day}`;
  const offset =
    parts.timeZoneName === "GMT"
      ? "+00:00"
      : parts.timeZoneName.replace("GMT", "");

  return {
    now: {
      raw: `${dateText}T${parts.hour}:${parts.minute}:${parts.second}${offset}`,
      time: `${parts.hour}:${parts.minute}`,
      date: dateText,
      weekday: WEEKDAYS[new Date(`${dateText}T00:00:00Z`).getUTCDay()],
      timeOfDay:
        hour >= 5 && hour < 12
          ? "morning"
          : hour < 17
            ? "afternoon"
            : hour < 21
              ? "evening"
              : "night",
      year: Number(parts.year),
    },
  };
};

export const buildRuntimeContext = () => ({
  platform: process.env.PLATFORM ?? "unknown",
});

export const buildTemplateContext = (data = {}) => ({
  data,
  system: buildSystemContext(),
  runtime: buildRuntimeContext(),
});

export const renderTemplate = (template, context = {}) => {
  if (!template) return "";

  const compiled = Handlebars.compile(template, { noEscape: true });
  return compiled(context);
};

export const renderTemplateFile = async (filePath, context = {}) => {
  const template = await fs.readFile(filePath, "utf-8");
  return renderTemplate(template, context);
};
