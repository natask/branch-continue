# Card System Package

`TimeMachine` has been extracted as a reusable React package without the
QuickNote parser, app shell, editor, search, project promotion, or source
bridge.

## Shape

- Package: `@natnaelkahssay/card-stack-3d` in `packages/card-stack-3d`.
- Entry points: main JS/TS export plus `@natnaelkahssay/card-stack-3d/styles.css`.
- Build: ESM + `.d.ts`; peer deps are `react` and `react-dom`.
- Extracted: `CardStack3D.tsx`, `card-stack-3d.ts`, scroll helpers, gesture
  navigation, control persistence, and `.tm-*` package styles.

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

Also exports `CardStack3D`, `defaultStackControls`, `cardLinePosition`,
`sphericalDirection`, `cardRotationFromNormal`, `cardRotationFromOrientation`,
and scroll-bridge helpers.

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

1. `src/ui/components/TimeMachine.tsx` is now a thin app adapter.
2. App notes are sorted in the adapter and rendered through `renderCard`.
3. The package owns card stack gestures, transforms, scroll handling, storage,
   defaults, CSS, and exported geometry utilities.
4. Root scripts build the workspace package before app build/test.

Keep sorting, editor open state, search disabling, branch creation, source-file
persistence, and app-level keyboard policy in the app.
