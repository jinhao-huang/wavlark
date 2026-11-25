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

On **Public files**, select files across catalog pages and click **Download selected files**.
Your browser saves each original separately and may ask for permission to download multiple files.
Check its downloads list for progress. To get a missing file, open **Download individually** and click its path.

Under **Manage files → Upload files**, choose one or more files of up to 50,000 MiB
each. The directory and optional description apply to all of them. Leave the
directory empty for the root, or enter a path such as `Maps/Europe`. Set
**Concurrent uploads** to the number of files to upload at once (1–8, default 4),
then select **Upload files**. The browser remembers your choice. Retry failed files individually.
Under **Unpublished drafts**, select the files to publish and click **Confirm
publication**. Each has its own share link, such as `/resources/Maps/Europe/atlas.pdf`.

Uploads reserve their path. Any administrator can reopen **Manage files →
Unpublished drafts** and confirm a completed upload.
Files up to 5 MiB upload in one request. Larger files upload in 5 MiB parts.
After an interruption, retry on the same page or
select **Resume upload** on the draft and choose the original file. The upload
continues from the last confirmed part. For a single-request upload, **Re-upload
file** retries the whole file.
To replace a file, confirm **Discard draft** and upload the replacement at the freed path.
Drafts expire 24 hours after creation. Scheduled cleanup removes their files and releases their paths.

Under **Published files**, select **Delete** and confirm. The share link stops
working immediately. Publishing a new file at the same path makes that link open
the new file. Wavlark deletes the old R2 object by UUID. If R2 is unavailable,
daily cleanup retries the deletion. Previously issued R2 download links expire
within five minutes.

## Deploy to production

### Import the GitHub repository

Push the project to `main` on GitHub. In one Cloudflare account, create a D1 database named `wavlark` and a private R2 bucket. Use the `bucket_name` of the `FILES` binding in the [API Wrangler configuration](api/wrangler.jsonc). Activate R2 if prompted and use the default bucket location and jurisdiction. The API's first deployment applies migrations to this database.

Before importing the API, open **My Profile → API Tokens → Create Token**. Start with the **Edit Cloudflare Workers** template, select the deployment account and add **Account → D1 → Edit** for migrations. [Workers Builds token permissions](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)

1. Go to **Workers & Pages → Create application → GitHub**. Authorize the Cloudflare GitHub app for the repository and select it.
2. Create **wavlark-api** with **Root directory** set to `api`. Enter `pnpm run build` for **Build command** and `pnpm run deploy` for **Deploy command**. Select production branch `main`, disable preview builds, and leave build variables empty. Select your user API token in the build settings, then select **Save and Deploy**.
3. After the API deployment succeeds, import the same repository as **wavlark-web** with **Root directory** set to `web`. Use the same commands and branch settings, and the default build token. The Web Worker's `API` binding needs the deployed API. Register a `workers.dev` subdomain if prompted. Open the Web production URL and check that `/api/health` returns `{"status":"ok"}` and the homepage shows an empty catalog.

Each push to `main` triggers two independent deployments. The API compiles Rust, applies pending D1 migrations, then publishes. A failed migration stops publication. Applied migrations remain in effect if publication fails. When the Web needs a new API, push the API change first and wait for its deployment before pushing the Web change. [Workers Builds monorepo setup](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)

### Use a custom domain (optional)

Bind the hostname only to `wavlark-web`. Choose an unused hostname in an active Cloudflare zone in the same account.
Open **Workers & Pages → wavlark-web → Domains → Custom Domains and Routes → Add Domain**.
Enter just the hostname, for example `files.example.com`. Under **Enable for**,
select **Production**, then click **Add domain**. Once the homepage opens at
`https://files.example.com`, use that address for the steps below.

### Allow browser uploads

Select the bucket in **R2 Object Storage**, then open **Settings → CORS Policy → Add CORS policy**.
In the **JSON** tab, paste the rule below and replace `https://files.example.com` with the origin where administrators open the Web Worker. For example, for `https://wavlark-web.my-team.workers.dev/manage`, enter `https://wavlark-web.my-team.workers.dev`. Select **Save**. Exposing `ETag` lets the browser confirm each multipart upload part.
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
in the account that owns the bucket. Select **Create Account API token**,
choose **Object Read & Write**, and limit access to that bucket. After
creating the token, copy the **Access Key ID** and **Secret Access Key**.
The secret access key is shown only once.

Open **Workers & Pages → wavlark-api → Settings → Variables and Secrets**.
Wrangler sets `R2_BUCKET_NAME` from the repository. Add the five account-specific settings below to **Production** and select **Deploy**. Wrangler preserves dashboard variables with `keep_vars` and retains secrets across code deployments.

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
