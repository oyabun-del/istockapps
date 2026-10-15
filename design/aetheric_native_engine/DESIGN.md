---
name: Aetheric Native Engine
colors:
  surface: '#10131a'
  surface-dim: '#10131a'
  surface-bright: '#363941'
  surface-container-lowest: '#0b0e15'
  surface-container-low: '#191b23'
  surface-container: '#1d1f27'
  surface-container-high: '#272a32'
  surface-container-highest: '#32353d'
  on-surface: '#e1e2ec'
  on-surface-variant: '#c3c6d7'
  inverse-surface: '#e1e2ec'
  inverse-on-surface: '#2d3038'
  outline: '#8d90a0'
  outline-variant: '#434655'
  surface-tint: '#b4c5ff'
  primary: '#b4c5ff'
  on-primary: '#002a78'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#0053db'
  secondary: '#4cd7f6'
  on-secondary: '#003640'
  secondary-container: '#03b5d3'
  on-secondary-container: '#00424e'
  tertiary: '#c0c1ff'
  on-tertiary: '#1000a9'
  tertiary-container: '#585be6'
  on-tertiary-container: '#f1eeff'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#acedff'
  secondary-fixed-dim: '#4cd7f6'
  on-secondary-fixed: '#001f26'
  on-secondary-fixed-variant: '#004e5c'
  tertiary-fixed: '#e1e0ff'
  tertiary-fixed-dim: '#c0c1ff'
  on-tertiary-fixed: '#07006c'
  on-tertiary-fixed-variant: '#2f2ebe'
  background: '#10131a'
  on-background: '#e1e2ec'
  surface-variant: '#32353d'
typography:
  display:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-mobile:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.04em
  code-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
---

## Brand & Style

This design system embodies the precision, security, and tactile responsiveness of next-generation native utilities and curated app marketplaces. The brand aesthetic merges the clarity and structural rigor of modern iOS interface architecture with the technical transparency needed for developer tooling and alternative certificate distribution.

### Core Visual Principles
- **Native Precision:** Every interaction echoes low-latency operating system behaviors: tight bounding boxes, continuous curvatures, and crisp sub-pixel borders.
- **Utilitarian Elegance:** Complex technical data—such as cryptographic certificate statuses, bundle identifiers, sideload progress, and partition quotas—is rendered with immediate legibility and visual hierarchy.
- **Dynamic Luster:** A dark canvas accented by focused, high-frequency electric blue and cyan indicators that direct user intent without overwhelming system alerts.
- **Cyrillic Typographic Harmony:** The interface is engineered with native support for Russian Cyrillic glyphs, ensuring optical balance, proportional ascenders/descenders, and strict horizontal baseline consistency across all layout tiers.

## Colors

The palette relies on a tiered deep obsidian architecture paired with electric signal accents.

### Color Tokens & System Roles
- **Canvas (`#0A0D14`):** Base structural canvas providing high optical depth.
- **Card & Elevated Surfaces (`#161B26`):** Secondary container surface for app rows, certificate detail pods, and utility drawers.
- **Overlay & Popover Layer (`#1F2637`):** Tertiary dynamic surface reserved for modal sheets, context menus, and segmented switches.
- **Borders & Dividers (`#262E3F`):** Crisp structural stroke establishing strict boundary distinction between dark panels.
- **Primary Accent (`#2563EB`):** Electric blue dedicated to high-priority interactions, installation actions ("Установить"), and active tab states.
- **Secondary Accent (`#06B6D4`):** Cyan dedicated to verified signatures, real-time download indicators, and cryptographic health states.
- **Tertiary Accent (`#6366F1`):** Indigo used for enterprise developer certificates, bundle tags, and secondary action highlights.

### Functional Status Tokens
- **Success / Verified (`#10B981`):** Active enterprise certificates, valid provisioning profiles.
- **Warning / Expiry (`#F59E0B`):** Profiles nearing revocation or 7-day expiration thresholds.
- **Destructive / Error (`#EF4444`):** Untrusted binaries, revoked developer certificates, or install failures.

## Typography

The type system prioritizes Apple-inspired neutral neo-grotesque architecture via Inter, providing native geometric precision and refined tracking for Russian language text strings.

### Cyrillic & Localization Rules
- **Cap Height & Accents:** Russian Cyrillic uppercase letters (`Д`, `Ц`, `Щ`, `Й`) carry vertical descenders and diacritics. Vertical spacing preserves strict clearances to prevent line-height collisions.
- **Micro-Copy Density:** Russian translations frequently require 15% to 25% more character space than English equivalents (e.g., "Install" vs. "Установить", "Verified" vs. "Проверено"). All action buttons, badges, and segmented toggles use flexible intrinsic width containers with constrained `padding-x` to prevent truncated strings.
- **Numbers & Monospace Figures:** Numeric version hashes, certificate expiration countdowns, and bundle versions use tabular figures (`font-variant-numeric: tabular-nums`) to ensure zero-jitter alignment.

## Layout & Spacing

The interface uses a strict 4pt/8pt spatial increment combined with an iOS-native columnar approach designed for seamless utility consumption.

### Layout Mechanics
- **Mobile (< 768px):** Single-column stacked fluid layout with `margin: 1rem` (16px), allowing maximum horizontal width for app rows and certificate inspection blocks. Navigation rests on fixed glassmorphic bottom bars or pinned top navigation bars.
- **Tablet (768px - 1024px):** 2-column asymmetric fluid grid with `gutter: 1rem`. Left column hosts persistent category feeds; right column renders installation queues and detailed certificate properties.
- **Desktop (> 1024px):** Fixed utility shell with max container width of 1280px, utilizing a 12-column system, 24px gutters, and 32px canvas margins. Sidebars remain docked at 280px.
- **Rhythm Rules:** Stacked cards adhere to `space-md` (12px) separation. Related inline metadata chips maintain `space-xs` (4px) or `space-sm` (8px) gaps.

## Elevation & Depth

Visual depth is achieved through layered solid surface tones, frosted glass blurs, and luminous ambient glows rather than opaque dropshadows.

### Elevation Tiers
- **Base Level (Canvas):** Flat `#0A0D14` with absolute absorption.
- **Level 1 (Card & Section):** Surface `#161B26` surrounded by a continuous 1px hairline border (`#262E3F`).
- **Level 2 (Interactive Elements & Sheets):** Surface `#1F2637` featuring an ambient shadow: `0 8px 24px -4px rgba(0, 0, 0, 0.45)`.
- **Level 3 (Modals & Command Drawers):** High-opacity blurred acrylic backdrop (`backdrop-filter: blur(24px) saturate(180%)`, surface fill `rgba(22, 27, 38, 0.82)`), bordered with `rgba(255, 255, 255, 0.08)`.
- **Focus & Selection Glow:** Focused buttons and verified certificate nodes leverage a subtle, colored radial halo: `0 0 16px -2px rgba(37, 99, 235, 0.35)`.

## Shapes

The geometric identity relies on iOS-style smooth continuous curves (squircle emulation) with unified proportional radii.

### Geometry Specifications
- **Pills (`rounded-full`):** Reserved for interactive action triggers, CTA buttons ("Установить"), filter chips, and certificate validation badges.
- **Standard Cards (`rounded-lg`, 16px / 1rem):** Used for application cards, step guide tiles, and certificate summary panels.
- **Micro Elements (`rounded-md`, 8px / 0.5rem):** Used for segmented controllers, inline status pills, and app source icons.
- **App Icons (`rounded-xl`, 22% continuous curvature):** Distinct native iOS application icon mask applied strictly to third-party app artwork.

## Components

### Buttons
- **Primary Action ("Установить" / "Загрузить"):** Full-pill geometry (`rounded-full`), solid background `#2563EB`, text `#FFFFFF` (`label-md`), smooth scale transform on active tap (`scale: 0.97`). Height: 36px on mobile rows, 44px for primary call-to-actions.
- **Secondary / Ghost ("Подробнее", "Отмена"):** Pill shape, background `rgba(38, 46, 63, 0.45)`, border 1px solid `#262E3F`, text `#E2E8F0`.
- **Icon Buttons:** 36x36px circular bounds, background `#161B26`, border `#262E3F`, centering monochrome micro-icons.

### Status Badges & Verified Certificate Tags
- **Verified Certificate Badge:** Pill container with background `rgba(6, 182, 212, 0.12)`, 1px border `rgba(6, 182, 212, 0.35)`, text `#06B6D4` (`label-sm`). Preceded by a 6px solid cyan indicator dot or verified shield icon. Label examples: "Сертификат активен".
- **Warning Badge:** Background `rgba(245, 158, 11, 0.12)`, border `rgba(245, 158, 11, 0.35)`, text `#F59E0B`. Label: "Истекает через 2 дня".
- **Revoked / Untrusted Badge:** Background `rgba(239, 68, 68, 0.12)`, border `rgba(239, 68, 68, 0.35)`, text `#EF4444`. Label: "Отозван".

### Cards (App Rows & Source Repositories)
- **Container:** Background `#161B26`, border 1px solid `#262E3F`, padding `space-lg` (16px), corner radius `1rem`.
- **Structure:** Left side features 60x60px app icon with squircle clip; center column displays App Title (`headline-sm`, `#F8FAFC`), Developer & Bundle ID (`body-sm`, `#94A3B8`), and metadata chips; right side holds the dynamic primary action button.

### Readable Installation Steps (Onboarding / Signing Guide)
- **Step Card Component:** Numbered sequential cards with background `#161B26`, border `#262E3F`.
- **Step Indicator:** 28x28px circular badge with `#2563EB` background containing white bold step digits ("1", "2", "3").
- **Content:** Title in `headline-sm` ("Шаг 1: Установка профиля"), followed by clear instructional text in `body-md` ("Перейдите в Настройки -> Основные -> VPN и управление устройством..."). Bottom border displays quick-link pills for deep linking into native system configuration.

### Input Fields & Search
- **Search Bar:** Height 42px, pill-shaped (`rounded-full`), background `#161B26`, stroke 1px `#262E3F`. Placeholder text `#64748B` ("Поиск приложений, репозиториев..."). Focus ring shifts stroke to `#2563EB` with a 2px diffuse glow.
- **Text Inputs:** Height 44px, radius `0.5rem`, background `#0A0D14`, stroke 1px `#262E3F`, text `#F8FAFC`.

### Chips & Segmented Controls
- **Segmented Control:** Background `#0A0D14`, padding 4px, border 1px solid `#262E3F`, pill radius. Active tab slides with `#1F2637` background, white text, and low ambient shadow.
- **Filter Chips:** Intrinsic width, pill radius, outline stroke `#262E3F`, active state fills with `rgba(37, 99, 235, 0.16)` and `#2563EB` text.