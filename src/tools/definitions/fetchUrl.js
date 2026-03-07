import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

/** @type {import('../ToolRegistry.js').ToolDef} */
export default {
  name: "fetch_url",
  enabled: true,
  platforms: ["*"],
  requires: [],

  declaration: {
    name: "fetch_url",
    description:
      "Fetches the text content of a webpage from a URL. Use for summarizing links, reading news, or checking page content. Do not use on image or video URLs.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL of the webpage to fetch.",
        },
        maxLength: {
          type: "number",
          description:
            "Maximum text length to return (default: 4000). Request a smaller value for long documents.",
        },
      },
      required: ["url"],
    },
  },

  /**
   * @param {{ url: string, maxLength?: number }} args
   */
  execute: async ({ url, maxLength = 4000 }) => {
    let response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      return { error: `Request failed: ${err.message}` };
    }

    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get("content-type") ?? "";

    // 응답 크기 제한 (기본 5MB) — 비정상적으로 큰 페이지 차단
    const MAX_BYTES = 5 * 1024 * 1024;
    const contentLength = Number(response.headers.get("content-length"));
    if (contentLength && contentLength > MAX_BYTES) {
      return {
        error: `Response too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB (limit: 5MB)`,
      };
    }

    // Block binary content types that cannot be meaningfully read as text
    if (
      contentType.startsWith("image/") ||
      contentType.startsWith("video/") ||
      contentType.startsWith("audio/") ||
      contentType.includes("octet-stream")
    ) {
      return {
        error: `Binary content is not supported (${contentType}). Use multimodal features for image analysis.`,
      };
    }

    // Decode response body with correct charset to handle non-UTF-8 pages (e.g. EUC-KR)
    const charset = contentType.match(/charset=([^\s;]+)/)?.[1]?.toLowerCase();
    let raw;
    if (charset && charset !== "utf-8") {
      const buffer = await response.arrayBuffer();
      try {
        raw = new TextDecoder(charset).decode(buffer);
      } catch {
        // Fall back to UTF-8 if the declared charset is unrecognized
        raw = new TextDecoder("utf-8").decode(buffer);
      }
    } else {
      raw = await response.text();
    }

    let text;
    if (contentType.includes("html")) {
      text = extractReadableText(raw, url);
    } else {
      text = raw.trim();
    }

    const capped = sliceAtSentence(text, maxLength);
    const truncated = text.length > maxLength;

    if (response.url !== url) {
      console.log(`[fetch_url] Redirected: ${url} -> ${response.url}`);
    }

    return {
      url: response.url,
      length: text.length,
      truncated,
      content: capped,
    };
  },
};

/**
 * Extracts the main readable text from an HTML string using Readability.
 * Falls back to basic tag stripping if Readability cannot parse the page.
 *
 * @param {string} html - Raw HTML string
 * @param {string} url - Original URL, used by JSDOM for resolving relative links
 * @returns {string} Extracted plain text
 */
function extractReadableText(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article?.textContent) {
      return article.textContent.replace(/\s+/g, " ").trim();
    }
  } catch (err) {
    console.warn(
      `[fetch_url] Readability failed, falling back to tag stripping: ${err.message}`,
    );
  }

  return stripTags(html);
}

/**
 * Removes HTML tags and decodes common HTML entities from a string.
 *
 * @param {string} html - Raw HTML string
 * @returns {string} Plain text with tags removed
 */
function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Slices text to maxLength, trying to cut at a sentence boundary
 * rather than mid-sentence. Falls back to a hard cut if no boundary is found
 * within the last 20% of the allowed length.
 *
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function sliceAtSentence(text, maxLength) {
  if (text.length <= maxLength) return text;

  const cutoff = text.slice(0, maxLength);
  const lastPeriod = Math.max(
    cutoff.lastIndexOf(". "),
    cutoff.lastIndexOf(".\n"),
    cutoff.lastIndexOf("\n"),
  );

  if (lastPeriod > maxLength * 0.8) {
    return cutoff.slice(0, lastPeriod + 1);
  }

  return cutoff;
}
