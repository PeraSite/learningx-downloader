# Third-party notices / 배포 전 검토

이 문서는 완전한 법률 검토 또는 GPL 준수 인증이 아닙니다. Chrome Web Store 등 외부 배포 전 실제 포함 바이너리와 대응 소스를 기준으로 의무를 이행해야 합니다.

## Runtime dependencies

- **@ffmpeg/ffmpeg 0.12.15**: MIT. Source: https://github.com/ffmpegwasm/ffmpeg.wasm . The package wrapper/worker is bundled locally.
- **@ffmpeg/core 0.12.10**: GPL-2.0-or-later according to the installed package metadata. Source/build project: https://github.com/ffmpegwasm/ffmpeg.wasm . Contains FFmpeg and external codec libraries; the exact corresponding source and build configuration matter. This project packages the upstream prebuilt single-thread `dist/esm/ffmpeg-core.js` and `ffmpeg-core.wasm` unchanged.
- **fast-xml-parser 5.4.2**: MIT. Source: https://github.com/NaturalIntelligence/fast-xml-parser . Also includes its transitive runtime dependency strnum; inspect lockfile/package metadata for exact installed version and notices.

Before redistribution: preserve applicable notices, include full license texts, provide the required corresponding source/build materials or a legally sufficient source offer as applicable, and determine the obligations for the extension as a combined work. Do not assume closed-source/proprietary distribution is compatible merely because the UI and core use different files.

The extension downloads no executable code from these URLs at runtime. These are source references only.
