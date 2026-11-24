# Wavlark

[简体中文](README.zh-CN.md)

Wavlark is a public file library. Any administrator can upload, publish, and delete files.
The SvelteKit Worker
in `web/` (`wavlark-web`) renders the catalog. Its `API` service binding calls the Rust Worker in
`api/` (`wavlark-api`) for publication, catalog queries, and signed file transfers.

## Run locally

With [mise](https://mise.jdx.dev/) installed, set up a fresh checkout from the repository root.

```sh
mise trust
mise run setup
mise run dev
```

Open the URL printed by Vite. The catalog and signed downloads share this
address. Vite starts on port 5173 and tries the next available port if it's
busy. To choose a different starting port, run `mise run dev --port 5200`.

To manage files locally, start `mise run dev:admin` and open **Manage files**.
You sign in as `admin@example.com` without a Cloudflare account. Use `mise run dev` for the signed-out view.

Setup initializes `api/.dev.vars` for the R2 emulator and applies the
local D1 migrations. Each checkout keeps its D1 and R2 data in
`.wrangler/state`. A fresh catalog is empty. `GET /api/health` returns
`{"status":"ok"}`.

Run `mise run build` to build and dry-run both Workers locally.

## Manage files

In **Manage files**, choose a file of up to 100 MiB. Leave **Directory**
empty for the root, or enter a path such as `Maps/Europe`. You can add a
description. Select **Upload file**, then **Confirm publication** to make the
file public. Share its details page, for example `/resources/Maps/Europe/atlas.pdf`.

Uploads reserve their path. A retry in the same form gets a fresh upload link
for the original draft. Unpublished drafts expire after 24 hours. Scheduled
cleanup deletes their files and releases their paths.

Under **Published files**, select **Delete** and confirm. The share link stops
working immediately. Publishing a new file at the same path makes that link open
the new file. Wavlark deletes the old R2 object by UUID. If R2 is unavailable,
daily cleanup retries the deletion. Previously issued R2 download links expire
within five minutes.

## Production storage

Use a private R2 bucket dedicated to this D1 database. Set `R2_ENDPOINT` to the
account's absolute R2 S3 endpoint and `R2_BUCKET_NAME` to the bucket name. Give the signing
credentials **Object Read & Write** access to this bucket and store them in
Worker secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.

In the [bucket CORS policy](https://developers.cloudflare.com/r2/buckets/cors/),
allow the site's origin to send `PUT` with the headers `Content-Type`,
`Content-Disposition`, `If-None-Match`, and `x-amz-meta-wavlark`. Check the policy by uploading from
the deployed site in a browser.

## Administrator access

Create one Cloudflare Access self-hosted application for `/manage` and
`/api/manage` on the site's hostname. In the Allow policy, set **Include → Emails** to
the email addresses of everyone who should manage the library. Child paths [inherit the policy](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/#policy-inheritance).

In the `vars` section of `api/wrangler.jsonc`, set `ACCESS_ISSUER` to the
team origin (e.g. `https://your-team.cloudflareaccess.com`, without a trailing
slash) and `ACCESS_AUD` to the application's audience tag. Open **Manage files**
on the deployed site and sign in to see your email.

To verify the management page and API locally with temporary signed test
credentials, run `mise run test`.
