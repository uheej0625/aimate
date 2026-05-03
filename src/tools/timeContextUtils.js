export function buildCurrentTimeContext({
  date = new Date(),
  timeZone = "Asia/Seoul",
} = {}) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour) % 24;
  const hourText = String(hour).padStart(2, "0");

  return {
    currentDate: `${parts.year}-${parts.month}-${parts.day}`,
    currentTime: `${hourText}:${parts.minute}`,
    currentDateTime: `${parts.year}-${parts.month}-${parts.day} ${hourText}:${parts.minute}`,
    currentWeekday: parts.weekday,
    currentTimeZone: timeZone,
    timeOfDay: getTimeOfDay(hour),
  };
}

function getTimeOfDay(hour) {
  if (hour < 5) return "late night";
  if (hour < 8) return "early morning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 20) return "evening";
  return "night";
}
