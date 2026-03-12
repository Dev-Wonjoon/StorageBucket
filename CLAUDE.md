# StorageBucket

yt-dlp, gallery-dl 등을 활용한 미디어 다운로드/관리 Electron 데스크톱 앱

## Tech Stack

- **Framework**: Electron + electron-vite
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4
- **Backend**: Node.js (Electron main process)
- **Database**: SQLite (better-sqlite3 + Drizzle ORM)
- **Package Manager**: bun
- **External Tools**: yt-dlp, gallery-dl (resources/bin/)

## Architecture

```
src/
├── main/                  # Electron main process
│   ├── index.ts           # 앱 진입점
│   ├── AppInitializer.ts  # 초기화 로직
│   ├── handlers/          # IPC 핸들러 (Download, Media, Favorite, System)
│   ├── managers/          # 비즈니스 로직 매니저 (Download, Config, Bin)
│   ├── services/          # 서비스 레이어 (Media, Favorite, Search)
│   └── utils/             # 유틸리티 (YtdlpTask, GalleryDlTask, ArgsUtils 등)
├── renderer/              # React 프론트엔드
│   └── src/
│       ├── App.tsx
│       ├── features/      # 기능별 페이지 + ViewModel (download, gallery, favorites, settings)
│       ├── components/    # 공용 컴포넌트 (ui/, layouts/)
│       ├── hooks/         # 커스텀 훅
│       └── assets/        # CSS
├── preload/               # Electron preload 스크립트
├── database/              # Drizzle 스키마 및 DB 초기화
└── shared/                # main/renderer 공용 타입 및 상수
```

## Path Conventions

- **다운로드 경로**: `downloads/{site_name}/{uploader_id or uploader}/files`
- **썸네일 경로**: `thumbnails/{site_name}/{uploader_id or uploader}/files`
- **외부 바이너리**: `resources/bin/`

## DB Tables

- `platform` - 플랫폼 정보
- `profiles` - 업로더/채널 프로필
- `medias` - 다운로드된 미디어 메타데이터
- `tag` / `media_tag` - 태그 및 미디어-태그 다대다 매핑
- `favorites` - 즐겨찾기
- `download_queue` - 다운로드 큐 상태 관리

## Commands

- `bun run dev` - 개발 서버
- `bun run build` - 프로덕션 빌드
- `bun run build:win` - Windows 빌드
- `bun run lint` - ESLint
- `bun run typecheck` - 타입 체크

## Pattern

- **MVVM**: features/ 하위에 페이지 컴포넌트 + useXxxViewModel 훅으로 분리
- **IPC 통신**: Handler(renderer↔main) → Manager/Service → DB/외부 도구