# INSIDE FFC · Cloudflare 版

本版本专门用于 GitHub + Cloudflare Workers 部署，不需要自己购买或维护传统服务器。

- Cloudflare Workers：网站前后台程序与静态页面
- Cloudflare D1：作品资料、文章正文和发布状态
- Cloudflare R2：音频与封面
- GitHub：仅保存网站源代码

正式上线后，在网站 `/admin` 中新增或修改内容会直接写入 D1 和 R2，并立即影响线上网站，不需要再次提交 GitHub。

## 部署

面向非技术用户的完整步骤见项目内的 `新手部署指南.md`。

Cloudflare Workers Builds 的部署命令填写：

```text
npm run deploy
```

这个命令会先自动应用 D1 数据库迁移，再发布 Worker 和静态文件。

## 必需的 Cloudflare 资源

- D1 数据库：`inside-ffc-db`，绑定名 `DB`
- R2 存储桶：`inside-ffc-media`，绑定名 `MEDIA`
- Worker 运行时秘密变量：`ADMIN_PASSWORD`、`SESSION_SECRET`
- 普通变量：`ADMIN_USERNAME`，默认已设为 `admin`

创建 D1 后，把 `wrangler.jsonc` 中的 `REPLACE_WITH_YOUR_D1_DATABASE_ID` 替换为真实数据库 ID。

## 首期内容

数据库迁移会自动建立 Vol.01 的标题、摘要、主播、嘉宾和完整文字版，并引用以下 R2 文件：

```text
audio/Vol01.m4a
```

请把交付物 `cloudflare-first-content/Vol01.m4a` 上传到 R2 存储桶的 `audio` 文件夹。

## 音频限制

后台单个音频限制为 80MB，封面限制为 10MB。这是为了适配 Cloudflare 常见账户的请求大小和 Worker 内存限制。如果后续节目超过 80MB，建议先压缩为适合网页播放的 M4A 或 MP3。

## 本地开发

开发人员可复制 `.dev.vars.example` 为 `.dev.vars`，配置本地密码后执行：

```bash
npm install
npx wrangler d1 migrations apply DB --local
npm run dev
```

本地 D1 和 R2 是单独的模拟数据，不会修改线上内容。

## 安全设计

- 管理员密码和会话密钥使用 Cloudflare Secret 保存，不进入 GitHub。
- 管理登录使用安全 Cookie、签名会话、CSRF 校验和来源校验。
- 连续失败登录会按 IP 临时限制。
- 正文在服务端进行 HTML 白名单清洗。
- 上传文件限制类型、大小并使用随机文件名。
- 下架只隐藏内容；永久删除才会同时删除 D1 记录和 R2 媒体。
- 时间轴功能未包含在前台、后台或数据库中。
