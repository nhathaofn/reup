---
name: client-ui
description: Define and implement clear, consistent UI for the TediaPros Electron renderer while preserving its React and TypeScript rendering pattern, data boundaries, accessibility, Vietnamese i18n, and Windows behavior. Use when creating or changing client UI, layout, interaction, or UX.
---

# Client UI

## Goal

Keep the UI consistent without creating components, frameworks, or design-system abstractions before a real need exists.

## Inspect the Current Renderer Architecture

- Read root `package.json`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, the feature registry, and components near the feature before designing.
- The client currently uses React 19, TypeScript, TSX, feature modules, and semantic CSS; continue that pattern unless the user requests an architecture change.
- Do not add another UI framework, component library, or state library for a single screen.
- Keep renderer, preload, and Electron main at their proper boundaries; UI that needs Node/Electron privileges must go through a narrow preload API following `electron-boundary`.

## Organization by Page and Feature

- Registered capabilities live under `src/renderer/src/features/<feature-id>/` and expose their renderer module through the existing registry.
- Existing core screens under `src/renderer/src/components/` may remain there; do not move them only to impose a new folder convention.
- Split a screen when a child owns a distinct layout/interaction responsibility, not merely because the parent is long.
- `App.tsx` owns startup gating, shell composition, and tab selection; it must not absorb a feature's processing workflow.

## Components and Reusability

- Before creating new UI, inspect `src/renderer/src/components`, `src/renderer/src/features`, and related modules.
- A shared component is a reusable pattern of structure, properties, styles, and semantics for pages; it receives data/state through explicit inputs and does not own a page workflow.
- Use or extend an existing component when it has the same responsibility and semantics.
- UI used only on one screen must live in that page's folder; do not move it into shared components merely to reduce line count.
- Extract a shared component only when multiple real callers exist or a stable shared pattern is clear.
- A shared component must not contain business data, route conditions, or the complete markup of a specific page.
- Do not create a wrapper merely to shorten a class string or rename an element.

## Design pattern

- Consistently use existing patterns for colors, spacing, typography, borders, shadows, focus, and states.
- Promote repeated values into tokens/variants when the repetition represents the same semantics, not merely because class strings look similar.
- Reuse the existing CSS token system and promote a value only when it represents a repeated semantic role.

## React and CSS Strategy

- Use TSX for structure and semantic CSS classes for presentation. Do not introduce Tailwind or another styling framework without an explicit product requirement.
- Keep application tokens and small shell-wide rules in `src/renderer/src/styles.css`.
- Colocate a substantial feature stylesheet with its feature when doing so gives the styles a clearer owner; import it from the feature entry.
- Do not use inline styles or add a separate design-system/utility layer without a concrete use case.

## Stylesheet Organization

- Shared tokens/themes and the app shell remain in `src/renderer/src/styles.css`; avoid expanding it with a large new feature stylesheet.
- Styles belonging to only one registered feature should live beside that feature, using a discoverable name such as `styles.css`.
- Promote styles into a shared component only when multiple real consumers share the same semantics; class names must describe roles, not colors or temporary positions.

## Warm Minimal / Beige Minimalism

- TediaPros's default style is minimal, neutral, calm, and slightly handcrafted; retain generous whitespace and avoid a flashy technological feel.
- Prefer these color tokens: background `#F5F1E8`, surface `#FBF9F4`, text `#181716`, secondary `#716D66`, border `#DED9CF`, primary `#1D1C1A`.
- Separate cards/panels with thin borders, use corner radii around 8–12px, and avoid strong shadows. Primary buttons have a black background with white text; icons use thin outlines.
- The entire UI uses the `--font-ui` token with a multilingual system sans-serif stack, prioritizing Noto Sans and Segoe UI. Do not use handwritten fonts or fonts missing Vietnamese glyphs for logos, headings, empty states, or product content.
- Animations should be subtle and slow: hover background changes, fades, or very small scale changes. Images, when present, should use low saturation and blend with beige, gray, and black.
- Keep offline Windows font fallbacks; do not depend on network-loaded fonts or add a font dependency for one screen.

## Vietnamese i18n

- Before adding UI text, inspect the existing i18n and locale mechanism; reuse it instead of creating a separate dictionary or translator for each page.
- The current locale set is Vietnamese (`vi`) only. Keep the app-shell dictionary in `src/renderer/src/i18n/vi.ts` and move larger capability dictionaries beside their owner when needed.
- All new or touched displayed text, labels, validation messages, empty states, loading states, and error messages must use i18n keys; do not hardcode them in TSX.
- Use deterministic `vi` fallback and return a safe Vietnamese fallback string instead of displaying a technical key.
- Do not add a language selector or locale persistence until a second locale is explicitly requested.

## Safe Data Rendering

- Render ordinary dynamic text through React's escaped JSX expressions. Validate dynamic URLs and attributes separately; do not use `dangerouslySetInnerHTML` without a reviewed sanitizer and a concrete need.
- Do not use mockup data to conclude that the UI works.

## State and Interaction Lifecycle

- Asynchronous flows must have appropriate loading, empty, error, success, and disabled states.
- Do not leave the content area blank while loading, when no data exists, or on error.
- Register global event listeners in a scoped React effect and return cleanup for the exact listener.
- Cancel requests or ignore stale results after the component unmounts or its operation identity changes.

## Accessibility and Feedback

- Prefer semantic HTML, clear labels, and keyboard interaction appropriate to the control type.
- Focus states must be visible; tab order must be logical.
- Use ARIA when semantic HTML is insufficient; do not use ARIA in place of appropriate HTML.
- Do not communicate state through color alone.
- Use inline messages for form errors, toasts for non-blocking results, and modals for confirmations or risky actions when those patterns already exist or are genuinely needed.
- Feedback must clearly state what happened and what the user can do next.
- UI text and user messages must go through i18n and use correct Vietnamese diacritics.

## Data boundary

- The page module receives data/state and composes page markup; functional modules within the page own only the UI/interaction for their capability.
- A presentation module does not own business workflow; the route controller or renderer application module coordinates APIs, state, and cross-page interaction.
- Operations requiring filesystem, process, credentials, or Electron APIs must go through preload/main; do not grant Node privileges to the renderer.
- When an API contract changes, use `client-server-contract` and update the corresponding runtime validation/error mapping.

## Responsive Electron UI

- Read the current `BrowserWindow` configuration to select test dimensions instead of hardcoding assumptions in the skill.
- Check layout at the minimum and default Windows `BrowserWindow` sizes.
- Do not let text, buttons, dialogs, or primary content overflow or be clipped outside the viewport.
- The app shell is the sole owner of viewport height. A page inside the shell must not independently use `100vh`, `min-h-screen`, or a `calc()` expression that adds header/padding and creates a window-level scrollbar.
- Keep `min-height: 0` on flex children that need to shrink; when content is long, scrolling must remain inside the designated content region and must not push the entire window beyond the Electron frame.
- Verify that there are no extra scrollbars at both the default and minimum `BrowserWindow` sizes.

## Verification

Test with real data or structurally accurate payloads wherever possible. Verify keyboard behavior, focus, loading/error/empty states, and wide/narrow layouts. If the UI cannot be rendered/observed in practice, clearly state what was not verified; do not infer visual correctness from source code alone.

For a page-level feature, also verify that the route points only to the corresponding page entry, page functions no longer live in shared modules, and shared components contain no page route conditions or business data.
