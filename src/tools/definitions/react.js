import { jsonSchema } from "ai";

export default {
  name: "react",
  platforms: ["discord"],
  description:
    "현재 채널의 #번호 메시지에 이모지 리액션을 추가한다. targetMessageNo는 컨텍스트에 표시된 고정 참조 번호이며 발송 순서나 읽은 횟수가 아니다. emoji는 유니코드 이모지 또는 Discord 커스텀 이모지다. 번호를 예측하거나 채널 밖의 번호를 사용하지 않는다. 성공한 리액션만으로 응답을 마칠 수 있다.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      targetMessageNo: { type: "integer", minimum: 1 },
      emoji: { type: "string", minLength: 1, maxLength: 100 },
    },
    required: ["targetMessageNo", "emoji"],
    additionalProperties: false,
  }),
  execute: (input, context) =>
    context.messageActionService.react(input, context),
};
