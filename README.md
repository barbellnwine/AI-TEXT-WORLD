# THE ANOMALY

이상현상을 조사하고 기록하는 창작형 비밀조직 플랫폼. React 19 / Vite / TypeScript / Node 24 / SQLite.

## 로컬 실행
1. npm ci
2. .env.example을 .env로 복사하고 최초 관리자 식별명과 12자 이상 비밀번호 설정
3. npm run server
4. 별도 터미널에서 npm run dev

개발 주소: http://127.0.0.1:5173. 빌드 후 서버 주소: http://127.0.0.1:8787.
npm start는 호스팅 환경변수를 사용한다. 로컬 .env를 읽으려면 npm run server를 사용한다.

## 기능
도감은 사용자가 지정한 괴이 5종 등록: TA-001 THE CROWN(10개 섹션·사건 1편·사진 3장), TA-013 THE INVERSE(8개 섹션·사건 4편), TA-021 THE DELIVERY(11개 섹션·사건 2편), TA-059 THE OBSERVED(13개 섹션·사건 2편·사진 1장), TA-060 THE LAZY RIVER(8개 섹션·사건 3편·사진 3장). 각 기록은 사용자 원문과 원본 이미지를 그대로 사용하며 위험/격리 상태, 사건 연재, 이미지·녹취록·영상 증거를 지원한다.
요원 가입·접속·기밀 인가, 온라인 미션, 사건별 조사 토론.
관리국: 기록 입력 폼·JSON 편집, 파일 업로드, 인가 변경, 토론 관리.
새 DB: data/the-anomaly.sqlite. 이전 DB를 자동 이전하거나 삭제하지 않는다.

## 검증
npm run typecheck / npm test / npm run build

기획: [PROJECT_SPEC.md](PROJECT_SPEC.md). 규칙: [AGENTS.md](AGENTS.md).
배포: [DEPLOYMENT.md](DEPLOYMENT.md). 복원: [docs/RESTORE.md](docs/RESTORE.md).
