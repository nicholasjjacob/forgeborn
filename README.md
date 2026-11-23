# Forgeborn

An original top-down action/idle RPG for the web (Chrome, Safari on iOS), built with TypeScript, Vite and PixiJS.

**Controls:** drag anywhere on the battlefield for a floating joystick (touch), click or hold to walk (mouse), or WASD / arrow keys. With **Auto** on, the hero hunts on their own whenever you stop steering.

**Forge:** monsters drop shards (elites and bosses drop bundles). Spend shards to forge a random weapon (10 at forge level 1, rising ×1.6 per forge level): Sword (balanced), Axe (wide sweeps), Spear (long, narrow reach) or Hammer (slow, heavy, big knockback). Merge three weapons of the same type, tier and rarity (e.g. three Rare T3 Swords) into one of the next tier with the Merge button or Auto-merge: the selected weapon keeps its traits, and a merge can roll a rarity upgrade. Rarity (Common → Rare → Epic → Legendary) multiplies attack and adds one bonus trait per step: crit chance, crit damage, swing speed, lifesteal, gold find, chain shock or reach. Your equipped weapon can be upgraded too: with 2 matching weapons in the bag its card shows Merge 3/3. Tap any weapon to see exactly how your Attack would change if you equipped it (green ▲ / red ▼), and when a merge is ready the card previews the result ("After merge (T4): Attack 265 → 340"); after equipping or upgrading, Attack counts up to its new value. Weapon slots start at 20; the ⚔ Slots button buys another row of 5 with gold (1.5K, 4.5K, 13.5K…) up to 60, and extra slots are kept through Reforge. The forge has its own level (the 🔨 Forge Level button opens its window): upgrading it with gold forges higher tiers with better odds and adds +4% attack per level to whatever weapon you wield. Forge level is capped by how far you've got this run: one level per terrain reached on the map. Salvage spares for a quarter of their forge price in shards, so forging just to salvage never pays.

**Reforge (prestige):** once you've unlocked Sunscar Crossroads (zone 9) you can reforge: restart from the first zone at hero level 1 for embers (more the further you got). Embers buy permanent perks (damage, HP, gold, shard drops, speed, starting forge level, head start: begin at a higher hero level with the zone bosses below it already beaten, longer offline cap), and every ember ever earned also adds Ember Glow (+2% damage, +1% HP), so each run goes further than the last.

**Quests & achievements:** three rolling quests (defeat monsters, defeat elites, beat a boss, forge, merge, earn gold) pay gold and shards and are replaced when claimed. Achievements track lifetime milestones; every tier unlocked adds +3% damage and gold permanently.

**Hero level (1–100):** every kill gives XP (more in higher zones; bosses give 20×). Each level adds +3% damage and HP and +1% gold, and new levels open new zones. Reforge resets the level (Level Road rewards you've claimed stay claimed). Your level shows above the hero's head and in the chip under the zone bar, coloured by tier (bronze, silver at 25, gold at 50, ruby at 75, diamond at 100). Tap the chip for the **Level Road**: a reward every 5 levels, sized to the furthest zone you've reached when you claim it. Every milestone gives gold and shards, every 10 levels adds gems, every 20 a bonus weapon (Rare, Epic from 60, Legendary at 100), and every 25 embers.

**Wood & stone:** logs lie near trees and stones near rocks (new ones appear over time), and a swing that clips a tree or rock can knock a piece loose. Walk close to collect it; nearby pieces drift to you. Materials live in the 🎒 Bag (left icon column), alongside your treasures and a weapons summary; they're kept through Reforge, ready for building later.

**Missions (side icons on the main screen):** a 7-day login calendar with a grand prize on day 7; daily and weekly mission boards (points from tasks open reward chests at 20/40/60/80/100, reset at local midnight / Monday); a 7-day starter journey that unlocks a new task set each day; a monster codex with kill milestones per area; and a gem shop (gold, shards, wood & stone, hero XP, offline time, embers). Tap any gift on a points track to see what's inside. A tracker on the main screen shows the two closest daily missions. Gems come from logins, chests and the codex.

**Saving & offline:** progress autosaves every 10 seconds (and when you leave) to IndexedDB, mirrored to localStorage. While you're away your hero keeps earning 50% of your recent gold and shard rate (shards at a 20% share), measured over the last 5 minutes of play, for up to 8 hours (more with the Night Watch perk); a welcome-back screen shows what you got.

**World map:** the world is 18 zones across six terrains (Greenfield Meadow → Mirewood → Sunscar Dunes → Hollow Deep → Frostveil → Emberforge Caldera), three zones each, then "+" tiers. Each zone has a fixed difficulty, its own layout (open scatter, groves or crossroads; the light goes from day to dusk across a terrain's three zones) and its own XP per kill, about ×1.36 per zone, so the hardest zone you can handle is the fastest place to level. A zone unlocks when the hero reaches its level (4, 6, 8, 10, 12, 15, …) AND you've beaten the previous zone's boss. Bosses are fought in a walled arena with a 45 s timer whenever you tap Fight Boss: the first two zones of a terrain have a champion (a giant version of one of its monsters), the third has the terrain's own boss. The first win pays gold, shards and 10 gems; rematches pay the usual boss loot. Open the 🗺 Map to travel to any unlocked zone, and drop back to an easier one to farm if you keep dying.

**Monsters:** each monster has a fighting style. Melee monsters walk up and bite; dashers tremble, show a red lane, then charge along it; spitters keep their distance and lob projectiles you can sidestep. In every zone past the first, golden-aura elites appear (3× health, more damage, 4× gold, guaranteed shards). Bosses wind up a ground slam shown as a filling red circle: step out before it lands. A health bar appears over any monster you hit, with a pale chunk that drains after each hit.

## Run

```
npm install
npm run dev      # http://localhost:5173 (also on your local network, for testing on a phone)
npm test         # simulation + balance tests
npm run build    # production build in dist/
```

**Install as an app:** the production build is an installable web app (manifest + service worker for offline play). Chrome/Android/desktop: Settings → Install. iPhone: open it in Safari → Share → Add to Home Screen. Regenerate the icons with `npm run icons`.

**Testing on an iPhone:** run `npm run dev`, then open the "Network" URL Vite prints (e.g. `http://192.168.x.x:5173`) in Safari on a phone on the same Wi-Fi.

## Layout

| Path | What it does |
|---|---|
| `src/sim/` | Game rules: fixed 30 Hz simulation, movement/steering, combat, balance, event queue. No rendering, fully testable. |
| `src/sim/areas.ts` | Area definitions: ground palette, props, monster roster and boss per biome. |
| `src/sim/weapons.ts` | Weapon model, forms, traits, forge odds, merge rules. Pure functions, fully testable. |
| `src/sim/map.ts` | Seeded map generation, prop collision grid, obstacle steering. |
| `src/render/` | PixiJS top-down scene: camera, depth sorting, culling, pooled effects. Art is generated in code in a soft shaded cartoon style at 4× resolution (`sprites.ts`); pre-rendered 3D sprites can replace it without touching game code. Reads sim state only. |
| `src/audio/sfx.ts` | Procedural sound effects (Web Audio, no files), haptics. |
| `src/ui/settings.ts` | Settings sheet: sound, graphics quality, frame rate, install, reset. |
| `src/pwa.ts`, `public/sw.js`, `public/manifest.webmanifest` | Installable app + offline caching. |
| `scripts/make-icons.mjs` | Draws the app icons and writes the PNGs (pure Node). |
| `src/ui/input.ts` | Joystick, click-to-move and keyboard controls. |
| `src/ui/quests.ts`, `src/ui/reforge.ts` | Quests/achievements tab and Reforge/perk shop tab. |
| `src/ui/forge.ts` | Forge tab: weapon card, forge/auto-merge, inventory grid with tap-to-merge. |
| `src/ui/hud.ts` | DOM HUD and upgrade panel, refreshed at 10 Hz with change-only writes. |
| `src/core/` | RNG, number formatting, save/load (IndexedDB + localStorage mirror, migrations). |
| `src/sim/meta.ts` | Reforge rewards, ember perks, achievements and quest templates. |
| `src/sim/missions.ts`, `src/sim/missionSystem.ts` | Login calendar, daily/weekly boards, 7-day journey, codex, gem shop (clock passed in, fully testable). |
| `src/ui/missions.ts` | Missions sheet, side icons, main-screen mission tracker. |
| `src/sim/level.ts`, `src/ui/levelRoad.ts` | Hero level: XP curve, level bonuses, milestone rewards; Level Road sheet. |
| `src/sim/gather.ts` | Wood/stone pickups: ground spawns, chopping trees and rocks, collection. |
| `src/ui/tap.ts`, `src/ui/rewardFx.ts` | Reliable taps on live-updating sheets; reward "spill" animation. |
| `src/sim/offline.ts` | Offline earnings: pure calculation from saved earning rates. |
| `tests/` | Vitest tests, including a headless greedy-player pacing check. |

## Performance notes

- Fixed-timestep sim (30 Hz) with interpolated rendering at up to 60 fps; FPS cap toggle (30/60) for battery.
- Sprites come from one shared atlas plus one small atlas per area, so the scene draws in very few batches.
- Off-screen props and monsters are culled each frame; depth sorting only touches what's on the ground layer.
- Enemy separation uses a typed-array spatial grid; prop collisions use a static grid built once per map.
- Enemies, damage numbers, coins and particles use preallocated pools; the render loop allocates nothing per frame.
- Sim → renderer events go through a typed-array queue (no per-event objects).
- Render resolution capped at 2x device pixels (1x in Low graphics); rendering and audio stop entirely while the tab is hidden.
- Only the WebGL renderer is downloaded: WebGPU/Canvas renderers and Pixi's pointer-events/accessibility layers are split out and never fetched (~160 KB gzipped to first frame).
- Sound effects are synthesized (no audio downloads), throttled per sound and capped at 14 voices.
- Storage can't hang startup: if IndexedDB doesn't answer within 1.5 s the localStorage copy is used.

## Roadmap

1. ~~Combat prototype~~
1b. ~~Top-down view, player control, areas & monster rosters~~
2. ~~Weapons & forge: inventory, merging, rarities, traits~~
3. ~~Progression: IndexedDB saves with migrations, offline earnings~~
4. ~~Meta: prestige (Reforge), quests, achievements~~
5. ~~Polish: audio, juice, PWA install, trim PixiJS imports, low-end device pass~~
6. Native wrappers via Capacitor (iOS / Android)

## 3D sprites

Characters, monsters and scenery are pre-rendered from CC0 3D models with Blender:

```
blender -b --factory-startup -P tools/blender/render_sprites.py -- tools/blender/sources.json
```

- `tools/blender/sources.json` points at the source packs on this machine (copy `sources.example.json` and edit the paths). It's git-ignored.
- The script normalises each model to a game size, renders it from the game's ¾ camera (30°, facing right) with soft lighting, adds a cartoon outline, and packs idle / walk / attack frames into `public/sprites/*.png` plus `sprites.json` (frame rects, feet anchor, visible height). A full render takes under a minute.
- Which model plays which monster is the `MANIFEST` table at the top of the script; prop models are in `PROPS`. The hero wears `Helmet3` from the knight pack (`helmet` in `sources.json`; `helmet_pos` / `helmet_scale` tune its fit), attached to the head bone so it follows every animation.
- The game loads the hero and scenery sheets at start and each area's monster sheet the first time you reach it. Anything not loaded (or missing) falls back to the code-drawn art in `src/render/sprites.ts`.

## Credits

3D models by [Quaternius](https://quaternius.com) (CC0): Ultimate Monsters, Stylized Nature MegaKit, LowPoly Animated Knight. Thank you!
