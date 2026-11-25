# Forgeborn

A 3D top-down action idle RPG that runs in the browser and installs as an app on phones and PCs.

**▶ Play: https://nicholasjjacob.github.io/forgeborn/**

## The game

- **Fight:** drag to move (click, or WASD and the arrow keys, on PC), or turn on **Auto** and let the hero hunt.
- **The Greenwood:** one big hand-designed forest of nine regions: Meadow Outskirts, Goldenrod Fields, Mistwater Glade, Emberleaf Woods, Bloomwood Groves, Tidepine Thicket, Crimson Hollow, Old Mill Crossing and Emerald Mere.
  - Each region has its own colours, three monsters of its own and a boss lair.
  - Regions are separated by rocky borders, and the passes stay barricaded until you reach the region's level and beat the boss before it.
  - Monsters live in haunts around landmarks, and some areas are overrun with hordes.
- **Maps:**
  - A minimap that shows either the land around you (circle) or the whole forest (square).
  - A 3D World Map of the whole forest, greyed out until explored, with a close-up of each region and fast travel.
- **Heroes:** nine classes (Knight, Barbarian, Rogue, Ranger, Mage, Druid, Engineer, Shadow Rogue and the giant Warlord), each with its own perks, weapons, styles and colour schemes.
- **Forge:** turn monster shards into class weapons, then merge three of a kind into the next rarity (Common → Uncommon → Rare → Epic → Legendary → Mythic → Divine).
- **Grow:**
  - Progression: upgrades, the Level Road and Reforge (restart for embers that buy permanent perks).
  - Goals: the Quest Book, achievements, daily and weekly missions, a 7-day journey and the Monster Codex.
- **Quest Book:** every region has its own quests: hunt each of its monsters, slay its elites, beat its boss and explore it. Each quest has three tiers that earn stars, stars unlock region milestones (gems, gold), and mastering a region gives a permanent +5% damage and gold. Progress is kept for good, so it pays to go back to old regions.
- **Keep earning:** progress saves automatically, and the hero earns while you're away.

## Run it

```
npm install
npm run dev      # http://localhost:5173, also reachable from a phone on the same Wi-Fi
npm test
npm run build    # production build in dist/
```

Pushing to `main` builds, tests and deploys to GitHub Pages. The game checks for a newer version whenever it opens and updates itself.

## How it's built

- **TypeScript and Vite.**
- **Three.js:** the 3D world (animated models, shadows, effects), the World Map's 3D overview and the 3D portraits in menus.
- **PixiJS:** the 2D overlay with health bars and damage numbers.
- **Game rules:** `src/sim/` runs a fixed 30 Hz simulation with no rendering, so it's fully testable (Vitest). The forest layout (`src/sim/forest.ts`) is generated deterministically: a noise-warped Voronoi of nine regions, with passes, landmarks, haunts and props.
- **Code layout:** the 3D world lives in `src/render/` and the menus in `src/ui/`. There are two layouts, phone and full-window PC.

The 3D models in `public/models/` are built from the source packs:

- `node scripts/build-heroes.mjs`: heroes and their animations
- `node scripts/build-weapons.mjs`: weapons
- `node scripts/build-forest.mjs`: forest scenery
- `blender -b --python scripts/build-models.py`: monsters

## Credits

- **KayKit by [Kay Lousberg](https://kaylousberg.com) (CC0):** heroes, animations, weapons and the forest. The packs used are Adventurers, Character Animations, Fantasy Weapons Bits and Forest Nature Pack.
- **Monsters by [Quaternius](https://quaternius.com) (CC0):** from Ultimate Monsters.
- **UI icons from [game-icons.net](https://game-icons.net)** by Lorc, Delapouite and contributors (CC BY 3.0), restyled in code.
- **Fonts:** Lilita One and Fredoka (SIL OFL).
