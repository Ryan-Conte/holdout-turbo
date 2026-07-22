# Mobile play contract

HOLDOUT treats mobile as a first-class game client, not a scaled-down desktop page. The authoritative API and socket protocol are shared by every client; mobile controls only produce the same validated intents as keyboard and mouse.

## Entry and orientation

- Pressing a deployment button calls `enterMobilePlayMode()` before navigation. On supported browsers this enters fullscreen and requests a landscape orientation lock while the click still has user activation.
- Browser support is not universal, especially on iOS. `/play` therefore renders a blocking portrait gate for coarse/no-hover pointers. The game becomes available only after the device is landscape.
- The play route owns a device-width, non-zooming, `viewport-fit=cover` viewport. Other pages keep normal document behavior.
- Layouts must use `100dvh`/`100dvw` and `env(safe-area-inset-*)`; do not assume rectangular usable screen space.

## Controls

- Left stick: movement. Crossing the outer 82% engages sprint. It updates directional booleans only; it never submits coordinates.
- Right stick: aim, with a small dead zone. Holding it outside the dead zone fires. The most recent touch aim is retained after release.
- Action cluster: use/interact, reload (or rotate while holding a build kit), and quick heal.
- Utility bar: gear, crafting, map, skills, social, chat, sound and pause. When a panel is open it becomes an explicit **Back to zone** control.
- Keyboard and mouse remain active for desktop and hybrid devices. Touch and keyboard directions are merged into one `InputPayload`; the API remains authoritative for movement, stamina, ammo, attacks, hits and interactions.
- Pointer capture is required for each virtual stick so two thumbs can operate independently and neither stick loses input at its visual edge.

## UI requirements for new features

Every player-facing feature must satisfy this checklist before it is considered complete:

1. It has a touch path; no required action is hover-only, right-click-only or keyboard-only.
2. Primary touch targets are at least 44 by 44 CSS pixels with spacing that prevents accidental presses.
3. Its play-screen panel fits a 667x375 landscape viewport, respects safe areas, scrolls internally, and has a visible way back to the game.
4. Opening it stops movement and firing; closing it releases any held touch intent.
5. Labels describe the active input (`USE`, `AIM stick`, and so on) instead of exposing desktop-only keys.
6. It does not add client authority. Mobile sends the same bounded intent/event payloads and passes the same server checks as desktop.
7. It avoids document scroll, browser gestures and accidental zoom inside the game while preserving ordinary scrolling on the landing site.
8. It is tested with multi-touch or pointer-capture behavior, not only with mouse clicks at a narrow viewport.

## Responsive HUD rules

- Reserve the lower-left and lower-right corners for the two sticks. Do not place alerts, dialogs or inventory controls under them.
- Keep the hotbar centered at the bottom and the utility bar in the upper-right safe area.
- Camera zoom must fit the usable viewport rather than assuming the desktop `2x` scale. The play renderer targets about 22 horizontal by 11 vertical tiles, clamped from `0.9x` to `2x`, so Safari browser chrome does not leave tablet players with a five-tile-high view.
- The compact mobile HUD shows survival/combat essentials. The minimap, objective list, kill feed and redundant status chips may be hidden; the full map and panels remain accessible through the utility bar.
- Full-screen panels should use internal scrolling and 44px controls. Inventory uses horizontally scrollable equipment columns so slot sizes remain usable instead of shrinking to illegibility.
- Portrait is a blocked transitional state, not an alternative gameplay layout.

## Safari canvas limits

- Never allocate a full-world canvas based only on tile dimensions. iOS Safari may return a blank or unusable context when either dimension exceeds 4096 pixels or total area exceeds 16,777,216 pixels.
- Whole-map prerendering is limited to that conservative dimension and pixel budget. Larger worlds draw only the visible tile window each frame.
- Every authored terrain cell must retain the checked-in tile sheet as a fallback when its published database frame is absent or temporarily unavailable. A missing runtime frame must never become a black world.
- Keep the main game canvas at CSS-pixel resolution unless a measured device-pixel-ratio change also includes an explicit memory budget; a full Retina backing store can exceed mobile canvas memory quickly.

## Regression matrix

Run the web typecheck/build and manually verify at least:

| Viewport | Expected result |
| --- | --- |
| 390x844, coarse pointer | Portrait gate blocks the game and offers landscape/fullscreen retry. |
| 844x390, coarse pointer | Both sticks, action cluster and utility controls fit safe areas without overlap. |
| 667x375, coarse pointer | HUD remains readable; panels scroll and **Back to zone** stays reachable. |
| 1024x360, Safari-like landscape | Terrain remains textured and the responsive camera shows roughly 22x11 tiles despite browser chrome. |
| 1440x900, fine pointer | Desktop keyboard/mouse HUD is unchanged and mobile controls are hidden. |

Also verify simultaneous left/right stick capture, movement release on panel open or app blur, aim/fire release, interact/reload/heal, chat keyboard behavior, inventory touch actions, map pan/zoom controls, and rotation during an active session.

## Ownership

- `apps/web/lib/mobile-play.ts` owns fullscreen/orientation preparation and touch-device detection.
- `apps/web/components/game/MobileControls.tsx` owns virtual sticks, mobile actions, utility navigation and the portrait gate.
- `apps/web/components/GameClient.tsx` translates touch vectors into the existing authoritative intent pipeline.
- `apps/web/app/play/layout.tsx` owns the game-only viewport policy.
- `apps/web/app/globals.css` owns safe-area and landscape-phone presentation.
