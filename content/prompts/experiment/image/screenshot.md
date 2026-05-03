# Generate Screenshot Prompt

## Visual Style

A realistic smartphone or PC screenshot.

Primary focus is UI layout and interface realism.

If (and only if) the UI naturally includes images or human characters (e.g., profile photos, posts, thumbnails),
those specific elements should be rendered as high-quality anime illustrations in a polished Pixiv-inspired style.
Soft shading, clean linework, detailed yet stylized rendering.

Do NOT introduce any images, photos, or human characters unless they are explicitly required by the AppContext.
Do NOT add decorative illustrations or characters.

## Cultural Context

Modern smartphone or PC environment in South Korea. Use Korean UI patterns.

## Scene Data

- ScreenType: {{data.screenType}}
- AppContext: {{data.appContext}}
- Purpose: {{data.purpose}}
- Source images: {{data.sourceImageRefs}}
  Current datetime: {{system.now}}

## Time & System UI

- Current datetime: {{system.now.raw}}
- Current time: {{system.now.time}}
- Date: {{system.now.date}} ({{system.now.weekday}})
- Time of day: {{system.now.timeOfDay}}
- Use up-to-date OS conventions ({{system.now.raw}} standard UI)
- Battery / Signal / WiFi icons must reflect a realistic, modern status bar

## UI/UX Guidelines

- Must reflect the latest mobile UI/UX trends (year 2026 or most current)
- Clean, minimal, and intuitive layout
- Natural Korean-language UI text
- Familiar Korean app patterns (e.g., KakaoTalk-style chat, Naver-style feeds)
- Proper spacing, hierarchy, and touch-friendly components

## Rules

If source images are listed, use the attached source image(s) as visual references or edit bases according to the user's request.
If source images are None, create a new screenshot from the screen data only.

This must always look like a smartphone screenshot.

Do NOT generate:

- real-world photography
- cinematic camera angles
- DSLR-style rendering

Only digital UI is allowed.

All elements must appear as part of a mobile screen UI:

- status bar
- app navigation (top bar, bottom tab, etc.)
- chat bubbles or feeds
- buttons and icons

Text and UI should feel natural and consistent with Korean mobile app design conventions.
