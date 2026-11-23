# Wavlark

Wavlark is a public file library built with SvelteKit and a Rust Cloudflare Worker.

## Run locally

Install Node.js 24 LTS with npm and stable Rust with rustup. Use a shell with
Cargo's bin directory on your `PATH`. Run these commands from the repository root.

```sh
rustup target add wasm32-unknown-unknown
cargo install --locked worker-build --version 0.9.0
npm ci
npm run dev
```

Open the local URL printed by Wrangler for the home page. At the same origin,
`GET /api/health` returns `{"status":"ok"}`.

Run `npm run build` to build the static site and bundle the Worker without deploying.
