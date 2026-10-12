# Humanize

Humanize는 타이핑 표시와 전송 전 지연으로 사람이 입력하는 듯한 속도를 만든다. `TypingPacer`는 지연 계산을 담당하는 클래스로 유지하고, `MessageSender`가 플랫폼의 타이핑 표시와 실제 대기를 수행한다.

[메시지 분할](메시지%20분할.md)은 Discord의 전송 길이 제한을 맞추는 별도 책임이다. `humanize.enabled`를 꺼도 분할·취소 확인·전송·저장은 수행한다.

## 처리 순서

1. `MessageSender.send`가 모델 말풍선 하나를 길이 제한에 맞춰 분할한다.
2. 각 조각의 이미지 태그를 첨부로 해석한다.
3. `humanize.enabled`가 false가 아니면 `channel.sendTyping()`을 호출한다.
4. 이미지 태그를 제거한 `cleanText`와 최신 지연 설정으로 `TypingPacer.calculate`를 호출하고, 반환한 시간만큼 기다린다.
5. 현재 turn과 Generation 상태를 확인한 뒤 전송하고 확인된 결과를 저장한다.

`humanize.enabled: false`이면 타이핑 표시·지연 계산·대기를 모두 생략한다. 첫 조각과 후속 조각은 같은 계산식을 사용한다. 이미지 첨부만 있는 조각도 활성 상태에서는 최소 지연을 적용한다.

## 설정

```json
"humanize": {
  "enabled": true,
  "typingDelayMin": 1000,
  "typingDelayMax": 2000,
  "typingDelayPerChar": 60
}
```

| 설정 | 동작 |
| --- | --- |
| `humanize.enabled` | 기본 true. false이면 타이핑 표시와 전송 지연 생략 |
| `humanize.typingDelayMin` | 최소 지연. 기본 1000ms |
| `humanize.typingDelayMax` | 최대 지연. 기본 2000ms |
| `humanize.typingDelayPerChar` | UTF-16 단위당 지연. 기본 60ms |

`TypingPacer.calculate(text, { min, max, perChar })`는 `Math.min(max, Math.max(min, text.length * perChar))`를 계산한다. 설정 읽기와 실제 대기는 MessageSender의 책임이다. 활성 여부와 지연 설정은 조각마다 읽으므로 ConfigManager의 핫 리로드가 이후 조각부터 반영된다.

## 적용 범위와 취소

Humanize는 MessageSender를 사용하는 최종 messages와 오류 안내에 적용한다. reply/react 도구는 별도 전송 경로를 사용한다.

대기 중 취소되면 실제 전송 전 검사에서 중단한다. 인간화를 꺼도 같은 현재 turn·Generation 상태 검사를 수행한다. 전송 요청이 이미 시작됐다면 확인된 결과를 저장하고 다음 조각을 중단한다. 취소와 저장의 상세 계약은 [생성과 전송 및 재생성](생성과%20전송%20및%20재생성.md)을 참고한다.

## 근거와 검증

구현: `src/humanize/TypingPacer.js`, `src/messages/MessageSender.js`, `config/default.json`.

테스트: `test/humanize/TypingPacer.test.js`, `test/messages/MessageSender.test.js`, `test/integration/ChatPipeline.integration.test.js`. 계산식·태그 제거 후 지연 계산·설정 변경·비활성 상태의 타이핑과 타이머 생략·분할 전송·취소를 검증한다.

[홈](../홈.md) · [메시지 분할](메시지%20분할.md) · [모델과 설정](../AI/모델과%20설정.md)
