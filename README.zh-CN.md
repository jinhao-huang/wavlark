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

在 **Manage files → Upload a file** 中选择一个不超过 100 MiB 的文件。**Directory** 留空表示根目录，也可以填写 `地图/杭州` 这样的多级目录。按需填写说明，点击 **Upload file**，再点击 **Confirm publication** 公开文件。访客可以通过详情页链接访问资源，例如 `/resources/地图/杭州/交通图.pdf`。

开始上传后，草稿会占用所选路径。任何管理员都可以回到 **Manage files → Unpublished drafts**，确认发布已上传的文件。5 MiB 及以下的文件一次传完，更大的文件按 5 MiB 分片上传。中断后可以在原页面重试，也可以在草稿中点击 **Resume upload**，重新选择原文件，从上次确认的分片继续。整文件上传的草稿可用 **Re-upload file** 从头重试。要替换它，点击 **Discard draft** 并确认，即可在原路径上传新文件。草稿在创建 24 小时后过期，定时任务随后删除文件并释放路径。

在 **Published files** 中点击 **Delete** 并确认，原分享链接随即失效。在同一路径发布新文件后，原链接会打开新文件。Wavlark 按 UUID 删除旧的 R2 文件。如果 R2 暂时不可用，每日清理任务会补删。此前签发的 R2 下载链接最迟在签发后五分钟失效。

## 部署到生产环境

### 部署 Worker

在同一 Cloudflare 账户下准备以下资源。已有符合条件的同名资源可直接使用。

- 打开 [D1 SQL Database](https://dash.cloudflare.com/?to=/:account/workers/d1)，点 **Create Database**，名称填 `wavlark`，位置由 Cloudflare 自动选择。Wrangler 会按名称查找数据库。
- 打开 [R2 Object Storage](https://dash.cloudflare.com/?to=/:account/r2/overview)，如提示开通 R2，先完成开通。点 **Create bucket**，名称填 `wavlark-files`，位置选自动，不指定司法辖区。存储类别保留 **Standard**，公开访问保持关闭，桶由本站独占。

从 8 MiB 分片升级时，请暂停新上传，把需要保留的分片草稿传完并发布。等其余分片草稿过期后即可部署，再刷新已打开的管理页面。

完成本地初始化后，在仓库根目录登录该账户并部署。如果 Wrangler 提示注册 `workers.dev` 子域，选 **Yes**，为账户填一个可用的子域名。

```sh
mise exec -- pnpm exec wrangler login
mise run deploy
```

命令先执行待应用的生产 D1 迁移（跳过确认提示），再部署 Rust API Worker（`wavlark-api`），最后构建并部署 Web Worker（`wavlark-web`）。Wrangler 会在首次部署时自动创建这两个 Worker。任一步失败，后续步骤就会停止，之前成功的步骤仍然生效。

命令成功后，在 Cloudflare 控制台的 **Workers & Pages** 中可以看到这两个 Worker。下面的配置可以直接使用 `wavlark-web` 部署时输出的正式网址，也可以先绑定自己的域名。

### 绑定自定义域名（可选）

只给 `wavlark-web` 绑定域名。在同一 Cloudflare 账户下，为已激活的域名选一个尚未使用的主机名，例如 `files.example.com`。打开 **Workers & Pages → wavlark-web → Domains → Custom Domains and Routes → Add Domain**，填入主机名，在 **Enable for** 选 **Production**，然后点 **Add domain**。确认 `https://files.example.com` 能打开首页后，用这个网址完成下面的配置。

如果此前已通过 `workers.dev` 管理文件，在现有 R2 CORS 策略的 `AllowedOrigins` 中加上新域名的 HTTPS 地址，再到原来的 Access 应用中为新域名添加 `manage` 和 `api/manage` 两条路径。确认新域名能登录和上传后，即可移除旧网址对应的 CORS 和 Access 条目。如果两个网址都要用于管理，就保留两组配置。

### 允许浏览器上传

打开 **R2 Object Storage → wavlark-files → Settings → CORS Policy**，选择 **Add CORS policy**（已有策略则编辑），切到 **JSON**。新建时粘贴下面的规则。已有这条规则时，在 `AllowedOrigins` 中追加新来源，并确保 `ExposeHeaders` 包含 `ETag`，以便浏览器确认每一片上传成功。把示例中的 `https://files.example.com` 换成管理页的协议和域名，末尾不加斜杠，然后点 **Save**。例如，管理页是 `https://wavlark-web.my-team.workers.dev/manage`，这里就填 `https://wavlark-web.my-team.workers.dev`。[Cloudflare R2 控制台说明](https://developers.cloudflare.com/r2/buckets/cors/#add-cors-policies-from-the-dashboard)

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

打开 [R2 API Tokens 页面](https://dash.cloudflare.com/?to=/:account/r2/api-tokens)，选择 `wavlark-files` 所在的账户。点 **Create Account API token**，权限选 **Object Read & Write**，范围只选 `wavlark-files`。创建后复制 **Access Key ID** 和 **Secret Access Key**，后者只显示这一次。

打开 **Workers & Pages → wavlark-api → Settings → Variables and Secrets**，点 **Add**。下表五项的环境都只选 **Production**，**Secret** 按表中标注设置。填好后点 **Deploy**，后续发布会保留这些设置。

| 名称 | 勾选 Secret | 填写内容 |
| --- | --- | --- |
| `R2_ENDPOINT` | 否 | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`，将 `<ACCOUNT_ID>` 换成桶所属的 Cloudflare 账户 ID。[查找账户 ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/) |
| `ACCESS_ISSUER` | 否 | 在 **Zero Trust → Settings → Team name and domain** 找到团队域名，填成 `https://your-team.cloudflareaccess.com`，末尾不加斜杠。 |
| `ACCESS_AUD` | 否 | 编辑 Wavlark 的 Access 应用，在 **Additional settings** 中展开 **Application Audience (AUD) Tag**，复制里面 **Token** 字段的完整值。 |
| `R2_ACCESS_KEY_ID` | 是 | R2 令牌创建结果中的 **Access Key ID**。 |
| `R2_SECRET_ACCESS_KEY` | 是 | 同一令牌的 **Secret Access Key**。 |

打开 **Manage files** 并登录，核对页面显示的邮箱，再上传并发布一个小文件。用浏览器无痕窗口打开首页，确认访客无需登录即可下载该文件。
