# Codex 대화 품질 점검

`npm run chat:review`는 로그인된 Codex CLI를 대화 상대와 평가자로 사용해 AiMate와 세 대화를 계속 이어가는 개발용 실행기다. 정해진 질문을 반복 재생하지 않고 AiMate의 답변을 읽어 다음 말을 정한다. 현재 코드와 프롬프트를 평가하며 자동 수정하지 않는다.

## 실행과 종료

```powershell
npm run chat:review
npm run chat:review -- --resume <run-id>
npm run chat:review -- --turns 2
```

`<run-id>`는 시작 화면에 표시된 실행 ID다. 기본 실행에는 턴 수와 시간 제한이 없다. `Ctrl+C` 또는 `SIGTERM`으로 중지한다. `--turns`는 대화별 총 턴 수를 제한하는 실제 검증 옵션이며, 2이면 세 대화를 각각 2턴 진행하고 마지막 답변까지 평가한다. 재개 시 이미 해당 턴 수에 도달한 대화는 추가 전송하지 않는다.

설치된 `codex` 명령이 필요하다. `codex login status`가 ChatGPT 로그인을 표시해야 한다. 모델은 CLI 사용자 기본 설정을 그대로 사용한다. 실행기가 별도 API 키로 전환하거나 다른 모델을 자동 선택하지 않는다. AiMate의 채팅 모델과 실제 검색 비용은 Codex 사용량과 별도로 발생한다.

Codex 한도·인증·모델 설정 오류와 잘못된 평가 결과는 자동 재시도하지 않는다. Codex 호출이나 AiMate 한 턴이 5분 안에 완료되지 않으면 중지한다. 중지 이유는 `state.json`과 보고서에 남긴다. 실행 잠금은 같은 실행 ID의 동시 재개를 막고, 종료된 프로세스가 남긴 잠금은 재개 시 해제한다.

잔여 사용량을 읽어 정확히 0에서 멈추는 기능은 없다. 실제 사용량 한도 오류가 종료 기준이다. 계정이 추가 크레딧으로 계속 실행하도록 설정되어 있으면 포함 사용량 소진 직후에 중지한다고 보장하지 않는다. 사용량은 [공식 안내](https://learn.chatgpt.com/docs/pricing)의 대시보드와 `/status`에서 확인한다.

## 세 대화와 실제 파이프라인

| 대화 출발점 | 사용자 |
| --- | --- |
| 일상과 친밀감 | 지우 |
| 고민과 감정 변화 | 민서 |
| 관심사와 함께하는 활동 | 도윤 |

각 대화는 별도 CLI 사용자·채널·Codex 기억 요약을 갖는다. 실행마다 `.local/chat-review/<run-id>/review.db`를 초기화한다. 실제 CLI 대화 DB와 Discord 연결을 사용하지 않는다. 화면 없는 `HeadlessChat`이 기존 CLI 어댑터를 통해 MessageHandler에 입력을 전달한다. 컨텍스트 조립, 도구 선택, 생성, 메시지 분할과 저장은 공통 대화 파이프라인을 따른다. 생성의 처리·전송·저장이 끝난 `generation.settled` 이벤트까지 기다리므로 여러 답장이나 실패 안내를 한 턴으로 수집한다.

Codex는 첫 발언부터 직접 작성하며, 세 채널을 순서대로 진행한다. 다음 호출에는 해당 대화의 기억 요약, 최근 40턴, 최근 발견 사항 20개를 전달한다. 대화 종료 대신 주제와 감정에 반응하며 계속 이어가도록 지시한다. 평가 결과는 AiMate의 사용자 발언이나 시스템 프롬프트에 넣지 않는다.

Codex 호출은 `codex exec --ephemeral --sandbox read-only --json --output-schema ...`를 사용한다. 셸·앱·플러그인·브라우저·이미지 생성·하위 에이전트·MCP 도구를 끄고 대화 데이터로만 판단하도록 한다. [공식 비대화형 실행 문서](https://learn.chatgpt.com/docs/non-interactive-mode)를 참고한다.

## 평가와 도구

자연스러움, 캐릭터 일관성, 맥락, 공감, 반복과 질문 과다, 메시지 분할, 도구 사용, 오류 이후 대화 대응을 평가한다. 응답 원문의 출력 계약 문제는 별도 항목이다. 구조 검사와 Codex의 주관적 판단을 함께 기록하며 자동 평가를 실제 사용자 평가로 단정하지 않는다.

CLI에서 활성화되는 도구와 설정된 native 검색은 실제 실행한다. Discord 전용 상태·presence 도구는 노출되지 않는다. 도구의 정상 작동 여부는 시험 대상이 아니며, 필요한 상황에서 자연스럽게 호출하고 결과를 대화에 연결하는지 평가한다.

이미지 도구는 실제 인자·참조 처리, 템플릿 조립, IMAGE Generation 저장과 첨부 해석을 수행한다. `PlaceholderImageGenerator`가 이미지 모델 대신 고정 1×1 PNG를 반환하므로 이미지 AI 호출은 없다. 실제 이미지 도구와 같은 `content/image/` 경로에 무작위 이름으로 저장하며, 이어지는 이미지 참조도 이 파일을 사용한다. 이미지 자체의 품질은 평가하지 않는다. 대체 생성기를 주입한 container는 이미지 provider 인증을 검증하지 않으며 채팅 provider 설정은 정상 검증한다.

평가 반환 계약은 `nextMessage`, `memorySummary`, `findings`다. findings에는 category, severity, 근거 turns, description, suggestion이 필요하다. 다음 발언은 최대 4000자, 기억 요약은 6000자, 발견 사항은 호출당 10개로 제한하고 실제 존재하는 턴 번호만 허용한다.

## 기록과 재개

| 파일 | 의미 |
| --- | --- |
| `events.jsonl` | 시작·평가·전송 준비·확인된 전송·응답·종료의 전체 기록. 복구의 기준 |
| `state.json` | 최근 대화와 기억, 진행 중 입력, 평가 진행 상태의 복구용 스냅샷 |
| `report.md` | 진행 분량, 항목·심각도별 발견 건수, 개선 우선순위와 대표 인용 최대 100개 |
| `review.db` | 실제 공통 파이프라인을 사용한 전용 SQLite DB |
| `review-schema.json` | Codex 출력 형식 |

JSONL을 먼저 쓰고 동기화한 뒤 상태와 보고서를 임시 파일 교체로 갱신한다. 재개 시 JSONL을 읽어 스냅샷을 다시 만든다. 마지막 쓰기가 중간에 끊긴 경우 그 꼬리만 복구하며 중간 기록이 손상되어 있으면 실패한다. 전체 원문·발견 사항은 JSONL에 남고 모델에 전달하는 최근 대화와 보고서 대표 근거는 제한한다. 발견 건수는 관찰 횟수이며 동일 원인의 독립 버그 개수를 의미하지 않는다.

재개는 저장된 입력의 플랫폼 메시지 ID로 DB를 먼저 조회한다. 완료된 응답은 수집만 하고 사용자 메시지를 재전송하지 않는다. 입력만 저장되었거나 부분 응답 뒤 중단된 턴도 재전송하지 않고 중단 상태로 기록한다. 입력이 DB에 전혀 저장되지 않았다면 준비해 둔 동일 입력을 전송한다. 평가까지 저장된 다음 발언도 재사용한다. Codex 한도로 마지막 응답을 평가하지 못해도 대화는 보존되며 보고서의 응답 턴과 평가 완료 턴으로 구분한다.

재개 시 현재 AiMate 설정을 다시 읽으며 재개 이벤트에 실행 조건을 기록한다. 설정을 바꾸면 하나의 실행에 서로 다른 조건이 포함될 수 있으므로 변경 전후 이벤트를 확인한다.

보고서와 JSONL에는 provider 요청·헤더·시스템 프롬프트를 넣지 않고 필요한 메시지·도구·사용량 필드만 추출한다. 알려진 인증 값도 가린다. 전용 DB는 기존 생성 저장 계약을 그대로 사용하므로 비공개 프롬프트와 API 메타데이터가 포함될 수 있다. 결과 폴더와 생성 이미지는 Git 제외 경로에 보관하고 DB를 위키에 복사하지 않는다.

## 구현과 검증 근거

실행: `scripts/reviewChat.js`, `src/review/ReviewRunner.js`, `src/review/ReviewStore.js`, `src/review/CodexReviewer.js`.

대화·이미지 연결: `src/platforms/cli/headless.js`, `src/application/ReadChatTurn.js`, `src/core/container.js`, `src/review/PlaceholderImageGenerator.js`.

테스트: `test/review/ReviewRunner.test.js`, `test/review/CodexReviewer.test.js`, `test/integration/ChatReview.integration.test.js`.

테스트는 세 대화의 격리, 전체 응답 수집, 평가 미전달, 중복 없는 재개, 대체 이미지 저장·첨부, 한도·인증·반환 형식 오류, 타임아웃과 수동 종료를 검증한다. 실제 호출 성공 여부는 설치된 Codex CLI·계정·AiMate provider 설정에 달려 있다.

[홈](../홈.md) · [CLI](../플랫폼/CLI.md) · [테스트와 프롬프트 비교](테스트와%20프롬프트%20비교.md)
