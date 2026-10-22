# Third-party notices

이 프로젝트 자체의 소스코드 라이선스는 아직 지정하지 않았습니다. 아래 고지는 포함된 타사 구성요소에 관한 것이며, 프로젝트 전체에 새 라이선스를 부여하지 않습니다.

## 포함된 런타임 구성요소

- **@ffmpeg/ffmpeg 0.12.15 · MIT**
  - ffmpeg.wasm의 JavaScript wrapper와 worker입니다.
  - 소스: https://github.com/ffmpegwasm/ffmpeg.wasm
  - [라이선스 원문](docs/licenses/ffmpeg-wrapper-MIT.txt)
- **@ffmpeg/core 0.12.10 · GPL-2.0-or-later**
  - upstream에서 배포한 single-thread `ffmpeg-core.js`와 `ffmpeg-core.wasm`을 변경 없이 포함합니다.
  - 패키지: https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
  - 소스·빌드 프로젝트: https://github.com/ffmpegwasm/ffmpeg.wasm
  - [GPL 2.0 원문](docs/licenses/ffmpeg-core-GPL-2.0.txt)
  - FFmpeg와 외부 코덱 라이브러리를 포함합니다. 실제 바이너리의 빌드 구성과 각 구성요소의 의무를 기준으로 판단해야 합니다.
- **fast-xml-parser 5.4.2 · MIT**
  - 소스: https://github.com/NaturalIntelligence/fast-xml-parser
  - [설치된 패키지의 라이선스 원문](docs/licenses/fast-xml-parser-MIT.txt)
- **strnum 2.5.1 · MIT**
  - fast-xml-parser의 런타임 의존성입니다.
  - 소스: https://github.com/NaturalIntelligence/strnum
  - [설치된 패키지의 라이선스 원문](docs/licenses/strnum-MIT.txt)

## 배포 시 주의

라이선스 원문·저작권 고지와 이 문서를 설치 ZIP에 함께 포함합니다.
대응 소스와 빌드 자료 제공 등 GPL의 적용 의무는 별도로 이행해야 하며, upstream 링크만으로 모든 의무가 충족된다고 주장하지 않습니다.
이 문서는 법률 검토나 GPL 준수 인증이 아닙니다. 프로젝트 소스와 코어가 다른 파일이라는 이유만으로 독점 배포가 가능하다고 가정하지 마세요.

이 링크들은 출처 참조용입니다. 확장 실행 중 외부 실행 코드 CDN에서 코드를 내려받지는 않습니다.
