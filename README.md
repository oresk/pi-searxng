# @oresk/pi-searxng

Pi extension that adds a `web_search` tool backed by a self-hosted [SearXNG](https://docs.searxng.org/) instance — a privacy-respecting meta search engine aggregating results from multiple engines.

## Install

```bash
pi install npm:@oresk/pi-searxng
```

## Configuration

On first run, the extension creates a config file at:

```
~/.pi/agent/pi-searxng.jsonc
```

Edit it to configure your SearXNG instance and search preferences:

```jsonc
{
  // SearXNG instance URL.
  // Override with the SEARXNG_URL environment variable.
  "searxngUrl": "https://search.yourdomain.com",

  // Request timeout in milliseconds.
  "timeoutMs": 30000,

  // Maximum number of results per search (1–50).
  "maxResults": 10,

  // SafeSearch level: "off", "moderate", or "strict".
  "safesearch": "off",

  // ── mTLS (mutual TLS) ────────────────────────────────────────────────
  // Set these paths to authenticate with a SearXNG instance that requires
  // client certificates. Override with SEARXNG_CERT, SEARXNG_KEY, SEARXNG_CA.
  "mtlsCert": "/path/to/client-cert.pem",
  "mtlsKey":  "/path/to/client-key.pem",
  "mtlsCa":   "/path/to/ca-cert.pem"
}
```

The `SEARXNG_URL` environment variable takes priority over the config file:

```bash
export SEARXNG_URL="https://search.yourdomain.com"
```

If neither is set, it defaults to `http://localhost:8080`.

### mTLS (Mutual TLS)

For SearXNG instances that require client certificate authentication, configure mTLS via environment variables or config:

```bash
export SEARXNG_CERT="/path/to/client-cert.pem"
export SEARXNG_KEY="/path/to/client-key.pem"
export SEARXNG_CA="/path/to/ca-cert.pem"
```

Or in the config file:

```jsonc
{
  "mtlsCert": "/path/to/client-cert.pem",
  "mtlsKey":  "/path/to/client-key.pem",
  "mtlsCa":   "/path/to/ca-cert.pem"
}
```

Environment variables take priority over config values. `mtlsCert` and `mtlsKey` are required for mTLS to activate; `mtlsCa` is optional (use when the server uses a self-signed or private CA certificate).

### Setting up SearXNG

If you don't have a SearXNG instance yet, the easiest way is Docker:

```bash
docker run -d -p 8080:8080 \
  -e "SEARXNG_BASE_URL=http://localhost:8080/" \
  searxng/searxng
```

See the [SearXNG docs](https://docs.searxng.org/admin/installation-docker.html) for production setup.

## Available Categories

The tool supports all SearXNG engine categories:

| Category | Engines |
| ---------- | --------- |
| `general` / `web` | Google, Brave, DuckDuckGo, Startpage |
| `news` | Bing News, Google News, Reuters, Yahoo News |
| `it` | StackOverflow, MDN, GitHub, PyPI, Docker Hub, Arch Wiki |
| `science` | arXiv, PubMed, Google Scholar, Semantic Scholar |
| `packages` | PyPI, Docker Hub, Hoogle |
| `repos` | GitHub |
| `q&a` | StackOverflow, AskUbuntu, SuperUser |
| `images` | Google Images, Bing Images, Unsplash, Pexels, Flickr |
| `videos` | YouTube, Vimeo, Dailymotion |
| `social media` | Mastodon, Lemmy |
| `software wikis` | Arch Linux Wiki, Gentoo Wiki |
| `map` | OpenStreetMap |
| `weather` | wttr.in |
| `translate` | Lingva, Dictzone |
| `dictionaries` / `define` | Wiktionary, Wordnik, Etymonline |
| `music` | Bandcamp, SoundCloud, YouTube |
| `files` | Pirate Bay, SolidTorrents |
| `wikimedia` | Wiktionary, Wikinews |

## License

MIT
