# Wavlark

Wavlark is a public file library. The SvelteKit Worker in `web/` (`wavlark`)
renders the catalog. Its `API` service binding calls the Rust Worker in
`worker/` (`wavlark-api`) for metadata and signed downloads.

## Run locally

With [mise](https://mise.jdx.dev/) installed, set up a fresh checkout from the repository root.

```sh
mise trust
mise run setup
```

If your checkout has a `.dev.vars` at the repository root, copy any custom
values into `worker/.dev.vars`. For local R2, use the endpoint from
`worker/.dev.vars.example`.

Start the local server:

```sh
mise run dev
```

Open the URL printed by Vite. The catalog and signed downloads share this
address. Vite starts on port 5173 and tries the next available port if it's
busy. To choose a different starting port, run `mise run dev --port 5200`.

Setup initializes `worker/.dev.vars` for the R2 emulator and applies the
local D1 migrations. Each checkout keeps its D1 and R2 data in
`.wrangler/state`. A fresh catalog is empty. `GET /api/health` returns
`{"status":"ok"}`.

Run `mise run build` to build and dry-run both Workers locally.

## Try a local file

From the repository root, add a file to local R2 and publish its catalog entry:

```sh
printf 'Hello\n' | mise run wrangler:local r2 object put wavlark-files/hello --pipe \
  --content-type text/plain --content-disposition 'attachment; filename="hello.txt"'
mise run wrangler:local d1 execute DB \
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

## Publisher access

Create one Cloudflare Access self-hosted application for `/manage` and
`/api/manage` on the site's hostname. Add an Allow policy for the invited
email addresses. Child paths [inherit the policy](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/#policy-inheritance).

In the `vars` section of `worker/wrangler.jsonc`, set `ACCESS_ISSUER` to the
team origin (e.g. `https://your-team.cloudflareaccess.com`, without a trailing
slash) and `ACCESS_AUD` to the application's audience tag. Open **Publisher
workspace** on the deployed site and sign in to see your email.

To verify the management page and API locally with temporary signed test
credentials, run `mise run test`.
