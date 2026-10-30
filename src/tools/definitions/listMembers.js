import { jsonSchema } from "ai";

export default {
  name: "list_members",
  platforms: ["discord"],
  description:
    "현재 채널을 볼 수 있는 멤버를 최대 50명 조회한다. 온라인을 우선하며 전체 목록은 보장하지 않는다. query로 username/표시 이름을 검색할 수 있다. 결과의 username으로 get_member_status를 호출한다.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      query: { type: "string", maxLength: 80 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  }),
  execute: (input, context) =>
    context.participantService.listMembers(input, context),
};
