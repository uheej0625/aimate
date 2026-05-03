# AImate Refactoring TODO

## 1. 당장 고쳐야 할 치명적 코드 스멜 & 관례 위반

- [ ] 1-1. `new Function` (eval) 대체 (보안 및 성능 개선) - `CharacterLoader.js` 및 문자열 보간/파싱 로직 수정

## 3. 파격적 리팩토링 제안 (아키텍처 개편)

- [ ] Event-Driven 아키텍처 (Pub/Sub) 도입: ChatFlow의 절차지향적 파이프라인 분리 (응답 생성, DB 저장, 감정 분석 등을 비동기 이벤트로 분해)
- [ ] DI Container (Awilix 등) 전면 도입: 수동 객체 주입(new 클래스) 제거 및 순환 참조 방지
- [ ] Agent 프레임워크 패러다임 도입: 원시적 Tool Executor(for/while 루프) 구조를 상태 머신(LangGraph 개념) 혹은 Agent Chain으로 교체
