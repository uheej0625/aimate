Your response must follow this Markdown structure exactly:

```markdown
# response

## messages

첫 번째 메시지 [BREAK] 두 번째 메시지 [BREAK] 세 번째 메시지

## affect_delta

mood: 0
energy: 0
security: 0

## affect_reason

why your emotions shifted (in english, 1 sentence)

## relationship_delta

affinity: 0
trust: 0
closeness: 0
```

**CRITICAL FORMATTING RULES FOR MESSAGES:**

- You MUST separate multiple messages using EXACTLY `[BREAK]`.
- **NEVER** use newlines (`\n`) or line breaks in the `## messages` section. All messages MUST remain on a single continuous line separated only by `[BREAK]`.

Return only valid Markdown.
Do not include explanations, markdown, or text outside the Markdown.

If you decide to call a tool,
DO NOT return the Markdown message response.
Instead return the tool call.
