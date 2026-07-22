# Animation and game-feel audit

Reviewed 22 July 2026 against the target of a responsive, polished browser `.io` game while keeping the server authoritative.

## Baseline findings

| Area | Existing strength | Main rough edge | Severity |
| --- | --- | --- | --- |
| Local movement | Client prediction mirrors terrain, stamina, collision and encumbrance | Reconciliation was smooth, but no motion velocity reached the visual layer | Medium |
| Remote movement | Positions were eased toward the latest server state | Chasing 20 Hz snapshots produced elastic lag, foot sliding and uneven motion under jitter | High |
| Projectiles | Server-owned and culled correctly | Raw 20 Hz positions made fast shots visibly step | High |
| Character locomotion | State clips and runtime-authored art already exist | The fallback atlas had only idle + one step, so every actor toggled between two poses | High |
| Facing | Body direction is separate from weapon aim | Horizontal mirroring could flicker near the vertical axis | Medium |
| Combat | Local muzzle flash, recoil, casing, particles and sounds are immediate | Melee used one monotonic sweep; hit response depended mostly on a frame swap | Medium |
| Death | Corpses and entity-specific death clips exist | Fallback bodies snapped instantly sideways and faded immediately | Medium |
| World motion | Resource shake, falling trees, extraction beacons and light flicker exist | Doors snapped 90 degrees; water and fueled stations were visually static | Medium |
| Visibility | LOS is authoritative and client fog mirrors it | Per-tile fog edges read as a hard debug grid | Medium |
| Interface | Map, toasts, hurt, crafting and landing already animate | Most game panels appeared instantly and press feedback was inconsistent | Low |
| Accessibility | Landing honors reduced-motion | The in-game motion layer and most overlays did not | Low |

## Implemented polish pass

- Remote players, enemies and projectiles now render on an 85 ms buffered interpolation timeline, with only 50 ms of bounded extrapolation when a packet is late. The local survivor remains predicted and authoritative reconciliation is unchanged.
- Interpolated and predicted velocity now feeds the renderer. Locomotion cadence, secondary sway, shadow compression, start/stop settling and footsteps respond to actual motion instead of a boolean alone.
- `chars.png` now has four poses per row. The compatibility walk cycle is `1, 2, 3, 2`; idle remains frame `0`. Seed/default engine content and editor source metadata use the same layout.
- Player appearance compositing follows the active pose, so hair, skin, outfit, accent and arm layers stay registered to all four fallback frames.
- Facing uses hysteresis, preventing rapid left/right flips around vertical aim.
- Hits add a brief brightness/desaturation flash and damped positional shake. Published state clips still control the underlying frame.
- Melee now has anticipation, a fast impact phase and recovery. Spears retract, thrust and return instead of following the same arc as tools.
- Fallback deaths ease into a directional fall, remain readable briefly, then fade. Authored death clips remain supported inside that transition.
- Player-built doors ease between closed and open angles while server collision remains authoritative and immediate.
- Water gets restrained moving glints; fueled firepits/furnaces and torches get lightweight procedural flame/glow motion.
- Tree falls use a weightier cubic acceleration. LOS fog uses a feathered union mask instead of exposed tile seams.
- Game panels and the death overlay have short entry transitions, buttons get consistent press feedback, and the new motion respects `prefers-reduced-motion`.

## What still depends on authored art

The renderer now makes the compatibility sheet feel substantially better, but procedural polish cannot replace distinct authored actions. The next art pass should prioritize:

1. Player and humanoid clips with 6-8 locomotion frames plus weapon-specific attack/reload poses.
2. Unique hit reactions from front/back and a grounded multi-frame death for each silhouette.
3. Quadruped-specific idle, turn, run, attack and death clips; they currently share the generic state timing contract.
4. Directional or rotational variants for characters that should read differently when moving north/south.
5. Animation keyframe events for exact footstep, impact, shell and reload sound timing.

## Recommended follow-up engineering

- Add a proper animation graph with cross-fades and per-clip playback rates derived from world speed.
- Add reload and interaction timestamps to snapshots so those states can be authored like attack/hit/death.
- Pool high-volume particles and atlas published DB frames before raising effect counts.
- Profile low-end integrated GPUs with 100 visible actors; reduce ambient terrain effects dynamically if frame time exceeds budget.
- Add optional camera look-ahead and a user-facing screen-shake strength setting after cursor-to-world transforms share the camera offset.

## Verification target

- Local input remains immediate at 60+ render FPS.
- Remote motion stays continuous through normal 20 Hz snapshots and brief packet jitter.
- No client animation changes movement, damage, collision, attack eligibility or other authoritative outcomes.
- Fallback and published art both render through the same state contract.
- Reduced-motion removes nonessential bob, sway, flame and entry motion without hiding gameplay feedback.
