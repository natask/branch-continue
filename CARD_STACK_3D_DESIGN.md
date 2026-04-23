# Card Stack 3D System Design

## Scene

A set of flat cards arranged along a line in 3D space. A camera observes them. The focused card sits at the origin `(0, 0, 0)`.

---

## Two Independent Systems

### 1. Card Line

Cards are placed along a **line through the origin**. The line has:

- **Direction**: a unit vector defined by spherical coordinates `(lineTheta, linePhi)`.
  - `lineTheta` (azimuth, -180 to 180): rotation in the horizontal plane.
  - `linePhi` (elevation, -90 to 90): tilt up/down from horizontal.
- **Gap**: distance in world units between adjacent cards along this line.

Each card's 3D position:

```
position[i] = (i - focusIndex) * gap * lineDirection
```

The focused card is always at `(0, 0, 0)`. Cards before it extend in `-lineDirection`, cards after in `+lineDirection`.

**Moving the camera does not change card positions. Changing gap does not change the line direction. Changing line direction does not change gap.**

### 2. Camera

The camera is positioned in spherical coordinates relative to the origin (the focused card):

- **camTheta** (azimuth, -180 to 180): horizontal orbit angle around the focused card.
- **camPhi** (elevation, -90 to 90): vertical orbit angle.
- **camRadius** (distance, 100+): how far the camera sits from the focused card.

The camera always **looks at the origin**. Moving the camera changes how you see the cards, not where the cards are.

Camera properties:
- Focal length is a **constant** (per platform), independent of `camRadius`. Coupling the two cancels their effects on apparent size and breaks dolly.
- At `camTheta=0, camPhi=0`: camera looks straight down the Z-axis toward origin. Cards along the default line (X-axis) spread left-right on screen.
- Increasing `camPhi`: camera rises above, cards appear to tilt away. Foreshortening compresses far cards.
- Rotating `camTheta`: camera orbits horizontally, the card line appears to rotate on screen.
- Increasing `camRadius`: camera dollies back — focused card shrinks, perspective distortion decreases. Decreasing `camRadius` dollies in — focused card grows.

**Camera controls only change viewpoint. They never move, resize, or re-space the cards in world space.**

---

## Projection

Each card's 3D world position is projected to 2D screen coordinates:

1. Compute view-space position: transform card world position into camera's local coordinate system (forward, right, up).
2. Perspective divide: `screenX = (rightComponent / depth) * focalLength`, `screenY = -(upComponent / depth) * focalLength`.
3. The focused card at origin always projects to screen center (since camera looks at origin).

---

## Visual Effects (per-card, based on offset from focus)

These are applied after projection and are independent of both camera and card line:

- **Sink Y**: pushes non-focused cards down on screen (screen-space offset, not world-space).
- **Scale falloff**: non-focused cards shrink with distance from focus.
- **Opacity falloff**: non-focused cards fade.
- **Blur falloff**: non-focused cards blur.
- **Min scale**: floor on how small distant cards can get.
- **Falloff balance**: ratio of blur vs opacity in the falloff.

---

## Full Control List

| Control | System | What it does | Range |
|---------|--------|-------------|-------|
| `cardGap` | Card Line | Spacing between cards along the line | 20 - 600 |
| `lineTheta` | Card Line | Azimuth of line direction | -180 to 180 |
| `linePhi` | Card Line | Elevation of line direction | -90 to 90 |
| `camTheta` | Camera | Horizontal orbit angle | -180 to 180 |
| `camPhi` | Camera | Vertical orbit angle | -90 to 90 |
| `camRadius` | Camera | Distance from focused card | 100 - 3000 |
| `sinkY` | Visual FX | Screen-space push-down for non-focused cards | -100 to 200 |
| `falloff` | Visual FX | Intensity of scale/opacity/blur falloff | 0 - 3 |
| `falloffBalance` | Visual FX | Blur vs fade ratio | 0 - 1 |
| `minScale` | Visual FX | Minimum scale for distant cards | 0.3 - 1.0 |

---

## Independence Guarantees

- Changing `cardGap` only changes distance between cards. Line direction, camera, and visual FX stay fixed.
- Changing `lineTheta/linePhi` only rotates where cards sit in 3D. Camera stays put, gap stays the same.
- Changing `camTheta/camPhi/camRadius` only moves the viewpoint. Cards do not move in world space.
- Changing visual FX (sink, falloff, etc.) only affects screen-space appearance per card offset. No world-space or camera changes.

---

## Open Questions

1. Should the line direction default to `(1, 0, 0)` (horizontal) or match the current default spread angle?
2. Should focal length become a user-facing control, or stay a platform-fixed constant?


