# Wavlark

Wavlark is a public file library built with SvelteKit and a Rust Cloudflare Worker.

## Run locally

Install [mise](https://mise.jdx.dev/) and run these commands from the repository root.

```sh
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

Open the local URL printed by Wrangler for the home page. At the same origin,
`GET /api/health` returns `{"status":"ok"}`.

Run `mise exec -- pnpm build` to build the static site and bundle the Worker without deploying.
