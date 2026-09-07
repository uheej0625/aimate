# Conversation 도메인 및 AI 경계 후처리 구현 계획 재검토

| 항목 | 내용 |
| --- | --- |
| 검토일 | 2026-09-07 |
| 검토 대상 | [`conversation-episode-development-report.md`](./conversation-episode-development-report.md) |
| 코드 기준 | `2effff0` |
| 결론 | 방향은 타당하지만, 구현 전에 스냅샷 정합성·기존 데이터 경계·강제 확정 범위를 먼저 명세해야 한다. |

## 1. 검토 요약

우선 해결해야 할 항목은 다음 세 가지다.

1. Review 중 새 CHAT이 시작되어도 고정된 ReviewTurn의 Message–Generation 구성이 변하지 않아야 한다.
2. 기능 도입 전에 저장된 Message와 Generation이 첫 Review에 자동으로 유입되지 않아야 한다.
3. 오래된 Pending을 강제 확정할 때 그 뒤에 붙은 신규 Turn까지 함께 강제 확정하지 않아야 한다.

확정 Conversation의 원본 삭제 정책, claim lease, Turn 정렬 및 Conversation 시간 산정은 구현 전에 함께 명확히 하는 것이 좋다.

## 2. 구현 전 필수 보완

### 2.1 Review 스냅샷의 Message–Generation 정합성

#### 판정

유효한 문제다. 다만 모든 신규 메시지가 문제를 일으키는 것은 아니다. 이미 봇 답변까지 저장된 정상 CHAT Turn은 새 CHAT의 입력으로 다시 선택되지 않는다.

문제는 다음과 같이 아직 답변되지 않은 사용자 입력이 Review 스냅샷에 포함될 때 발생한다.

- 봇 답변이 없는 `FAILED` 또는 `CANCELLED` CHAT
- Generation에 연결되지 않은 사용자 Message
- 위 항목을 포함하는 Pending tail

#### 현재 코드와 충돌하는 지점

현재 채팅 준비 과정은 마지막 봇 Message 이후의 모든 Message를 `pendingMessages`로 선택하고, 해당 Message ID 전체를 새 CHAT 입력으로 전달한다.

- [`HistoryService.js`](../src/messages/HistoryService.js#L28)
- [`HistoryService.js`](../src/messages/HistoryService.js#L88)

이후 `recordInputWithMessages`는 선택된 Message들의 `generationId`를 새 Generation ID로 갱신한다.

- [`GenerationRepository.js`](../src/repositories/GenerationRepository.js#L78)

다음 실행 순서가 가능하다.

```text
1. U1이 답변되지 않은 상태로 6시간 경과
2. Review가 U1 또는 U1의 기존 CHAT을 스냅샷으로 고정
3. Review 실행 중 U2 도착
4. 새 CHAT이 U1 + U2를 입력으로 사용하고 두 Message의 generationId를 갱신
5. 기존 Review가 U1만 Conversation으로 확정
6. 새 CHAT Generation은 이미 확정된 U1과 미확정 U2에 걸쳐 있게 됨
```

원문은 Review 중 새 입력이 생겨도 기존 결과를 저장하고 ReviewWindow만 유지하도록 한다. 하지만 이 경우 스냅샷에 기록된 Message–Generation 구성이 저장 시점에는 달라질 수 있다.

#### 권장 수정

첫 버전에서는 다음 방식이 가장 단순하다.

1. 스냅샷에 각 ReviewTurn의 Message ID와 Generation ID를 저장한다.
2. 결과 저장 직전에 Message–Generation 연결이 스냅샷과 같은지 다시 확인한다.
3. 스냅샷에 포함된 Message가 다른 Generation으로 이동했거나 삭제·확정되었다면 Review 결과 전체를 폐기한다.
4. 진행 중인 CHAT이 종료된 뒤 새 스냅샷으로 다시 Review한다.

`lastUserMessageAt > snapshotCutoffAt`이라는 사실만으로 기존 결과를 폐기할 필요는 없다. 신규 Message가 기존 스냅샷의 구성에 영향을 주지 않았다면 원문 정책대로 기존 결과를 저장하고 ReviewWindow만 유지할 수 있다.

새 입력이 들어와도 기존 Review 결과를 반드시 보존해야 한다면, Review 대상 Message를 별도로 claim하거나 Generation–Message 관계를 불변 이력으로 저장하는 모델이 필요하다.

#### 필요한 테스트

- 답변 없는 U1을 Review하는 동안 U2가 들어오면 기존 Review 결과를 저장하지 않는다.
- 새 CHAT이 U1+U2를 입력으로 묶은 뒤 생성한 새 스냅샷에는 두 Message가 한 ReviewTurn으로 나타난다.
- 정상 완료된 과거 CHAT은 신규 CHAT 때문에 스냅샷이 무효화되지 않는다.

### 2.2 기존 데이터 자동 유입 방지 기준

#### 판정

런타임 버그가 확정된 것은 아니지만, 구현에 필요한 기준이 문서에 없다.

원문은 과거 Message와 Generation의 Conversation 자동 역산을 범위에서 제외한다. 그러나 Review 후보는 Conversation에 아직 속하지 않은 ReviewTurn으로만 정의한다. Migration으로 `conversationId`를 추가하면 기존 레코드도 모두 `null`이므로, 별도의 하한이 없으면 첫 Review에 포함될 수 있다.

#### 권장 수정

ReviewWindow에 명시적인 시작점을 저장한다.

```prisma
model ConversationReviewWindow {
  // 첫 Review 대상 사용자 Message의 ID
  firstEligibleMessageId Int
}
```

첫 사용자 Message와 ReviewWindow를 같은 트랜잭션에서 만들 때 해당 Message ID를 기록하고, ReviewTurn 조회는 이 ID 이상인 사용자 Message에서 시작한다.

`ReviewWindow.createdAt`을 하한으로 사용하는 방식은 권장하지 않는다. Message와 Window의 생성 순서, timestamp 정밀도, 동률 처리에 따라 첫 Message가 빠질 수 있다.

#### 필요한 테스트

- Migration 전에 존재하던 Message와 Generation은 신규 ReviewWindow의 입력에 포함되지 않는다.
- ReviewWindow를 만든 첫 사용자 Message는 반드시 포함된다.
- Pending 재검토에서는 최초 시작점부터가 아니라 아직 확정되지 않은 Turn만 포함된다.

### 2.3 `mustFinalize` 적용 범위

#### 판정

문서 내부 정책이 충돌한다.

경계 정책은 Pending 이후 새 입력이 없을 때 24시간 뒤 강제 확정한다고 정의한다. 반면 Pending 처리 절차는 `pendingSinceAt`을 유지한 채 신규 입력을 함께 Review하고, `pendingMaxAge`가 지나면 전체 입력에서 Pending 반환을 금지한다.

따라서 오래된 Pending 뒤에 방금 추가된 신규 Turn이 있으면 신규 Turn도 강제 확정된다.

#### 권장 수정

전체 입력에 적용되는 `mustFinalize` boolean 대신 강제 확정 범위를 전달한다.

```json
{
  "mustFinalizeThroughTurnIndex": 4
}
```

검증 규칙은 다음과 같이 바꾼다.

- `pendingFromTurnIndex`가 있으면 `mustFinalizeThroughTurnIndex`보다 커야 한다.
- 오래된 Pending에 해당하는 Turn은 모두 확정되어야 한다.
- 그 뒤에 추가된 신규 suffix는 Pending으로 남길 수 있다.
- 신규 Turn이 없다면 강제 확정 인덱스가 마지막 Turn이므로 결과적으로 Pending을 반환할 수 없다.

#### 필요한 테스트

- 24시간 된 Pending만 있으면 전체가 확정된다.
- 24시간 된 Pending 뒤에 신규 Turn이 있으면 기존 Pending은 확정하고 신규 suffix는 Pending으로 둘 수 있다.
- 강제 확정 범위 안에서 Pending을 시작하면 응답을 거부한다.

## 3. 구현 전에 정할 후속 정책

### 3.1 확정 Conversation 소속 Message의 삭제와 재생성

#### 판정

중간 우선순위의 정책 누락이다.

현재 재생성 흐름은 대상 Generation의 Message를 조회한 뒤 저장소에서 삭제한다.

- [`RerollConversation.js`](../src/application/RerollConversation.js#L21)
- [`RerollConversation.js`](../src/application/RerollConversation.js#L38)

Conversation이 확정된 뒤 Message를 삭제하면 `Conversation.messages`는 달라지지만 기존 Summary와 Memory는 그대로 남는다. 원문의 “확정 결과를 변경하지 않는다”가 Review 재분할만 금지하는지, 원본 Message 구성까지 불변으로 본다는 의미인지 명확하지 않다.

다음 중 하나를 선택해야 한다.

- 확정된 Message의 물리 삭제와 재생성을 금지한다.
- Message는 soft delete하고 Conversation의 원본 관계는 유지한다.
- Conversation에 확정 당시의 입력 스냅샷을 별도로 보존하며, Summary와 Memory는 그 스냅샷의 결과임을 명시한다.

첫 버전에서 기존 삭제 기능을 유지해야 한다면 세 번째 방식이 가장 충돌이 적다.

### 3.2 claim 만료와 복구

#### 판정

문서는 만료된 claim을 복구한다고 규정하지만 만료 조건을 정의하지 않는다.

최소한 다음 중 하나가 필요하다.

- `reviewClaimExpiresAt` 필드
- `reviewClaimedAt + reviewClaimLeaseTimeout` 규칙

다중 worker를 허용한다면 Review가 오래 걸리는 동안 lease를 갱신하는 heartbeat도 정의해야 한다. 단일 worker만 지원한다면 그 제한과 시작 시 복구 규칙을 명시할 수 있다.

### 3.3 ReviewTurn 정렬과 Conversation 시간

#### 판정

AI가 경계를 판단하기 위해 작성자나 시간 정보를 반드시 받아야 하는 것은 아니다. Memory 저장 대상은 확정 후 실제 Message의 작성자를 조회해 판단할 수 있고, 시간 간격 자체를 Conversation 경계로 사용하지 않는 정책도 명확하다.

다만 저장 결과의 재현성을 위해 다음은 필요하다.

- Generation 기반 Turn과 독립 Message Turn의 전체 정렬 기준
- timestamp가 같을 때의 동률 해소 기준
- `Conversation.startedAt`과 `endedAt`의 산정 기준

권장 기준은 다음과 같다.

```text
ReviewTurn 정렬
  1. Turn에 포함된 첫 사용자 Message의 createdAt 오름차순
  2. createdAt이 같으면 첫 사용자 Message의 id 오름차순

Conversation 시간
  startedAt = 첫 ReviewTurn의 첫 사용자 Message.createdAt
  endedAt   = 마지막 ReviewTurn에 포함된 마지막 실제 Message.createdAt
```

작성자와 Message timestamp를 AI 입력에 제공할지는 경계 품질을 평가한 뒤 결정해도 된다.

## 4. 이전 검토에서 보정한 내용

- “Review 중 새 메시지가 오면 항상 스냅샷이 깨진다”는 표현은 과했다. 답변되지 않은 Message가 새 CHAT 입력으로 다시 묶일 때 문제가 발생한다.
- 기존 데이터가 반드시 자동 처리된다고 단정할 수는 없다. 정확한 지적은 자동 유입을 막는 하한이 명세되지 않았다는 것이다.
- 확정 후 Message 삭제는 Conversation 재분할과 동일한 문제는 아니다. 다만 Summary·Memory의 원본 일관성 정책이 필요하다.
- 작성자와 시간이 AI 입력에 반드시 필요하다는 주장은 철회한다. 결정적 정렬과 `startedAt`·`endedAt` 산정 규칙만 필수다.

## 5. 권장 반영 순서

1. Review 중 새 입력 또는 Message–Generation 연결 변경 시 기존 결과를 폐기하는 규칙을 추가한다.
2. `firstEligibleMessageId` 등 기존 데이터와 신규 Review 대상의 경계를 추가한다.
3. `mustFinalize`를 범위 기반 강제 확정으로 변경한다.
4. 확정 Message의 삭제·재생성 정책을 선택한다.
5. claim lease와 복구 조건을 수치로 정의한다.
6. ReviewTurn 정렬 및 Conversation 시간 산정 규칙을 정의한다.
7. 위 경쟁 조건과 migration 경계를 테스트 목록에 추가한다.

이 항목들이 반영되면 Prisma 모델과 worker 구현을 시작할 수 있는 수준의 명세가 된다.
