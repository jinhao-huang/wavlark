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

打开 **Manage files**，选择一个不超过 100 MiB 的文件。**Directory** 留空表示根目录，也可以填写 `地图/杭州` 这样的多级目录。按需填写说明，点击 **Upload file**，再点击 **Confirm publication** 公开文件。访客可以通过详情页链接访问资源，例如 `/resources/地图/杭州/交通图.pdf`。

开始上传后，草稿会占用所选路径。在同一表单中重试，会为原草稿签发新的上传链接。未发布的草稿在 24 小时后过期，定时任务随后删除文件并释放路径。

在 **Published files** 中点击 **Delete** 并确认，原分享链接随即失效。在同一路径发布新文件后，原链接会打开新文件。Wavlark 按 UUID 删除旧的 R2 文件。如果 R2 暂时不可用，每日清理任务会补删。此前签发的 R2 下载链接最迟在签发后五分钟失效。

## 部署到生产环境

### 部署 Worker

在生产环境的 Cloudflare 账户下，准备名为 `wavlark` 的 D1 数据库和名为 `wavlark-files` 的私有 R2 桶。桶使用默认辖区，由本站独占。已有符合条件的同名资源可直接使用，Wrangler 会按名称查找数据库。完成本地初始化后，在仓库根目录登录该账户并部署。

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

打开 **R2 Object Storage → wavlark-files → Settings → CORS Policy**，选择 **Add CORS policy**（已有策略则编辑），切到 **JSON**。粘贴下面的规则，把 `https://files.example.com` 换成你打开管理页时用的网址，只保留协议和域名，末尾不加斜杠，然后点 **Save**。例如，管理页是 `https://wavlark-web.my-team.workers.dev/manage`，这里就填 `https://wavlark-web.my-team.workers.dev`。[Cloudflare R2 控制台说明](https://developers.cloudflare.com/r2/buckets/cors/#add-cors-policies-from-the-dashboard)

```json
[
  {
    "AllowedOrigins": ["https://files.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "Content-Disposition", "If-None-Match", "x-amz-meta-wavlark"]
  }
]
```

### 配置管理员登录

打开 **Zero Trust → Access controls → Applications → Create new application**，选择 **Self-hosted and private → Public DNS** 并继续。在 **Destinations** 下用 **Add public hostname** 添加两条记录，域名都填 Web 站点域名。第一条的 **Path** 填 `manage`，第二条填 `api/manage`。这样管理页和管理 API 需要登录，首页保持公开。选择管理员可用的登录方式，添加 **Allow** 策略，在 **Include → Emails** 中填写管理员邮箱，然后保存应用。[Cloudflare 路径保护说明](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#protect-a-specific-hostname-custom-domain-or-path)

### 配置 API 变量和密钥

打开 **R2 Object Storage → Overview → Account Details → API Tokens → Manage**，创建 R2 令牌，权限选 **Object Read & Write**，范围只选 `wavlark-files`。复制创建结果中的 **Access Key ID** 和 **Secret Access Key**，后者只显示这一次。[R2 凭据和端点说明](https://developers.cloudflare.com/r2/api/tokens/)

打开 **Workers & Pages → wavlark-api → Settings → Variables and Secrets**，按下表逐行添加，再点 **Deploy** 使设置生效。后续发布会保留这些值。

| 类型 | 名称 | 填写内容 |
| --- | --- | --- |
| Text | `R2_ENDPOINT` | 从 R2 令牌创建成功页面底部复制 S3 端点，只保留协议和域名，形如 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`。 |
| Text | `ACCESS_ISSUER` | 在 **Zero Trust → Settings → Team name and domain** 找到团队域名，填成 `https://your-team.cloudflareaccess.com`，末尾不加斜杠。 |
| Text | `ACCESS_AUD` | 编辑刚创建的 Access 应用，在 **Additional settings** 中复制 **Application Audience (AUD) Tag**。 |
| Secret | `R2_ACCESS_KEY_ID` | R2 令牌创建结果中的 **Access Key ID**。 |
| Secret | `R2_SECRET_ACCESS_KEY` | 同一令牌的 **Secret Access Key**。 |

打开 **Manage files** 并登录，核对页面显示的邮箱，再上传并发布一个小文件。用浏览器无痕窗口打开首页，确认访客无需登录即可下载该文件。
