# AiMate 컨텍스트 구성 최종안

2026-10-30 · 코드 재점검 및 구현 반영

이 문서는 컨텍스트 표시와 참여자 조회의 결정 기록이다. 현재 동작의 상세 계약은 [컨텍스트와 프롬프트](../AI/컨텍스트와%20프롬프트.md), [Discord](../플랫폼/Discord.md#참여자-조회), [생성과 전송 및 재생성](../대화/생성과%20전송%20및%20재생성.md)을 우선한다.

## 기준

봇이 실제 관측 가능한 범위에서 대화와 현재 상태를 제공한다. Discord 사용자 화면과 봇 API의 정보 범위가 같다고 가정하지 않는다. 관찰 기록과 현재 프로필 정보는 구분하며 누락한 상태를 추정하지 않는다.

## 컨텍스트 순서

sequence.js가 전체 순서를 결정한다. 기본 배치는 다음과 같다.

1. 시스템 지시와 캐릭터·행동 규칙
2. 마지막 봇 SENT까지의 history 관찰 목록
3. response: 응답 지시·현재 시각·참여자·관찰 표시 규칙을 합친 하나의 user 메시지
4. 이후 pending 관찰 목록 전체

summary·fact·episode 주입은 미구현이다. pending에는 여러 발언·수정·삭제가 함께 들어갈 수 있으며 실제 처리 대상은 ConversationState cursor로 별도 결정한다. 마지막 user 하나로 축약하지 않는다.

## 표시 규칙

| 항목 | 구현 |
| --- | --- |
| 시각의 의미 | Event.observedAt. 원래 플랫폼 발송 시각과 구분 |
| 시간대 | 채팅은 캐릭터 config.json의 필수 timezone 사용 |
| 시간 헤더 | 첫 user 관찰·작성자 변경·5분 이상 간격·날짜 변경에 `[HH:MM]` |
| 관찰 그룹 | 수정·삭제·과거 조회와 그 다음 발언은 별도 그룹 |
| 날짜 구분 | 지역 날짜가 달라진 첫 user 관찰 앞에 절대 날짜를 부착. assistant는 다음 user로 미룸 |
| 표시 범위 | history slice를 적용한 뒤 실제 선택된 관찰부터 계산 |
| 서버 이름 | 현재 서버 닉네임 → 글로벌 이름 → username |
| DM/서버 없는 CLI | 헤더 이름 생략 |
| 관찰 사건의 작성자 | 모델 role과 별개로 보존. `대상 작성자:`로 표시 |
| assistant | 날짜·시간·이름 헤더 생략. reply/react용 고정 `#N`은 유지 |
| 멘션 | 저장 원문 유지. 모델에 표시할 때 같은 이름 맵으로 치환 |

5분은 앱의 표시 정책이다. Discord 화면의 병합 간격을 검증한 값이 아니다. 시각이 없으면 추정하지 않는다. 번호는 이미 구현된 불변 참조이며 파서에서 일괄 삭제하지 않는다.

## 참여자와 이름 해석

참여자는 실제 전달한 관찰의 작성자 중 자신을 제외한 계정이다. 멘션 대상은 이름 변환에만 보완하고 발언하지 않았다면 참여자 블록에 넣지 않는다.

- 5명 이하: 이름·username·공개 서버 태그·관측 가능한 상태·활동
- 6명 이상: 이름·username·공개 서버 태그. 상태는 도구로 조회
- DM: 이름 대신 ‘상대’. 길드 프레즌스를 추정하지 않음

이름·태그·활동은 한 줄과 길이 제한을 적용하고 헤더 위조 문자를 제거한다. 상태·활동은 외부 데이터이며 지시로 취급하지 않고 대화와 관련 있을 때만 언급하도록 안내한다. 동명이인은 `하늘 (@sky)`로 구분한다.

한 요청의 컨텍스트·멘션·도구는 ParticipantResolver를 공유한다. 도구 인자는 username을 우선하고 표시 이름도 허용한다. 해석 순서는 username 정확 일치 → 표시 이름/구분 이름 정확 일치 → 유일한 부분 일치다. 모호하면 후보를 반환하고 임의로 고르지 않는다. snowflake는 모델의 사용자 인자나 결과에 노출하지 않는다.

## 플랫폼 경계와 조회 도구

DiscordParticipantSource를 ParticipantService에 주입해 순수 프로필 데이터만 공통 계층에 전달한다. 컨텍스트 조립은 캐시만 읽으며 Event snapshot의 username·글로벌 이름으로 보완한다. ServerMember 테이블은 추가하지 않는다. 상태·닉네임은 현재 캐시에서 알 수 있는 값이며 수신 때 저장한 값을 현재 상태로 단정하지 않는다.

`list_members`는 최대 50명을 반환하고 온라인을 우선한다. 캐시와 한 번의 제한된 REST 페이지/접두 검색을 사용한다. 전체 서버 조회는 하지 않으며 항상 부분 결과(`complete: false`)로 설명한다. `get_member_status`는 선택된 멤버 정보를 다시 확인한 뒤 현재 캐시의 프레즌스를 읽는다. 두 도구 모두 ViewChannel을 확인하고 비공개 스레드 가입·관리 권한도 반영한다. CLI에는 노출하지 않는다.

상태 누락은 unknown이다. offline과 invisible은 구분하지 못한다. 개인정보 설정이나 캐시 누락으로 활동을 얻지 못할 수 있다. GuildPresences intent를 코드에 추가했으며 운영자는 Developer Portal에서도 Presence Intent를 허용해야 한다. 서버 태그는 설치된 discord.js 14.24.2의 User.primaryGuild를 사용하고 identityEnabled가 참일 때만 표시한다.

현재 시각·상태를 response에 두어도 닉네임이나 동명이인 구성이 바뀌면 history 표시가 달라질 수 있다. prompt cache 적중을 보장하지 않는다.

## 실패 처리와 기존 지적 정정

- 생성 실패는 FAILED와 로그·GenerationFailed 구독으로만 보고한다. 오류 안내를 캐릭터 발언으로 전송·저장하지 않는다. 기존 부분 출력은 유지하며 완료 cursor는 전진하지 않는다.
- 실패 입력 보존은 기존 cursor 계약으로 이미 구현되어 있었다. 새 변경은 오류 안내가 대화 문맥을 오염시키지 않게 하는 것이다.
- 시간 유틸은 이미 Intl.DateTimeFormat과 실제 오프셋을 사용했다. config/default.yaml과 app.timezone을 읽으며 이미지의 별도 시간대 우선순위는 유지한다.
- reply/react와 channelMessageNo는 이미 구현되어 있어 보존했다.
- 도구 실행 채널은 ChatFlow가 ChannelRepository.findById로 읽으며 server 관계를 포함한다.

## 검증과 한계

구현: `src/chat/context/ObservationFormatter.js`, `ParticipantService.js`, `ParticipantResolver.js`, `SequenceBuilder.js`, `src/messages/HistoryService.js`, `src/repositories/EventRepository.js`, `src/platforms/discord/DiscordParticipantSource.js`, `src/tools/definitions/listMembers.js`, `getMemberStatus.js`, `src/chat/ChatGenerationFailureHandler.js`.

테스트: `test/chat/context/ContextAssembly.test.js`, `Participants.test.js`, `test/platforms/discord/participants.test.js`, `test/messages/HistoryService.test.js`, `test/integration/ChatPipeline.integration.test.js`.

실제 모델이 헤더를 모방하는 빈도·활동을 언급하는 빈도와 실제 Discord 연결 품질은 별도 운영 검증 대상이다. 자동 테스트는 관찰 역할·순서·번호·원문 보존, 시간대·자정·그룹 경계, 이름 충돌, 권한 필터, 부분 조회, 실패 입력 복구를 검증한다.
