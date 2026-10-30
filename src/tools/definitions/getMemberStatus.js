import { jsonSchema } from "ai";

export default {
  name: "get_member_status",
  platforms: ["discord"],
  description:
    "현재 채널 멤버의 관측 가능한 접속 상태·활동을 조회한다. user는 username 우선, 표시 이름도 허용한다. 모호하면 후보를 반환한다. unknown은 오프라인을 뜻하지 않으며 상태는 대화와 관련 있을 때만 언급한다.",
  inputSchema: jsonSchema({
    type: "object",
    properties: { user: { type: "string", minLength: 1, maxLength: 160 } },
    required: ["user"],
    additionalProperties: false,
  }),
  execute: (input, context) =>
    context.participantService.getStatus(input, context),
};
