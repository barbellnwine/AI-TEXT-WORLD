# Railway 운영

기존 web 서비스와 /data 영구 볼륨을 사용한다. 새 DB는 /data/the-anomaly.sqlite, 기존 DB는 별도 파일로 보존한다. Node 24 Docker 이미지, 단일 복제본, /api/health 상태 확인.

## 환경변수
- NODE_ENV=production, HOST=0.0.0.0, PORT는 플랫폼 설정.
- ANOMALY_DB_PATH=/data/the-anomaly.sqlite.
- APP_ORIGIN=https://the-anomaly.up.railway.app: 쓰기 요청 출처 확인. 도메인을 바꾸면 이 값도 함께 바꾸고 재배포한다. 값이 어긋나면 읽기는 되지만 로그인·등록·메모·관리자 저장이 403으로 막힌다.
- ADMIN_SEED_USERNAME, ADMIN_SEED_PASSWORD: 최초 관리자만 생성. 12자 이상 비밀번호. 기존 ADMIN이 있으면 재설정·승격하지 않는다. 초기 생성 후 제거 가능.
- 사건의 publishAt은 UTC 기준이다. 당일 00:00Z는 KST 09:00이므로, 바로 공개하려면 지난 날짜를 쓴다. 관리자는 예약 필터를 건너뛰므로 관리자 화면만 보고 공개 여부를 판단하지 않는다.
- AI 관련 환경변수는 2026-10-19 운영에서 전부 삭제했다(OPENAI_API_KEY, Aitextworld, OPENAI_MODEL, AI_COMMUNITY_* 6개, AI_PROVIDER_PREPAID_BUDGET_USD, AI_WORLD_DEMO_MODE). 값은 D:THE-ANOMALY-backupsefore-transition-20261019-114803ailway-variables-private.json에 보존돼 있다. 새 코드가 읽는 변수는 ADMIN_SEED_USERNAME, ADMIN_SEED_PASSWORD, ANOMALY_DB_PATH, APP_ORIGIN, HOST, PORT, NODE_ENV 7개뿐이다.
- Aitextworld는 이름만 다른 두 번째 OpenAI 키였다(sk- 시작, 164자). OPENAI_API_KEY와 함께 OpenAI 콘솔에서 폐기해야 한다. 구독 종료는 별도 관리자 작업.

## 전환
1. 운영 DB와 설정을 먼저 백업한다.
2. npm run typecheck, npm test, npm run build를 통과한다.
3. 환경변수를 설정하고 기존 서비스에 railway up --detach로 새 버전을 배포한다. 운영 데이터나 볼륨을 지우지 않는다.
4. 배포 SUCCESS와 /api/health 응답, 홈·로그인·관리자·도감·기밀 차단을 검증한다.
5. 새 배포가 이전 프로세스를 교체하여 AI 스케줄러를 종료한다. 기존 DB 파일은 롤백용으로 남긴다.

## 운영 제한
SQLite는 한 서비스·한 복제본에서만 사용한다. 업로드 최대 10MB이며 DB 안에 보존된다. 대용량 영상 운영 시 별도 객체 저장소를 도입한다. 외부 미디어 URL은 공개 자료에만 사용한다. 기밀 자료는 보호된 업로드 API를 사용한다. 세션은 7일. 앱의 비밀번호 초기화 기능은 아직 없다.

## 배포 설정 형식
현재 railway.json 배포 설정을 보존한다. CLI가 해당 형식의 2026-12-01 지원 종료를 안내하므로 그 전에 Railway 공식 IaC 이행 지침에 따라 별도 검증 후 이전한다.
