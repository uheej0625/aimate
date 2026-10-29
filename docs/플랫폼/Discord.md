# Discord

Discord 어댑터는 Discord.js Message를 순수 메시지 데이터로, TextBasedChannel을 ChannelPort로 변환한다. 공통 대화 파이프라인의 정책과 Discord API 동작을 나누는 경계다.

## 이벤트와 활성화

client는 Guilds·GuildMessages·MessageContent·GuildMembers·DirectMessages intent와 Channel·Message partial을 사용한다. Developer Portal에서도 필요한 privileged intent를 허용하고 채널 읽기·전송·명령 및 필요한 삭제 권한을 준비한다. 권한 실패는 API 오류로 드러난다.

messageCreate·messageUpdate·messageDelete·messageDeleteBulk를 CREATE·UPDATE·DELETE 계약으로 전달한다. 부분 메시지 fetch는 loadMessage로 지연한다. 삭제는 ID 목록을 사용한다.

`/활성화`는 현재 채널을 등록하고 선택한 global/server/channel scope를 저장한다. **현재 수신 조건은 해당 Channel record가 존재하고 logEnabled가 false인 것**이다. 로그 채널의 생성·수정·삭제 이벤트는 MessageHandler에서 본문 조회·저장·응답 예약 전에 건너뛴다. scope에 따라 서버 전체로 활성화를 확장하는 로직이나 멘션·DM·features 설정별 응답 필터는 현재 MessageHandler에 없다. 등록되지 않은 DM도 자동 활성화되지 않는다.

## 봇 프레즌스

시작 시 온라인·활동 없음으로 접속하며 ready 이벤트는 프레즌스를 덮어쓰지 않는다. AI는 두 Discord 전용 도구를 사용한다.

- `set_discord_status`: `status`를 `online`, `idle`, `dnd`, `invisible`, `offline` 중 하나로 변경한다. 활동은 유지한다.
- `set_discord_activity`: `activities` 목록 전체를 교체한다. 각 항목은 `type`과 `name`을 지정하며 빈 배열로 모두 지운다. 접속 상태는 유지한다.

활동 유형은 `PLAYING`, `LISTENING`, `WATCHING`, `CUSTOM`, `COMPETING`이다. 스트리밍과 URL은 지원하지 않는다. CUSTOM 외의 name에는 자연어 설명이나 약칭 대신 실제 게임의 정식 전체 이름을 쓰도록 안내한다. CUSTOM의 name에는 표시할 문구를 넣으며 도구가 Discord의 `name: "Custom Status"`, `state: "표시할 문구"`로 변환한다. 두 도구 모두 변경을 남용하지 않도록 안내하며 특히 CUSTOM은 꼭 필요할 때만 사용한다. 게임명 선택과 사용 빈도는 모델 지침이며 코드의 게임명 검증이나 호출 횟수 제한은 아니다.

예를 들어 `{"activities":[{"type":"PLAYING","name":"Stardew Valley"}]}`는 게임 활동을 표시하고, `{"activities":[]}`는 활동을 지운다. 잘못된 상태·활동 유형·미지원 필드는 전송 전에 오류로 반환한다. SDK 실행 오류는 ToolRegistry에서 모델용 error로 변환한다.

상태는 모든 서버에서 공유하며 저장하지 않고 재시작 시 초기화한다. 도구 성공은 Gateway 갱신 요청을 전송했다는 의미다.

## 명령

| 종류 | 표시 이름 | 동작 |
| --- | --- | --- |
| 슬래시 | `활성화` | 현재 채널 등록 |
| 슬래시 | `로그 채널` | 서버 관리자가 생성 로그 수신을 채널별 활성화/비활성화 |
| 메시지 메뉴 | `이 메세지만 삭제` | 플랫폼 삭제 성공 후 공통 삭제 정책 반영 |
| 메시지 메뉴 | `이 이후 메세지 삭제` | 대상 포함 후속 메시지 삭제, 확인된 ID만 반영 |
| 메시지 메뉴 | `생성 정보 확인` | 연결된 Generation 상태·입력·출력 확인 |
| 메시지 메뉴 | `재생성` | 원래 생성의 봇 출력 정리 후 새 생성 |

삭제 명령은 플랫폼 bulk/개별 삭제 결과를 확인한 후 StoredMessageService로 전달한다. 플랫폼 이벤트가 중복 도착해도 공통 삭제 경로에서 중복 경험과 응답을 막는다. 삭제 권한이 없는 메시지는 DB에서 성공한 것처럼 처리하지 않는다.

`npm run deploy`는 commands 디렉터리를 읽고 토큰으로 application ID를 조회해 명령 목록을 등록한다. `DISCORD_GUILD_ID`로 길드/전역 등록을 선택한다. 본문 prefix 명령 처리 기능은 현재 구현되어 있지 않다.

`/로그 채널 상태:활성화`는 현재 채널로 이 서버의 생성 로그를 받는다. 선택 항목 `대상`으로 수신 채널을 지정한다. 수신 설정은 Channel.logEnabled에 저장해 재시작 후에도 유지한다. 첫 메시지부터 대기 카드에 원문을 누적하고 생성·응답 완료까지 같은 카드를 수정한다. 설정·권한·저장·장애 처리 계약은 [로그](../운영/로그.md)를 참고한다.

## 로더에서 실제 핸들러까지

loadEvents는 events 디렉터리 모듈을 불러오고 once 여부에 따라 client.once 또는 client.on으로 등록한다. 이벤트 실행 오류는 로더 wrapper에서 로그로 수집한다. 주입 context에는 client와 공통 진입점이 포함된다.

loadCommands는 data와 execute가 있는 모듈을 client.commands에 등록한다. interactionCreate는 slash 또는 message context menu만 처리하고 commandName으로 command를 찾는다. 실제 실행에는 createDiscordApplication에서 주입한 유스케이스를 사용한다.

명령 표시 이름을 바꾸면 로컬 모듈뿐 아니라 Discord 등록 목록도 갱신해야 한다. 로컬 로딩과 외부 deploy는 서로 다른 작업이다.

## 삭제 명령의 실제 경계

‘이 메세지만 삭제’는 먼저 targetMessage.delete를 기다린다. 실패하면 DB 삭제 서비스를 호출하지 않는다. 성공하면 ChannelPort와 botId를 붙여 공통 DELETE 경로로 보낸다.

Discord 삭제 이벤트가 명령의 DB 반영보다 먼저 처리되면 명령이 반환받는 삭제 개수는 0일 수 있다. 이 값만으로 플랫폼 삭제가 실패했다고 판단할 수 없다. 메시지 삭제의 외부 결과와 DB에서 새로 변경한 개수를 나누어 읽는다.

‘이 이후 메세지 삭제’는 대상 메시지를 포함해 후속 메시지를 수집하고 bulk 또는 개별 삭제를 시도한다. 오래된 메시지·부분 실패는 개별 결과로 집계한다. 공통 서비스에는 확인된 ID만 넘기므로 재시도나 권한 실패를 추가할 때 이 경계를 유지한다.

## 근거와 검증

구현: `src/platforms/discord/client.js`, `src/platforms/discord/adapter.js`, `src/platforms/discord/events/`, `src/platforms/discord/commands/`, `src/platforms/discord/deploy.js`, `src/tools/definitions/setDiscordStatus.js`, `src/tools/definitions/setDiscordActivity.js`.

테스트: `test/platforms/discord/adapter.test.js`, `test/platforms/discord/deletionCommands.test.js`, `test/platforms/discord/createDiscordApplication.test.js`, `test/platforms/discord/presence.test.js`(기본 활동 없음·ready 덮어쓰기 방지), `test/tools/discordPresence.test.js`(실제 discord.js Gateway 패킷·상태/활동 독립 변경·5가지 활동·삭제·스트리밍 거부·등록/플랫폼 필터).

[홈](../홈.md) · [플랫폼 독립 계약](../구조/플랫폼%20독립%20계약.md) · [생성과 전송 및 재생성](../대화/생성과%20전송%20및%20재생성.md)
