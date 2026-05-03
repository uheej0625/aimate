import fs from "fs/promises";
import Handlebars from "handlebars";

const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"]; //prettier-ignore

export const buildSystemContext = (date = new Date()) => {
  const hour = date.getHours();

  return {
    now: {
      raw: date.toISOString(),
      time: `${String(date.getHours()).padStart(2, "0")}:${String(
        date.getMinutes(),
      ).padStart(2, "0")}`,
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        "0",
      )}-${String(date.getDate()).padStart(2, "0")}`,
      weekday: WEEKDAYS[date.getDay()],
      timeOfDay:
        hour >= 5 && hour < 12
          ? "morning"
          : hour < 17
            ? "afternoon"
            : hour < 21
              ? "evening"
              : "night",
      year: date.getFullYear(),
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
