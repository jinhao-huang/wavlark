# Wavlark

[English](README.md)

Wavlark 是一个公共文件分享站。`web/` 下的 SvelteKit Worker（`wavlark`）负责展示资源目录，通过 `API` 服务绑定调用 `worker/` 下的 Rust Worker（`wavlark-api`），查询文件信息并生成下载链接。

## 本地运行

安装 [mise](https://mise.jdx.dev/) 后，在仓库根目录运行以下命令，初始化新检出的项目。

```sh
mise trust
mise run setup
```

如果仓库根目录已有旧版 `.dev.vars`，请将自定义值复制到 `worker/.dev.vars`。本地 R2 地址使用 [worker/.dev.vars.example](worker/.dev.vars.example) 中的值。

启动开发服务器：

```sh
mise run dev
```

打开 Vite 输出的网址即可浏览目录和下载文件。Vite 默认从 5173 端口开始尝试，遇到占用会自动换到下一个可用端口。要指定起始端口，可运行 `mise run dev --port 5200`。

开发管理页时，用 `mise run dev:publisher` 启动，再打开 **Publisher workspace**，即可用 `publisher@example.com` 身份进入，无需配置 Cloudflare 账户。要查看未登录时的页面，用 `mise run dev` 启动即可。

`mise run setup` 会为 R2 模拟器初始化 `worker/.dev.vars`，并执行本地 D1 数据库迁移。每份工作副本的 D1 和 R2 数据都保存在各自的 `.wrangler/state` 目录中。首次启动时资源目录为空，访问 `GET /api/health` 应返回 `{"status":"ok"}`。

运行 `mise run build` 可在本机构建两个 Worker 并模拟部署。

## 添加一个本地文件

在仓库根目录运行以下命令，将示例文件写入本地 R2，并在 D1 中发布对应的资源记录。

```sh
printf 'Hello\n' | mise run wrangler:local r2 object put wavlark-files/hello --pipe \
  --content-type text/plain --content-disposition 'attachment; filename="hello.txt"'
mise run wrangler:local d1 execute DB \
  --command "INSERT OR REPLACE INTO resources (id, name, size_bytes, published_at) VALUES ('hello', 'hello.txt', 6, unixepoch())"
```

刷新首页，打开 **hello.txt**，在详情页点击 **Download file**。资源 ID 同时用作 R2 对象的键，下载文件名取自 R2 的 `Content-Disposition`。当 `published_at` 为 `NULL` 时，目录会隐藏该资源，`/download/<id>` 也不可用。资源发布后，这个地址会跳转到有效期为五分钟的 R2 签名链接。

部署 Rust Worker 时，将 `R2_ENDPOINT` 设为当前账户的 R2 S3 完整地址，将 `R2_BUCKET_NAME` 设为私有存储桶名称。为该桶创建只读凭据，通过 Worker secrets 配置 `R2_ACCESS_KEY_ID` 和 `R2_SECRET_ACCESS_KEY`。

## 发布者登录

在 Cloudflare Access 中创建一个自托管应用，同时保护站点域名下的 `/manage` 和 `/api/manage`。添加一条 Allow 策略，填入受邀发布者的邮箱地址。[子路径会继承这条策略](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/#policy-inheritance)。

在 `worker/wrangler.jsonc` 的 `vars` 中，将 `ACCESS_ISSUER` 设为团队地址（例如 `https://your-team.cloudflareaccess.com`，末尾不加斜杠），将 `ACCESS_AUD` 设为该应用的 Audience Tag。部署后，打开站点上的 **Publisher workspace**，登录后即可看到自己的邮箱。

在本地运行 `mise run test`，可用临时签发的测试凭据验证管理页面和 API。
