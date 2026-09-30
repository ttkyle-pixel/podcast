# INSIDE FFC · Cloudflare 版

本版本专门用于 GitHub + Cloudflare Workers 部署，不需要自己购买或维护传统服务器。

- Cloudflare Workers：网站前后台程序与静态页面
- Cloudflare D1：作品资料、文章正文和发布状态
- Cloudflare R2：音频与封面
- GitHub：仅保存网站源代码

正式上线后，在网站 `/admin` 中新增或修改内容会直接写入 D1 和 R2，并立即影响线上网站，不需要再次提交 GitHub。

## 第一季与第二季

作品现已包含独立的“栏目季数”字段。首页会按照第二季、第一季的顺序自动分组；后台的新建和编辑页面可以直接选择季数。

- 升级数据库后，已有作品默认归入第二季，不会删除或覆盖原有标题、封面、音频和文字。
- 新增第一季作品时，在后台把“栏目季数”选择为“第一季”，期数只填写 `Vol.01`、`Vol.02` 等，不需要再填写 `Season1`。
- 前台会自动生成 `SEASON 1`、`SEASON 2` 栏目，无需为每一季建立单独网站。

## 浏览数

- 每篇已发布作品的卡片、文字详情页和后台作品列表都会显示浏览数。
- 读者每打开一次作品就增加 1 次；同一台设备当天重复打开、关闭后重开或刷新页面，都会继续累计。
- 升级后原有作品的浏览数从 0 开始，不影响作品的标题、封面、音频和文字内容。

## 最简单的本地预览

本地预览不是上传 Cloudflare 的前置条件；Cloudflare 可以直接从 GitHub 构建本项目。为了方便上线前检查，项目另外提供了一键预览：

1. 安装 Node.js 20 或更高版本的 LTS 版。
2. 双击 `双击启动本地预览.bat`。
3. 第一次运行时设置一个至少 12 位的本地后台密码。
4. 等浏览器自动打开。后台地址是 `http://127.0.0.1:8789/admin`，用户名是 `admin`。

本地 D1、R2 和线上 Cloudflare 的 D1、R2 完全分开。本地的新增、修改、删除不会同步到线上；正式上线后应登录线上 `/admin` 管理同事看到的内容。更详细的零基础说明见 `本地预览说明.txt`。

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

普通用户直接双击 `双击启动本地预览.bat` 即可。开发人员也可复制 `.dev.vars.example` 为 `.dev.vars`，配置本地密码后执行：

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
