# AiMate

Discord, Instagram, CLI에서 동작하는 AI 대화 봇입니다. 단순 질의응답이 아니라 **실제 친구처럼 짧은 메시지를 여러 번 주고받는 경험**을 목표로 합니다. 대화를 거듭할수록 감정 상태가 쌓이고, 관계가 변하고, 봇이 먼저 말을 걸기도 합니다.

---

## 무슨 봇인가요?

보통 AI 챗봇은 질문 하나에 긴 답변 하나를 돌려줍니다. AiMate는 그 방식을 바꾸려고 합니다. 메신저에서 친구와 대화할 때처럼, 짧은 메시지가 여러 번 오가는 걸 흉내냅니다. 봇은 대화 내용을 기억하고, 7가지 감정 축(애착, 질투, 신뢰, 경외감, 불안, 소유욕, 자존감)에 따라 조금씩 달라집니다. 충분히 신뢰를 쌓으면 봇이 먼저 말을 걸어오기도 하고요.

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

| 변수                 | 설명                    |
| -------------------- | ----------------------- |
| `DISCORD_TOKEN`      | Discord 봇 토큰         |
| `DISCORD_CLIENT_ID`  | Discord 애플리케이션 ID |
| `INSTAGRAM_USERNAME` | Instagram 계정 ID       |
| `INSTAGRAM_PASSWORD` | Instagram 계정 비밀번호 |
| `GEMINI_API_KEY`     | Google Gemini API 키    |

### 3. 데이터베이스 초기화

```bash
npm run db:init
```

Prisma가 `prisma/schema.prisma`를 읽어 로컬 SQLite 파일을 생성합니다.

### 4. 실행

| 명령어              | 설명                                 |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Discord 봇 실행                      |
| `npm run cli`       | 터미널에서 직접 대화 (개발·테스트용) |
| `npm run instagram` | Instagram DM 봇 실행                 |
| `npm run deploy`    | Discord 슬래시 커맨드 등록           |

새 기능을 만들었다면 `npm run cli`로 먼저 빠르게 확인해보세요. Discord 재시작 없이 프롬프트와 캐릭터 설정을 테스트할 수 있습니다.

---

## 주요 기능

### 감정 & 관계 엔진

대화마다 7가지 감정 축이 조금씩 변합니다. 어떤 대화를 했는지에 따라 봇의 말투와 반응이 달라집니다. 감정 값은 사용자별로 저장되어 대화를 끊었다가 다시 와도 이어집니다.

### 크론 스케줄링

봇이 스스로 특정 시간에 메시지를 보내거나 작업을 예약할 수 있습니다. LLM이 대화 중에 직접 `registerCron` 도구를 호출해서 일정을 잡습니다.

### 도구 (Tools)

LLM이 필요하다고 판단하면 스스로 도구를 호출합니다.

- `fetchUrl` — 웹페이지 스크래핑 및 요약
- `getTime` — 현재 시스템 시간 조회
- `setDiscordPresence` / `setDiscordStatus` — 봇의 Discord 상태 변경

### 캐릭터 설정

`content/character/` 안의 파일로 봇의 이름, 나이, 말투, 성격 등을 정의합니다. 프롬프트를 고치지 않아도 `variables.json`과 `identity.md`만 수정하면 캐릭터가 바뀝니다.

---

## 구조 요약

```txt
src/
├── core/          # 메시지 처리 흐름 (ChatFlow, MessageHandler 등)
├── engines/       # 감정(Emotion), 관계(Relationship) 엔진
├── platforms/     # Discord / Instagram / CLI 어댑터
├── providers/     # Gemini, Vertex AI 연동
├── repositories/  # DB 접근 레이어 (Prisma)
├── services/      # 비즈니스 로직 (AI, Context, Cron 등)
└── tools/         # LLM이 호출하는 도구 정의 및 실행기

content/
├── character/     # 캐릭터 정의 (identity.md, variables.json)
└── prompts/       # 시스템 프롬프트 템플릿
```

각 플랫폼(Discord, Instagram, CLI)은 들어오는 메시지를 동일한 내부 포맷으로 변환한 뒤 동일한 처리 흐름을 탑니다. 내부 메시지 포맷은 `docs/message-format.md`를 참조하세요.

---

## 기술 스택

- **Runtime**: Node.js (ES Modules)
- **Database**: Prisma + SQLite
- **AI**: Google Gemini API, Vertex AI
- **Platforms**: discord.js, Instagram Private API
- **기타**: pino (로깅), node-cron (스케줄링), jsdom + @mozilla/readability (URL 파싱)

---

## 참고

- 이 프로젝트는 개인 학습 목적으로 만들어지고 있습니다. 버그나 이상한 부분이 있으면 이슈로 알려주세요.
- 주석은 영어로 작성되어 있으나 일부 코드에는 한국어가 섞여 있을 수 있습니다. 조금씩 고쳐나가고 있습니다.
- 모든 이슈나 PR은 환영입니다. 작은 수정이라도 부담 갖지 말고 제안해주세요!
