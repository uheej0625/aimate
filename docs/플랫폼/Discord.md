# Discord

Discord 어댑터는 Discord.js Message를 순수 메시지 데이터로, TextBasedChannel을 ChannelPort로 변환한다. 공통 대화 파이프라인의 정책과 Discord API 동작을 나누는 경계다.

## 이벤트와 활성화

client는 Guilds·GuildMessages·MessageContent·GuildMembers·DirectMessages intent와 Channel·Message partial을 사용한다. Developer Portal에서도 필요한 privileged intent를 허용하고 채널 읽기·전송·명령 및 필요한 삭제 권한을 준비한다. 권한 실패는 API 오류로 드러난다.

messageCreate·messageUpdate·messageDelete·messageDeleteBulk를 CREATE·UPDATE·DELETE 계약으로 전달한다. 부분 메시지 fetch는 loadMessage로 지연한다. 삭제는 ID 목록을 사용한다.

`/활성화`는 현재 채널을 등록하고 선택한 global/server/channel scope를 저장한다. **현재 수신 조건은 해당 Channel record의 존재**다. scope에 따라 서버 전체로 활성화를 확장하는 로직이나 멘션·DM·features 설정별 응답 필터는 현재 MessageHandler에 없다. 등록되지 않은 DM도 자동 활성화되지 않는다.

## 명령

| 종류 | 표시 이름 | 동작 |
| --- | --- | --- |
| 슬래시 | `활성화` | 현재 채널 등록 |
| 메시지 메뉴 | `이 메세지만 삭제` | 플랫폼 삭제 성공 후 공통 삭제 정책 반영 |
| 메시지 메뉴 | `이 이후 메세지 삭제` | 대상 포함 후속 메시지 삭제, 확인된 ID만 반영 |
| 메시지 메뉴 | `생성 정보 확인` | 연결된 Generation 상태·입력·출력 확인 |
| 메시지 메뉴 | `재생성` | 원래 생성의 봇 출력 정리 후 새 생성 |

삭제 명령은 플랫폼 bulk/개별 삭제 결과를 확인한 후 StoredMessageService로 전달한다. 플랫폼 이벤트가 중복 도착해도 공통 삭제 경로에서 중복 경험과 응답을 막는다. 삭제 권한이 없는 메시지는 DB에서 성공한 것처럼 처리하지 않는다.

`npm run deploy`는 commands 디렉터리를 읽고 토큰으로 application ID를 조회해 명령 목록을 등록한다. `DISCORD_GUILD_ID`로 길드/전역 등록을 선택한다. 본문 prefix 명령 처리 기능은 현재 구현되어 있지 않다.

## 로더에서 실제 핸들러까지

loadEvents는 events 디렉터리 모듈을 불러오고 once 여부에 따라 client.once 또는 client.on으로 등록한다. 이벤트 실행 오류는 로더 wrapper에서 로그로 수집한다. 주입 context에는 client와 공통 진입점이 포함된다.

loadCommands는 data와 execute가 있는 모듈을 client.commands에 등록한다. interactionCreate는 slash 또는 message context menu만 처리하고 commandName으로 command를 찾는다. 실제 실행에는 createDiscordApplication에서 주입한 유스케이스를 사용한다.

명령 표시 이름을 바꾸면 로컬 모듈뿐 아니라 Discord 등록 목록도 갱신해야 한다. 로컬 로딩과 외부 deploy는 서로 다른 작업이다.

## 삭제 명령의 실제 경계

‘이 메세지만 삭제’는 먼저 targetMessage.delete를 기다린다. 실패하면 DB 삭제 서비스를 호출하지 않는다. 성공하면 ChannelPort와 botId를 붙여 공통 DELETE 경로로 보낸다.

Discord 삭제 이벤트가 명령의 DB 반영보다 먼저 처리되면 명령이 반환받는 삭제 개수는 0일 수 있다. 이 값만으로 플랫폼 삭제가 실패했다고 판단할 수 없다. 메시지 삭제의 외부 결과와 DB에서 새로 변경한 개수를 나누어 읽는다.

‘이 이후 메세지 삭제’는 대상 메시지를 포함해 후속 메시지를 수집하고 bulk 또는 개별 삭제를 시도한다. 오래된 메시지·부분 실패는 개별 결과로 집계한다. 공통 서비스에는 확인된 ID만 넘기므로 재시도나 권한 실패를 추가할 때 이 경계를 유지한다.

## 근거와 검증

구현: `src/platforms/discord/client.js`, `src/platforms/discord/adapter.js`, `src/platforms/discord/events/`, `src/platforms/discord/commands/`, `src/platforms/discord/deploy.js`.

테스트: `test/platforms/discord/adapter.test.js`, `test/platforms/discord/deletionCommands.test.js`, `test/platforms/discord/createDiscordApplication.test.js`.

[홈](../홈.md) · [플랫폼 독립 계약](../구조/플랫폼%20독립%20계약.md) · [생성과 전송 및 재생성](../대화/생성과%20전송%20및%20재생성.md)
