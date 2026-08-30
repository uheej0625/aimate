# Conversation 도메인 및 AI 경계 후처리 구현 계획

| 항목   | 내용                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------- |
| 작성일 | 2026-08-27                                                                                                |
| 상태   | 정책 확정 및 구현 계획                                                                                    |
| 목적   | 일정 시간 모은 대화를 AI가 의미 단위 `Conversation`으로 나누고, 확정된 구간별 Summary와 Memory를 생성한다. |

## 1. 목표

현재는 CHAT `Generation`이 완료될 때마다 Memory를 추출한다. 짧은 대화가 여러 Generation으로 나뉘면 같은 사실을 반복해서 검사하고, 전체 흐름을 보지 못한 상태에서 기억을 판단하게 된다.

단순 유휴 시간만으로 `Conversation` 경계를 확정하는 방식도 사용하지 않는다. 사용자가 봇의 질문에 늦게 답하거나 비동기적으로 대화하면, 기계적인 시간 경계와 의미상 대화 경계가 쉽게 어긋나기 때문이다.

이를 다음과 같이 바꾼다.

```text
사용자 메시지 수신
  → Message 저장
  → Channel의 열린 ReviewWindow 생성 또는 활동 시각 갱신
  → 평소처럼 CHAT Generation 실행
  → 입출력 Message와 Generation은 아직 Conversation에 확정하지 않음

ConversationReviewWorker 주기 실행
  → 마지막 사용자 메시지 이후 6시간이 지난 ReviewWindow 선점
  → 아직 Conversation에 속하지 않은 ReviewTurn을 스냅샷으로 고정
  → 전체 스냅샷으로 CONVERSATION_REVIEW Generation 실행
  → AI가 확정 Conversation 여러 개와 최대 하나의 Pending tail 반환
  → 확정 구간별 Summary와 Memory 저장
  → Pending tail은 다음 Review 입력으로 유지
```

`6시간`은 AI Review를 시작하기 위한 운영상 유휴 기준이다. 이 값 자체가 Conversation 경계를 결정하지 않는다. `Conversation`은 AI가 Review 결과로 확정한 의미상 대화 구간이다.

## 2. 용어와 책임

| 이름                                   | 의미                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `Channel`                              | Discord나 CLI 등 플랫폼상의 대화 장소                                   |
| `ConversationReviewWindow`             | 미확정 대화를 모으고 Review 시점·claim·Pending 상태를 관리하는 운영 단위 |
| `ReviewTurn`                           | AI가 경계를 나눌 수 있는 최소 입력 단위                                 |
| `Conversation`                         | AI가 의미상 하나의 대화로 확정한 구간                                   |
| `Generation(type=CHAT)`                | 한 번의 채팅 AI 실행과 그 입출력 기록                                   |
| `Generation(type=CONVERSATION_REVIEW)` | 한 번의 경계 판정·요약·Memory 추출 실행 기록                            |
| `Pending tail`                         | 아직 끝나지 않았다고 판단해 확정하지 않은 연속된 마지막 ReviewTurn 구간  |
| `Memory`                               | 확정 Conversation에서 추출한 사용자 기억                               |
| `Summary`                              | 확정 Conversation의 압축 표현                                           |

관계는 다음과 같다.

```text
Channel
├─ ConversationReviewWindow
│  └─ Generation(type=CONVERSATION_REVIEW)[]
├─ Conversation[]
│  ├─ Message[]
│  ├─ Generation(type=CHAT)[]
│  ├─ Memory[]
│  └─ reviewGeneration
└─ 아직 Conversation에 속하지 않은 ReviewTurn[]
   └─ 다음 Review의 Pending 또는 신규 입력
```

`ConversationReviewWindow`와 `Conversation`은 서로 대체할 수 없다.

- `ConversationReviewWindow`: 언제 Review할지와 누가 처리 중인지 관리한다.
- `Conversation`: Review가 확정한 의미상 결과를 보존한다.

## 3. 경계 정책

첫 버전의 Conversation 경계 정책은 다음과 같이 고정한다.

1. 마지막 사용자 메시지 이후 6시간이 지나면 Review 후보가 된다.
2. 실행 중인 CHAT Generation이 있으면 Review를 시작하지 않는다.
3. AI는 입력을 0개 이상의 확정 Conversation과 최대 하나의 Pending tail로 나눈다.
4. Pending은 반드시 입력의 연속된 마지막 구간이어야 한다.
5. 확정된 Conversation은 이후 Review에서 다시 나누거나 합치지 않는다.
6. Pending 상태에서 새 대화가 들어오면 기존 Pending과 신규 ReviewTurn을 함께 Review한다.
7. Pending 이후 새 입력이 없으면 24시간 뒤 `mustFinalize` Review를 실행한다.
8. `mustFinalize` Review에서는 Pending을 반환할 수 없다.
9. 이미 확정된 Conversation에 대한 늦은 응답도 확정 결과를 다시 열지 않는다. 이후 Review에서 별도 Conversation으로 확정될 수 있다.

예를 들어 Review 후보가 Generation #3부터 #10까지라면 다음 결과가 가능하다.

```text
Generation #3 ~ #6  → Conversation #1 확정
Generation #7 ~ #8  → Conversation #2 확정
Generation #9 ~ #10 → Pending tail
```

다음에 Generation #11부터 #13이 추가되면, 이미 확정된 #3부터 #8은 제외하고 #9부터 #13만 다시 Review한다.

의미상 미완료 여부를 애플리케이션 규칙으로 추론하지 않는다. 봇의 마지막 문장이 질문인지, CHAT이 실패했는지 같은 정보는 AI 입력에 제공하되 Pending 여부는 Review 출력으로 결정한다.

## 4. 범위

이번 구현에 포함한다.

- 사용자 메시지가 들어오면 Channel의 열린 `ConversationReviewWindow`를 생성하거나 갱신한다.
- 6시간 유휴 후 미확정 ReviewTurn 스냅샷을 만든다.
- ReviewTurn을 AI가 여러 Conversation과 하나의 Pending tail로 나누게 한다.
- 확정 Conversation별 Summary와 Memory 후보를 한 번의 Review에서 생성한다.
- AI 출력의 경계, 누락, 중복, Pending 위치를 애플리케이션에서 검증한다.
- 확정된 Message와 CHAT Generation에 `conversationId`를 설정한다.
- 실패하거나 취소된 CHAT의 사용자 Message도 Review 입력에 포함한다.
- Generation에 연결되지 못한 사용자 Message도 독립 ReviewTurn으로 포함한다.
- 후처리 AI 호출을 `CONVERSATION_REVIEW` Generation으로 기록한다.
- 실패한 Review는 같은 스냅샷을 다시 만들 수 있도록 claim을 해제한다.
- worker 정상 종료 시 실행 중 Review를 취소하고 재시도 가능한 상태로 되돌린다.

이번 구현에 포함하지 않는다.

- 확정 Conversation의 재분할·병합·재개방
- 여러 Review 결과의 비교와 현재 버전 선택
- 사람의 Review 승인·반려
- 과거 Message와 Generation의 Conversation 자동 역산
- 여러 사용자가 섞인 Conversation의 사용자별 Memory 추출
- Conversation Summary의 채팅 프롬프트 삽입과 검색
- 날짜 기준 Daily Digest 생성

## 5. ReviewTurn 구성

Review 경계는 실제 DB ID를 AI가 직접 조합하게 하지 않고, 애플리케이션이 만든 순번 기반 `ReviewTurn` 사이에서만 나눈다.

```json
{
  "turnIndex": 0,
  "generationId": 3,
  "generationStatus": "COMPLETED",
  "userMessages": [
    { "messageId": 21, "content": "사용자 입력" }
  ],
  "assistantMessages": [
    { "messageId": 22, "content": "봇 출력" }
  ]
}
```

ReviewTurn 구성 규칙은 다음과 같다.

- 한 CHAT Generation과 현재 그 Generation에 연결된 실제 Message를 하나의 ReviewTurn으로 묶는다.
- debounce로 여러 사용자 Message가 한 CHAT Generation에 들어갔다면 같은 ReviewTurn에 둔다.
- 하나의 ReviewTurn을 두 Conversation으로 나누지 않는다.
- CHAT이 `FAILED` 또는 `CANCELLED`여도 실제 사용자 Message가 있으면 포함한다.
- Generation에 연결되지 않은 사용자 Message는 `generationId: null`인 독립 ReviewTurn으로 포함한다.
- 실제로 저장된 Message를 기준으로 구성하며, 취소된 Generation의 오래된 `input` 스냅샷 때문에 같은 사용자 Message를 중복 포함하지 않는다.
- 사용자 입력 없이 실행된 cron이나 retry CHAT은 기본적으로 제외한다. 특정 사용자 대화의 일부로 처리해야 하면 호출자가 명시적인 출처를 기록한다.
- IMAGE, VOICE, EMBEDDING, CONVERSATION_REVIEW Generation은 첫 버전의 경계 입력에서 제외한다.

ReviewTurn은 첫 버전에는 별도 DB 모델로 만들지 않는다. Review 시작 시 Message와 CHAT Generation에서 구성한 스냅샷을 Review Generation의 `input`에 저장한다.

## 6. 데이터 모델

핵심 모델은 다음과 같다. 관계 이름과 migration 세부 사항은 Prisma 검증 단계에서 확정한다.

```prisma
model Channel {
  id String @id @default(cuid())

  // 기존 필드

  conversationReviewWindows ConversationReviewWindow[]
  conversations             Conversation[]
}

model ConversationReviewWindow {
  id String @id @default(cuid())

  channelId String
  channel   Channel @relation(fields: [channelId], references: [id])

  lastUserMessageAt DateTime
  nextReviewAt       DateTime
  pendingSinceAt     DateTime?

  activeKey        String?   @default("ACTIVE")
  reviewClaimedAt  DateTime?
  reviewClaimToken String?
  closedAt         DateTime?

  reviewGenerations Generation[] @relation("ReviewWindowGenerations")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([nextReviewAt, reviewClaimedAt])
  @@unique([channelId, activeKey])
}

model Conversation {
  id String @id @default(cuid())

  channelId String
  channel   Channel @relation(fields: [channelId], references: [id])

  messages        Message[]
  chatGenerations Generation[] @relation("ConversationChatGenerations")
  memories        Memory[]

  reviewGenerationId Int
  reviewGeneration   Generation @relation(
    "ProducedConversations",
    fields: [reviewGenerationId],
    references: [id]
  )

  summary   String
  startedAt DateTime
  endedAt   DateTime

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Generation {
  id Int @id @default(autoincrement())

  // 기존 필드

  conversationId String?
  conversation   Conversation? @relation(
    "ConversationChatGenerations",
    fields: [conversationId],
    references: [id]
  )

  reviewWindowId String?
  reviewWindow   ConversationReviewWindow? @relation(
    "ReviewWindowGenerations",
    fields: [reviewWindowId],
    references: [id]
  )

  producedConversations Conversation[] @relation("ProducedConversations")

  messages Message[]
}

model Message {
  id Int @id @default(autoincrement())

  // 기존 필드

  conversationId String?
  conversation   Conversation? @relation(
    fields: [conversationId],
    references: [id]
  )
}

model Memory {
  id Int @id @default(autoincrement())

  // 기존 필드

  conversationId String?
  conversation   Conversation? @relation(
    fields: [conversationId],
    references: [id]
  )

  @@unique([userId, content])
}
```

`Generation.conversationId`는 CHAT Generation이 어느 확정 Conversation에 속하는지를 나타낸다. `CONVERSATION_REVIEW` Generation 하나는 여러 Conversation을 만들 수 있으므로 이 관계를 사용하지 않고 `Conversation.reviewGenerationId`로 산출 관계를 기록한다.

`Message.conversationId`와 CHAT `Generation.conversationId`는 Review 확정 전까지 `null`이다. 사용자 메시지는 Generation 생성 전에 저장되고 Generation이 실패할 수 있으므로 Message의 Conversation 소속을 Generation 관계만으로 추론하지 않는다.

`activeKey`는 열린 ReviewWindow일 때 `"ACTIVE"`, 완전히 처리되어 닫힐 때 `null`이다. SQLite는 복합 UNIQUE 제약에서 `null` 중복을 허용하므로 Channel마다 열린 ReviewWindow가 하나만 존재하도록 한다.

`reviewClaimToken`은 오래된 worker 결과가 새 claim 상태를 덮어쓰는 것을 막는다. Review 결과 저장 트랜잭션은 읽었던 token과 현재 token이 같은지 확인한다.

## 7. ReviewWindow 활동과 Review 시점

기본 설정은 다음과 같다.

```json
{
  "conversation": {
    "reviewIdleTimeout": 21600000,
    "pendingMaxAge": 86400000,
    "reviewPollInterval": 60000,
    "shutdownGraceTimeout": 10000
  }
}
```

사람의 메시지를 저장하는 트랜잭션에서 다음 작업을 함께 처리한다.

1. Message를 저장한다.
2. 같은 Channel의 열린 ReviewWindow를 조회하거나 생성한다.
3. `lastUserMessageAt`을 Message 시각으로 갱신한다.
4. `nextReviewAt`을 `lastUserMessageAt + reviewIdleTimeout`으로 갱신한다.

Message 저장과 ReviewWindow 활동 갱신 사이에 부분 성공이 없어야 한다. 동시 생성이 고유 제약에 걸리면 트랜잭션을 다시 실행해 이미 생성된 ReviewWindow를 갱신한다.

worker는 다음 조건을 모두 만족할 때 ReviewWindow를 claim할 수 있다.

1. `closedAt == null && activeKey == "ACTIVE"`다.
2. `nextReviewAt <= now`다.
3. `reviewClaimedAt == null`이다.
4. 해당 Channel에 `PROCESSING` 또는 `GENERATED` 상태의 사용자 입력 CHAT Generation이 없다.
5. Conversation에 아직 속하지 않은 ReviewTurn이 하나 이상 있다.

claim에 성공한 worker는 현재 시점까지의 미확정 ReviewTurn ID와 내용을 고정해 Review Generation의 `input`에 저장한다. 스냅샷의 마지막 활동 시각은 `snapshotCutoffAt`으로 metadata에 기록한다. 이후 도착한 Message와 Generation은 이 스냅샷에 추가하지 않는다.

## 8. AI 경계 출력과 검증

Review 출력은 경계 판정, Summary, Memory 후보를 함께 반환한다.

```json
{
  "conversations": [
    {
      "endTurnIndex": 3,
      "summary": "첫 번째 대화의 간결한 요약",
      "memoryCandidates": [
        {
          "content": "사용자에 대한 지속성 있는 사실",
          "category": "fact",
          "importance": 3
        }
      ]
    },
    {
      "endTurnIndex": 5,
      "summary": "두 번째 대화의 간결한 요약",
      "memoryCandidates": []
    }
  ],
  "pendingFromTurnIndex": 6
}
```

Generation #3부터 #10이 `turnIndex` 0부터 7에 대응한다면 위 출력은 다음과 같다.

```text
turnIndex 0 ~ 3 → Generation #3 ~ #6 → Conversation #1
turnIndex 4 ~ 5 → Generation #7 ~ #8 → Conversation #2
turnIndex 6 ~ 7 → Generation #9 ~ #10 → Pending tail
```

애플리케이션은 AI 응답을 저장하기 전에 다음 조건을 모두 검증한다.

- `endTurnIndex`는 입력 범위 안에서 엄격히 증가한다.
- 각 Conversation은 하나 이상의 ReviewTurn을 가진다.
- 첫 번째 ReviewTurn부터 마지막 확정 경계까지 누락과 중복이 없다.
- `pendingFromTurnIndex`가 있으면 마지막 확정 경계 바로 다음 위치다.
- Pending은 하나의 연속된 suffix이며 중간 Pending은 허용하지 않는다.
- Pending이 없으면 마지막 Conversation이 마지막 ReviewTurn까지 포함한다.
- `mustFinalize` 입력이면 `pendingFromTurnIndex`는 `null`이어야 한다.
- 확정 Conversation의 Summary는 비어 있지 않다.
- `memoryCandidates`와 각 필드가 정해진 스키마를 만족한다.

정상 응답이지만 확정할 Conversation이 없으면 `conversations`는 빈 배열이고 `pendingFromTurnIndex`는 `0`일 수 있다. 기억할 내용이 없는 확정 Conversation의 `memoryCandidates`는 빈 배열이다.

## 9. Pending 처리

Review 결과에 Pending tail이 있으면 다음과 같이 처리한다.

1. Pending 앞의 Conversation만 확정한다.
2. Pending ReviewTurn의 Message와 Generation은 `conversationId == null`로 유지한다.
3. ReviewWindow의 `pendingSinceAt`이 없다면 현재 시각을 기록한다.
4. `nextReviewAt`을 기본적으로 `pendingSinceAt + pendingMaxAge`로 설정한다.
5. 그 전에 새 사용자 메시지가 들어오면 `nextReviewAt`을 새 메시지 시각부터 6시간 뒤로 갱신한다.
6. 다음 Review에는 기존 Pending과 그 이후의 신규 ReviewTurn을 함께 넣는다.

Review 실행 중 `lastUserMessageAt > snapshotCutoffAt`인 새 입력이 생겼다면 결과 저장 트랜잭션은 새 입력이 계산한 `nextReviewAt`을 Pending 기본값으로 덮어쓰지 않는다.

`pendingMaxAge`가 지나 실행하는 Review에는 `mustFinalize: true`를 전달한다. AI가 이때도 Pending을 반환하면 스키마 위반으로 처리하고 저장하지 않는다.

Review 결과가 모든 스냅샷을 확정했더라도 Review 실행 중 새 Message가 도착했으면 ReviewWindow를 닫지 않는다. 새 Message가 없고 미확정 ReviewTurn도 남지 않았을 때만 `closedAt`을 기록하고 `activeKey`를 `null`로 만든다.

이 정책은 지연 응답을 가능한 한 기존 Pending과 함께 볼 수 있게 하지만, 확정된 Conversation을 무기한 다시 여는 것은 허용하지 않는다. 24시간 강제 확정 이후 도착한 응답은 다음 Conversation의 입력이 된다.

## 10. 후처리 Generation

후처리 AI 호출도 기존 `Generation`에 기록한다.

```text
Generation.type
- CHAT
- IMAGE
- VOICE
- EMBEDDING
- CONVERSATION_REVIEW
```

`Generation`은 결과물이 아니라 결과를 만든 실행 기록이다. 저장 책임은 다음과 같이 구분한다.

| 데이터                        | 저장 위치                                          |
| ----------------------------- | -------------------------------------------------- |
| Review 실행 상태              | `Generation.status`                                |
| ReviewWindow와 claim 출처      | `Generation.reviewWindowId`, `Generation.metadata` |
| 사용한 프롬프트               | `Generation.prompt`                                |
| ReviewTurn 입력 스냅샷        | `Generation.input`                                 |
| API 원본 요청·응답            | `Generation.apiRequest`, `Generation.apiResponse`  |
| 모델이 반환한 원본 구조       | `Generation.output`                                |
| 확정 Conversation의 산출 관계 | `Conversation.reviewGenerationId`                  |
| 확정된 Summary                | `Conversation.summary`                             |
| 확정된 Memory                 | `Memory`                                           |

AI 호출은 DB 트랜잭션 밖에서 실행한다. Review Generation의 입력은 실행 전에 완전히 저장하며, 재시도는 새 `CONVERSATION_REVIEW` Generation으로 기록한다.

## 11. 저장, 동시성, 재시도

Review 응답을 검증한 뒤 하나의 트랜잭션에서 다음 작업을 처리한다.

1. ReviewWindow가 열려 있고 `reviewClaimToken`이 현재 worker의 token과 같은지 확인한다.
2. 입력 스냅샷의 ReviewTurn이 아직 다른 Conversation에 확정되지 않았는지 확인한다.
3. 확정 구간별 Conversation을 생성한다.
4. 해당 Message와 CHAT Generation에 `conversationId`를 설정한다.
5. 검증된 Summary와 Memory를 저장한다.
6. Review Generation을 `COMPLETED`로 전환한다.
7. Pending과 Review 중 새 입력 존재 여부에 따라 ReviewWindow를 유지하거나 닫는다.
8. `reviewClaimedAt`과 `reviewClaimToken`을 비운다.

Conversation, Message·Generation 연결, Summary, Memory, Review 완료 상태 사이에 부분 성공이 없어야 한다. `(userId, content)` 고유 제약과 upsert로 기존 Memory와의 중복을 방지한다.

AI 호출, 응답 검증 또는 저장 트랜잭션이 실패하면 다음과 같이 처리한다.

- Review Generation을 `FAILED`로 기록한다.
- Conversation, Summary, Memory는 새로 확정하지 않는다.
- `reviewClaimedAt`과 `reviewClaimToken`을 비운다.
- 같은 ReviewWindow를 다음 polling에서 다시 시도한다.
- 프로세스 중단으로 claim이 남으면 시작 시 만료된 claim만 복구한다.
- 만료된 claim에 연결된 `PROCESSING` Review Generation은 `FAILED`로 바꾼다.

같은 ReviewWindow를 두 worker가 읽더라도 조건부 claim에 성공한 worker만 Review Generation을 만들 수 있다. 오래된 worker가 뒤늦게 응답해도 claim token 검증에 실패하므로 결과를 저장하지 못한다.

## 12. 사용자 경계

Memory는 사용자에게 귀속되므로 Conversation이 Channel에 속한다는 사실만으로 저장 대상을 정하지 않는다. 각 확정 Conversation에 포함된 사용자 Message의 작성자를 조회한다.

- 작성자가 한 명이면 그 사용자의 Memory를 저장한다.
- 작성자가 없으면 Summary만 저장한다.
- 작성자가 두 명 이상이면 Summary만 저장하고 Memory는 저장하지 않는다.

여러 사용자가 섞인 경우에는 `mixed_authors`를 Review Generation의 metadata와 로그에 남긴다. 사용자별 Memory가 필요해지면 사용자 입력과 봇 응답의 대응 관계를 별도로 정의한다.

## 13. worker 정상 종료

Conversation Review는 사용자 응답 경로가 아니며 재시도할 수 있으므로, 프로세스 종료 시 무기한 완료를 기다리지 않는다.

정상 종료 순서는 다음과 같다.

1. ConversationReviewWorker의 새 polling과 claim을 중지한다.
2. 실행 중인 Review AI 요청에 abort signal을 보낸다.
3. abort된 Review Generation을 `CANCELLED`로 기록하고 claim을 해제한다.
4. 현재 worker 작업이 정리될 때까지 `shutdownGraceTimeout`만큼 기다린다.
5. 제한 시간 안에 정리되지 않으면 로그를 남기고 종료를 계속한다.
6. 일반 CHAT을 포함한 나머지 Generation 종료 처리를 수행한다.
7. 모든 상태 저장 시도가 끝난 뒤 Prisma 연결을 종료한다.

제한 시간 초과나 강제 종료로 claim 해제가 저장되지 않을 수 있으므로, 시작 시 만료된 claim을 복구하는 절차는 항상 유지한다. 정상 종료에서 명시적으로 취소된 Review는 `CANCELLED`, 예기치 않은 중단 후 복구된 Review는 `FAILED`로 구분한다.

## 14. 기존 Conversation 용어 정리

CLI에서 Channel을 조회·생성하던 `ConversationCatalog`은 이미 `ChannelCatalog`으로 변경했다. 새 도메인 엔티티와 충돌하지 않도록 남은 느슨한 `Conversation` 용례도 별도의 기계적 리팩터링으로 정리한다.

| 현재 이름             | 변경 이름         | 실제 역할                     |
| --------------------- | ----------------- | ----------------------------- |
| `ConversationBuffer`  | `ChatDebouncer`   | 채팅 실행 debounce 타이머     |
| `ConversationRequest` | `ChatRequest`     | 한 번의 ChatFlow 요청         |
| `RerollConversation`  | `RegenerateReply` | 특정 Generation의 답변 재생성 |

기존 `conversation.*` 설정 중 채팅 실행에 관한 값은 `chat.*`으로 옮긴다.

- `bufferTimeout`
- `maxContextMessages`
- `messageBreakTag`
- `typingDelayMin`
- `typingDelayMax`
- `typingDelayPerChar`

ReviewWindow와 Conversation 후처리에 관한 설정만 `conversation.*`에 둔다.

- `reviewIdleTimeout`
- `pendingMaxAge`
- `reviewPollInterval`
- `shutdownGraceTimeout`

이름 변경과 DB 모델 도입을 같은 diff에 섞지 않는다.

## 15. 구현 위치

| 위치                                                     | 변경 내용                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                   | ReviewWindow, Conversation과 관계, Memory 고유 제약 추가                   |
| `src/repositories/ConversationReviewWindowRepository.js` | 활동 갱신, 대상 조회, claim, Pending 유지, 조건부 종료                     |
| `src/repositories/ConversationRepository.js`             | 확정 Conversation과 Message·Generation·Memory 저장 트랜잭션                |
| `src/messages/MessageHandler.js`                         | 사용자 Message 저장과 ReviewWindow 활동 갱신 연결                          |
| `src/repositories/MessageRepository.js`                  | 미확정 Message 조회와 Conversation 연결                                    |
| `src/repositories/GenerationRepository.js`               | 미확정 CHAT 조회, Review 실행 기록, Conversation 연결                      |
| `src/memory/ConversationReviewTurnBuilder.js`            | Message와 Generation을 중복 없는 ReviewTurn 스냅샷으로 구성                |
| `src/memory/ConversationReviewer.js`                     | AI 경계·Summary·Memory 출력 생성과 스키마 검증                             |
| `src/memory/ConversationReviewWorker.js`                 | ReviewWindow claim, Review 실행, Pending과 재시도 조정                      |
| `src/memory/registerMemoryPolicy.js`                     | Generation 완료 즉시 Memory를 추출하는 정책 제거                           |
| `src/core/container.js`                                  | 저장소, Reviewer, worker 의존성 연결                                       |
| `src/core/shutdown.js`                                   | worker 중지, Review abort, 제한 시간 대기 후 Prisma 종료                    |
| 플랫폼 시작 코드                                        | worker 시작과 복구 단계 연결                                               |

`CronJob` 테이블과 `CronJobWorker`는 사용하지 않는다. 예약 대화 실행과 Conversation 후처리는 실행 조건과 결과가 다르다.

## 16. 구현 순서

1. 남은 느슨한 Conversation 이름을 Channel·Chat 용어로 변경한다. (`ConversationCatalog` → `ChannelCatalog`은 완료)
2. Prisma 모델과 migration을 추가한다.
3. 사용자 Message 저장과 ReviewWindow 활동 갱신을 하나의 저장 연산으로 구현한다.
4. 미확정 Message와 CHAT Generation으로 ReviewTurn을 구성한다.
5. AI 경계 출력 스키마와 검증기를 구현한다.
6. Review Generation 기록과 worker claim·재시도를 구현한다.
7. 확정 Conversation, 연결, Summary, Memory 저장 트랜잭션을 구현한다.
8. Pending 재검토와 24시간 `mustFinalize` 정책을 구현한다.
9. 기존 Generation별 Memory 추출 정책을 제거한다.
10. worker 시작·복구·정상 종료를 애플리케이션 생명주기에 연결한다.

각 단계는 관련 테스트를 통과한 뒤 다음 단계로 진행한다. Prisma migration은 기존 Memory 중복 여부를 확인하고 정리 기준을 별도로 확정한 뒤 생성한다.

## 17. 테스트

### ReviewWindow 생성과 트리거

- 첫 사용자 Message는 열린 ReviewWindow를 만든다.
- 후속 Message는 같은 ReviewWindow의 `lastUserMessageAt`과 `nextReviewAt`을 갱신한다.
- Message 저장과 ReviewWindow 갱신은 함께 성공하거나 롤백된다.
- 6시간이 지나지 않은 ReviewWindow는 claim하지 않는다.
- 활성 CHAT Generation이 있으면 Review를 시작하지 않는다.
- 서로 다른 Channel은 ReviewWindow를 공유하지 않는다.

### ReviewTurn 구성

- CHAT Generation의 실제 사용자·봇 Message를 하나의 ReviewTurn으로 구성한다.
- debounce된 여러 사용자 Message를 같은 ReviewTurn에 둔다.
- 실패·취소 CHAT의 실제 사용자 Message를 포함한다.
- Generation에 연결되지 않은 사용자 Message를 독립 ReviewTurn으로 포함한다.
- 오래된 Generation input 때문에 같은 Message를 중복 포함하지 않는다.
- cron, IMAGE, VOICE, EMBEDDING, CONVERSATION_REVIEW Generation은 기본 입력에서 제외한다.

### AI 경계 검증

- 여러 확정 Conversation과 하나의 Pending tail을 허용한다.
- Pending이 없는 전체 확정을 허용한다.
- 전체 입력이 Pending인 결과를 허용한다.
- 누락, 중복, 역순 경계, 빈 Conversation을 거부한다.
- 중간 Pending과 둘 이상의 Pending 구간을 거부한다.
- `mustFinalize`에서 Pending을 반환하면 거부한다.
- 빈 Summary와 잘못된 Memory 후보를 거부한다.

### 확정과 Pending

- 확정 구간별 Conversation과 Summary를 저장한다.
- Message와 CHAT Generation을 같은 Conversation에 연결한다.
- Review Generation 하나가 여러 Conversation의 출처가 될 수 있다.
- Pending Message와 Generation은 `conversationId == null`로 유지한다.
- 다음 Review는 기존 Pending과 신규 ReviewTurn만 입력으로 사용한다.
- 확정된 Conversation은 다음 Review에서 변경하지 않는다.
- 24시간 뒤 `mustFinalize` Review를 실행한다.
- Review 중 새 Message가 들어오면 해당 Message를 확정하지 않고 ReviewWindow를 유지한다.

### 사용자와 Memory

- 작성자가 한 명이면 해당 사용자의 Memory를 저장한다.
- 작성자가 없으면 Summary만 저장한다.
- 작성자가 여러 명이면 Summary만 저장하고 `mixed_authors`를 기록한다.
- 빈 Memory 후보도 정상 성공으로 처리한다.
- 이미 존재하는 `(userId, content)` Memory는 중복 저장하지 않는다.

### 실패와 동시성

- LLM 호출이나 응답 검증이 실패하면 Conversation을 확정하지 않는다.
- Conversation, 연결, Summary, Memory, Review 완료는 함께 성공하거나 롤백된다.
- 같은 ReviewWindow를 두 worker가 읽어도 활성 Review는 하나만 실행한다.
- 오래된 claim token의 결과는 저장하지 않는다.
- 실패한 ReviewWindow는 다음 polling에서 다시 시도한다.
- 시작 시 만료된 claim과 PROCESSING Review를 복구한다.

### 정상 종료

- 종료가 시작되면 새 polling과 claim을 중지한다.
- 실행 중 Review에 abort signal을 전달한다.
- abort된 Review를 `CANCELLED`로 기록하고 claim을 해제한다.
- 상태 저장 뒤 Prisma 연결을 종료한다.
- 제한 시간 초과 시 종료가 무기한 멈추지 않는다.
- 정리되지 않은 claim은 다음 시작 시 복구한다.

## 18. 완료 기준

다음 조건을 모두 충족하면 구현을 완료한다.

1. 6시간 유휴 기준이 Conversation 경계가 아니라 Review 시점으로만 작동한다.
2. AI가 미확정 ReviewTurn을 여러 Conversation과 최대 하나의 Pending tail로 나눈다.
3. 경계 출력의 누락·중복·비연속·잘못된 Pending을 저장 전에 거부한다.
4. 확정된 Conversation은 이후 Review에서 변경되지 않는다.
5. Pending은 새 입력과 함께 다시 Review되고 24시간 뒤에는 강제 확정된다.
6. 실패·취소 CHAT과 Generation 없는 사용자 Message가 Review에서 누락되지 않는다.
7. Review 중 도착한 새 Message가 고정된 스냅샷에 잘못 포함되지 않는다.
8. 한 Review Generation이 만든 여러 Conversation의 출처가 보존된다.
9. 확정 Summary는 Conversation에, 확정 Memory는 사용자에게 저장된다.
10. 여러 사용자의 사실이 한 사용자의 Memory로 저장되지 않는다.
11. Conversation, Message·Generation 연결, Summary, Memory, Review 완료 사이에 부분 성공이 없다.
12. 실패, 재시작, 정상 종료 후 미완료 ReviewWindow를 다시 처리할 수 있다.
13. worker 종료가 무기한 LLM 호출 때문에 멈추지 않는다.
14. 기존 Generation별 Memory 추출 정책이 제거된다.
15. 관련 단위 테스트와 전체 테스트가 통과한다.
