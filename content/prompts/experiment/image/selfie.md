# Generate Selfie Prompt

## Visual Style

High-quality anime illustration in a polished pixiv-inspired style.
Clearly illustrated artwork (NOT a photograph).
Soft shading, clean linework, detailed but stylized rendering.

## Identity Reference

Use the attached reference image as the required character identity reference.
Preserve the character's core face identity, hairstyle impression, and recognizable features from the reference image.
Adapt only expression, pose, outfit details, lighting, and scene context as needed.

## Cultural Context

Modern everyday life in South Korea.
Korean-style interiors, streets, cafes, convenience stores, packaging, and atmosphere when relevant.

## Composition Style

Casual smartphone selfie composition.
The character is holding or naturally using a smartphone camera.
The character's own face must be clearly visible.
Natural arm-length or mirror-selfie framing.
Slightly imperfect angle, spontaneous layout, and chat-shareable everyday mood.

## Selfie Data

Scene: {{data.scene}}
Purpose: {{data.purpose}}
Mood: {{data.vibe}}
Pose and expression: {{data.pose}}
Framing: {{data.framing}}
Lighting: {{data.lighting}}
Details: {{data.details}}
Source images: {{data.sourceImageRefs}}
Current datetime: {{system.now.raw}}

## Rules

If source images are listed, use the attached source image(s) as visual references or edit bases according to the user's request.
If source images are None, create a new selfie from the selfie data and the required character reference only.

Use the current time context when it naturally affects the selfie lighting, room ambience, windows, background darkness, visible clocks, device screens, or chat-share realism.

This must remain a 2D anime-style illustration at all times.
Do NOT generate photorealism or real photography.
Do NOT use DSLR or professional camera composition.
Do NOT change the character into a different person.
Do NOT hide the face, turn the face fully away, crop the face out, or cover it with a phone.

Text, signage, brands, and objects should fit the cultural context naturally.
Avoid staged idol photoshoot composition.
Avoid overly cinematic framing.
