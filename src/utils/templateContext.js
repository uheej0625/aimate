const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"]; //prettier-ignore

export const buildSystemContext = (date = new Date(), timeZone) => {
  // Keep calendar, digits and GMT offset labels stable for ISO serialization.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const dateText = `${parts.year}-${parts.month}-${parts.day}`;
  const offset =
    parts.timeZoneName === "GMT"
      ? "+00:00"
      : parts.timeZoneName.replace("GMT", "");

  return {
    now: {
      timezone: formatter.resolvedOptions().timeZone,
      raw: `${dateText}T${parts.hour}:${parts.minute}:${parts.second}${offset}`,
      time: `${parts.hour}:${parts.minute}`,
      date: dateText,
      weekday: WEEKDAYS[new Date(`${dateText}T00:00:00Z`).getUTCDay()],
      timeOfDay: getTimeOfDay(hour),
      year: Number(parts.year),
    },
  };
};

export const buildRuntimeContext = () => ({
  platform: process.env.PLATFORM ?? "unknown",
});

export const buildTemplateContext = (
  data = {},
  { referenceDate = new Date(), timeZone } = {},
) => ({
  data,
  system: buildSystemContext(referenceDate, timeZone),
  runtime: buildRuntimeContext(),
});

function getTimeOfDay(hour) {
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}
