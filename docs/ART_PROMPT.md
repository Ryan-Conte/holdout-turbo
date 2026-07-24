# HOLDOUT production art prompt set

Mode: built-in image generation.

Reference supplied by the user: `docs/assets/asset-style-reference.png`.

All source sheets use crisp hand-placed pixel clusters, dark charcoal outlines, restrained material dithering, consistent upper-left lighting, grounded shadows, muted forest green/olive/slate/earth/weathered-steel colors, and sparse rust/red/brass accents. The style target is a polished top-down survival extraction game atlas with readable Zero Sievert-scale silhouettes. No text, labels, UI, logos, antialiasing, vector edges, photorealism, glossy mobile-game rendering or blended gradients.

## Flora source

> Using the attached reference as the exact visual language, create a production-ready pixel-art flora and wilderness prop sprite sheet for a top-down 3/4 survival extraction game. Make a clean 4×4 grid on a perfectly flat bright magenta chroma-key background (#ff00ff), with one isolated sprite centered in each equal cell and no overlap. Exact left-to-right, top-to-bottom order: 1 evergreen spruce, 2 broadleaf oak, 3 white-barked birch, 4 golden autumn aspen; 5 bare dead snag, 6 young pine sapling, 7 dense olive shrub, 8 red berry bush; 9 fern patch, 10 marsh reeds, 11 mixed wildflowers, 12 tall field grass; 13 fallen mossy log, 14 mossy tree stump, 15 thorny bramble, 16 mushroom cluster. Detailed high-quality pixel art, crisp hard pixels, dark charcoal outlines, top-left light, bottom-right grounding shadows, muted worn natural palette, strong readable silhouettes, transparent-ready edges. Every cell contains exactly one complete object.

Output: `docs/assets/production-flora-source.png`  
Runtime keyed source: `apps/web/public/sprites/production-flora.png`

## Actor and fauna source

> Using the attached reference as the exact visual language, create a production-ready pixel-art actor and fauna sprite sheet for a top-down 3/4 survival extraction game. Make a clean 4×4 grid on a perfectly flat bright magenta chroma-key background (#ff00ff), with one isolated full-body sprite centered in each equal cell and no overlap. Exact left-to-right, top-to-bottom order: 1 olive tactical survivor with rifle, 2 bloodied infected zombie, 3 dark military rifleman, 4 hooded scavenger trader; 5 antlered deer, 6 rabbit, 7 wild boar, 8 grey wolf; 9 red fox, 10 brown bear, 11 bull moose, 12 raccoon; 13 tawny cougar, 14 armored infected brute, 15 olive survivor alternate, 16 dark survivor alternate. Consistent 3/4 top-down angle, grounded feet, detailed equipment and fur, crisp hard pixel clusters, charcoal outlines, restrained dithering, upper-left light and bottom-right shadows. Strong gameplay silhouettes, no cropped parts, every actor fully inside its cell.

Output: `docs/assets/production-actors-source.png`  
Runtime keyed source: `apps/web/public/sprites/production-actors.png`

## Actor locomotion contact A

> Use case: precise-object-edit. Asset type: production pixel-art animation pose atlas. Preserve the input's exact 4 by 4 grid, all sixteen actor identities, costumes, equipment, palette, scale, pixel density, viewpoint, magenta background, spacing and cell order. Change only the pose of every actor into the first walk/run contact pose. Humanoids use one clearly planted forward leg with the opposite natural arm swing and stable torso. Quadrupeds extend one foreleg and the opposite hind leg, compressing the other legs beneath the body with a subtle forward weight shift. Rabbit uses a first bound contact; brute uses a heavy foot plant. Preserve facing, silhouettes, antlers, tails, gear and proportions. Perfectly flat uniform #ff00ff background; no overlap, cropping, added subjects, text, blur, antialiasing or watermark.

Output: `docs/assets/production-actors-walk-a-source.png`  
Runtime keyed source: `apps/web/public/sprites/production-actors-walk-a.png`

## Actor locomotion contact B

> Use case: precise-object-edit. Asset type: production pixel-art animation pose atlas. Preserve contact A's exact 4 by 4 grid, identities, faces, costumes, weapons, equipment, palette, scale, pixel density, viewpoint, magenta background, spacing and cell order. Change only the limbs into the opposite walk/run contact pose. Humanoids reverse the forward/back legs and natural arm swing while heads and torsos remain stable. Quadrupeds reverse the extended foreleg/opposite hind leg pair and weight shift. Rabbit uses the opposite bound contact; brute uses the opposite heavy foot plant. Preserve all identity and silhouette invariants. Perfectly flat uniform #ff00ff background; no overlap, cropping, new subjects, text, blur, antialiasing or watermark.

Output: `docs/assets/production-actors-walk-b-source.png`  
Runtime keyed source: `apps/web/public/sprites/production-actors-walk-b.png`

## Actor punch wind-up

> Use case: identity-preserve. Asset type: production pixel-art action pose atlas for a top-down survival extraction game. Image 1 is the exact 4×4 character and fauna identity atlas and the edit target. Create the ANTICIPATION / WIND-UP frame for every subject while preserving the exact 4×4 grid, order, identity, outfit, equipment, colors, scale, pixel density, and magenta chroma-key background. Every subject still faces toward screen-right. Humanoids use a clear bare-knuckle straight-punch wind-up: feet planted in a fighting stance, knees slightly bent, weight loaded onto the rear leg, torso and hips rotated backward, rear punching fist drawn tightly beside the ribs, lead hand raised in guard, shoulders compressed. This is anticipation only; no arm is extended yet. Zombie and brute use the same readable wind-up adapted to their body shapes, with a heavier hunched shoulder load. Animals preserve species and identity but use an appropriate attack-anticipation pose: body compressed, weight loaded on rear legs, head lowered or pulled back, without becoming humanoid. Crisp high-detail 2D pixel art matching Image 1 exactly, hard pixel clusters, restrained post-apocalyptic olive/brown palette, no smoothing. Exact same four columns and rows with generous separation; every subject fully inside its cell; feet or paws share Image 1's baseline. Perfectly flat solid magenta chroma-key background, uniform edge to edge. Change only the action pose; preserve all identities and costume details; exact original subject order. No added characters, weapons, props, labels, shadows, gradients, floor plane, particles, motion blur, text, watermark, anti-aliasing, semi-transparent edges or magenta inside a subject. Avoid idle, walking or already-extended poses, crossed arms, extra limbs, malformed hands, size drift, cropping, grid lines and background texture.

Output: `docs/assets/production-actors-punch-windup-source.png`  
Runtime keyed source: `apps/web/public/sprites/production-actors-punch-windup.png`

## Actor punch impact

> Use case: identity-preserve. Asset type: production pixel-art action pose atlas for a top-down survival extraction game. Image 1 is the exact 4×4 character and fauna identity atlas and the edit target. Create the PEAK IMPACT frame for every subject while preserving the exact 4×4 grid, order, identity, outfit, equipment, colors, scale, pixel density, and magenta chroma-key background. Every subject attacks toward screen-right. Humanoids deliver a powerful bare-knuckle rear-hand straight punch at full extension. The punching arm forms a clear shoulder-to-fist line, rear shoulder and hip rotate through the strike, weight transfers onto a bent lead leg, rear heel lifts, opposite hand stays tight against the cheek in guard, and the head remains protected behind the lead shoulder. The silhouette must read instantly as a punch, not running or pointing. Zombie and brute use the same readable strike adapted to their body shapes, with an especially heavy committed brute punch. Animals preserve species and identity but use their appropriate peak attack/lunge pose with forequarters, head or claws committed forward. Crisp high-detail 2D pixel art matching Image 1 exactly, hard pixel clusters, restrained post-apocalyptic olive/brown palette, no smoothing. Exact same four columns and rows with generous separation; every subject fully inside its cell; planted feet/paws retain Image 1's baseline; allow room to screen-right. Perfectly flat solid magenta chroma-key background, uniform edge to edge. Change only the action pose; preserve all identities and costume details; exact original subject order. No added characters, weapons, props, labels, shadows, gradients, floor plane, impact particles, speed lines, motion blur, text, watermark, anti-aliasing, semi-transparent edges or magenta inside a subject. Avoid idle, walking/running, short bent jabs, both arms extended, crossed arms, extra limbs, malformed hands, size drift, cropping, grid lines and background texture.

Output: `docs/assets/production-actors-punch-impact-source.png`  
Runtime keyed source: `apps/web/public/sprites/production-actors-punch-impact.png`

## Actor punch recovery

> Use case: identity-preserve. Asset type: production pixel-art action pose atlas for a top-down survival extraction game. Image 1 is the exact 4×4 character and fauna identity atlas and the edit target. Create the PUNCH RETRACTION / RECOVERY frame for every subject while preserving the exact 4×4 grid, order, identity, outfit, equipment, colors, scale, pixel density, and magenta chroma-key background. Every subject still faces toward screen-right. Humanoids are shown immediately after a committed straight punch: punching arm bent halfway back toward the ribs with the elbow returning along the body; opposite fist high in guard; shoulders and hips visibly unwinding; weight beginning to return from the lead leg while both feet stay planted and knees remain flexed. It must read as recoil/retraction, distinct from both wind-up and full extension. Zombie and brute use the same heavy retraction adapted to their bodies with residual forward momentum. Animals preserve species and identity but use an appropriate attack-recovery pose with forequarters landing or pulling back and weight settling. Crisp high-detail 2D pixel art matching Image 1 exactly, hard pixel clusters, restrained post-apocalyptic olive/brown palette, no smoothing. Exact same four columns and rows with generous separation; every subject fully inside its cell; feet or paws share Image 1's baseline. Perfectly flat solid magenta chroma-key background, uniform edge to edge. Change only the action pose; preserve all identities and costume details; exact original subject order. No added characters, weapons, props, labels, shadows, gradients, floor plane, particles, motion blur, text, watermark, anti-aliasing, semi-transparent edges or magenta inside a subject. Avoid idle, walking/running, full extension, fully loaded wind-up, crossed arms, both arms extended, extra limbs, malformed hands, size drift, cropping, grid lines and background texture.

Output: `docs/assets/production-actors-punch-recovery-source.png`  
Runtime keyed source: `apps/web/public/sprites/production-actors-punch-recovery.png`

## Props and structures source

> Using the attached reference as the exact visual language, create a production-ready pixel-art prop and structure sprite sheet for a top-down 3/4 survival extraction game. Make a clean 4×4 grid on a perfectly flat bright magenta chroma-key background (#ff00ff), one isolated complete object per equal cell, centered with no overlap. Exact left-to-right, top-to-bottom order: 1 cluttered workbench, 2 glowing stone furnace, 3 steel anvil on stump, 4 ringed campfire; 5 military cot bed, 6 wooden storage chest, 7 reinforced steel crate, 8 burning torch post; 9 rough wooden wall section, 10 weathered stone wall section, 11 reinforced metal door, 12 log-and-wire fence; 13 rusted wrecked car, 14 striped road barrier, 15 sandbag wall, 16 bare dead tree. Detailed worn materials, crisp hard pixels, dark outlines, top-left light, restrained dithering, grounded bottom-right shadows, muted olive/brown/slate palette with sparse warm flame and rust accents.

Output: `docs/assets/production-props-source.png`  
Runtime keyed source: `apps/web/public/sprites/production-props.png`

## Terrain source

> Using the attached reference as the exact visual language, create a production-ready seamless pixel-art terrain tile sheet for a top-down survival extraction game. Make an exact edge-to-edge 4×4 grid with no gutters, borders, labels or gaps. Exact left-to-right, top-to-bottom order: 1 lush mottled grass, 2 dark shallow water with reeds and stones, 3 dusty sand and pebbles, 4 broken asphalt road; 5 churned brown mud, 6 cracked dark asphalt, 7 weathered wood floor boards, 8 fitted grey stone floor; 9 leaf-littered forest floor, 10 rocky ground, 11 worn rubber-and-metal doormat, 12 canvas cot-bed surface; 13 copper ore ground, 14 iron ore ground, 15 mossy cliff rock, 16 dry yellow field grass. High-detail crisp pixel clusters, restrained texture dithering, dark muted olive/earth/slate palette, consistent upper-left light, tiling-friendly edges and no objects crossing between cells.

Output: `docs/assets/production-terrain-source.png`  
Runtime source: `apps/web/public/sprites/production-terrain.png`

## Items A source

> Using the attached reference as the exact visual language, create a production-ready pixel-art item icon sheet for a survival extraction game. Make a precise 6×6 grid on a perfectly flat bright magenta chroma-key background (#ff00ff), one isolated item centered per equal cell with no overlap. Exact left-to-right, top-to-bottom order: wood log, stone chunks, copper ore, iron ore, copper ingot, iron ingot; carbon pieces, leather hide, cloth roll, rope coil, duct tape roll, scrap metal; pistol ammunition, rifle ammunition, shotgun shells, arrows, pistol, assault rifle; double-barrel shotgun, sniper rifle, combat knife, hatchet, pickaxe, hunting bow; hammer, shovel, civilian helmet, military helmet, civilian vest, military vest; small backpack, military backpack, red dot sight, suppressor, raw meat, cooked meat. Highly detailed miniature icons with crisp hard pixels, dark charcoal outlines, restrained dithering, top-left light, bottom-right grounding shadow, worn olive/brown/steel palette and sparse red/brass accents. Every icon fully inside its cell.

Output: `docs/assets/production-items-a-source.png`  
Runtime keyed source: `apps/web/public/sprites/production-items-a.png`

## Items B source

> Using the attached reference as the exact visual language, create a production-ready pixel-art item icon sheet for a survival extraction game. Make a precise 6×6 grid on a perfectly flat bright magenta chroma-key background (#ff00ff), one isolated item centered per equal cell with no overlap. Exact left-to-right, top-to-bottom order for the first 31 cells: 1 berry cluster, 2 canned food, 3 water bottle, 4 bandage roll, 5 medical kit, 6 painkiller bottle; 7 fuel can, 8 electronic parts, 9 flashlight, 10 gold bar, 11 diamond, 12 relic; 13 wood floor building kit, 14 wood wall kit, 15 wood door kit, 16 wood fence kit, 17 campfire kit, 18 torch-post kit; 19 storage-chest kit, 20 workbench kit, 21 furnace kit, 22 bed kit, 23 stone floor kit, 24 stone wall kit; 25 stone door kit, 26 stone fence kit, 27 rifle schematic, 28 armor schematic, 29 medical schematic, 30 fuel bundle, 31 steel crate kit. Leave the remaining five cells empty magenta. Detailed worn miniature icons, crisp hard pixels, charcoal outlines, restrained dithering, upper-left light, bottom-right shadow, muted olive/earth/steel palette with readable red, gold and cyan accents. Every icon fully inside its cell.

Output: `docs/assets/production-items-b-source.png`  
Runtime keyed source: `apps/web/public/sprites/production-items-b.png`

The runtime sheets are not used as opaque generated blobs. `tools/lib/production-art.mjs` chroma-keys, normalizes, outlines and packs the sources into 132 editable RGBA assets and derives 266 state-animation frames.
