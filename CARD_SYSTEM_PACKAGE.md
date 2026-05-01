# Card System Package Plan

Extract `TimeMachine` as a reusable React package without the QuickNote parser,
app shell, editor, search, project promotion, or source bridge.

## Shape

- Package: `@branch-continue/card-stack` or workspace `packages/card-stack`.
- Entry points: main JS/TS export plus `@branch-continue/card-stack/styles.css`.
- Build: ESM + `.d.ts`; peer deps are `react` and `react-dom`.
- Extract: `TimeMachine.tsx`, `card-stack-3d.ts`, required navigation helpers,
  and only `.tm-*` rules from `src/style.css`.

## API

```ts
export type CardStackItem = {
  id: string; title: string; body?: string; preview?: string
  timestamp?: string | null; tags?: readonly string[]; order?: number
}

export type CardStackControlKey =
  | 'camTheta' | 'camPhi' | 'camRadius' | 'cardGap' | 'lineTheta' | 'linePhi'
  | 'cardLeftRight' | 'cardFrontBack' | 'focusX' | 'focusY'
  | 'sinkY' | 'falloff' | 'falloffBalance' | 'minScale'
export type CardStackControls = Record<CardStackControlKey, number>

export type CardStackConfig = {
  isMobile?: boolean; navigationEnabled?: boolean; showTuner?: boolean
  swipeUpNavTarget?: 'previous' | 'next'
  wheelNavDirection?: 'natural' | 'reverse'
  controls?: Partial<CardStackControls>; storageKeyPrefix?: string | false
}

export interface CardStackProps<T extends CardStackItem = CardStackItem> {
  items: readonly T[]; activeId: string | null; totalCount?: number
  config?: CardStackConfig
  renderCard?: (item: T, state: { focused: boolean }) => React.ReactNode
  onSelect?: (item: T) => void; onOpen?: (item: T) => void
  onBranch?: (item: T) => void
  onControlsChange?: (controls: CardStackControls) => void
}
```

Also export `CardStack`, `defaultDesktopControls`, `defaultMobileControls`,
`cardLinePosition`, `sphericalDirection`, `cardRotationFromOrientation`.

## Styling

- Ship package CSS; keep `.tm-*` initially for easy migration or rename once to
  `.card-stack-*`.
- Replace app globals with defaulted vars: `--card-stack-text`,
  `--card-stack-accent`, `--card-stack-surface`,
  `--card-stack-motion-duration`.
- Consumers import CSS explicitly and override vars from their theme.

## Defaults

- Export current desktop/mobile control presets.
- Support controlled `controls`; otherwise keep internal state.
- Persist tuner controls only when `storageKeyPrefix` is a string; `false`
  disables localStorage.
- Preserve independent config groups: card line, camera, card orientation,
  focus offset, and visual falloff.

## Migration

1. Copy `TimeMachine` to `packages/card-stack/src/CardStack.tsx`.
2. Rename props from note-specific names to item-specific names.
3. Replace direct `SourceNote` use with generic `CardStackItem`; map app notes
   at the call site.
4. Move `card-stack-3d.ts` unchanged and export it as utilities.
5. Move stack CSS into package `styles.css`.
6. Swap current usage to:
   `<CardStack items={notes} activeId={activeNoteId} onSelect={selectNote} />`.

Keep sorting, editor open state, search disabling, branch creation, source-file
persistence, and app-level keyboard policy in the app.
