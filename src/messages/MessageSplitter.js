import { GENERATED_IMAGE_TAG_REGEX } from "../tools/imageReferenceUtils.js";

const BOUNDARIES = [
  /\r?\n[ \t]*\r?\n/g,
  /\r?\n/g,
  /[.!?。！？]["'”’)\]]*\s+/g,
  /\s+/g,
];

/** Limits rendered text length while preserving attachment tags and fenced code. */
export class MessageSplitter {
  split(text, maxLength = 1900) {
    if (!Number.isInteger(maxLength) || maxLength < 32 || maxLength > 2000) {
      throw new RangeError(
        "messages.maxLength must be an integer from 32 to 2000.",
      );
    }
    if (renderedLength(text) <= maxLength) return [text];

    const messages = [];
    let current = "";
    const flush = () => {
      if (current.trim()) messages.push(current.trim());
      current = "";
    };
    const append = (part) => {
      if (renderedLength(current) + renderedLength(part) > maxLength) {
        flush();
      }
      current += part;
    };

    for (const segment of segments(text)) {
      if (!segment.fence || renderedLength(segment.text) <= maxLength) {
        const parts = segment.fence
          ? [segment.text]
          : splitText(segment.text, maxLength, BOUNDARIES);
        for (const [index, part] of parts.entries()) {
          if (index > 0) flush();
          append(part);
        }
        continue;
      }

      // Keep the language and fence when they fit, reserving both wrappers.
      let opening = segment.opening;
      let fence = segment.fence;
      if (renderedLength(opening) + fence.length + 3 > maxLength) {
        fence = fence.length * 2 + 4 > maxLength ? "```" : fence;
        opening = `${fence}\n`;
      }
      const closing = `\n${fence}`;
      const bodyLimit = maxLength - renderedLength(opening) - closing.length;
      flush();
      const bodies = splitText(segment.body, bodyLimit, [/\r?\n/g]);
      for (const body of bodies.length ? bodies : [""]) {
        messages.push(`${opening}${body}${closing}`);
      }
    }
    flush();
    return messages;
  }
}

function imagePattern() {
  // Do not mutate the shared resolver regex's lastIndex.
  return new RegExp(GENERATED_IMAGE_TAG_REGEX);
}

function renderedLength(text) {
  // The attachment resolver removes these tags before channel.send.
  return text.replace(imagePattern(), "").length;
}

function* segments(text) {
  const openingPattern = /^[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*\r?\n/gm;
  let offset = 0;
  let match;
  while ((match = openingPattern.exec(text)) !== null) {
    if (match.index > offset) {
      yield { text: text.slice(offset, match.index) };
    }
    const fence = match[1];
    const bodyStart = openingPattern.lastIndex;
    const closingPattern = new RegExp(
      `^[ \\t]{0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?$`,
      "gm",
    );
    closingPattern.lastIndex = bodyStart;
    const closing = closingPattern.exec(text);
    const end = closing ? closingPattern.lastIndex : text.length;
    yield {
      text: text.slice(match.index, end),
      opening: match[0],
      fence,
      body: text.slice(bodyStart, closing ? closing.index : end),
    };
    offset = end;
    openingPattern.lastIndex = end;
  }
  if (offset < text.length) yield { text: text.slice(offset) };
}

function splitText(text, maxLength, boundaries) {
  const parts = [];
  while (renderedLength(text) > maxLength) {
    const end = fittingEnd(text, maxLength);
    const prefix = text.slice(0, end);
    // Mask attachment tags so punctuation/whitespace inside them isn't a boundary.
    const visible = prefix.replace(imagePattern(), (tag) =>
      "\0".repeat(tag.length),
    );
    let cut = end;
    for (const pattern of boundaries) {
      pattern.lastIndex = 0;
      let match;
      let boundary = 0;
      while ((match = pattern.exec(visible)) !== null) {
        boundary = pattern.lastIndex;
      }
      if (boundary > 0) {
        cut = boundary;
        break;
      }
    }
    parts.push(text.slice(0, cut));
    text = text.slice(cut);
  }
  if (text) parts.push(text);
  return parts;
}

function fittingEnd(text, maxLength) {
  let offset = 0;
  let remaining = maxLength;
  for (const match of text.matchAll(imagePattern())) {
    const length = match.index - offset;
    if (length > remaining) return safeEnd(text, offset + remaining);
    remaining -= length;
    offset = match.index + match[0].length;
  }
  return safeEnd(text, Math.min(text.length, offset + remaining));
}

function safeEnd(text, end) {
  // String.length matches the existing transport guard; keep surrogate pairs intact.
  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  return previous >= 0xd800 &&
    previous <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
    ? end - 1
    : end;
}
