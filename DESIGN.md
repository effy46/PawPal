---
name: PawPal
description: A tiny desktop dog that helps you pause before you burn out.
colors:
  warm-off-white: "#faf6ee"
  paper-edge: "#f1ebde"
  bubble-cream: "#fffcf4"
  warm-near-black: "#2d261f"
  ink-soft: "#6e6457"
  ink-faint: "#998d7c"
  pencil-outline: "#24201c"
  deep-teal-green: "#244e45"
  fresh-green: "#10a37f"
  amber-brown: "#b67d3a"
  amber-brown-deep: "#a26d2c"
  warm-rust: "#a85a35"
  error-rust: "#a8462d"
  review-amber: "#7b551f"
typography:
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1.2
  bubble-title:
    fontFamily: "Inter, 'Huninn', 'SF Pro Rounded', 'PingFang SC', ui-rounded, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.15
  handwriting:
    fontFamily: "'Comic Sans MS', 'Chalkboard SE', 'Marker Felt', ui-rounded, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 560
    lineHeight: 1.34
rounded:
  control: "6px"
  surface: "8px"
  card: "10px"
  bubble: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.amber-brown}"
    textColor: "#ffffff"
    rounded: "5px"
    height: "26px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "{colors.amber-brown-deep}"
  button-secondary:
    backgroundColor: "#ffffff"
    textColor: "{colors.warm-near-black}"
    rounded: "5px"
    height: "26px"
    padding: "0 10px"
  bubble-button:
    backgroundColor: "#f3eee5"
    textColor: "#3b3025"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  bubble-button-primary:
    backgroundColor: "{colors.deep-teal-green}"
    textColor: "#fffaf0"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.warm-near-black}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 10px"
  stat-card:
    backgroundColor: "#ffffff85"
    textColor: "{colors.warm-near-black}"
    rounded: "{rounded.card}"
    padding: "12px 14px"
  pet-card:
    backgroundColor: "#3c2f1c0a"
    textColor: "{colors.warm-near-black}"
    rounded: "{rounded.card}"
    padding: "12px 10px 10px"
---

# Design System: PawPal

## 1. Overview

**Creative North Star: "PawPal"**

PawPal's UI is the pet's world extending onto your desk: warm paper surfaces, soft rounded controls, and a hand-drawn comic-bubble layer that belongs to the dog itself. The system has two registers that share one warmth. The **pet overlay** (thought bubbles, task badges, popovers) is playful and comic-like — bubble cream surfaces, pencil-ink outlines, organic blob shapes, handwriting type. The **settings dashboard** is quiet stationery — a warm paper page with amber-brown accents, hairline rules, and small friendly controls. Each pet (Hachi, Xiao Ji Mao, White Line Dog, custom GIFs) is its own artwork; everything around it follows this one shared system.

This system explicitly rejects the **corporate SaaS dashboard** (no gray admin chrome, no cold neutrals, no dense data-tool severity) and the **generic Electron app** (no default-looking widgets, no native-ish gray panels, no mismatched controls). Components lean soft and friendly: rounded, paper-toned, slightly playful — but charm lives in the pet art and small touches, never in decorated chrome.

**Key Characteristics:**
- Warm paper everywhere; no pure grays, no cold whites
- Two registers, one world: comic bubbles for the pet, quiet stationery for settings
- Small, soft, friendly controls (26–28px) with pill and rounded-rect shapes
- Hand-drawn touches (pencil outlines, sticker shadows, tape, stamps) reserved for the pet/journal layer
- Gentle by default: small motion, soft state colors, nothing loud or urgent

## 2. Colors

A warm, low-saturation palette anchored on paper tones and brown-green inks; every neutral is tinted warm.

### Primary
- **Amber Brown** (#b67d3a): the settings accent. Primary buttons, selected pet cards, active toggles, focused input borders, text links. Soft tint `rgba(182, 125, 58, 0.14)` backs selected and welcome surfaces. Darkens to **#a26d2c** on hover.
- **Deep Teal-Green** (#244e45): the pet world's action color. Primary bubble buttons, agent-working status text, focus badge ink. Used sparingly — it signals "the dog is asking or telling you something."

### Secondary
- **Fresh Green** (#10a37f): completion only — the ✓ dot on finished agent task bubbles, hover tint on context-menu items.
- **Review Amber** (#7b551f): agent "reviewing/waiting" status ink (border tint `rgba(182, 125, 58, 0.18–0.24)`).
- **Warm Rust** (#a85a35 settings / #a8462d bubbles): warnings, errors, destructive hovers. Backed by tints (`rgba(168, 90, 53, 0.08–0.12)`), never alarm-red.

### Neutral
- **Warm Off-White** (#faf6ee): the settings page paper. Edge tone **#f1ebde** for adjacent panels.
- **Bubble Cream** (#fffcf4): the pet overlay surface, almost always at 0.9–0.96 alpha so the desktop breathes through.
- **Warm Near-Black** (#2d261f): primary text in the bubble world; settings uses the sibling **#2a241d**.
- **Ink Soft** (#6e6457) and **Ink Faint** (#998d7c): secondary and tertiary text, labels, hints.
- **Pencil Outline** (#24201c): the 2px hand-drawn border of comic popovers and count badges.
- **Rules**: hairlines are `rgba(60, 47, 28, 0.1)`, strong rules `rgba(60, 47, 28, 0.18)`; white overlays (`rgba(255,255,255,0.34–0.55)`) lift rows and previews off the paper.

### Named Rules
**The Two-Paper Rule.** Settings lives on Warm Off-White (#faf6ee); the pet world lives on translucent Bubble Cream (#fffcf4). Never swap them, never introduce a third surface tone.

**The Warm Neutral Rule.** No pure gray anywhere. Every neutral — text, border, shadow color — is tinted toward warm brown (`rgba(60, 47, 28, …)` or `rgba(45, 38, 31, …)`), never `rgba(0, 0, 0, …)`.

**The Two-Accent Rule.** Amber Brown belongs to settings; Deep Teal-Green belongs to the pet's bubbles. Don't use the green in settings chrome or the ochre inside thought bubbles.

## 3. Typography

**UI Font:** Inter (with PingFang SC / Hiragino Sans GB / Microsoft YaHei for Chinese, system-ui fallback)
**Bubble Title Font:** Inter + Huninn (zh-CN swaps to Huninn-led rounded stack)
**Handwriting Font:** Comic Sans MS / Chalkboard SE / Marker Felt (ui-rounded fallback)
**Mono:** ui-monospace / Menlo / Consolas, for CLI snippets and diagnostics only

**Character:** One friendly sans carries the whole UI; the handwriting stack is the dog's own voice and appears only where the dog "speaks" or "writes."

### Hierarchy
- **Title** (700, 24px, 1.1): the settings page title and journal month header (the latter in handwriting).
- **Headline** (600, 14px, uppercase, +0.02em): settings group titles in Ink Soft.
- **Body** (400, 13.5px, 1.4): settings prose and row labels; bubbles run 12–13px.
- **Label** (600, 11–12px, 1.2): stat labels, hints, badges, status lines in Ink Soft/Faint.
- **Stat value** (400, 28px, 1, tabular-nums): dashboard numbers.

Chinese (zh-CN) drops uppercase transforms and heavy weights (600→400) — bilingual layouts are first-class; never rely on uppercase or letter-spacing for hierarchy alone.

### Named Rules
**The Handwriting Boundary Rule.** The Comic Sans/Marker Felt stack lives exclusively inside the dog's thought-bubble popovers and journal headings. It is forbidden in buttons, labels, settings, or any functional control.

**The Tabular Numbers Rule.** Every number that updates (stats, countdowns, steppers, diagnostics) sets `font-variant-numeric: tabular-nums`.

## 4. Elevation

Two-tier elevation, flat by default. The settings page is paper-flat: depth comes from hairline rules and translucent white overlays, not shadows. Floating UI earns a **soft ambient shadow**; the hand-drawn comic layer gets a **hard sticker shadow** instead — a small offset shadow with zero blur, like a sticker pressed onto the screen.

### Shadow Vocabulary
- **Ambient low** (`box-shadow: 0 6px 16px rgba(45, 38, 31, 0.14)`): tooltips, focus badge.
- **Ambient mid** (`box-shadow: 0 8px 22px rgba(45, 38, 31, 0.12)` to `0 10px 24px rgba(45, 38, 31, 0.16)`): context menus, agent task cards, help tooltips.
- **Sticker** (`box-shadow: 2px 3px 0 rgba(36, 32, 28, 0.18)`, small elements `1px 2px 0 rgba(36, 32, 28, 0.12)`): comic popovers, count badges — always paired with the 2px Pencil Outline border.
- **Glow status** (`filter: drop-shadow(0 6px 10px …)` in green/amber/rust at ≤0.24 alpha): the pet sprite's agent-status aura.

### Named Rules
**The Sticker Shadow Rule.** Hard offset shadows (zero blur) appear only on Pencil-Outlined comic elements. Soft ambient shadows never exceed 24px blur or 0.16 alpha. Settings controls cast no shadows at all.

## 5. Components

Soft and friendly: small paper-toned controls with rounded corners and pill silhouettes; playfulness comes from shape and warmth, not decoration.

### Buttons
- **Shape:** rounded rectangle (5px), 26px tall, 12.5px/500 text.
- **Primary:** Amber Brown fill, white text; hover deepens to #a26d2c.
- **Secondary:** white fill, strong-rule border; hover swaps border to Amber Brown. Disabled fades to 0.55 opacity.
- **Bubble buttons:** pills (999px) inside speech bubbles — putty `#f3eee5` default, Deep Teal-Green primary with warm-white text, danger in soft rust tint `#f2d9d1`.
- **Chip-add button:** dashed pill that solidifies and turns Amber Brown on hover.

### Chips
- **Style:** 4px radius, warm tint `rgba(60, 47, 28, 0.06)`, 12px text, inline × button that turns Warm Rust on hover. Live inside a white bordered well (6px radius).

### Cards / Containers
- **Corner Style:** 8px for rows/blocks/diag cards, 10px for stat and pet-picker cards, 11px for agent task cards, 16px for speech bubbles.
- **Background:** translucent white overlays (0.34–0.55) on settings paper; Bubble Cream at 0.9–0.96 in the pet world.
- **Shadow Strategy:** flat in settings; ambient or sticker per Elevation rules when floating.
- **Border:** hairline rule; 1.5px on selectable pet cards (Amber Brown when selected); 2px Pencil Outline on comic popovers.
- **Internal Padding:** 10–14px.

### Inputs / Fields
- **Style:** white fill, strong-rule 1px border, 6px radius, 28px tall.
- **Focus:** border becomes Amber Brown; no glow, no outline ring.
- **Stepper:** white pill-box with − / value / + segments and tabular numbers; **Toggle:** 34×20px pill, Amber Brown when on, 160ms thumb slide; **Select:** white with CSS-triangle caret in Ink Soft.
- **Placeholder:** `rgba(153, 141, 124, 0.78)`.

### Navigation
- **Settings:** a single quiet page — uppercase group titles in a left column (92px), content right; disclosure rows (uppercase, caret) reveal diagnostics. No tabs, no sidebar chrome.
- **Pet context menu:** Bubble Cream rounded panel (11px), hover rows tint Fresh Green at 12%; danger rows tint rust.

### Speech & Task Bubbles (signature)
The dog communicates through a layered bubble system. **Speech bubble:** Bubble Cream rounded-rect (16px) with a CSS triangle tail, centered 13px text, pill action buttons. **Comic thought popover:** an organic blob (`border-radius: 50% 50% 49% 51% / 55% 51% 49% 45%`) with 2px Pencil Outline, sticker shadow, two trailing outlined circles as the thought-tail, handwriting body text, uppercase bubble-title header colored by agent status (working green / reviewing amber / error rust). **Task badges & cards:** small cream cards (11px radius) with a status dot that becomes a Fresh Green ✓ when complete. Status is conveyed by ink and border-tint color shifts, never by loud fills.

### Monthly Journal (signature)
A scrapbook spread on kraft-paper textures: washi-tape strips (beige + dotted sage), handwriting month title in warm brown #6a4b31, hand-rotated day stamps in soft green/yellow/red tints (~0.32–0.38 alpha), line-drawn flower and dog doodles, and a paw-print trail. Decorative hand-drawn elements are welcome here — this is the one surface where the journal's craft-paper world takes over.

## 6. Do's and Don'ts

### Do:
- **Do** keep every neutral warm-tinted (`rgba(60, 47, 28, …)` shadows and rules, #faf6ee/#fffcf4 surfaces) — the Warm Neutral Rule.
- **Do** keep bubble styling identical across all pets and agents: one bubble language, regardless of which pet is active.
- **Do** use pills (999px) for badges, toggles, week highlights, and bubble buttons; rounded rects (5–16px) for everything else.
- **Do** keep motion small and stately: 120–160ms ease for UI state; the pet's own keyframe loops (bob, breathe, hop) stay within ±14px.
- **Do** design zh-CN and English together — drop uppercase/letter-spacing tricks for Chinese, swap to the Huninn-led stack.
- **Do** convey status with ink-color and border-tint shifts (green/amber/rust) on cream, never with saturated fills.

### Don't:
- **Don't** build **corporate SaaS dashboard** chrome — no gray panels, no cold neutrals, no data-dense admin tables, no sidebar-and-topbar app shell.
- **Don't** ship **generic Electron app** widgets — no default-styled controls, no native-ish gray panels, no mismatched form controls.
- **Don't** use the handwriting font outside the dog's bubbles and journal headings (the Handwriting Boundary Rule).
- **Don't** mix the accents: no Deep Teal-Green in settings chrome, no Amber Brown inside thought bubbles (the Two-Accent Rule).
- **Don't** pair a hard sticker shadow with anything that lacks the 2px Pencil Outline, and never put shadows on settings controls.
- **Don't** use alarm colors or urgency theater — warnings stay in Warm Rust tints at ≤0.12 alpha backgrounds; PawPal never nags.
- **Don't** use gradient text, colored side-stripe borders, or glassmorphism blur panels anywhere.
