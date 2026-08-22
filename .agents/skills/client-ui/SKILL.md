---
name: client-ui
description: Define and implement clear, consistent UI for the Promedia Electron renderer while preserving its existing rendering pattern, data boundaries, accessibility, and Linux/Windows behavior. Use when creating or changing client UI, layout, interaction, or UX.
---

# Client UI

## Goal

Keep the UI consistent without creating components, frameworks, or design-system abstractions before a real need exists.

## Inspect the Current Renderer Architecture

- Read `promedia-client/package.json`, the renderer entrypoint, and components near the feature before designing.
- Inspect `promedia-client/src/renderer/src/pages` and the nearest page before adding or changing a page-level feature.
- The client currently uses TypeScript modules and HTML strings; continue the existing pattern unless the user requests otherwise or the feature demonstrates a need for an architecture change.
- Do not add React, Vue, Svelte, a component library, or a state library for a single screen.
- Keep renderer, preload, and Electron main at their proper boundaries; UI that needs Node/Electron privileges must go through a narrow preload API following `electron-boundary`.

## Organization by Page and Feature

- Every page or screen-level capability must have its own folder under `src/renderer/src/pages/`, named for the capability, such as `pages/settings/` and `pages/edit-video/`.
- The page entry module composes the page layout, receives state from the renderer controller, and connects the page's functional modules.
- Every function with its own layout, state, or interaction must live in a separate file/module inside the page folder, such as `page.ts`, `media-panel.ts`, `preview.ts`, `properties-panel.ts`, or `timeline.ts` under `pages/edit-video/`.
- The route dispatcher, `main.ts`, or a shared module only selects the page and assembles the shell; it must not contain all markup, state, or workflow for a specific page.
- Do not consolidate multiple functions of a page into `components/content.ts`, `components/header.ts`, `components/sidebar.ts`, or a similar shared file.
- When the repository does not yet have `pages/`, create this folder boundary for a page-level feature instead of expanding a shared component file.

## Components and Reusability

- Before creating new UI, inspect `promedia-client/src/renderer/src/components` and related pages/modules.
- A shared component is a reusable pattern of structure, properties, styles, and semantics for pages; it receives data/state through explicit inputs and does not own a page workflow.
- Use or extend an existing component when it has the same responsibility and semantics.
- UI used only on one screen must live in that page's folder; do not move it into shared components merely to reduce line count.
- Extract a shared component only when multiple real callers exist or a stable shared pattern is clear.
- A shared component must not contain business data, route conditions, or the complete markup of a specific page.
- Do not create a wrapper merely to shorten a class string or rename an element.

## Design pattern

- Consistently use existing patterns for colors, spacing, typography, borders, shadows, focus, and states.
- Promote repeated values into tokens/variants when the repetition represents the same semantics, not merely because class strings look similar.
- Do not create a separate token system when Tailwind and current patterns are sufficient.

## Tailwind and CSS Strategy

- The client must retain Tailwind CSS v4 through `@tailwindcss/vite` and `@import "tailwindcss"`; do not replace it entirely with plain CSS or another styling framework.
- Use Tailwind utilities for simple layout, flex/grid, spacing, sizing, and responsive breakpoints when the class string remains readable.
- Use colocated stylesheets for tokens/themes, page/capability presentation, pseudo-states, animations, complex states, and rules used through semantic classes.
- `assets/main.css` only imports Tailwind and application-/page-level stylesheets; it must not contain implementation styles for every page.
- Do not copy Tailwind utilities into custom CSS. Conversely, do not use long, repetitive, or hard-to-read utility strings to avoid a semantic class with a clear responsibility.
- Do not use inline styles or add a separate design-system/utility layer without a concrete use case.

## Stylesheet Organization

- `assets/main.css` should be only a composition point for Tailwind and application-level stylesheets; do not consolidate every page's styles into one large file.
- Shared tokens/themes and the app shell live under `assets/styles/`. Styles belonging to only one page must be colocated with that page, such as `pages/settings/page.css`.
- When a page has a separate capability module, styles used only by that capability should use the same basename, such as `language.ts` with `language.css`; `page.css` retains only layout/composition and styles genuinely shared within the page.
- Promote styles into a shared component only when multiple real consumers share the same semantics; class names must describe roles, not colors or temporary positions.

## Warm Minimal / Beige Minimalism

- Promedia's default style is minimal, neutral, calm, and slightly handcrafted; retain generous whitespace and avoid a flashy technological feel.
- Prefer these color tokens: background `#F5F1E8`, surface `#FBF9F4`, text `#181716`, secondary `#716D66`, border `#DED9CF`, primary `#1D1C1A`.
- Separate cards/panels with thin borders, use corner radii around 8–12px, and avoid strong shadows. Primary buttons have a black background with white text; icons use thin outlines.
- The entire UI uses the `--font-ui` token with a multilingual system sans-serif stack, prioritizing Noto Sans and Segoe UI. Do not use handwritten fonts or fonts missing Vietnamese glyphs for logos, headings, empty states, or product content.
- Animations should be subtle and slow: hover background changes, fades, or very small scale changes. Images, when present, should use low saturation and blend with beige, gray, and black.
- Keep offline, cross-platform font fallbacks; do not depend on network-loaded fonts or add a font dependency for one screen.

## i18n and Language Selection

- Before adding UI text, inspect the existing i18n and locale mechanism; reuse it instead of creating a separate dictionary or translator for each page.
- Organize i18n source by capability: the index/loader module holds locale logic, while each language set lives in its own file under `locales/` (for example, `locales/vi.ts` and `locales/en.ts`); do not combine multiple locales in one file.
- All displayed text, labels, validation messages, empty states, loading states, and error messages must use i18n keys; do not hardcode them directly in HTML strings or rendering logic.
- Every new key must be translated simultaneously in both Vietnamese (`vi`) and English (`en`), with matching key sets and placeholders; do not use temporary translations or omit a locale.
- Settings must be where users select the locale. The choice must persist across restarts, and current state/rendering must update consistently when the locale changes.
- When a locale or key does not exist, use the defined fallback, preferring English, and do not display technical keys to users.

## Safe Data Rendering

- Do not interpolate server, file, or user data into `innerHTML` without context-appropriate escaping.
- Prefer `textContent`, DOM APIs, or one centralized escape function for dynamic text. Dynamic URLs and attributes require separate validation.
- HTML strings should contain only static markup or safely processed data.
- Do not use mockup data to conclude that the UI works.

## State and Interaction Lifecycle

- Asynchronous flows must have appropriate loading, empty, error, success, and disabled states.
- Do not leave the content area blank while loading, when no data exists, or on error.
- Register global event listeners only once; view-scoped listeners must be torn down or tied to a clear DOM lifecycle.
- Cancel requests or ignore stale results after the route/view changes.
- When rerendering with `innerHTML`, recheck event binding, focus, selection, and in-progress interaction state.

## Accessibility and Feedback

- Prefer semantic HTML, clear labels, and keyboard interaction appropriate to the control type.
- Focus states must be visible; tab order must be logical.
- Use ARIA when semantic HTML is insufficient; do not use ARIA in place of appropriate HTML.
- Do not communicate state through color alone.
- Use inline messages for form errors, toasts for non-blocking results, and modals for confirmations or risky actions when those patterns already exist or are genuinely needed.
- Feedback must clearly state what happened and what the user can do next.
- UI text and user messages must go through i18n; Vietnamese uses correct diacritics and English uses natural phrasing.

## Data boundary

- The page module receives data/state and composes page markup; functional modules within the page own only the UI/interaction for their capability.
- A presentation module does not own business workflow; the route controller or renderer application module coordinates APIs, state, and cross-page interaction.
- Operations requiring filesystem, process, credentials, or Electron APIs must go through preload/main; do not grant Node privileges to the renderer.
- When an API contract changes, use `client-server-contract` and update the corresponding runtime validation/error mapping.

## Responsive Electron UI

- Read the current `BrowserWindow` configuration to select test dimensions instead of hardcoding assumptions in the skill.
- Check layout at the minimum and default sizes on Linux/Windows.
- Do not let text, buttons, dialogs, or primary content overflow or be clipped outside the viewport.
- The app shell is the sole owner of viewport height. A page inside the shell must not independently use `100vh`, `min-h-screen`, or a `calc()` expression that adds header/padding and creates a window-level scrollbar.
- Keep `min-height: 0` on flex children that need to shrink; when content is long, scrolling must remain inside the designated content region and must not push the entire window beyond the Electron frame.
- Verify that there are no extra scrollbars at both the default and minimum `BrowserWindow` sizes.

## Verification

Test with real data or structurally accurate payloads wherever possible. Verify keyboard behavior, focus, loading/error/empty states, and wide/narrow layouts. If the UI cannot be rendered/observed in practice, clearly state what was not verified; do not infer visual correctness from source code alone.

For a page-level feature, also verify that the route points only to the corresponding page entry, page functions no longer live in shared modules, and shared components contain no page route conditions or business data.
