/* 집필실 설정 — 내 Firebase·구글 드라이브 값만 여기에 넣어요 (DRIVE_SETUP.md 참고)
 * DEFAULT_CLIENT_ID: 내 Firebase(=구글 클라우드) 프로젝트에서 만든 OAuth 클라이언트 ID (웹 애플리케이션 · 공개 값이라 비밀이 아님).
 *   비워 두면 앱 [설정]에서 기기마다 붙여 넣어요. 앱 [설정]에서 다른 ID를 입력하면 그 값이 우선합니다 (기기에 저장).
 *   클라이언트 보안 비밀(secret)은 절대 넣지 마세요 — 이 앱은 사용하지 않습니다.
 * APK_URL: 직접 만든 안드로이드 앱(APK) 내려받기 주소. 비워 두면 APK 안내를 숨겨요.
 */
window.YW_CONFIG = {
  DEFAULT_CLIENT_ID: "",
  DRIVE_ROOT_NAME: "집필실",
  SCOPE: "https://www.googleapis.com/auth/drive.file",
  APK_URL: ""
};
