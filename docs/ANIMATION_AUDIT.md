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

## Production art follow-up — 24 July 2026

The database-authored production library now closes the highest-impact art gaps:

- Player, trader, infected, military, brute and all nine wildlife silhouettes have 19 state frames: two idle, four active locomotion poses plus two alternates, three generic weapon attacks, two hit, three death and three authored punch/lunge poses.
- Locomotion now comes from two generated, identity-preserving contact atlases with a scale-normalized neutral passing pose. Feet and paws remain planted at the world anchor instead of sliding a static sprite sideways.
- Light, standard and heavy bodies use different contact/passing cadences. Wildlife emits quadruped stride events, heavy animals plant more slowly, and runtime bob is synchronized closely to the contact cycle.
- Attack and hit frames articulate around a fixed ground anchor. Death uses one controlled accelerated rotation, a short settle, and a stable final corpse frame instead of combining sprite squash with a second rotation.
- Bare-fist combat has its own `punch` state. The survivor now loads a planted stance, rotates shoulder and hip through a full-extension cross, retracts into guard and settles on the same 450 ms cadence used for authoritative fist attacks. The former detached skin-color rectangle has been removed.
- Tree depletion preserves the exact oak, ironwood, pine or birch sprite. It now has root recoil, a 0.84 s accelerating fall, impact debris and bounce, delayed impact audio, a grounded hold, and a short final fade.
- Moose, raccoon and cougar extend the fauna set with their own fallback rows, production frames, behavior, drops, sounds and map placements.
- Published humanoids render from 80 by 64 px masters and wide-running wildlife from 96 by 64 px normalized masters; tree resources remain 64 px. The added width is transparent action room, while per-asset `renderScale` and shared height keep their gameplay footprint consistent.
- Keyframe events now cover footsteps/strides, hit recovery, death contact and the brute roar/slam. Weapon-specific reload events remain blocked on additional authoritative snapshot state.

## Smoothness and pipeline pass — 24 July 2026 (second pass)

- Clip evaluation moved into `apps/web/game/animation.ts`, shared verbatim by the renderer and the new `/dev/animations` QA harness (`npm run art:preview`), so playback iterated in the harness is what ships.
- Walk playback is stride-driven: a per-entity accumulator advances with actual ground speed (bounded 0.55–1.9× of the authored cadence around 160 px/s), and the procedural bob/sway phase is derived from the same stride cycle, eliminating foot-cadence drift at any velocity.
- State exits crossfade for ~100 ms (walk/idle/recovery transitions only); hit, death, attack and punch entries still snap. The fallback `chars.png` path crossfades the same way.
- Clips can opt into `blendMs` keyframe blending (idle 90, attack 50, punch 45, hit 40, death 80); keyframes tagged `impact` never blend in, so strikes stay hard.
- Fixed: `punch` state elapsed fell through to wall-clock time in both `drawPlayer` and `drawEnemy`, freezing bare-fist attacks on their final frame. Attacks and punches now share the timestamped elapsed path.
- Attacks displace the body along the facing angle (pull back through windup, ~4 px committed lunge at impact, eased settle) for players and enemies.
- Locomotion gained generated push-off in-betweens (frames 19/20) for an eight-step cycle, idle gained a half-inhale (frame 21) for a four-step breathing triangle, and quadrupeds now breathe (1 px chest lift).
- `shiftUpper` backfills the rows it vacates, removing the horizontal slit wide bodies (bear, brute) showed in lifted poses; generated cells are also cleaned of chroma-key fringe and isolated speckles.
- Performance: published frames rasterize through bulk `ImageData` writes instead of ~2M per-pixel `fillRect` calls (world init and `s:visuals` pushes no longer stall), and the per-viewer snapshot filter memoizes LOS per target tile with squared-distance early-outs in the 20 Hz broadcast loop.
- Verified in a real guest raid: walk mirroring, punch windup/impact/retract against rocks and trees, spear craft-equip-thrust attachment, death overlay and redeploy.

## Alignment, HUD-perf and panel-chrome pass — 24 July 2026 (third pass)

- The metronomic in-game stutter was the NET/clock HUD readouts: each ~1 s state change re-rendered the whole GameClient tree (~66 ms dev-mode long task, confirmed via PerformanceObserver + mutation correlation). Both chips now own their state outside the tree and receive updates through registered setters; a 900-frame capture afterwards recorded zero long tasks.
- Actor frames register by planted-feet centroid instead of silhouette bounding box, so slung gear or an extended fist no longer shifts the body off the entity anchor between poses (republished as sprite rev 67 / animation rev 11).
- Player and enemy shadows sit at the sprite's actual feet (frame bottom minus baseline padding) rather than a fixed offset the taller production art overran; armor overlay placeholders scale with the rendered sprite.
- Center panels (crafting, inventory, trade, social) moved from the old flat steel chrome to the same dithered olive field-gear material as the HUD: brass headers, raised/pressed/disabled button bevels, recessed tabs with a brass active strip, sunken recipe sockets, framed requirement rows with met/short status edges, and a recessed red-tinted blocked-craft state distinct from ordinary disabled buttons.

## Recommended follow-up engineering

- Add a proper animation graph with cross-fades and per-clip playback rates derived from world speed.
- Add reload and interaction timestamps to snapshots so those states can be authored like attack/hit/death.
- Add directional north/south actor variants once the animation graph supports facing-specific clip selection.
- Pool high-volume particles and atlas published DB frames before raising effect counts.
- Profile low-end integrated GPUs with 100 visible actors; reduce ambient terrain effects dynamically if frame time exceeds budget.
- Add optional camera look-ahead and a user-facing screen-shake strength setting after cursor-to-world transforms share the camera offset.

## Verification target

- Local input remains immediate at 60+ render FPS.
- Remote motion stays continuous through normal 20 Hz snapshots and brief packet jitter.
- No client animation changes movement, damage, collision, attack eligibility or other authoritative outcomes.
- Fallback and published art both render through the same state contract.
- Reduced-motion removes nonessential bob, sway, flame and entry motion without hiding gameplay feedback.
