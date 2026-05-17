# Generate Photo Prompt

## Visual Style

High-quality anime illustration in a polished pixiv-inspired style.
Clearly illustrated artwork (NOT a photograph).
Soft shading, clean linework, detailed but stylized rendering.

## Cultural Context

Modern everyday life in South Korea.
Korean-style interiors, streets, cafes, convenience stores, packaging, and atmosphere when relevant.

## Composition Style

Casual smartphone snapshot composition.
Natural framing as if quickly captured and shared in chat.
Slightly imperfect angle and spontaneous layout.
Candid everyday perspective.

## Scene Data

Scene: {{data.scene}}
Purpose: {{data.purpose}}
Mood: {{data.vibe}}
Human presence: {{data.humanPresence}}
Lighting: {{data.lighting}}
Details: {{data.details}}
Source images: {{data.sourceImageRefs}}
Current datetime: {{system.now.raw}}

## Rules

If source images are listed, use the attached source image(s) as visual references or edit bases according to the user's request.
If source images are None, create a new image from the scene data only.

Use the datetime context when it naturally affects the scene, lighting, sky, open shops, room ambience, visible clocks, device screens, or chat-share realism.
If the user explicitly asks for a different time, follow the user's requested time instead.
Do not show a bright daytime scene when the current time context indicates night unless the scene is clearly indoors with artificial lighting or the user requested daylight.

This must remain a 2D anime-style illustration at all times.
Do NOT generate photorealism or real photography.
Do NOT use DSLR or real camera appearance.
Use casual snapshot composition only, not real camera rendering.

Text, signage, brands, and objects should fit the cultural context naturally.
Avoid staged composition.
Avoid overly cinematic framing.
