# learningx-downloader 검증 결과

## 2026-10-26 자료 다운로드 및 이름 변경

- 로컬 단위 테스트: 76 pass, 0 fail. TypeScript strict 검사와 확장 빌드 통과.
- 실제 숭실대 LearningX 페이지를 Aside에서 확인했습니다. 파일 자료에는 버튼이 표시되고, 과제형 퀴즈에는 표시되지 않습니다.
- 실제 PPTX 자료를 확장 버튼으로 저장했습니다. PowerPoint 파일 식별과 ZIP 무결성 검사를 통과했습니다.
- PDF·PPTX 원본 파일명 보존, 영상/자료 타입 분리, 열람 제한 및 HTML·로그인·오류 응답 거부를 단위 테스트로 확인했습니다.
- 이번 변경의 로컬 검증에서 별도 Playwright 브라우저는 실행하지 않았습니다. GitHub Actions의 전체 Chromium E2E 결과와는 구분합니다.

## 이전 영상 병합 통합 검증 (2026-10-22)

- 검증일: 2026-10-22T13:15:16.994Z
- 빌드: Bun / TypeScript strict / Chrome Manifest V3
- 단위 테스트: 71 pass, 0 fail, 89 assertions
- Chrome for Testing 실제 확장 설치 통합 테스트: 13 pass

## 통과한 시나리오

- single-header-title-and-action-order
- storage-radio-and-layout
- help-modal-focus-escape-and-backdrop
- history-modal-focus-escape-backdrop-and-empty-state
- local-copy
- incompatible-copy-rejected
- normalize-with-silent-input
- cancel
- lms-one-click-single-mp4-no-studio
- lms-one-click-offscreen-segment-merge-no-studio
- closed-lecture-rejected
- untrusted-link-rejected
- history-dialog-and-clear

내보낸 MP4는 네이티브 ffprobe로 길이와 음성 트랙을 확인하고, 네이티브 ffmpeg로 전체 디코딩 검사했습니다. 브라우저 미리보기 재생도 확인했습니다. 기본 LMS 버튼 테스트에서는 별도 작업 탭이 열리지 않는 것을 확인했습니다.

## 디자인 확인

당시 상단 제목 하나와 30px 제목 스타일을 검증했습니다. 최근 다운로드 버튼을 사용법 왼쪽에 배치하고 두 기능 모두 모달로 제공합니다. 다운로드 기록 빈 상태, 저장 내역, 지우기, 닫기, Esc, 배경 클릭 및 포커스 복원을 검증했습니다. TDS 공개 blue500/grey 색상, 점선 파일 영역, 라디오 저장 방식, select 오른쪽 여백을 유지합니다. 390px 모바일 폭에서도 가로 넘침이 없습니다.

## 검증 경계

- 2026-10-22의 영상 통합 테스트는 모의 LearningX 페이지와 합성 세션을 사용했습니다. 2026-10-26의 실제 학교 페이지 검증은 위에 별도로 기재했습니다.
- 512 MiB 한도 전체를 채운 대용량·장시간 병합 성능을 검증한 것은 아닙니다.
- 실제 자료 다운로드는 사용자의 Aside에 로드한 확장으로 확인했습니다. Chrome Web Store에는 게시하지 않았습니다.
- 스토어 배포와 상업적 배포 전에는 학교 약관 및 GPL 대응 소스/고지 의무 검토가 필요합니다.
