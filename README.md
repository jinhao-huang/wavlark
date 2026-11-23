# Wavlark

Wavlark is a public file library. SvelteKit renders the catalog on Cloudflare
Workers and calls a Rust Worker through a service binding for metadata and downloads.

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

Open the local URL printed by Vite to browse the public file library. A fresh
catalog is empty. Setup applies the local D1 migrations and initializes
`.dev.vars` with credentials for Wrangler's local R2 emulator. If an existing
`.dev.vars` uses a relative `R2_ENDPOINT`, replace it with the absolute URL
from `.dev.vars.example`. At the same origin as the catalog, `GET /api/health`
returns `{"status":"ok"}`.

Run `mise run build` to build and dry-run both Workers locally.

## Try a local file

From the repository root, add a file to local R2 and publish its catalog entry:

```sh
printf 'Hello\n' | mise exec -- pnpm exec wrangler r2 object put wavlark-files/hello --local --pipe \
  --content-type text/plain --content-disposition 'attachment; filename="hello.txt"'
mise exec -- pnpm exec wrangler d1 execute DB --local \
  --command "INSERT OR REPLACE INTO resources (id, name, size_bytes, published_at) VALUES ('hello', 'hello.txt', 6, unixepoch())"
```

Refresh the home page and open **hello.txt**. The resource ID doubles as its
object key. R2's `Content-Disposition` supplies the download filename. A null
`published_at` keeps the resource out of the catalog and disables its
`/download/<id>` link. For a published file, that link redirects to a
five-minute signed R2 URL.

For the deployed Rust Worker, configure `R2_ENDPOINT` with the account's absolute R2
S3 endpoint and `R2_BUCKET_NAME` with the private bucket name. Store the
bucket-scoped, read-only credentials as Worker secrets `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY`.
