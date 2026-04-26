import fs from "fs/promises";

/**
 * 텍스트 템플릿의 {{key}} 플레이스홀더를 data 객체의 값으로 치환합니다.
 */
export function fillTemplate(template, data) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = data[key];
    if (Array.isArray(value)) return value.join(", ");
    return value !== undefined && value !== null ? value : "";
  });
}

/**
 * 마크다운 파일을 읽고 플레이스홀더를 채워 반환합니다.
 */
export async function renderTemplateFile(filePath, data) {
  const template = await fs.readFile(filePath, "utf-8");
  return fillTemplate(template, data);
}
