# AiMate

Discord와 CLI에서 동작하는 AI 대화 봇입니다. 단순 질의응답이 아니라 **실제 친구처럼 짧은 메시지를 여러 번 주고받는 경험**을 목표로 합니다.

---

## 무슨 봇인가요?

보통 AI 챗봇은 질문 하나에 긴 답변 하나를 돌려줍니다. AiMate는 메신저에서 친구와 대화할 때처럼 짧은 메시지가 여러 번 오가는 흐름을 만듭니다. 캐릭터와 모듈식 프롬프트, 대화 히스토리, 도구 호출을 하나의 공통 파이프라인으로 처리합니다.

---

## 시작하기

### 1. 패키지 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env.example`을 복사해서 `.env`를 만들고 필요한 값을 채워줍니다.

```bash
cp .env.example .env
```

채워야 하는 주요 항목:

| 변수                           | 설명                    |
| ------------------------------ | ----------------------- |
| `DISCORD_TOKEN`                | Discord 봇 토큰         |
| `DISCORD_CLIENT_ID`            | Discord 애플리케이션 ID |
| `AI_GATEWAY_API_KEY`           | Vercel AI Gateway 키    |
| `OPENAI_API_KEY`               | OpenAI 직접 연동 키     |
| `XAI_API_KEY`                  | xAI 직접 연동 키        |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Generative AI 키 |
| `VERTEX_PROJECT_ID`            | Vertex AI 프로젝트 ID   |
| `VERTEX_LOCATION`              | Vertex AI 리전          |

AI provider는 Vercel AI SDK provider 이름을 그대로 씁니다. `config/default.json`의 `ai.chat.provider`, `ai.image.provider`에는 `gateway`, `openai`, `google`, `vertex`, `openaiCompatible`, `xai` 중 하나를 넣습니다. AI Gateway를 쓰면 `provider`를 `gateway`로 두고 `model`을 `openai/gpt-5-mini`처럼 Gateway 모델 ID로 설정합니다.

`ai.chat.prompt`와 `ai.image.prompt`에는 `content/prompts/` 아래에 존재하는 프롬프트 팩 이름을 지정해야 합니다. 프로젝트에서 사용하는 프롬프트 팩은 별도 라이선스와 개발 상태 때문에 Git에서 제외될 수 있습니다.

### 3. 데이터베이스 초기화

```bash
npm run db:init
```

Prisma가 `prisma/schema.prisma`를 읽어 로컬 SQLite 파일을 생성합니다.

### 4. 실행

| 명령어           | 설명                                 |
| ---------------- | ------------------------------------ |
| `npm run dev`    | Discord 봇 실행                      |
| `npm run cli`    | 터미널에서 직접 대화 (개발·테스트용) |
| `npm run deploy` | Discord 슬래시 커맨드 등록           |

새 기능을 만들었다면 `npm run cli`로 먼저 빠르게 확인해보세요. Discord 재시작 없이 프롬프트와 캐릭터 설정을 테스트할 수 있습니다.

CLI는 전체 화면 TUI로 실행되며 대화 채널과 히스토리가 데이터베이스에 유지됩니다. `Ctrl+N`으로 새 채팅을 만들고, `Tab`과 방향키로 채널을 전환합니다. `Enter`는 전송, `Shift+Enter` 또는 `Alt+Enter`는 줄바꿈, `PgUp`/`PgDn`은 대화 스크롤, `Ctrl+Q`는 종료입니다.

---

## 주요 기능

### 크론 스케줄링

봇이 스스로 특정 시간에 메시지를 보내거나 작업을 예약할 수 있습니다. LLM이 대화 중에 직접 `registerCron` 도구를 호출해서 일정을 잡습니다.

### 도구 (Tools)

LLM이 필요하다고 판단하면 스스로 도구를 호출합니다.

- `fetchUrl` — 웹페이지 스크래핑 및 요약
- `getTime` — 현재 시스템 시간 조회
- `setDiscordPresence` / `setDiscordStatus` — 봇의 Discord 상태 변경

### xAI 웹 검색

xAI의 서버사이드 웹 검색은 `nativeTools`를 명시해 켭니다. Gateway 모델 ID의 접두사(`xai/…`)와 직접 xAI provider는 dialect를 자동 결정합니다. 명시적 `dialect` 값은 이 자동 판단을 덮어쓰는 경우에만 사용합니다. Gateway 경로는 xAI 키 없이 Gateway 키만으로 동작합니다.

```json
{
  "provider": "gateway",
  "model": "xai/grok-4.5",
  "nativeTools": { "webSearch": true }
}
```

xAI를 직접 호출할 때는 `XAI_API_KEY`와 Responses API를 사용합니다.

```json
{
  "provider": "xai",
  "model": "grok-4.5",
  "api": "responses",
  "nativeTools": { "webSearch": true }
}
```

xAI Responses API의 서버사이드 도구는 AiMate의 일반 도구(`getTime`, `fetchUrl` 등)와 함께 사용할 수 있습니다.

### 캐릭터 설정

`content/character/` 안의 파일로 봇의 이름, 나이, 말투, 성격 등을 정의합니다. 프롬프트를 고치지 않아도 `variables.json`과 `identity.md`만 수정하면 캐릭터가 바뀝니다.

---

## 구조 요약

```txt
src/
├── ai/            # Vercel AI SDK 런타임, 모델, 채팅·이미지 생성
├── character/     # 캐릭터 컨텍스트 구성
├── chat/          # 대화 흐름, 프롬프트 조립, 응답 파싱
├── core/          # DI 컨테이너, 이벤트, 로깅, 종료 처리
├── messages/      # 메시지 저장, 히스토리, 전송
├── platforms/     # Discord / CLI 어댑터
├── repositories/  # Prisma 데이터 접근
├── scheduling/    # 예약 작업과 재시도
└── tools/         # LLM 도구 정의 및 실행

content/
├── character/     # 캐릭터 정의 (identity.md, variables.json)
└── prompts/       # 시스템 프롬프트 템플릿
```

각 플랫폼(Discord, CLI)은 들어오는 메시지를 동일한 내부 포맷으로 변환한 뒤 동일한 처리 흐름을 탑니다. 내부 메시지 포맷은 `docs/message-format.md`를 참조하세요.

---

## 기술 스택

- **Runtime**: Node.js (ES Modules)
- **Database**: Prisma + SQLite
- **AI**: Vercel AI SDK
- **Platforms**: discord.js, CLI
- **기타**: pino (로깅), node-cron (스케줄링), jsdom + @mozilla/readability (URL 파싱)

---

## 참고

- 이 프로젝트는 개인 학습 목적으로 만들어지고 있습니다. 버그나 이상한 부분이 있으면 이슈로 알려주세요.
- 주석은 영어로 작성되어 있으나 일부 코드에는 한국어가 섞여 있을 수 있습니다. 조금씩 고쳐나가고 있습니다.
- 모든 이슈나 PR은 환영입니다. 작은 수정이라도 부담 갖지 말고 제안해주세요!
