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

Run `mise run build` to build and dry-run both Workers locally. Run `mise run test`
to verify the management page and API with temporary signed credentials.

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

## Deploy to production

### Deploy the Workers

In the target Cloudflare account, create or reuse the D1 database `wavlark` and
a private R2 bucket named `wavlark-files` in the default jurisdiction, dedicated to this library. Wrangler
resolves the database by name. After local setup, sign in to that account and
deploy from the repository root.

```sh
mise exec -- pnpm exec wrangler login
mise run deploy
```

The task applies pending production D1 migrations without a prompt, deploys the
Rust API Worker (`wavlark-api`), then builds and deploys the Web Worker (`wavlark-web`).
Wrangler creates each Worker on its first deployment. A failed step stops the
release. Earlier successful steps remain in effect.

After the command succeeds, both Workers appear under **Workers & Pages**.
Use the production URL printed for `wavlark-web` in the settings below, or attach
your own domain first.

### Use a custom domain (optional)

Bind the hostname only to `wavlark-web`. Choose an unused hostname in an active Cloudflare zone in the same account.
Open **Workers & Pages → wavlark-web → Domains → Custom Domains and Routes → Add Domain**.
Enter just the hostname, for example `files.example.com`. Under **Enable for**,
select **Production**, then click **Add domain**. Once the homepage opens at
`https://files.example.com`, use that address for the steps below.

If you already manage files on `workers.dev`, add the new HTTPS origin to
`AllowedOrigins` in the existing R2 CORS policy. In the existing Access
application, add the new hostname for both `manage` and `api/manage`. Verify
sign-in and upload on the new domain before removing the old origin and Access
entries. Keep both sets of entries if you want to manage files from either address.

### Allow browser uploads

Open **R2 Object Storage → wavlark-files → Settings → CORS Policy**. Choose
**Add CORS policy** (or edit the existing policy) and open the **JSON** tab.
Paste the rule below, replace `https://files.example.com` with the origin of
your management page, then select **Save**. For example, if you open
`https://wavlark-web.my-team.workers.dev/manage`, enter
`https://wavlark-web.my-team.workers.dev` with no path or trailing slash.
[Cloudflare R2 CORS settings](https://developers.cloudflare.com/r2/buckets/cors/#add-cors-policies-from-the-dashboard)

```json
[
  {
    "AllowedOrigins": ["https://files.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "Content-Disposition", "If-None-Match", "x-amz-meta-wavlark"]
  }
]
```

### Configure administrator access

Under **Zero Trust → Access controls → Applications → Create new application**,
select **Self-hosted and private → Public DNS** and continue. Under **Destinations**,
use **Add public hostname** to add two entries for the same Web hostname.
Enter `manage` in the first **Path** field and `api/manage` in the second.
This keeps the homepage public. Choose a
login method your administrators can use and add an **Allow** policy with
**Include → Emails** set to their addresses. Save the application.
[Cloudflare Access for Worker paths](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#protect-a-specific-hostname-custom-domain-or-path)

### Set the API variables and secrets

In **R2 Object Storage → Overview → Account Details → API Tokens → Manage**,
create an R2 token with **Object Read & Write** access scoped to
`wavlark-files`. Copy the **Access Key ID** and **Secret Access Key** from the
result. The secret access key is shown only once.
[R2 credentials and endpoints](https://developers.cloudflare.com/r2/api/tokens/)

Open **Workers & Pages → wavlark-api → Settings → Variables and Secrets**.
Add each row separately and select **Deploy** to apply the settings.
Subsequent releases preserve these values.

| Type | Name | Value |
| --- | --- | --- |
| Text | `R2_ENDPOINT` | Copy the S3 endpoint from the bottom of the R2 token confirmation page, e.g. `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Use only the scheme and hostname. |
| Text | `ACCESS_ISSUER` | The team domain from **Zero Trust → Settings → Team name and domain**, formatted as `https://your-team.cloudflareaccess.com` with no trailing slash. |
| Text | `ACCESS_AUD` | In the Access application's **Edit → Additional settings**, copy **Application Audience (AUD) Tag**. |
| Secret | `R2_ACCESS_KEY_ID` | **Access Key ID** from the R2 token. |
| Secret | `R2_SECRET_ACCESS_KEY` | **Secret Access Key** from the same token. |

Open **Manage files**, sign in, and check the email shown on the page. Upload
and publish a small file. In a private browser window, open the homepage and
download that file without signing in.
