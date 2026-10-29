import { jsonSchema } from "ai";
import { ActivityType } from "discord.js";

const activityTypes = {
  PLAYING: ActivityType.Playing,
  LISTENING: ActivityType.Listening,
  WATCHING: ActivityType.Watching,
  CUSTOM: ActivityType.Custom,
  COMPETING: ActivityType.Competing,
};

/** @type {import('../ToolRegistry.js').ToolDef} */
export default {
  name: "set_discord_activity",
  platforms: ["discord"],
  description:
    "Discord 활동을 변경한다. CUSTOM 외에는 자연어 설명이나 약칭 대신 실제 게임의 정식 전체 이름을 쓴다. 변경을 남용하지 말고, 특히 CUSTOM은 꼭 필요할 때만 사용한다.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      activities: {
        type: "array",
        description: "활동 목록을 교체한다. 빈 배열이면 모두 지운다.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: Object.keys(activityTypes) },
            name: {
              type: "string",
              minLength: 1,
              description: "실제 게임의 정식 전체 이름. CUSTOM이면 표시할 문구",
            },
          },
          required: ["type", "name"],
          additionalProperties: false,
        },
      },
    },
    required: ["activities"],
    additionalProperties: false,
  }),
  execute: async (args, { platformClient: client }) => {
    if (!client?.user) {
      return { error: "Discord 클라이언트를 찾을 수 없습니다." };
    }
    if (
      !args ||
      Object.keys(args).some((key) => key !== "activities") ||
      !Array.isArray(args.activities) ||
      args.activities.some(
        (activity) =>
          !activity ||
          Object.keys(activity).some(
            (key) => !["name", "type"].includes(key),
          ) ||
          typeof activity.name !== "string" ||
          !activity.name.trim() ||
          typeof activity.type !== "string" ||
          !Object.hasOwn(activityTypes, activity.type),
      )
    ) {
      return { error: "활동에는 유효한 type과 name을 지정하세요." };
    }
    const activities = args.activities.map(({ type, name }) => ({
      type: activityTypes[type],
      name: type === "CUSTOM" ? "Custom Status" : name,
      ...(type === "CUSTOM" ? { state: name } : {}),
    }));
    client.user.setPresence({ activities });
    return { success: true, activities: args.activities };
  },
};
