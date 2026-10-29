import { jsonSchema } from "ai";

const statuses = ["online", "idle", "dnd", "invisible", "offline"];

/** @type {import('../ToolRegistry.js').ToolDef} */
export default {
  name: "set_discord_status",
  platforms: ["discord"],
  description: "Discord 접속 상태를 변경한다. 변경을 남용하지 않는다.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      status: { type: "string", enum: statuses },
    },
    required: ["status"],
    additionalProperties: false,
  }),
  execute: async (args, { platformClient: client }) => {
    if (!client?.user) {
      return { error: "Discord 클라이언트를 찾을 수 없습니다." };
    }
    if (
      !args ||
      Object.keys(args).some((key) => key !== "status") ||
      !statuses.includes(args.status)
    ) {
      return { error: "유효한 status를 지정하세요." };
    }
    client.user.setStatus(args.status);
    return { success: true, status: args.status };
  },
};
