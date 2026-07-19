# Plutonium GCDN

A collection of browser-playable games, served as standalone HTML files via a CDN-friendly directory structure.

## Structure

```
/
├── config.json       # Game registry (names, paths, metadata)
└── games/            # One .html file per game
    ├── cookie-clicker.html
    ├── minecraft-1.5.2.html
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
    { "id": "cookie-clicker", "name": "Cookie Clicker", "path": "games/cookie-clicker.html" }
  ]
}
```

## Adding a Game

1. Drop the self-contained `.html` file into `games/`.
2. Add a corresponding entry to the `games` array in `config.json`.

## License

See [LICENSE](LICENSE).
