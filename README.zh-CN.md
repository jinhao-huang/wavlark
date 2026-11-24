# Wavlark

[English](README.md)

Wavlark 是一个由一名管理员维护的公共文件分享站。`web/` 下的 SvelteKit Worker（`wavlark`）负责展示资源目录，通过 `API` 服务绑定调用 `worker/` 下的 Rust Worker（`wavlark-api`），处理发布请求、查询文件信息并生成上传和下载链接。

## 本地运行

安装 [mise](https://mise.jdx.dev/) 后，在仓库根目录初始化项目并启动开发服务器。

```sh
mise trust
mise run setup
mise run dev
```

打开 Vite 输出的网址即可浏览目录和下载文件。Vite 默认从 5173 端口开始尝试，遇到占用会自动换到下一个可用端口。要指定起始端口，可运行 `mise run dev --port 5200`。

开发管理页时，用 `mise run dev:publisher` 启动，再打开 **Manage files**，即可用 `publisher@example.com` 身份进入，无需配置 Cloudflare 账户。要查看未登录时的页面，用 `mise run dev` 启动即可。

`mise run setup` 会为 R2 模拟器初始化 `worker/.dev.vars`，并执行本地 D1 数据库迁移。每份工作副本的 D1 和 R2 数据都保存在各自的 `.wrangler/state` 目录中。首次启动时资源目录为空，访问 `GET /api/health` 应返回 `{"status":"ok"}`。

运行 `mise run build` 可在本机构建两个 Worker 并模拟部署。

## 发布文件

打开 **Manage files**，选择一个不超过 100 MiB 的文件。**Directory** 留空表示根目录，也可以填写 `地图/杭州` 这样的多级目录。按需填写说明，点击 **Upload file**，再点击 **Confirm publication** 公开文件。访客可以通过详情页链接访问资源，例如 `/resources/地图/杭州/交通图.pdf`。

开始上传后，草稿会占用所选路径。在同一表单中重试，会为原草稿签发新的上传链接。未发布的草稿在 24 小时后过期，定时任务随后删除文件并释放路径。

## 生产环境存储配置

为这个 D1 数据库单独使用一个私有 R2 桶。在 Rust Worker 中，将 `R2_ENDPOINT` 设为当前账户的 R2 S3 完整地址，`R2_BUCKET_NAME` 设为桶名。为签名凭据授予该桶的 **Object Read & Write** 权限，通过 Worker secrets 配置 `R2_ACCESS_KEY_ID` 和 `R2_SECRET_ACCESS_KEY`。

在[桶的 CORS 配置](https://developers.cloudflare.com/r2/buckets/cors/)中，允许站点来源发送 `PUT` 请求，并允许 `Content-Type`、`Content-Disposition`、`If-None-Match` 和 `x-amz-meta-wavlark` 请求头。部署后，用浏览器在站点上传一份文件，验证跨域配置。

## 管理员登录

在 Cloudflare Access 中创建一个自托管应用，同时保护站点域名下的 `/manage` 和 `/api/manage`。在 Allow 策略的 **Include → Emails** 中只填写管理员的完整邮箱地址。[子路径会继承这条策略](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/#policy-inheritance)。

在 `worker/wrangler.jsonc` 的 `vars` 中，将 `ACCESS_ISSUER` 设为团队地址（例如 `https://your-team.cloudflareaccess.com`，末尾不加斜杠），将 `ACCESS_AUD` 设为该应用的 Audience Tag。部署后，打开站点上的 **Manage files**，登录后即可看到自己的邮箱。

在本地运行 `mise run test`，可用临时签发的测试凭据验证管理页面和 API。
