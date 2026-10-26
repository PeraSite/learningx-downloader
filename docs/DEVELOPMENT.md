# learningx-downloader 개발 가이드

## 준비

- Bun 1.4.0
- 데스크톱 Chrome 또는 Playwright Chromium
- 통합 테스트용 네이티브 `ffmpeg`, `ffprobe`, `openssl`, `zip`, `unzip`

확장을 **사용할 때**는 Bun이나 네이티브 ffmpeg가 필요하지 않습니다.
위 도구는 소스 빌드와 개발·테스트에 사용합니다.

## 실행과 빌드

```bash
bun install --frozen-lockfile
bun run dev
bun run build
```

- `bun run dev`: 웹 미리보기. 로컬 파일 병합을 시험할 수 있습니다. 학교 세션 연동은 확장으로 설치해야 합니다.
- `bun run build`: `dist/`에 MV3 확장을 만들고 `release/learningx-downloader-{버전}.zip`을 생성합니다.
- 확장 수정 후에는 `chrome://extensions`와 LearningX 탭을 새로고침하세요.

## 테스트

```bash
bun run typecheck
bun run test
bun x playwright install chromium --no-shell
bun run test:e2e
```

통합 테스트는 분리된 Chrome for Testing 프로필에서 **실제 확장**을 로드합니다.
생성한 테스트 영상과 모의 LearningX 페이지·합성 세션만 사용하며, 사용자의 브라우저 세션은 복제하지 않습니다.
내보낸 MP4의 재생 시간과 음성 트랙을 확인하고 네이티브 ffmpeg로 전체 디코딩 검사합니다.

실제 학교 계정과 실시간 LMS DOM의 검증과는 구분해야 합니다. 마지막 로컬 검증은 [TEST_REPORT.md](../TEST_REPORT.md)를 확인하세요.

환경변수:

- `TEST_OUTPUT_DIR`: 테스트 결과·프로필·생성 영상 위치
- `FFMPEG_PATH`, `FFPROBE_PATH`: 테스트용 바이너리 경로
- `PLAYWRIGHT_BROWSERS_PATH`: 테스트용 Chromium 위치

테스트 출력에는 합성 인증 정보와 테스트용 HTTPS 개인 키가 포함될 수 있습니다.
**프로필·테스트 출력 전체를 저장소나 공개 Actions artifact에 업로드하지 마세요.**

## 구조

- `src/content.ts`: LMS 콘텐츠 타입 감지, 영상·자료 다운로드 버튼, 같은 프레임에서 인증 GET
- `src/learningx.ts`: Commons 영상·파일·PDF 타입 구분과 열람 권한 검증
- `src/background.ts`: 확장 메시지와 고급 화면 진입
- `src/direct.ts`: 영상·자료 원클릭 다운로드 작업과 취소
- `src/offscreen.ts`: 화면 없는 영상 조각 다운로드·병합
- `src/commons.ts`: 원본 URL 허용 목록, 영상 XML 해석, 자료 원본 다운로드 응답 검증
- `src/network.ts`: 미디어 검사, 후보 주소 fallback, 수신 바이트 제한
- `src/merger.ts`: WORKERFS, ffprobe, 빠른 병합, 호환 변환, 접합부 검사
- `src/history.ts`: 다운로드 기록 직렬화
- `src/studio.ts`, `src/style.css`: 영상 병합 UI와 영상·자료 공통 다운로드 기록
- `scripts/prepare.ts`, `scripts/build.ts`: 로컬 실행 코드/WASM을 포함한 Bun 빌드

## 병합 정책

기본 모드는 concat demuxer와 `-c copy`입니다. 코덱 초기화 데이터·해상도·프레임·회전·음성 구성이 다르면 거부합니다.
호환 모드는 1280×720 / 30fps / H.264 / AAC로 변환하고, 무음 파일에는 무음 트랙을 추가합니다. 원본 음성을 임의로 버리지 않습니다.

입력은 WORKERFS에 읽기 전용으로 마운트합니다. 그래도 출력·디코더에는 큰 메모리가 필요합니다.
빠른 병합은 512 MiB, 호환 모드는 10분·128 MiB, 호환 변환 중간 결과는 192 MiB로 제한합니다.
결과의 재생 시간·음성 트랙과 각 접합부의 짧은 디코딩을 검사합니다. 전체 디코딩 검사를 대체하지는 않습니다.

## 릴리스

`main` push 또는 main의 수동 Actions 실행으로 배포합니다.

1. 잠긴 의존성을 설치하고 단위 테스트를 실행합니다.
2. 확장을 빌드하고 커밋·실행 정보가 든 `BUILD_INFO.json`을 추가합니다.
3. 설치 ZIP을 풀어 **그 실제 페이로드**로 Chromium E2E를 수행합니다.
4. 성공한 최신 main 빌드만 ZIP과 SHA-256 체크섬을 게시합니다.

진행 중 새 커밋이 오면 이전 실행을 취소할 수 있습니다. 이전 커밋을 수동 재실행해도 최신 main이 아니면 게시하지 않습니다.
버전은 `manifest.json`, 릴리스 식별자는 실행 번호와 커밋 해시를 사용합니다. Chrome Web Store 자동 업데이트는 제공하지 않습니다.

## 기여·문제 제보

문제 제보에는 Chrome 버전, LMS 도메인, 수행한 동작, 표시된 오류를 적어 주세요.
비밀번호, 쿠키, 세션 토큰, 학생 정보, 비공개 강의 URL이나 영상은 첨부하지 마세요.

다른 대학 지원을 추가할 때는 도메인 허용 목록·DOM·로그인 방식·실제 다운로드 권한을 각각 확인해야 합니다.
출석·학습 진도 변경, DRM·열람 제한 우회는 범위에 포함하지 않습니다.

프로젝트 자체 라이선스는 아직 지정하지 않았습니다. 라이선스와 권리 관계를 확정하기 전에는 외부 코드의 무단 반입·재배포를 피하세요.
