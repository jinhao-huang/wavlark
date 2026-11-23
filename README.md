# Wavlark

Wavlark is a public file library built with SvelteKit and a Rust Cloudflare Worker.

## Run locally

With [mise](https://mise.jdx.dev/) installed, set up a fresh checkout from the repository root.

```sh
mise trust
mise run setup
```

Start the local server:

```sh
mise run dev
```

Open the local URL printed by Wrangler for the home page. At the same origin,
`GET /api/health` returns `{"status":"ok"}`.

Run `mise run build` to build the static site and bundle the Worker locally.
