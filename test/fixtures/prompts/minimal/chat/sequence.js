export default [
  { type: "file", role: "system", source: "system.md" },
  { type: "placeholder", role: "user", source: "character.identity" },
  { type: "history" },
  { type: "pending" },
  { type: "file", role: "user", source: "response.md" },
];
