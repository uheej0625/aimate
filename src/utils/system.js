import { execSync } from "child_process";

export function fixWindowsEncoding() {
  if (process.platform === "win32") {
    try {
      // Windows 환경에서 터미널의 코드 페이지를 UTF-8로 변경 (로그 한글 깨짐 방지용)
      execSync("chcp 65001", { stdio: "ignore" });
    } catch (e) {}
  }
}
