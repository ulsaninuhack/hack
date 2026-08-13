# Voice input layer

이 디렉터리는 이웃연결단의 음성·텍스트 입력을 고정 JSON 계약으로 바꾸는 독립 모듈이다. 지도, 트리아지 큐, 규칙 그래프, 방문 확정, 경로·배치 최적화는 이 모듈의 범위가 아니다.

## 현재 단계

- **3a 완료:** 텍스트 입력 -> OpenAI Structured Outputs -> 계약 검증 -> JSON
- **3b 완료(모킹 전사 검증):** WAV/MP3/M4A 파일 -> OpenAI 전사 -> 즉시 PII 마스킹 -> 기존 3a -> 같은 계약 검증 -> JSON
- **ContactOps P3 어댑터 완료(모킹 검증):** Planner -> 기존 JSON 스키마 -> 영/한 관찰 매핑 -> Critic(누락·모순·다음 확인 질문) -> 명시적 사용자 확인 후보
- **3c 코드 완료(모킹 검증):** LiveKit 2인 WebRTC 통화 -> 발화자별 OpenAI Realtime 전사 -> 연락 대상 확정 발화만 기존 3a/ContactOps 후보 경계 재사용

3a가 최하단 폴백이다. 3b는 파일을 전사한 뒤 `processVoiceInput({ kind: 'text', ... })`에 그대로 넘긴다. 3c도 실시간 전사가 끝나면 기존 텍스트 후보 경계를 재사용하며, 실패하면 3b 파일 입력, 다시 문답·수동 입력 순서로 전환한다.

> 3c는 코드와 mock 테스트가 통과해도 완료가 아니다. **실기기 마이크로 실제 발화 테스트가 반드시 필요하다.**

## 고정 출력 계약

계약의 단일 원본은 [`schema/voice-output.schema.json`](schema/voice-output.schema.json)이다. 모든 필드는 항상 존재한다. `condition` 의도에서는 `contact_result`가 `null`, `contact_result` 의도에서는 `condition`이 `null`, `other`에서는 둘 다 `null`이다.

매뉴얼 기준은 「고독사 예방 및 관리를 위한 이웃연결단 활동 매뉴얼」 14쪽의 6개 위험징후 체크리스트와 48~49쪽의 관찰·가정방문 기록지다. 언급되지 않은 관찰 항목은 `null`이며, 식사·위생은 매뉴얼 표기의 `양호 | 불량 | 심각`만 사용한다.

트리아지 경계를 지키기 위해 `risk_score`는 발화에 숫자 점수가 직접 등장할 때만 옮기고 기본값은 `0`이다. `visit_recommended`도 연결단원이 방문 필요를 직접 권고·요청했을 때만 `true`다. 이 값은 방문 확정이 아니며 최종 규칙과 담당자 승인은 메인 시스템의 책임이다.

ContactOps 확인 후보 `contact-ops-observation-candidate/v2`는 기존 음성 계약의 `risk_score`와 `visit_recommended`를 항상 제거하고 제거 내역만 남긴다. 미응답 연속 횟수, 재연락 기한, 점수, 방문 승인, 이관 완료, 경로 제약은 후보 스키마가 받지 않는 서버 소유 필드다. `위생상태: 심각`은 새 가중치를 만들지 않고 `불량`으로 매핑하며 Critic 경고를 남긴다. `요즘 밥을 잘 못 먹어요`처럼 등급 경계가 모호한 식사 표현은 식사 등급 후보를 `null`로 되돌리고, 한 문장의 `next_question`으로 구체적 사실을 다시 확인하게 한다. `오늘 아무것도 못 먹었다` 뒤에 `아침에는 죽을 조금 먹었다`가 이어지면 기존 값을 조용히 덮지 않고 식사 후보를 `null`로 유지한 채 모순과 시간 범위 확인 질문을 반환한다. 서로 다른 날짜가 명시된 경우에는 모순으로 만들지 않는다.

## 설치와 오프라인 테스트

Node.js 24가 필요하다.

```bash
npm ci
npm test
npm run test:coverage
```

3a 골든셋은 `test/fixtures/text-golden.json`, 3b 골든셋은 `test/fixtures/audio-golden.json`에 있다. 3b 골든은 8개의 결정론적 mock WAV와 주입된 `stub_transcript`를 사용해 응답/미응답, 식사 양호·불량·심각, 다중 관찰징후, 프롬프트 인젝션 문구, 사투리, 컨디션, 합성 PII 형태를 검증한다. OpenAI 호출은 mock이므로 API 키나 마이크 없이 헤드리스에서 실행할 수 있다.

기본 `npm test`에서 라이브 테스트는 항상 skip된다. 따라서 CI·나이틀리에서 네트워크나 API 키를 사용하지 않는다.

## API 키와 실행

키는 커밋하거나 명령행에 쓰지 않는다. `.env.example`을 복사해 로컬 `voice/.env`에만 둔다.

```bash
cp .env.example .env
printf '%s' '오늘 무릎이 안 좋아요' \
  | npm run text -- --surveyor-id '연결단원 001'

npm run audio -- \
  --audio-file ./consented-synthetic-memo.wav \
  --surveyor-id '연결단원 001'
```

텍스트 Planner/Critic은 기본적으로 `OPENAI_API_KEY`를 쓰지만,
`CONTACT_OPS_CODEX_BRIDGE_URL`과 32자 이상의 `CONTACT_OPS_CODEX_BRIDGE_TOKEN`을 설정하면
인증된 Mac mini Codex 브리지를 우선 사용한다. 두 transport가 모두 설정된 경우에만 네트워크
연결 실패, 타임아웃, HTTP 503/504 또는 본문 없는 게이트웨이 502에 기존 `OPENAI_API_KEY`를 재사용한다. 인증 실패, 사용량 제한,
모델 출력 오류, 응답 계약 오류는 OpenAI로 가리지 않고 그대로 실패한다. 외부 브리지 URL은
HTTPS만 허용한다. 운영 방법은
[`../docs/MAC_MINI_CODEX_BRIDGE.md`](../docs/MAC_MINI_CODEX_BRIDGE.md)를 따른다.
`OPENAI_VOICE_TEXT_MODEL`은 OpenAI text transport의 Structured Outputs 모델을 바꾼다.
브리지 사용 시 실제 모델은 Mac mini의 `CODEX_BRIDGE_MODEL`이 결정한다.

파일 전사 모델은 `OPENAI_VOICE_TRANSCRIPTION_MODEL`로 바꾼다. 기본값은 `gpt-4o-mini-transcribe`이며 `whisper-1`, `gpt-4o-transcribe` 계열로 교체할 수 있다. 입력 언어 힌트는 `OPENAI_VOICE_TRANSCRIPTION_LANGUAGE`이고 기본값은 `ko`다. 이 어댑터는 제품 범위에 맞춰 WAV/MP3/M4A 정규 파일만 받으며, OpenAI 파일 전사 제한에 맞춰 25MB 이하만 허용한다. 구현은 OpenAI의 [파일 전사 가이드](https://developers.openai.com/api/docs/guides/speech-to-text)처럼 `audio.transcriptions.create`에 파일 스트림을 전달한다.

메인이 호출할 단일 인터페이스는 다음과 같다.

```js
import { processVoiceInput } from './voice/src/index.mjs';

const result = await processVoiceInput({
  kind: 'text',
  text: '방금 CASE-0412랑 통화했는데 이틀째 밥을 안 먹었대요',
  surveyorId: '연결단원 001',
});
```

3b에서 메인이 호출할 단일 인터페이스는 `processAudioFile`이다. 내부에서는 전사 직후 원문을 메모리에서만 마스킹하고, 기존 3a `processVoiceInput`을 그대로 호출한다.

```js
import { processAudioFile } from './voice/src/audio-input.mjs';

const result = await processAudioFile({
  audioPath: './consented-synthetic-memo.wav',
  surveyorId: '연결단원 001',
});
```

전사 호출 경계는 `transcribe(audioPath, options) -> string`이다. 테스트에서는 `processAudioFile`의 `transcriber` 옵션에 stub을 주입하고, 운영에서는 기본 OpenAI 어댑터를 사용한다.

ContactOps는 `planContactOpsObservation(input, options)`로 텍스트 또는 검증된 WAV/MP3/M4A를 후보로 바꾸고, 서버가 확인 요청을 받을 때 `assertContactOpsObservationCandidate(value)`로 정확한 키와 경계를 다시 검증한다. 어댑터는 `confirmed: false` 후보만 만들며 확정·점수·승인을 실행하지 않는다.

선택된 대상자의 통화 결과 화면에서 들어온 파일·텍스트는 서버가
`selected_case_voice_memo` 문맥과 선택된 합성 case ID를 Planner에 함께 전달한다.
따라서 대상자의 말을 1인칭으로 인용하거나 욕설·감탄사가 섞여도 연결단원 본인의
컨디션이 아니라 통화 결과 후보로 해석한다. Planner가 `누워만 있음`을 `외출_없음`,
사회적 접촉 부재를 정규 `관계망 없음` 신호로 추출하면 어댑터가 기존 한국어
체크리스트의 `관계망_유무=없음`으로 변환한다. 발화에 다른 case ID가 명시되면
선택된 case와의 불일치를 Critic에 남긴다.

같은 정규 신호 방식으로 공과금 2개월 이상 체납, 최근 건강·마음 괴로움, 관계망,
평소 연락 빈도를 기존 체크리스트 후보에 채운다. AI가 별도 숫자 점수를 만들지는
않는다. 조사원이 후보를 확인·제출하면 기존 결정론 점수표가 해당 항목을 계산한다.
체크리스트로 바로 표현되지 않는 `free_text`는 모바일의 `기타 특이사항 확인`에
노출해 조사원이 관련 항목을 수동으로 확인할 수 있게 한다.

```js
import {
  assertContactOpsObservationCandidate,
  planContactOpsObservation,
} from './voice/src/contact-ops-adapter.mjs';

const candidate = await planContactOpsObservation({
  kind: 'text',
  text: 'SYN-HH-2812551000-0001 전화는 연결됐고 식사가 심각합니다.',
  surveyorId: '연결단원 001',
  caseId: 'SYN-HH-2812551000-0001',
}, { plannerClient: deterministicMockClient });

const safeConfirmationCandidate = assertContactOpsObservationCandidate(candidate);
```

## 라이브 옵션과 폴백

사람이 만든 합성 TTS 오디오 또는 동의를 받은 비식별 테스트 오디오의 경로를 로컬 `.env`에만 둔 뒤 명시적으로 실행한다.

```bash
npm run test:live
```

`RUN_LIVE_WHISPER=1`이 설정된 이 명령만 실제 전사 API와 3a API를 호출한다. 전사 결과의 문구 일치는 단언하지 않고, 비어 있지 않은 마스킹 전사와 최종 계약 통과만 확인한다. `.env`, 원시 전사, 오디오 경로는 커밋하거나 로그로 남기지 않는다.

ContactOps 실제 Planner–Critic 그래프는 `ENABLE_LIVE_CONTACT_OPS_AI=1`이 명시되고 OpenAI 또는 Mac mini text transport가 설정된 경우에만 열린다. Planner 호출 후 두 번째 Structured Outputs Critic 호출이 실행되며, Critic은 `missing_fields`, `contradictions`, `low_confidence_fields`, `warnings` 배열과 `next_question` 하나만 반환할 수 있다. 질문은 160자 이하의 단일 확인 질문 또는 `null`이며 점수·등급·진단·방문·이관·승인을 결정할 수 없다. 기본값 `0`에서는 외부 호출을 막고 주입된 모킹 Planner/Critic만 실행한다. 오디오 파일 전사는 브리지 대상이 아니므로 계속 `OPENAI_API_KEY`가 필요하다.

3c는 조사원과 연락 대상에게 각각 서버 서명 역할 토큰을 발급한다. 두 브라우저는 LiveKit으로 서로의 음성을 듣고, 각자 자기 마이크만 OpenAI Realtime 전사에 보낸다. 자막은 두 역할 모두 화면에 표시하지만 기존 3a/ContactOps 후보에는 연락 대상의 확정 발화만 전달한다. 확정 발화가 추가될 때 누적 전사문을 디바운스해 Planner–Critic 상태를 다시 계산하고, 통화 화면에는 체크리스트와 `next_question`을 `AI 후보 · 미확정`으로 스트리밍한다. 세션 로컬 근거 원장은 분석된 전사문에 실제 포함된 확정 발화 ID만 후보 항목에 연결한다. Critic이 식사 모순을 반환하면 두 발화를 모두 보존한 상충 카드가 표시된다. 늦게 끝난 과거 응답과 중복 확정 자막은 버리며, 확정 자막은 늦은 중간 자막으로 되돌아가지 않는다. 통화 종료 후 조사원이 체크리스트를 확인하고 제출해야 기존 결정론 점수와 보고가 실행된다. 폴백 순서는 3c 실패 시 3b 파일 업로드, 그다음 문답·수동 입력이다. 근거 원장은 브라우저 통화 세션의 읽기 전용 투영이며 서버 영속 그래프나 자동 확정 기록이 아니다.

`gpt-live-transcribe`를 전용 `type: transcription` 세션에서 쓰면서 `server_vad`를
지정하면 `Turn detection is not supported for this transcription model.` 오류가 난다.
현재 구현은 `type: realtime` 세션에 `gpt-live-transcribe`를 입력 전사기로 연결한다.
발화 경계는 Realtime 세션의 `server_vad`가 만들며 `create_response`와
`interrupt_response`는 모두 꺼서 AI 음성 응답은 생성하지 않는다. 전사 델타는 즉시
표시되고 completed 이벤트만 체크리스트 후보에 들어간다.

### 초록이 증명하는 것

- 주입한 전사 결과가 오디오 파일 경계를 거쳐 즉시 마스킹되고 기존 3a와 고정 JSON 계약으로 연결됨
- 3a의 Structured Outputs 요청, 출력 스키마 검증, evidence 원문 부분문자열 검증을 수정·복제하지 않고 재사용함
- 합성 PII 형태가 3a API 요청과 최종 `transcript`·`evidence`에 원문으로 남지 않음
- WAV/MP3/M4A 파일 종류·시그니처·크기·심볼릭 링크 검증과 오류 메시지 비노출

### 초록이 증명하지 못하는 것

- 실제 Whisper/OpenAI 전사 모델의 한국어 노인 음성, 전화 음질, 사투리, 소음 환경 정확도
- Galaxy/iPhone 두 대의 실제 WebRTC 마이크·스피커 동작과 네트워크 품질

위 항목은 아침에 실기기·실오디오로 사람이 검증해야 한다. 모킹 테스트 통과를 실제 음성 품질 완료로 간주하지 않는다.

2026-08-13 로컬 클라우드 스모크에서는 서로 다른 합성 WAV를 가짜 마이크로 넣은
두 브라우저가 실제 LiveKit Cloud 방에 2명으로 참여하고, OpenAI Realtime SDP 201
응답 뒤 연결단원 1턴과 연락 대상 1턴을 분리해 completed 자막으로 받았다. 이는 실제
클라우드 배선과 애플리케이션 발화자 분리를 증명하지만 Galaxy/iPhone의 실제 마이크,
스피커 에코, 이동통신망, Safari 권한 UX를 증명하지 않는다.

2026-08-13 운영 리허설에서는 Secret Manager 키를 주입한 Cloud Run에서 7초 한국어
합성 M4A를 모바일 multipart 경로로 전송해 전사·Planner·Critic 후보 HTTP 200을
확인했다. 이는 실 API 배선만 증명하며 실제 조사원 음성 품질을 증명하지 않는다.

선택 대상자 문맥 보강 후 욕설이 섞인 4.3초 합성 발화
`밥 안 먹고 누워만 있어. 사람 안 만나.`를 실제 OpenAI 전사·Planner·Critic에 넣어
`connected_concern`, `식사상태=심각`, `외출_없음=true`, `관계망_유무=없음`,
`requires_user_confirmation=true`를 확인했다. 확인된 후보를 기존 점수 엔진에 넣으면
급성도 37점 `주시`, 취약도 62.60점, `재연락 기한 단축`이 된다. 합성 TTS 결과이므로
실제 노인 음성·전화 음질·사투리·소음 정확도는 계속 사람 검증 과제다.

## 개인정보와 로그

- 통화 전사는 동의를 받은 입력만 사용한다.
- 데모 발화와 ID는 전부 합성 데이터만 사용한다.
- 실제 이름·주소·연락처를 요구하거나 생성하지 않는다.
- PII 형태가 들어오면 모델 호출 전에 마스킹하고, 구조화 결과의 모든 문자열도 다시 마스킹한다.
- `transcript`는 STT 원문을 유지하되 개인정보 안전 규칙 때문에 마스킹 토큰으로 치환된 원문이다.
- 3b의 원시 전사는 전사 응답과 마스킹 호출 사이의 메모리에서만 사용하며, JSON·파일·로그에 쓰지 않는다.
- 이 모듈은 transcript, 모델 응답, 오디오 경로를 로그로 남기지 않는다.
