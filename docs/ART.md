# Art pipeline

HOLDOUT ships two coordinated art layers:

- `apps/web/public/sprites/*.png` contains the compact 16 px compatibility atlases used during cold start, source imports and any database outage.
- Published `game_sprite_assets` rows are the production library. Items are authored at 48 px and characters, terrain, resources, flora and world props at 64 px. `PixelAsset.renderScale` preserves readable world scale while retaining the source art's fine pixel clusters.

Both layers use hard pixel sampling (`imageSmoothingEnabled = false`), upper-left lighting, charcoal outlines, restrained material dithering and the muted olive/earth/steel palette in `tools/lib/production-art.mjs`.

The checked-in production source atlases are:

- `production-actors.png` — survivor, infected, military, trader and ten fauna silhouettes.
- `production-actors-walk-a.png` / `production-actors-walk-b.png` — identity-preserving planted contact poses for every actor.
- `production-actors-punch-windup.png` / `production-actors-punch-impact.png` / `production-actors-punch-recovery.png` — authored anticipation, full-extension impact and retraction poses.
- `production-items-a.png` / `production-items-b.png` — the complete 67-item runtime catalog.
- `production-flora.png` — trees, shrubs, ferns, reeds, flowers, grasses, logs, stumps, brambles and mushrooms.
- `production-props.png` — stations, storage, fortifications, furniture and roadside cover.
- `production-terrain.png` — seamless authored ground, water, floors, ore and cliff materials.

The source generations and reference image live under `docs/assets/`; the public copies are chroma-keyed transparent runtime inputs.

## Generate and publish

```bash
npm run art:generate
```

Builds shared content, regenerates the fallback atlases and produces the visual QA sheets:

- `docs/assets/production-sprite-catalog.png`
- `docs/assets/production-animation-frames.png`

```bash
npm run art:publish
```

Runs generation, seeds newly shipped content IDs, replaces every draft/published sprite row in one revision, and replaces the complete animation document. Sparse asset history remains available for rollback.

The visual direction reference used by this pass is `docs/assets/asset-style-reference.png`. The generated source atlases are normalized, outlined and packed by the production art library so every published row remains editable in the engine.

## `tiles.png` compatibility layout

The fallback atlas remains a 16×16 grid so offline and pre-database rendering stay stable.

| col | sprite |
|---|---|
| 0-1 | grass variants |
| 2 | water |
| 3 | sand |
| 4 | dirt road / mud source |
| 5 | asphalt |
| 6 | wood floor |
| 7 | wall |
| 8 | door mat / hideout exit |
| 9 + 13 | bed top and bottom |
| 10-11 / rows 0-1 | 32×32 tree |
| 12 | rock |
| 14-16 | workbench, firepit, furnace |
| 17-18 | stump, rubble |
| 19-24 | build floors, wall, door, fence and torch |
| 25-26 | copper and iron vein |
| 27-28 | anvil and cliff |

## `chars.png` compatibility layout

The atlas has four fallback poses per row: idle, left contact, passing/hop and right contact.

| rows | actor |
|---|---|
| 0-7 | survivor outfit bases |
| 8-10 | infected, military guard and trader |
| 11-16 | deer, rabbit, boar, wolf, fox and bear |
| 17-19 | moose, raccoon and cougar |

Published humanoid assets use an 80 by 64 px transparent canvas; wide-running fauna use 96 by 64 px. The wider canvases preserve the existing actor height while giving committed strikes room for fists, muzzles, legs, tails and antlers. Each actor contains 19 state frames composed from its neutral master, two locomotion contacts and three authored attack poses:

| indices | state |
|---|---|
| 0-1 | breathing idle |
| 2-5 | left contact, lifted passing, right contact and neutral passing |
| 6-7 | retained contact alternates for editor-authored clips |
| 8-10 | anticipation, impact/lunge and recovery |
| 11-12 | hit recoil and settle |
| 13-15 | stagger, fall and grounded death |
| 16-18 | punch/lunge wind-up, peak impact and retraction |
| 19-20 | left/right push-off locomotion in-betweens |
| 21 | half-inhale breathing in-between |

Locomotion plays as an eight-step cycle (contact → push-off → passing → reach per side) and idle breathes through a four-step triangle. Clips may set `blendMs` for short client-side alpha blends across keyframe boundaries; entries whose keyframe event is `impact` always snap. The client runtime (`apps/web/game/animation.ts`) additionally scales walk playback with actual ground speed and crossfades state exits, so the same clips read smoothly at any velocity.

`/admin/animations` owns the timing and keyframe events. `punch` is a dedicated state rather than a hand-shaped overlay on the generic weapon attack. Its authored wind-up, impact, retraction and neutral recovery total 450 ms for the survivor, matching the authoritative fist cooldown. The current profiles use distinct heavy/light cadences, contact events, attack windups, hit recovery and persistent final death poses. The infected brute retains synchronized roar/slam cues.

## `items.png`

One fallback icon exists per `ItemId`, in shared `ITEM_SPRITE_ORDER`. Published 48 px item art is authoritative in world rendering and DOM inventory icons; the 16 px sheet is used only when runtime content is unavailable.

Adding an item requires an `ITEMS` definition, an `ITEM_SPRITE_ORDER` entry, a compatibility drawing in `tools/gen-sprites.mjs`, and an authored/refined production asset in `tools/lib/production-art.mjs`.

## Flora and world dressing

The production block catalog includes pine saplings, dense shrubs, berry bushes, fern beds, reeds, wildflowers, tall grass, fallen logs, mossy stumps, brambles and mushroom clusters. These are decorative, non-colliding block definitions so they can be densely dressed without changing movement authority.

Pine and birch are full resource definitions with health, wood drops, respawn timing and weighted regrowth. Greyvale and the showcase generator both place every new flora category and tree family.

## Animation QA harness

```bash
npm run art:preview
```

Writes `apps/web/public/dev-art-preview.json` (gitignored) — the exact document `art:publish` would store — and `/dev/animations` plays it through the same runtime the game uses (`sampleClip`, `EntityAnimator`, `computeMotionPose`). The page has a live grid across all states, a raw frame strip, a deterministic per-clip timeline with a baseline ruler, and static catalogs for items, blocks, resources and terrain. Iterate art or clip timing there before publishing.

## Browser pixel studio

`/admin/sprites` edits independent sprite rows rather than rewriting one multi-megabyte document. Assets support 1-64 px dimensions and up to 64 frames. High-resolution production assets intentionally omit fallback import metadata so the studio cannot accidentally replace a 48 px/64 px asset with a 16 px sheet crop.

Runtime clients cache the published RGBA frames, hot-apply new visual revisions, and fall back to the checked-in atlases if a frame is absent. The current 132-asset document is about 20.2 MiB as raw JSON and 2.38 MiB compressed over the wire. See `docs/ENGINE.md`.
