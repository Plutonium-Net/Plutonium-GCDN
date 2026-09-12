# Plutonium GCDN

A collection of browser-playable games, served as standalone HTML files via a CDN-friendly directory structure.

## Structure

```
/
├── config.json       # Game registry (names, paths)
├── details.json      # Per-game descriptions, controls, banners, sync, tags
└── games/            # One folder per game
    ├── cookie-clicker/index.html
    ├── minecraft-1.5.2/index.html
    └── ...
```

## config.json

The root [`config.json`](config.json) is the source of truth for the game catalogue. Each entry contains:

| Field  | Description                              |
|--------|------------------------------------------|
| `id`   | URL-safe slug matching the filename      |
| `name` | Human-readable display name             |
| `path` | Relative path to the game's HTML file   |

```json
{
  "site": {
    "name": "Plutonium GCDN",
    "description": "A collection of browser-playable games.",
    "gamesDir": "games"
  },
  "games": [
    { "id": "cookie-clicker", "name": "Cookie Clicker", "path": "games/cookie-clicker/index.html" }
  ]
}
```

The root [`details.json`](details.json) stores optional per-game metadata keyed by game id:

```json
{
  "basket-random": {
    "description": "Ragdoll basketball for one or two players.",
    "controls": [
      { "keys": "W A S D", "action": "Move" }
    ],
    "banner": "images/basket-random.png",
    "cloudSync": true,
    "tags": ["2 Player", "Sports"]
  }
}
```

## Adding a Game

1. Add the self-contained game page as `games/<game-id>/index.html`.
2. Add a corresponding entry to the `games` array in `config.json`.
3. Add a matching metadata entry to `details.json`.

## License

See [LICENSE](LICENSE).
