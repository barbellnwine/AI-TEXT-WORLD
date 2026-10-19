# 전환 백업 및 복원

## 보존 위치
D:\THE-ANOMALY-backups\before-transition-20261019-114803

- 기존 소스·환경설정·data 폴더 전체 사본 (node_modules, 생성 dist, .git 제외).
- retired/: 작업 폴더에서 퇴역시킨 기존 소스·테스트·문서·공개 자료 원본. 미커밋 수정도 포함.
- uncommitted.patch, git-head.txt: 당시 커밋과 미커밋 수정 정보.
- consistent-legacy.sqlite: SQLite backup API로 만든 일관 로컬 DB 스냅샷. integrity_check = ok.
- production-legacy.sqlite: 실제 Railway 운영 DB의 일관 스냅샷. integrity_check = ok.
- production-legacy-final.sqlite: 이전 AI 서버가 완전히 종료된 후 만든 마지막 일관 스냅샷. 복원 시 이 파일을 우선 사용한다.
- production-retired-data-complete.tar.gz: 운영 볼륨의 기존 데이터 파일 전체 압축본. 새 서비스 DB와 중복 스냅샷은 제외. 기존 AI DB 외 로그·관련 자료도 보존한다.
- railway-variables-private.json: 기존 Railway 설정/비밀값. 비공개 파일이며 공유·커밋 금지.
- railway-status.json: 이전 배포와 볼륨 식별 정보.
- 운영 볼륨에도 /data/before-anomaly-20261019.sqlite 보존. 원래 /data/ai-community.sqlite는 변경·삭제하지 않는다.

## 로컬 기존 서비스 복원
1. 새 서버를 종료한다. 현재 THE ANOMALY 코드와 신규 DB도 먼저 별도 D드라이브 폴더에 백업한다.
2. 백업 루트의 기존 프로젝트 파일들을 별도 복원 폴더에 복사한다. retired는 작업 정리 과정에서 생긴 중복 보존본이므로 필수로 덮어쓸 필요 없다.
3. consistent-legacy.sqlite를 복원 프로젝트의 data/ai-community.sqlite로 복사한다. DB가 실행 중인 동안 덮어쓰지 않는다. 기존 WAL/SHM을 복원 DB와 혼합하지 않는다.
4. Node 24에서 npm ci, npm run typecheck, npm run build 실행. 비밀 설정은 백업 .env를 안전하게 사용한다.
5. AI API 과금과 스케줄러를 원치 않으면 AI_COMMUNITY_ENABLED=false, AI_WORLD_DEMO_MODE=true로 확인한 후 시작한다. 실제 운영 재개는 관리자가 결정한다.

## 운영 롤백
1. Railway에서 백업 status 파일에 기록된 이전 성공 배포를 선택해 재배포한다. 새 서비스 DB는 먼저 보존한다.
2. 기존 볼륨과 /data/ai-community.sqlite가 그대로 남아 있으므로 이전 서버는 기존 DB를 사용한다. 복원이 필요한 경우 서비스를 정지하고 production-legacy-final.sqlite로 교체한다. 관련 데이터 파일은 production-retired-data-complete.tar.gz에서 복원한다.
3. 필요할 때만 railway-variables-private.json에서 기존 운영 설정을 복원한다. 값을 채팅·공개 로그에 출력하지 않는다.
4. 홈페이지·health·로그인·기록 보존을 확인한다. 이전 서버를 다시 올리면 AI 기능도 되살아날 수 있으므로 기존 master switches를 확인한다.

## 신규 서비스 정기 백업
node --experimental-strip-types tool/backup.ts <DB경로> <백업파일경로>

Node 내장 backup API 사용. 업로드 파일도 SQLite files 테이블에 포함되므로 DB 스냅샷 한 개에 함께 보존된다. 외부 URL 자료는 원격 저장소 소유자가 별도 백업해야 한다. Railway 볼륨 백업 정책도 운영자가 주기적으로 확인한다.
