import { jsonSchema } from "ai";

export default {
  name: "reply",
  platforms: ["discord"],
  description:
    "현재 채널의 #번호 메시지에 답장을 바로 전송한다. targetMessageNo는 컨텍스트에 표시된 고정 참조 번호이며 발송 순서나 읽은 횟수가 아니다. 같은 답장을 최종 messages에 다시 쓰지 않는다. 성공한 답장만으로 응답을 마칠 수 있다. 번호를 예측하거나 채널 밖의 번호를 사용하지 않는다.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      targetMessageNo: { type: "integer", minimum: 1 },
      text: { type: "string", minLength: 1, maxLength: 2000 },
    },
    required: ["targetMessageNo", "text"],
    additionalProperties: false,
  }),
  execute: (input, context) =>
    context.messageActionService.reply(input, context),
};
