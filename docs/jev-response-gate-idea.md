# JEV 응답 게이트 아이디어 스케치

| 항목 | 내용 |
| ---- | ---- |
| 작성일 | 2026-09-17 |
| 상태 | 아이디어 단계. 구현·정책 미확정 |
| 목표 | 고정 5초 버퍼를 대화 상태 기반의 응답 판단으로 개선 |

## 핵심 아이디어

현재는 사용자 메시지가 들어올 때마다 5초 타이머를 갱신하고, 조용해지면 응답 생성을 시작한다. 이를 이벤트마다 JEV가 현재 대화 상태를 평가하는 `ResponseGate`로 바꾼다.

```text
메시지 이벤트 → 저장 → JEV 판단
                         ├─ REPLY_NOW → 응답 생성
                         ├─ WAIT_MORE → 짧은 재평가 타이머
                         └─ IGNORE    → 종료
```

판단은 boolean 대신 다음 세 가지 선택지로 구성한다.

- `REPLY_NOW`: 발화가 완결됐고 지금 답장이 유용하다.
- `WAIT_MORE`: 사용자가 더 말할 가능성이 있거나 문맥이 부족하다.
- `IGNORE`: 답장이 필요 없는 이벤트다.

같은 요청에서 진행 중인 생성을 취소해야 하는지도 별도 boolean 질문으로 평가할 수 있다.

## 남겨야 하는 안전장치

- `WAIT_MORE` 뒤에 새 이벤트가 없을 수 있으므로 재평가 타이머는 유지한다.
- 채널별 판정 순번을 두고 뒤늦게 도착한 오래된 판단은 폐기한다.
- DM, 직접 멘션, cron, reroll처럼 의도가 명확한 입력은 규칙으로 즉시 또는 강제 실행한다.
- JEV의 확률과 confidence는 실제 대화 로그로 임계값을 보정한다.
- 타입이 보장되어도 판단 자체가 틀릴 수 있으므로 기존 생성 취소·상태 검증은 유지한다.

## 도입 순서

1. 기존 5초 동작을 유지하며 JEV 판단만 기록하는 shadow mode를 운영한다.
2. 확신이 높은 `REPLY_NOW`만 기존 타이머를 건너뛰게 한다.
3. 결과를 검증한 뒤 `ConversationBuffer`를 채널별 `ResponseGate`로 교체한다.

현재 프로젝트는 AI SDK 6을 사용하지만 JEV의 `evaluate` API는 AI SDK 7 이상이 필요하다. 실제 실험 전에 SDK 업그레이드 영향과 호출 비용·지연을 별도로 확인한다.

## 참고

- [TypeSafe AI: Introducing System One Models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [Vercel AI Gateway: Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation)
