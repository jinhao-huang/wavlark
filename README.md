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

Under **Manage files → Upload a file**, choose a file of up to 100 MiB. Leave **Directory**
empty for the root, or enter a path such as `Maps/Europe`. You can add a
description. Select **Upload file**, then **Confirm publication** to make the
file public. Share its details page, for example `/resources/Maps/Europe/atlas.pdf`.

Uploads reserve their path. Any administrator can reopen **Manage files →
Unpublished drafts** and confirm a completed upload.
Files up to 5 MiB upload in one request. Larger files upload in 5 MiB parts.
After an interruption, retry on the same page or
select **Resume upload** on the draft and choose the original file. The upload
continues from the last confirmed part. For a single-request upload, **Re-upload
file** retries the whole file. Once uploaded, select **Confirm publication**.
To replace a file, confirm **Discard draft** and upload the replacement at the freed path.
Drafts expire 24 hours after creation. Scheduled cleanup removes their files and releases their paths.

Under **Published files**, select **Delete** and confirm. The share link stops
working immediately. Publishing a new file at the same path makes that link open
the new file. Wavlark deletes the old R2 object by UUID. If R2 is unavailable,
daily cleanup retries the deletion. Previously issued R2 download links expire
within five minutes.

## Deploy to production

### Deploy the Workers

Prepare these resources in the same Cloudflare account. Reuse them if they already exist.

- In [D1 SQL Database](https://dash.cloudflare.com/?to=/:account/workers/d1), select **Create Database**, name it `wavlark`, and use automatic placement. Wrangler finds it by name.
- In [R2 Object Storage](https://dash.cloudflare.com/?to=/:account/r2/overview), activate R2 if prompted. Select **Create bucket**, name it `wavlark-files`, and use automatic location with no jurisdiction restriction. Keep the **Standard** storage class and leave public access disabled. Dedicate this bucket to the library.

When upgrading from 8 MiB parts, pause new uploads and publish any multipart drafts
you want to keep. Once the remaining multipart drafts expire, deploy and refresh any open management pages.

After local setup, sign in to that account and deploy from the repository root.
If Wrangler asks to register a `workers.dev` subdomain, choose **Yes** and enter an available name for the account.

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
For a new policy, paste the rule below. If this rule already exists, add the origin to its
`AllowedOrigins` array and include `ETag` in `ExposeHeaders` so the browser can confirm each part. Replace `https://files.example.com` with the origin of
your management page, then select **Save**. For example, if you open
`https://wavlark-web.my-team.workers.dev/manage`, enter
`https://wavlark-web.my-team.workers.dev` with no path or trailing slash.
[Cloudflare R2 CORS settings](https://developers.cloudflare.com/r2/buckets/cors/#add-cors-policies-from-the-dashboard)

```json
[
  {
    "AllowedOrigins": ["https://files.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "Content-Disposition", "If-None-Match", "x-amz-meta-wavlark"],
    "ExposeHeaders": ["ETag"]
  }
]
```

### Configure administrator access

On your first visit to **Zero Trust**, complete onboarding and choose a team name.
In a new organization, administrators who belong to your Cloudflare account can use the default **Cloudflare** login.
To let other approved administrators sign in by email code, enable **One-time PIN** under **Integrations → Identity providers → Add new identity provider**.
[Cloudflare login methods](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

Under **Zero Trust → Access controls → Applications → Create new application**,
select **Self-hosted and private → Public DNS** and continue. Under **Destinations**,
use **Add public hostname** to add two entries for the same Web hostname.
Enter `manage` in the first **Path** field and `api/manage` in the second.
Add an **Allow** policy with **Include → Emails** set to your administrators' addresses.
Enable the chosen login method for this application and save it.
[Cloudflare Access for Worker paths](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#protect-a-specific-hostname-custom-domain-or-path)

### Set the API variables and secrets

Open the [R2 API Tokens page](https://dash.cloudflare.com/?to=/:account/r2/api-tokens)
in the account that owns `wavlark-files`. Select **Create Account API token**,
choose **Object Read & Write**, and limit access to `wavlark-files`. After
creating the token, copy the **Access Key ID** and **Secret Access Key**.
The secret access key is shown only once.

Open **Workers & Pages → wavlark-api → Settings → Variables and Secrets**.
Select **Add**. For all five entries, select **Production** only and set
**Secret** as shown below. Select **Deploy** to apply the settings. Subsequent releases preserve them.

| Name | Secret | Value |
| --- | --- | --- |
| `R2_ENDPOINT` | No | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Replace `<ACCOUNT_ID>` with the ID of the Cloudflare account that owns the bucket. [Find your account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/) |
| `ACCESS_ISSUER` | No | The team domain from **Zero Trust → Settings → Team name and domain**, formatted as `https://your-team.cloudflareaccess.com` with no trailing slash. |
| `ACCESS_AUD` | No | Edit the Wavlark Access application. Under **Additional settings**, expand **Application Audience (AUD) Tag** and copy the entire value shown in the **Token** field. |
| `R2_ACCESS_KEY_ID` | Yes | **Access Key ID** from the R2 token. |
| `R2_SECRET_ACCESS_KEY` | Yes | **Secret Access Key** from the same token. |

Open **Manage files**, sign in, and check the email shown on the page. Upload
and publish a small file. In a private browser window, open the homepage and
download that file without signing in.
