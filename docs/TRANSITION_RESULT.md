# 전환 결과 · 2026-10-19

## 후속 콘텐츠 정정
사용자 요청에 따라 임의로 추가했던 5종을 도감·홈·관리 목록에서 내리고 복구 가능한 보관 상태로 전환했다. 신규 DB에 예시 5종을 자동 등록하는 코드를 제거했다. 테스트용 자료는 tests/fixtures로 분리하여 운영에 포함하지 않는다. 현재 요청 범위는 기존 택배 괴이 1종과 기존 이미지 1장이다. 프로젝트·백업·현재 대화에서 해당 원본을 확인할 수 없어 자료를 요청했으며, 원본 수신 전에는 대체 설정·이미지를 생성하지 않는다. 관련 보존 경로: D:\THE-ANOMALY-backups\before-content-correction-20261019. 후속 테스트 7/7 통과.

## 최초 전환 기록

- 서비스: https://the-anomaly.up.railway.app (2026-10-19 이전 주소: web-production-0a945.up.railway.app)
- 새 배포: abbe7929-df24-4263-8bfc-f8001e84f04b / SUCCESS.
- 이전 배포: f534d13f-0aa7-4b00-8407-29aea045f2da / REMOVED. 이전 컨테이너와 AI 스케줄러가 종료되었다. 배포 기록과 운영 데이터는 영구 삭제하지 않았다.
- 동일 Railway 서비스·도메인·영구 볼륨을 유지하고 새 DB /data/the-anomaly.sqlite를 생성했다.
- 기존 /data/ai-community.sqlite 유지. 전환 전 및 이전 컨테이너 종료 후 DB 백업과 전체 퇴역 데이터 압축본을 D드라이브에 보존했다.
- 신규/기존 운영 DB 모두 PRAGMA integrity_check = ok. 신규 개체 5종 확인.
- 관리자 접속 정보: D:\THE-ANOMALY-backups\THE-ANOMALY-admin-private.txt (공유·커밋 금지).
- npm run typecheck 통과. npm test: 6/6 통과. npm run build 및 공개 파일 비밀값 검사 통과. npm audit: 취약점 0.
- 실제 HTTPS에서 health, 홈페이지, 빌드 자산, 개체 5종, 기밀 차단, 기존 시뮬레이션 API 404, 관리자 로그인·관리 API·로그아웃 검증 통과.
- 연결 가능한 브라우저가 없어서 실제 화면 렌더링·클릭·모바일 시각 검증은 완료하지 못했다. 반응형 CSS와 인터랙션을 구현했고 이 검증 한계를 인계한다.
- 초기 관리자 seed 값은 새 계정 생성에 사용했으며 이미 ADMIN이 존재하면 재실행 시 계정을 재생성하거나 비밀번호를 변경하지 않는다.
- 운영 키는 새 서버에서 사용하지 않는다. 기존 AI 공급자 키 폐기와 구독 해지는 수행하지 않았다.
