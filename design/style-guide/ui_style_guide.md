# AESP – UI Style Guide (Inspiration Driven)

This document captures the UI direction inspired by the provided Figma references. It translates the look & feel into concrete design tokens, patterns, and components for the React + Tailwind + shadcn/ui stack.

## 1) Visual Direction

- Playful, friendly, and cartoonish elements (Miniavs, GEE&ME packs)
- Clean, high-contrast layouts with strong spacing (Instagram concept)
- Mobile-first composition, fluid cards, rounded corners
- Subtle depth with soft shadows and glassmorphism touches

## 2) Color System

- Primary: Vibrant gradient (e.g., from #7C3AED to #22D3EE)
- Secondary: Warm accent (#F59E0B, #F43F5E) for CTAs/badges
- Surface: #0B1220 (dark), #0F172A (cards), with white text
- Feedback: success #10B981, warning #F59E0B, danger #EF4444

Tailwind example tokens:

- bg-primary: gradient via utility + bg-clip-text for headings
- text-muted: slate-400, slate-500
- border-subtle: white/10

## 3) Typography

- Headings: Inter/Manrope (700/800), tight leading, gradient text for H1
- Body: Inter (400/500), comfortable line-height
- Mono (code/numerical badges): JetBrains Mono or Fira Code (optional)

Sizing ramp:

- H1: text-4xl md:text-6xl, H2: 3xl/4xl, Body: base, Small: sm

## 4) Spacing & Radius

- Spacing: 8px grid (2, 4, 8, 16, 24, 32)
- Radius: rounded-2xl for cards; rounded-full for chips/avatars
- Shadows: subtle (shadow-lg/2xl with low opacity)

## 5) Motion & Micro-interactions

- Framer Motion for enter/exit and hover lift
- Lottie for playful iconography or empty states
- Duration: 200–350ms, easing: easeOut/backOut for playful feel

## 6) Components

- App Shell: sticky header with glass blur, bottom nav on mobile
- Card: gradient outline or glass surface; hover scale 1.02
- Buttons: primary gradient, secondary outline; icon-leading
- Input: soft background, focus ring with primary hue
- Chips/Badges: colorful, rounded-full; used for levels/topics
- Avatars: use Miniavs/GEE&ME, circle frame, subtle ring
- Progress Ring: radial progress for session score
- Toast/Sheet: shadcn/ui primitives with custom tokens

## 7) Layout Patterns

- Hero: big H1 with gradient, mascot/character illustration
- Dashboard: 2-col grid (cards + activity feed)
- Practice Screen: prominent mic button, real-time transcript area
- Topic Gallery: card grid with category chips

## 8) Assets

- Store source illustrations in design/assets/illustrations
- Store avatar sets in design/assets/avatars
- Export SVG when possible for crispness and theming

## 9) Accessibility

- Contrast AA for text on dark surfaces
- Focus states visible; motion-reduced preference respected
- Clear labels on mic/actions

## 10) Implementation Notes

- shadcn/ui for base primitives; extend with Tailwind tokens
- Keep tokens centralized (tailwind.config.js/theme.ts)
- Provide light/dark themes but default to dark (from references)

---

Next steps:

- Extract palette and typography from the specific Figma files
- Export 2–3 mascot/character SVGs and place under assets
- Scaffold Tailwind tokens (colors, radius, shadow) to match this guide
