# StorageBucket

## 소개
**StorageBucket**은 개인용 미디어 관리 프로그램입니다.  
로컬에 있는 사진과 영상뿐 아니라 **YouTube, Instagram, Twitter 등 웹에 업로드된 미디어를 다운로드**해 한 곳에서 관리할 수 있습니다.  

쉽게 말해, 내 컴퓨터 속 **개인 미디어 갤러리**입니다.

---

## 주요 기능

- **미디어 다운로드**
  - 웹에서 사진과 영상을 다운로드해 갤러리에 저장
  - 지원 플랫폼: YouTube, Instagram, Twitter (추가 예정)

- **로컬 미디어 관리**
  - 내 PC에 이미 있는 사진/영상을 불러와 정리 가능
  - 파일명, 태그, 메타데이터로 빠르게 검색 가능

- **갤러리 보기**
  - 썸네일 기반 갤러리 UI 제공
  - 다크 모드 / 라이트 모드 지원

- **태그 및 검색**
  - 원하는 미디어에 태그를 붙여 분류
  - 검색 기능으로 원하는 자료를 즉시 찾기

- **자동 정리 (예정 기능)**
  - 오래된 파일 자동 백업/삭제
  - 다운로드 시 플랫폼별/사용자별 자동 분류

---

## 설치 및 실행

1. **필수 환경**
   - Python 3.12 이상
   - (선택) Docker 환경 지원

2. **설치 및 실행**
   ```bash
   git clone https://github.com/Dev-Wonjoon/StorageBucket.git
   cd StorageBucket
   pip install -r requirements.txt
   python main.py
