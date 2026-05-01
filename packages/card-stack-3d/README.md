# Card Stack 3D

A spatial 3D card stack for notes, documents, timelines, version history, and markdown cards.

```tsx
import { CardStack3D } from '@natnaelkahssay/card-stack-3d'
import '@natnaelkahssay/card-stack-3d/styles.css'

export function NotesView({ cards, activeId, setActiveId }) {
  return (
    <CardStack3D
      items={cards}
      activeId={activeId}
      onSelect={(card) => setActiveId(card.id)}
      onOpen={(card) => console.log('open', card)}
    />
  )
}
```

## Why

Most 3D carousels are image showcases. This component is built for readable content cards: notes, markdown, document history, search results, and branching timelines.

## Configuration

The card line, camera, card orientation, and visual falloff are independent controls:

```tsx
<CardStack3D
  items={cards}
  controls={{
    camTheta: 88,
    camPhi: 7,
    camRadius: 120,
    cardGap: 97,
    lineTheta: -14,
    linePhi: 22,
    cardLeftRight: 0,
    cardFrontBack: 0,
    focusX: 41,
    focusY: 7,
    sinkY: 37,
    falloff: 1.4,
    falloffBalance: 0.5,
    minScale: 0.82,
  }}
/>
```

The stylesheet ships usable defaults and also maps to common app theme tokens.
Override these on `.tm-layout` or any parent scope:

```css
.my-stack {
  --card-stack-text: #f7f2e8;
  --card-stack-text-dim: rgba(247, 242, 232, 0.72);
  --card-stack-text-muted: rgba(247, 242, 232, 0.48);
  --card-stack-accent: #e8a84c;
  --card-stack-font-serif: Georgia, serif;
}
```

Use `renderCard` when you want full control over the card surface:

```tsx
<CardStack3D
  items={cards}
  renderCard={(card, { scrollProps }) => (
    <>
      <div className="tm-card-titlebar">
        <span className="tm-card-name">{card.title}</span>
      </div>
      <div className="tm-card-body">
        <div {...scrollProps}>{card.body}</div>
      </div>
    </>
  )}
/>
```
