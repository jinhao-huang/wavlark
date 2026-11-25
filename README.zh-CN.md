# Wavlark

[English](README.md)

Wavlark 是一个公共文件分享站。所有管理员都可以上传、发布和删除文件。`web/` 下的 SvelteKit Worker（`wavlark-web`）负责展示资源目录，通过 `API` 服务绑定调用 `api/` 下的 Rust Worker（`wavlark-api`），处理发布请求、查询文件信息并生成上传和下载链接。

## 本地运行

安装 [mise](https://mise.jdx.dev/) 后，在仓库根目录初始化项目并启动开发服务器。

```sh
mise trust
mise run setup
mise run dev
```

打开 Vite 输出的网址即可浏览目录和下载文件。Vite 默认从 5173 端口开始尝试，遇到占用会自动换到下一个可用端口。要指定起始端口，可运行 `mise run dev --port 5200`。

开发管理页时，用 `mise run dev:admin` 启动，再打开 **Manage files**，即可用 `admin@example.com` 身份进入，无需配置 Cloudflare 账户。要查看未登录时的页面，用 `mise run dev` 启动即可。

`mise run setup` 会为 R2 模拟器初始化 `api/.dev.vars`，并执行本地 D1 数据库迁移。每份工作副本的 D1 和 R2 数据都保存在各自的 `.wrangler/state` 目录中。首次启动时资源目录为空，访问 `GET /api/health` 应返回 `{"status":"ok"}`。

运行 `mise run build` 可在本机构建两个 Worker 并模拟部署。运行 `mise run test` 可用临时签发的测试凭据验证管理页面和 API。

## 管理文件

在 **Public files** 中可以跨页勾选文件。点击 **Download selected files** 后，浏览器会分别下载每份原文件，首次下载时可能会询问是否允许连续下载多个文件。进度可在浏览器的下载列表中查看。如果少了某份文件，展开 **Download individually** 并点击对应的文件路径即可补下。

在 **Manage files → Upload files** 中选择一份或多份文件，每份最大 50,000 MiB（约 48.83 GiB）。这批文件共用同一个目录和可选说明。**Directory** 留空表示根目录，也可以填写 `地图/杭州` 这样的多级目录。用 **Concurrent uploads** 选择同时上传的文件数（1 到 8 份，默认 4 份），再点击 **Upload files**。浏览器会记住这个设置。失败的文件可以单独重试。在 **Unpublished drafts** 中勾选要公开的文件，点击 **Confirm publication** 即可一起发布。每份文件都有自己的分享链接，例如 `/resources/地图/杭州/交通图.pdf`。

开始上传后，草稿会占用所选路径。任何管理员都可以回到 **Manage files → Unpublished drafts**，确认发布已上传的文件。5 MiB 及以下的文件一次传完，更大的文件按 5 MiB 分片上传。中断后可以在原页面重试，也可以在草稿中点击 **Resume upload**，重新选择原文件，从上次确认的分片继续。整文件上传的草稿可用 **Re-upload file** 从头重试。要替换它，点击 **Discard draft** 并确认，即可在原路径上传新文件。草稿在创建 24 小时后过期，定时任务随后删除文件并释放路径。

在 **Published files** 中点击 **Delete** 并确认，原分享链接随即失效。在同一路径发布新文件后，原链接会打开新文件。Wavlark 按 UUID 删除旧的 R2 文件。如果 R2 暂时不可用，每日清理任务会补删。此前签发的 R2 下载链接最迟在签发后五分钟失效。

## 部署到生产环境

### 从 GitHub 创建两个 Worker

把项目推送到 GitHub 的 `main` 分支。在同一个 Cloudflare 账户下创建 D1 数据库 `wavlark` 和一个私有 R2 桶。桶名填写 [API 的 Wrangler 配置](api/wrangler.jsonc) 中 `FILES` 绑定的 `bucket_name`。首次使用 R2 时按提示开通，桶的位置和司法辖区保留默认设置。API 首次部署时会在这个数据库中建表。

导入 API 前，打开 **My Profile → API Tokens → Create Token**，用 **Edit Cloudflare Workers** 模板创建用户令牌，选定部署账户，再添加 **Account → D1 → Edit** 权限，供数据库迁移使用。[Workers Builds 令牌权限](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)

1. 打开 **Workers & Pages → Create application → GitHub**，授权 Cloudflare GitHub 应用访问项目仓库，然后选中该仓库。
2. 创建 **wavlark-api**，**Root directory** 填 `api`，**Build command** 填 `pnpm run build`，**Deploy command** 填 `pnpm run deploy`。生产分支选 `main`，关闭预览构建，构建变量留空。在构建设置中选择刚创建的用户令牌，点击 **Save and Deploy**。
3. 等 API 部署成功，再从同一仓库创建 **wavlark-web**。**Root directory** 填 `web`，构建命令、部署命令和分支设置与 API 相同，构建令牌可用默认值。Web 的 `API` 服务绑定依赖已部署的 API。如提示注册 `workers.dev` 子域名，按提示完成。打开 Web 的生产网址，确认 `/api/health` 返回 `{"status":"ok"}`，首页显示空目录。

此后每次推送到 `main`，两个 Worker 都会独立部署。API 先编译 Rust，再执行待应用的 D1 迁移，最后发布。迁移失败会停止发布。如果发布失败，已成功执行的迁移仍然生效。网页需要新接口时，先推送 API 改动，等它上线后再推送网页改动。[Workers Builds 多项目仓库配置](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)

### 绑定自定义域名（可选）

只给 `wavlark-web` 绑定域名。在同一 Cloudflare 账户下，为已激活的域名选一个尚未使用的主机名，例如 `files.example.com`。打开 **Workers & Pages → wavlark-web → Domains → Custom Domains and Routes → Add Domain**，填入主机名，在 **Enable for** 选 **Production**，然后点 **Add domain**。确认 `https://files.example.com` 能打开首页后，用这个网址完成下面的配置。

### 允许浏览器上传

在 **R2 Object Storage** 中选择刚创建的桶，打开 **Settings → CORS Policy → Add CORS policy**，在 **JSON** 页签粘贴下面的规则。把 `https://files.example.com` 换成管理页的协议和域名，然后点 **Save**。例如，管理页是 `https://wavlark-web.my-team.workers.dev/manage`，这里就填 `https://wavlark-web.my-team.workers.dev`。浏览器需要读取 `ETag` 来确认每个分片上传成功。[Cloudflare R2 控制台说明](https://developers.cloudflare.com/r2/buckets/cors/#add-cors-policies-from-the-dashboard)

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

### 配置管理员登录

首次打开 **Zero Trust** 时，按提示创建组织并设置团队名称。新组织默认使用 **Cloudflare** 登录，适用于已加入该 Cloudflare 账户的管理员。要让其他获准的管理员用邮箱验证码登录，先到 **Integrations → Identity providers → Add new identity provider** 启用 **One-time PIN**。[Cloudflare 登录方式说明](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

打开 **Zero Trust → Access controls → Applications → Create new application**，选择 **Self-hosted and private → Public DNS** 并继续。在 **Destinations** 下用 **Add public hostname** 添加两条记录，域名都填 Web 站点域名。第一条的 **Path** 填 `manage`，第二条填 `api/manage`。添加 **Allow** 策略，在 **Include → Emails** 中填写管理员邮箱。为这个应用启用前面选定的登录方式，然后保存。[Cloudflare 路径保护说明](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#protect-a-specific-hostname-custom-domain-or-path)

### 配置 API 变量和密钥

打开 [R2 API Tokens 页面](https://dash.cloudflare.com/?to=/:account/r2/api-tokens)，选择桶所在的账户。点 **Create Account API token**，权限选 **Object Read & Write**，范围只选这个桶。创建后复制 **Access Key ID** 和 **Secret Access Key**，后者只显示这一次。

打开 **Workers & Pages → wavlark-api → Settings → Variables and Secrets**。Wrangler 会从仓库配置设置 `R2_BUCKET_NAME`。在 **Production** 中填好下表五项账户配置，点 **Deploy**。后续代码发布时，Wrangler 会通过 `keep_vars` 保留控制台里的普通变量，密钥也会保留。

| 名称 | 勾选 Secret | 填写内容 |
| --- | --- | --- |
| `R2_ENDPOINT` | 否 | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`，将 `<ACCOUNT_ID>` 换成桶所属的 Cloudflare 账户 ID。[查找账户 ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/) |
| `ACCESS_ISSUER` | 否 | 在 **Zero Trust → Settings → Team name and domain** 找到团队域名，填成 `https://your-team.cloudflareaccess.com`，末尾不加斜杠。 |
| `ACCESS_AUD` | 否 | 编辑 Wavlark 的 Access 应用，在 **Additional settings** 中展开 **Application Audience (AUD) Tag**，复制里面 **Token** 字段的完整值。 |
| `R2_ACCESS_KEY_ID` | 是 | R2 令牌创建结果中的 **Access Key ID**。 |
| `R2_SECRET_ACCESS_KEY` | 是 | 同一令牌的 **Secret Access Key**。 |

打开 **Manage files** 并登录，核对页面显示的邮箱，再上传并发布一个小文件。用浏览器无痕窗口打开首页，确认访客无需登录即可下载该文件。
