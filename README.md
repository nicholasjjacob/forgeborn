# Forgeborn

A 3D top-down action idle RPG that runs in the browser and installs as an app.

**▶ Play: https://nicholasjjacob.github.io/forgeborn/**

## The game

- **Fight:** drag to move, or turn on **Auto** and let the hero hunt.
- **Explore:** 18 zones across six terrains on the 🗺 world map. New zones open with hero level and zone bosses.
- **Forge:** turn monster shards into swords, axes, spears and hammers, then merge them into higher tiers and rarities.
- **Grow:** upgrades, the Level Road, quests, achievements and daily missions.
- **Reforge:** restart for embers that buy permanent perks.
- **Keep earning:** progress saves automatically, and the hero earns while you're away.

## Run it

```
npm install
npm run dev      # http://localhost:5173, also reachable from a phone on the same Wi-Fi
npm test
npm run build    # production build in dist/
```

Pushing to `main` deploys to GitHub Pages.

## How it's built

- **TypeScript and Vite.**
- **Three.js:** the 3D world, including animated models, shadows and effects.
- **PixiJS:** the 2D overlay with health bars and damage numbers.
- **The rest:** the game rules (`src/sim/`) run in a fixed 30 Hz simulation with no rendering, so they're fully testable. The 3D world lives in `src/render/` and the menus in `src/ui/`.

The 3D models in `public/models/` are converted from the source packs with `blender -b --python scripts/build-models.py`.

## Credits

3D models by [Quaternius](https://quaternius.com) (CC0): Ultimate Monsters, Stylized Nature MegaKit, Knight Character.
UI icons from [game-icons.net](https://game-icons.net) by Lorc, Delapouite and contributors (CC BY 3.0), restyled in code. Fonts: Lilita One and Fredoka (SIL OFL).
