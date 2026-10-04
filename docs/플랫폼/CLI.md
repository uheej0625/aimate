# CLI

`npm run cli`는 영속 채널을 가진 터미널 UI를 연다. 플랫폼 client만 모의 객체이며 저장·컨텍스트·도구·AI 생성은 같은 container를 사용한다.

## 채널과 화면

ChannelCatalog가 CLI 채널과 활성 Message를 읽는다. 기본 조회는 채널마다 최근 100개이며 모델 컨텍스트의 범위와 다르다. 채널이 없으면 UUID로 새 채널을 만든다.

startRepl은 플랫폼 UUID별 모의 ChannelPort를 재사용하고 타이핑·전송 이벤트를 TUI에 반영한다. 사용자의 입력은 화면에 먼저 추가한 뒤 공통 MessageHandler로 전달한다. 새 채널과 기존 기록은 DB에 유지하지만 버퍼·주시 상태는 프로세스 메모리에만 있다.

| 키 | 동작 |
| --- | --- |
| `Ctrl+N` | 새 채팅 |
| `Tab`, 방향키 | 패널 이동과 채널 선택 |
| `Enter` | 전송 |
| `Shift+Enter` 또는 `Alt+Enter` | 줄바꿈. 터미널 키 전송 방식에 따라 지원이 다를 수 있음 |
| `PgUp/PgDn`, `Ctrl+U/Ctrl+D` | 대화 스크롤 |
| `Ctrl+Q` 또는 `Ctrl+C` | 종료 신호 전달 |

인터랙티브 CLI에서는 Pino 로그를 silent로 설정해 화면을 보호한다. 모의 채널 send는 content만 화면에 표시하므로 생성 이미지의 files 첨부는 렌더링하지 않는다. Discord 전용 presence·status 도구는 노출되지 않는다.

## UI와 애플리케이션의 경계

| 구성 요소 | 책임 |
| --- | --- |
| ChatTui | 입력 문자열·커서·focus·스크롤·현재 채널과 busy 화면 상태 |
| startRepl | new-channel·send·quit UI 이벤트를 애플리케이션 호출에 연결 |
| ChannelCatalog | 플랫폼 채널 목록과 화면용 메시지 데이터 조회 |
| createMockChannel | 타이핑·전송을 UI callback으로 연결하고 정규화 메시지 반환 |
| CLI adapter | UI 입력의 임시 메시지를 공통 MessageEvent로 변환 |

ChatTui.start는 raw 입력과 키 이벤트, resize 처리, 터미널 대체 화면을 설정한다. close는 이를 해제하고 커서를 복원한다. 화면 lifecycle 변경 시 종료 키뿐 아니라 중복 close도 안전한지 확인한다.

addMessage는 화면 목록과 개수를 갱신하고 첫 사용자 본문으로 제목을 만든다. UI 제목은 DB의 별도 Channel.title 필드가 아니다. 채널을 재조회할 때도 기록에서 제목을 계산한다.

## 화면 상태가 DB 상태와 다를 수 있는 경우

send 이벤트에서 사용자 메시지는 DB 성공 전에 화면에 추가한다. 저장에 실패하면 오류 notice를 표시하지만 이미 추가한 화면 메시지를 자동 제거하지 않는다. 따라서 화면에 있다는 이유만으로 Message가 저장되었다고 판단하지 않는다.

봇 onSend도 플랫폼 전송을 표시하는 callback이며 그 뒤 MessageSender가 DB에 기록한다. 화면·저장·Generation 완료는 분리된 단계다. 새 UI 기능을 만들 때 복구 정책이 필요하면 어느 단계의 성공을 기준으로 하는지 명시한다.

ChannelCatalog.list의 최근 메시지 제한은 UI 재로딩 범위다. 화면에 없는 이전 기록도 Event 기반 모델 컨텍스트에는 포함될 수 있다.

## 수정 지점과 검증 근거

`npm run chat:review`는 TUI 없이 같은 CLI 어댑터와 공통 파이프라인을 사용하는 개발용 실행기다. `HeadlessChat`은 `generation.settled`까지 기다려 전체 답장과 실패 안내를 수집하고, `readChatTurn`으로 저장된 턴을 복구한다. 전용 DB·세 사용자·도구 대체·중단 후 재개는 [Codex 대화 품질 점검](../개발/Codex%20대화%20품질%20점검.md)을 참조한다.

입출력 계약은 adapter, 화면·키 동작은 tui, 채널 연동은 repl과 ChannelCatalog에서 변경한다. 화면 변경이 모델 입력 정책을 바꾸지 않도록 한다.

구현: `src/platforms/cli/index.js`, `src/platforms/cli/repl.js`, `src/platforms/cli/tui.js`, `src/platforms/cli/mocks.js`, `src/application/ChannelCatalog.js`.

테스트: `test/platforms/cli/tui.test.js`, `test/platforms/cli/adapter.test.js`, `test/application/useCases.test.js`.

[홈](../홈.md) · [대화 세션과 버퍼](../대화/대화%20세션과%20버퍼.md) · [도구와 이미지](../AI/도구와%20이미지.md)
