# Voice input layer

이 디렉터리는 이웃연결단의 음성·텍스트 입력을 고정 JSON 계약으로 바꾸는 독립 모듈이다. 지도, 트리아지 큐, 규칙 그래프, 방문 확정, 경로·배치 최적화는 이 모듈의 범위가 아니다.

## 현재 단계

- **3a 완료:** 텍스트 입력 -> OpenAI Structured Outputs -> 계약 검증 -> JSON
- **3b 미구현:** 오디오 파일 -> 전사 -> 3a
- **3c 미구현:** Realtime API(WebRTC) -> function calling -> 같은 JSON

3a가 최하단 폴백이다. 3b는 파일을 전사한 뒤 `processVoiceInput({ kind: 'text', ... })`에 그대로 넘기고, 3c도 실시간 전사·함수 호출이 실패하면 3b, 다시 3a 순서로 전환한다.

> 3c는 코드와 mock 테스트가 통과해도 완료가 아니다. **실기기 마이크로 실제 발화 테스트가 반드시 필요하다.**

## 고정 출력 계약

계약의 단일 원본은 [`schema/voice-output.schema.json`](schema/voice-output.schema.json)이다. 모든 필드는 항상 존재한다. `condition` 의도에서는 `contact_result`가 `null`, `contact_result` 의도에서는 `condition`이 `null`, `other`에서는 둘 다 `null`이다.

매뉴얼 기준은 「고독사 예방 및 관리를 위한 이웃연결단 활동 매뉴얼」 14쪽의 6개 위험징후 체크리스트와 48~49쪽의 관찰·가정방문 기록지다. 언급되지 않은 관찰 항목은 `null`이며, 식사·위생은 매뉴얼 표기의 `양호 | 불량 | 심각`만 사용한다.

트리아지 경계를 지키기 위해 `risk_score`는 발화에 숫자 점수가 직접 등장할 때만 옮기고 기본값은 `0`이다. `visit_recommended`도 연결단원이 방문 필요를 직접 권고·요청했을 때만 `true`다. 이 값은 방문 확정이 아니며 최종 규칙과 담당자 승인은 메인 시스템의 책임이다.

## 설치와 오프라인 테스트

Node.js 24가 필요하다.

```bash
npm ci
npm test
```

골든셋은 `test/fixtures/text-golden.json`에 있다. OpenAI 호출은 mock이므로 API 키나 마이크 없이 헤드리스에서 실행할 수 있다.

## API 키와 실행

키는 커밋하거나 명령행에 쓰지 않는다. `.env.example`을 복사해 로컬 `voice/.env`에만 둔다.

```bash
cp .env.example .env
printf '%s' '오늘 무릎이 안 좋아요' \
  | npm run text -- --surveyor-id '연결단원 001'
```

`OPENAI_VOICE_TEXT_MODEL`로 Structured Outputs 지원 모델을 바꿀 수 있다. 기본값은 `gpt-4o-mini`다.

메인이 호출할 단일 인터페이스는 다음과 같다.

```js
import { processVoiceInput } from './voice/src/index.mjs';

const result = await processVoiceInput({
  kind: 'text',
  text: '방금 CASE-0412랑 통화했는데 이틀째 밥을 안 먹었대요',
  surveyorId: '연결단원 001',
});
```

## 개인정보와 로그

- 통화 전사는 동의를 받은 입력만 사용한다.
- 데모 발화와 ID는 전부 합성 데이터만 사용한다.
- 실제 이름·주소·연락처를 요구하거나 생성하지 않는다.
- PII 형태가 들어오면 모델 호출 전에 마스킹하고, 구조화 결과의 모든 문자열도 다시 마스킹한다.
- `transcript`는 STT 원문을 유지하되 개인정보 안전 규칙 때문에 마스킹 토큰으로 치환된 원문이다.
- 이 모듈은 transcript나 모델 응답을 로그로 남기지 않는다.
