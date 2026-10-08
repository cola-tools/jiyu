# Linux 学习打卡平台 · 部署方案

> 目标：**前端用 GitHub Pages 免费托管，后端 + MySQL 部署到云端，绑定自己的域名**，
> 学生用手机 / 电脑 / 平板的浏览器直接访问，无需安装任何 App。
> 
> 本文档面向第一次部署的人，照着做即可上线；每一步都给出了验证方法与常见报错的排查思路。

---

## 目录

1. [先回答你最关心的问题：前后端能连起来吗？](#1-先回答你最关心的问题前后端能连起来吗)
2. [整体架构](#2-整体架构)
3. [部署前准备清单](#3-部署前准备清单)
4. [步骤一：代码推上 GitHub](#4-步骤一代码推上-github)
5. [步骤二：开通 MySQL 并初始化数据](#5-步骤二开通-mysql-并初始化数据)
6. [步骤三：部署后端 API（Railway）](#6-步骤三部署后端-apirailway)
7. [步骤四：部署前端（GitHub Pages）](#7-步骤四部署前端github-pages)
8. [步骤五：绑定自己的域名](#8-步骤五绑定自己的域名)
9. [环境变量总表](#9-环境变量总表)
10. [账号清单与首次改密](#10-账号清单与首次改密)
11. [日常更新与回滚](#11-日常更新与回滚)
12. [常见问题排查](#12-常见问题排查)
13. [安全注意事项](#13-安全注意事项)
14. [会员体系（VIP）使用说明](#14-会员体系vip使用说明)

---

## 1. 先回答你最关心的问题：前后端能连起来吗？

**能连，但要理解一个关键点：GitHub 只适合托管"静态文件"（HTML/CSS/JS），它不能运行 Node.js 后端，也不能装 MySQL。**

所以正确做法是把系统拆成两半，分别放在最合适的地方：

| 部分      | 内容                        | 放在哪                             | 费用            |
| ------- | ------------------------- | ------------------------------- | ------------- |
| **前端**  | `web/` 里的 HTML / CSS / JS | **GitHub Pages**（静态托管）          | 免费            |
| **后端**  | `server/` 里的 Express API  | **Railway / Render**（Node 运行环境） | 免费额度 / 约 $5/月 |
| **数据库** | MySQL                     | 云 MySQL（可与后端同一平台）               | 免费额度 / 约 $5/月 |

**它们是这样连起来的：**

```
学生的浏览器（手机/电脑）
   │  ① 打开网页：https://你的域名（GitHub Pages 提供页面）
   ▼
浏览器加载 HTML/CSS/JS 后，JS 通过 fetch() 发起 HTTP 请求
   │  ② 请求接口：https://api.你的域名/api/xxx（Railway 上的后端）
   ▼
后端校验 Token → 读写云上的 MySQL → 返回 JSON
   │  ③ 后端在响应头里声明「允许来自你域名的跨域请求」（CORS）
   ▼
浏览器拿到数据，渲染打卡页面
```

只要满足三个条件，前后端就"连起来"了：

1. **前端知道后端的地址** —— 本项目内置了 4 种配置方式（见 [1.1](#11-前端如何找到后端)）；
2. **后端允许前端的域名跨域访问**（CORS 白名单）；
3. **两边都是 HTTPS**（浏览器不允许 HTTPS 页面请求 HTTP 接口，即"混合内容"限制）。

这三点在下面的步骤里都会配好。

### 1.1 前端如何找到后端

前端 `web/js/config.js` 按以下优先级解析后端地址：

| 优先级 | 方式                                                     | 适用场景                       |
| --- | ------------------------------------------------------ | -------------------------- |
| A   | 页面里写死 `window.LINUX_STUDY_API = "https://api.xxx.com"` | **推荐，部署时用这个**，一劳永逸         |
| B   | URL 加参数 `?api=https://api.xxx.com`                     | 临时切换 / 调试，会存入 localStorage |
| C   | localStorage 里的 `lsp.apiBase`                          | 登录页「后端服务地址」弹窗保存的值          |
| D   | 同源（`location.origin`）                                  | 本地开发，或后端直接托管 `web/` 目录时    |

> 另外登录页右下角有「后端服务地址」入口，学生端也可以现场配置——但你按步骤五写死之后，学生什么都不用填，打开网址就能用。

---

## 2. 整体架构

```
                    ┌──────────────────────────────────────┐
                    │            你的域名 example.com       │
                    └──────────┬───────────────┬───────────┘
                               │               │
              study.example.com│               │api.example.com
                               ▼               ▼
                 ┌───────────────────┐  ┌───────────────────┐
                 │   GitHub Pages    │  │  Railway 后端服务  │
                 │  （静态前端 web/） │  │  Node.js + Express│
                 │  HTML/CSS/JS      │  │  /api/auth        │
                 └───────────────────┘  │  /api/student     │
                                        │  /api/admin       │
                                        └─────────┬─────────┘
                                                  │ 内网/TCP
                                                  ▼
                                        ┌───────────────────┐
                                        │     云 MySQL      │
                                        │  linux_study 库   │
                                        └───────────────────┘
```

**为什么这样拆，而不是全部塞进一台服务器？**

- GitHub Pages 免费、全球 CDN、自带 HTTPS、零运维——静态前端放这里性价比最高；
- 后端需要常驻进程 + 数据库连接，Railway/Render 这类平台一键部署 Node 项目，自动配 HTTPS 和域名；
- 前后端分离后，改前端只需重新推代码，后端和数据不受影响；以后要加小程序端，也可以直接复用同一套 API。

> **备选拓扑**：如果你已有一台云服务器（阿里云 / 腾讯云轻量），也可以用 `node + Nginx 反向代理 + 本机 MySQL` 全部自托管，见 [6.3](#63-备选方案自建云服务器部署)。

---

## 3. 部署前准备清单

| 需要准备                | 说明                               |
| ------------------- | -------------------------------- |
| GitHub 账号           | 注册免费：<https://github.com/signup> |
| Railway 或 Render 账号 | 后端托管，可用 GitHub 账号直接登录            |
| 你的域名                | 已完成实名认证；DNS 解析权限（能在域名服务商后台加记录）   |
| 本机已安装               | Node.js ≥ 18、Git、MySQL 客户端（可选）   |
| 项目代码                | 即本目录 `linux-study-platform/`     |

---

## 4. 步骤一：代码推上 GitHub

```bash
cd linux-study-platform

# 初始化仓库并首次提交
git init
git add .
git commit -m "init: Linux 学习打卡平台（前端 + 后端 + 数据库脚本）"

# 在 GitHub 网页上新建一个**私有**仓库（Private），例如 linux-study-platform
# 然后关联远程并推送（把 yourname 换成你的用户名）
git remote add origin https://github.com/yourname/linux-study-platform.git
git branch -M main
git push -u origin main
```

**注意：仓库务必选 Private（私有）**——里面有学生账号种子数据，虽然密码是哈希存储，也不建议公开。

> `.gitignore` 已排除 `node_modules/`、`.env`、测试截图等，无需再手工排除。

---

## 5. 步骤二：开通 MySQL 并初始化数据

### 5.1 开通数据库（三选一）

| 平台                           | 免费额度    | 特点            |
| ---------------------------- | ------- | ------------- |
| **Railway MySQL**（推荐，与后端同平台） | 试用额度 $5 | 零配置，内网直连，部署最顺 |
| **Aiven MySQL Free**         | 永久免费小实例 | 需开 SSL，跨平台通用  |
| **阿里云 / 腾讯云 RDS**            | 按量付费    | 国内访问快，需备案域名配合 |

以下以 **Railway** 为例（其他平台步骤相同，只是拿连接信息的地方不一样）：

1. 登录 <https://railway.app> → **New Project** → **Provision MySQL**；
2. 进入 MySQL 服务 → **Connect** 标签页，记下这几项：
   - `MYSQLHOST`（主机）、`MYSQLPORT`（端口）、`MYSQLUSER`（用户）
   - `MYSQLPASSWORD`（密码）、`MYSQLDATABASE`（库名）

### 5.2 初始化数据库（两种方式任选）

**方式 A：一键脚本（推荐）**

在本地 `server/` 目录执行，把云端数据库填进去：

```bash
cd server
npm install

DB_HOST=你的主机 \
DB_PORT=你的端口 \
DB_USER=你的用户 \
DB_PASSWORD=你的密码 \
DB_NAME=你的库名 \
node src/scripts/init-db.js
```

> Windows PowerShell 写法：`$env:DB_HOST="你的主机"; $env:DB_PORT="3306"; ... ; npm run init-db`

执行成功会输出：

```
✔ 初始化完成（库：linux_study）
  ├─ 管理员：1 个
  ├─ 学生：5 个
  ├─ 目录节点：4485 个
  └─ 可打卡内容：484 个
```

**方式 B：mysql 命令行导入**

```bash
mysql -h 主机 -P 端口 -u 用户 -p 库名 < db/schema.sql
mysql -h 主机 -P 端口 -u 用户 -p 库名 < db/seed_accounts.sql
mysql -h 主机 -P 端口 -u 用户 -p 库名 < db/seed_content.sql
```

> 若云端账号没有 `CREATE DATABASE` 权限，先删掉 `schema.sql` 开头的
> `CREATE DATABASE` / `USE` 两行，连接时直接指定库名即可（文件头部有注释说明）。

**验证**：连接数据库执行 `SELECT COUNT(*) FROM units;`，应得到 **4485**。

---

## 6. 步骤三：部署后端 API（Railway）

### 6.1 创建服务

1. Railway 项目里 → **New** → **GitHub Repo** → 选中你的仓库；
2. **Settings → Root Directory** 填 `server`（后端代码在 server 子目录）；
3. Railway 会自动识别 `package.json`，构建命令 `npm install`，启动命令 `npm start`；
4. **Variables** 标签页添加环境变量（见 6.2）；
5. **Settings → Networking → Generate Domain**，得到一个临时域名如
   `https://linux-study-api.up.railway.app` —— 这就是**后端 API 地址**。

### 6.2 后端环境变量

在 Railway 的 Variables 里逐条添加（完整说明见 [第 9 节](#9-环境变量总表)）：

```ini
NODE_ENV=production

DB_HOST=你的MySQL主机
DB_PORT=你的MySQL端口
DB_USER=你的MySQL用户
DB_PASSWORD=你的MySQL密码
DB_NAME=linux_study
DB_SSL=false            # 若用 Aiven 等要求 SSL 的库则改 true

# 允许跨域的前端来源。先填 GitHub Pages 默认域和你的自定义域
CORS_ORIGINS=https://yourname.github.io,https://study.example.com
```

> **CORS 很关键**：不配置（留空）时后端允许任意来源（方便先跑通）；正式上线请务必填上前端域名白名单，只放行你自己的站点。

### 6.3 验证后端

浏览器或命令行访问：

```bash
curl https://你的后端地址/api/health
# 期望返回：{"ok":true,"time":"...","version":"1.0.0"}
```

再测一次登录接口（能返回 token 说明数据库也通了）：

```bash
curl -X POST https://你的后端地址/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin@2026","role":"admin"}'
```

### 6.4 备选方案：自建云服务器部署

如果你更愿意用自己的云主机（阿里云/腾讯云轻量）：

```bash
# 1. 安装 Node 18+ 与 MySQL，导入数据库（同 5.2）
# 2. 上传代码，安装依赖
cd server && npm install
# 3. 写好 .env（复制 .env.example）后用 pm2 常驻
npm install -g pm2
pm2 start src/index.js --name linux-study-api
pm2 save && pm2 startup
# 4. Nginx 反向代理（示例）
#    location /api/ { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }
#    另外把 web/ 目录设为站点根目录，则前端后端同源，连 CORS 都不用配
# 5. 用 certbot 申请免费 HTTPS 证书
```

> 自建方案的优点：前端后端同源部署最简单；缺点：证书续期、备份、安全加固都要自己维护。

---

## 7. 步骤四：部署前端（GitHub Pages）

### 7.1 开启 Pages（用 GitHub Actions 自动发布）

项目里已内置发布流水线 `.github/workflows/deploy-pages.yml`，每次 `web/` 目录有改动并推送到 `main` 分支，就会自动发布最新前端。

1. 打开仓库 → **Settings → Pages**；
2. **Source** 选择 **GitHub Actions**（不是 "Deploy from a branch"）；
3. 打开 **Actions** 标签页，等第一次流水线跑完（约 1 分钟）；
4. 回到 **Settings → Pages**，会看到站点地址：
   `https://yourname.github.io/linux-study-platform/` —— 这就是**前端地址**。

### 7.2 把后端地址写进前端（关键一步）

编辑 `web/index.html`，在 `<head>` 最早的位置（`config.js` 加载之前）加一行：

```html
<script>window.LINUX_STUDY_API = "https://你的后端地址";</script>
```

保存并推送：

```bash
git add web/index.html
git commit -m "deploy: 指向后端 API 地址"
git push
```

Actions 会自动重新发布。完成后打开前端地址，应能看到登录页，直接用账号登录成功。

### 7.3 更新 CORS 白名单

现在知道了前端最终地址，回到 Railway 把 `CORS_ORIGINS` 补全：

```ini
CORS_ORIGINS=https://yourname.github.io,https://study.example.com
```

> `*.github.io` 的项目页后端已默认放行；把自定义域名也加上更稳妥。

---

## 8. 步骤五：绑定自己的域名

假设你的域名是 `example.com`，规划两个子域名：

| 子域名                 | 用途      | 指向           |
| ------------------- | ------- | ------------ |
| `study.example.com` | 学生访问的前端 | GitHub Pages |
| `api.example.com`   | 后端 API  | Railway      |

### 8.1 配置 DNS 解析

在你的域名服务商（阿里云 / 腾讯云 / Cloudflare 等）后台添加两条记录：

| 记录类型  | 主机记录  | 记录值                                               | 说明              |
| ----- | ----- | ------------------------------------------------- | --------------- |
| CNAME | study | `yourname.github.io`                              | 指向 GitHub Pages |
| CNAME | api   | `你的Railway域名`（如 `linux-study-api.up.railway.app`） | 指向后端            |

> 若要用裸域 `example.com` 做前端，则添加 4 条 A 记录指向
> `185.199.108.153` / `185.199.109.153` / `185.199.110.153` / `185.199.111.153`。

### 8.2 GitHub Pages 绑定自定义域

1. 仓库根目录新建文件 `web/CNAME`，内容一行：`study.example.com`；
   （放进 `web/` 是因为发布流水线会把 `web/` 整体拷贝为站点根）
2. **Settings → Pages → Custom domain** 填 `study.example.com` → Save；
3. 等待 DNS 生效（几分钟到几小时）后勾选 **Enforce HTTPS**（强制 HTTPS）。

> 首次绑定 GitHub 会提示 "DNS check unsuccessful"，多等一会儿重试即可。
> 国内解析到 github.io 可能偏慢，如速度不理想，可把前端改放到 Cloudflare Pages（同样免费，步骤几乎一致）。

### 8.3 Railway 绑定 api 子域

1. Railway 服务 → **Settings → Networking → Custom Domain** → 输入 `api.example.com`；
2. 按提示在你的 DNS 里加一条 CNAME（Railway 会给出目标值）；
3. 证书自动签发，完成后 `https://api.example.com/api/health` 可直接访问。

### 8.4 更新两处配置（绑定域名后必做）

1. `web/index.html` 的 `window.LINUX_STUDY_API` 改为 `https://api.example.com`；
2. Railway 的 `CORS_ORIGINS` 加入 `https://study.example.com`。

改完推送代码、重启后端，即完成全部绑定。

---

## 9. 环境变量总表

| 变量                | 必填    | 默认          | 说明                                           |
| ----------------- | ----- | ----------- | -------------------------------------------- |
| `PORT`            | 否     | 3000        | 监听端口；Railway/Render 会自动注入，不用填                |
| `NODE_ENV`        | 建议    | development | 生产环境填 `production`                           |
| `DB_HOST`         | ✅     | 127.0.0.1   | MySQL 主机地址                                   |
| `DB_PORT`         | 否     | 3306        | MySQL 端口                                     |
| `DB_USER`         | ✅     | root        | 数据库用户                                        |
| `DB_PASSWORD`     | ✅     | （空）         | 数据库密码                                        |
| `DB_NAME`         | 否     | linux_study | 库名                                           |
| `DB_POOL`         | 否     | 10          | 连接池大小                                        |
| `DB_SSL`          | 否     | false       | 云库要求 SSL 时填 `true`                           |
| `CORS_ORIGINS`    | ✅（生产） | （空=允许全部）    | 允许的前端来源，逗号分隔；生产环境务必配置                        |
| `TOKEN_TTL_HOURS` | 否     | 720         | 登录令牌有效期（小时），默认 30 天                          |
| `SMS_PROVIDER`    | 否     | console     | `console` 响应里回显验证码 / `http` 接真实短信 / `off` 关闭 |
| `SMS_DEBUG`       | 否     | 1           | `1` 时在响应与日志打印验证码，**生产务必改 0**                 |

> **从旧版本升级**：只需在 MySQL 里执行一次 `db/migrate_v2_member.sql`（幂等脚本，可重复执行），
> 它会为 `students` 增加会员字段与手机号唯一约束，并新建会员相关 5 张表；执行完重启后端即可。

> 数据库结构、字段与索引见 `db/schema.sql` 文件内注释；种子数据由 `db/gen_seed.py` 生成。

---

## 10. 账号清单与首次改密

系统内置 1 个管理员 + 5 个学生账号（由 `db/seed_accounts.sql` 写入）：

| 角色  | 账号         | 初始密码          | 会员等级       | 备注                            |
| --- | ---------- | ------------- | ---------- | ----------------------------- |
| 管理员 | `admin`    | `admin@2026`  | —          | 教师端，可管理目录 / 学生 / 会员 / 督促 / 题库 |
| 学生  | `student1` | `xiaoran2026` | 永久会员       | 学生一 · 2026001 · 计算机应用 1 班     |
| 学生  | `student2` | `linux2026`   | 年会员        | 学生二 · 2026002 · 计算机应用 1 班     |
| 学生  | `student3` | `study2026`   | 普通会员       | 学生三 · 2026003 · 计算机应用 1 班     |
| 学生  | `student4` | `buddy2026`   | 周会员（剩 2 天） | 学生四 · 2026004 · 计算机应用 2 班     |
| 学生  | `student5` | `hello2026`   | 普通会员（已禁用）  | 学生五 · 2026005 · 计算机应用 2 班     |

> 这套演示账号刻意覆盖了全部门禁状态：普通会员看 🔒、年会员/永久会员全解锁、
> 周会员触发「剩余不足 3 天」倒计时、student5 用来验证禁用提示。

**上线后第一件事：登录后台 → 我的资料 → 修改密码**，把管理员密码改掉；
学生账号可在「学生名单」里逐一修改真实姓名、学号、班级、联系电话，并重置密码。
（密码以 scrypt 哈希存储，数据库里看不到明文。）

---

## 11. 日常更新与回滚

**更新前端**：改 `web/` 下的文件 → `git push` → Actions 自动重新发布（约 1 分钟生效）。

**更新后端**：改 `server/` 下的文件 → `git push` → Railway 自动重新构建部署。

**回滚**：

- GitHub Pages：仓库 **Deployments** 里选上一次成功的部署 → **Re-deploy**；
- Railway：服务 **Deployments** 列表里选旧版本 → **Redeploy**。

**数据备份**（建议每周一次）：

```bash
mysqldump -h 主机 -P 端口 -u 用户 -p 库名 > backup-$(date +%F).sql
```

---

## 12. 常见问题排查

**① 登录页提示「后端服务未连接」**
→ 打开 `https://你的后端地址/api/health`，若打不开说明后端没起来：去 Railway 看部署日志；
若能打开，说明是前端地址配置问题：检查 `window.LINUX_STUDY_API` 是否已写、拼写是否正确（不要以 `/` 结尾）。

**② 浏览器控制台报 CORS 错误（`blocked by CORS policy`）**
→ 后端 `CORS_ORIGINS` 没包含前端地址。把它补上（协议、域名、端口三者必须完全一致），重启后端。

**③ 页面能打开但请求全部失败，控制台报 `mixed content`**
→ 前端是 HTTPS 而后端还是 HTTP。给后端绑定域名并启用 HTTPS（Railway 自动签发），再把 `window.LINUX_STUDY_API` 改成 `https://` 开头。

**④ 后端日志报 `ER_ACCESS_DENIED_ERROR` / 连不上数据库**
→ 核对 6 个 DB_ 环境变量；Railway 内网场景 `DB_HOST` 要填 Railway 提供的 MySQL 私网主机；Aiven 等平台记得 `DB_SSL=true`。

**⑤ 登录报「账号或密码错误」但账号确实存在**
→ 数据库可能没导入账号数据：执行 `SELECT COUNT(*) FROM students;`，应为 5；为 0 就重跑 `node src/scripts/init-db.js`（脚本幂等，已导入过内容不会重复插入；要清空重导加 `--force`）。

**⑥ 学生打卡后管理后台没刷新**
→ 后台面板数据在进入页面时拉取，点侧栏「刷新」或重新进入该页即可；未读督促徽标每 90 秒自动轮询。

**⑦ 手机上字体/按钮不是手绘风**
→ 手绘描边用 SVG 滤镜实现，个别老安卓 WebView 不支持时会自动降级为普通描边，属预期行为，不影响功能。

**⑧ 想恢复演示数据**
→ 重新执行 `node src/scripts/init-db.js --force`（会清空打卡记录、督促、题库后重新导入）。

---

## 13. 安全注意事项

- [ ] 管理员 `admin` 的默认密码 `admin@2026` **上线后立即修改**；
- [ ] `CORS_ORIGINS` 生产环境必须配置白名单，不要留空；
- [ ] GitHub 仓库保持 **Private**；
- [ ] Railway 项目令牌 / 数据库密码不要提交进 Git（`.env` 已被 `.gitignore` 排除）；
- [ ] 建议每周 `mysqldump` 备份一次；
- [ ] 如需加学生，直接在后台「学生名单 → 新增学生」里创建，不必改种子脚本。

---

## 14. 会员体系（VIP）使用说明

### 14.1 会员分级与定价

| 档位   | 价格    | 时长              | 权益                                       |
| ---- | ----- | --------------- | ---------------------------------------- |
| 普通会员 | ¥0    | 不限              | 仅「① 入门与安装」下 5 个小节；不可打卡、不可导出、**无法登录打卡平台** |
| 周会员  | ¥4    | 自设置时刻起 **7 天整** | 全章节 + 打卡 + 出题练习 + 三格式导出                  |
| 月会员  | ¥12   | **30 天整**       | 同上                                       |
| 年会员  | ¥24   | **365 天整**      | 同上                                       |
| 永久会员 | ¥59.9 | 无到期时间           | 同上，且**不可逆**（之后再充值仍为永久）                   |

价格与权益文案在 **管理后台 → 定价配置** 里可改，保存后立即同步到两个前端的「定价」页。

### 14.2 管理员如何开通 / 续费

**管理后台 → 会员管理**：

- 顶部汇总卡：账号总数 / 超级会员 / 普通会员 / 临期不足 3 天 / 已禁用；
- 每行操作：**开通会员 / 续费改档**、**禁止使用 / 恢复使用**、**变更流水**；
- 「开通 / 续费」弹窗会**实时预览叠加后的到期时间**（精确到秒）；
- 支持「快速开通」：先选账号再选档位；
- 列表页下方是**打卡记录导出流水**（谁在什么时候导出了多少条）。

**续费叠加规则**（与需求逐字一致）：

```
新到期时刻 = max(当前时刻, 原到期时刻) + 本次时长
例：剩余 2天2小时45分1秒 时充值周会员 → 变成 9天2小时45分1秒
```

- **不限制设置频率**：刚设完周会员 3 秒后，仍可对同一账号再设月会员 / 周会员，同类型或不同类型都能正确叠加；
- **到期自动降级**为普通会员，并**立即清除登录令牌** —— 无论用户是否在线都会被强制退出打卡平台。

### 14.3 用户的门禁体验

| 场景              | 用户看到的内容                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| 普通会员点第二章节起的任意小节 | 提示「你还未开通超级会员，请联系管理员开通后进行学习！」，小节标题后有 🔒                                         |
| 普通会员登录打卡平台      | 提示「你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！」                                           |
| 被管理员禁用          | 「您的账号已被管理员设置为禁用，请联系管理员开通账号使用权限」，学习/打卡/个人信息全部不可用                                |
| 会员剩余不足 3 天      | 提示「你的会员期限已不足3天，为了能够正常使用该平台，请及时联系管理员进行续费！」，右下角常驻**动态倒计时（x天x时x分x秒）**             |
| 会员在使用中到期        | 弹出**不可取消**的「会员到期提醒」，内容为「你的会员于 xxxx年xx月xx日xx时xx分xx秒 到期，现将强制退出该平台…」，只有一个「退出登录」按钮 |
| 到期后重新进入         | 同样提示「你还未开通会员，无法使用打卡平台…」                                                        |

开通超级会员后，头像旁的「普通会员」会变成**金色「超级会员」**，全章节 🔒 消失。

### 14.4 注册 / 登录 / 忘记密码

学习平台与打卡平台共用一套账号（`/learn/` 与打卡平台互相跳转）：

- 注册需填：**用户名、密码、确认密码、手机号、手机号短信验证码、图形验证码**；
- **手机号是唯一性凭证**，重复注册提示「该手机号已绑定账号，请直接登录！」；
- 注册成功默认**普通会员**；账号创建后**不可注销**；
- 忘记密码：输入手机号 + 短信验证码后**直接设置新密码**；
- 短信验证码限流：同号同场景 60 秒一条、同号每天 10 条、同 IP 每小时 20 条。

> **接真实短信**：把 `SMS_PROVIDER` 改成 `http` 并配置你的短信服务商接口
> （见 `server/src/sms.js` 顶部的 provider 说明），再把 `SMS_DEBUG` 改成 `0`。

### 14.5 学习平台是怎么接进来的

`learn/index.html` 由 `tools/build-learn.js` 从你提供的 `study_linux.html` **自动生成**：
构建脚本对原文件打 13 条补丁（统一 CRLF/LF → 注入主题引导 → 暴露 `window.__lcb` 数据钩子 →
章节标题追加 🔒 → 打卡 / 导出 / 撤销改为走服务端），**不改写原应用任何一行逻辑**；
`learn/bridge.js` 通过这些钩子接管注册登录、章节门禁、打卡与导出。

以后若要更新学习内容，改回 `study_linux.html`（或 `tools/build-learn.js` 里的数据源）后执行：

```bash
node tools/build-learn.js
```

即可重新生成 `learn/index.html`（构建时会自检 `__lcb` 引用的标识符是否真实存在，
避免出现「桥接层静默失效」的问题）。

### 14.6 本地验证（三套测试，共 301 项断言）

```bash
# 1) 后端接口端到端（注册/门禁/叠加/到期/禁用/导出）
node tests/api-member-smoke.js          # 123 项

# 2) 打卡平台浏览器端到端（无头 Chrome）
node tests/browser-smoke.js             # 101 项

# 3) 会员体系浏览器端到端（学习平台 + 管理后台 + 打卡平台）
node tests/browser-member.js            # 77 项
```

三套套件都会**自动复位演示账号基线、清理自己创建的测试账号**，可以反复运行；
`browser-*` 需要本机装有 Chrome，截图输出到 `tests/shots/`。

---

## 附：本项目目录结构

```
linux-study-platform/
├── web/                     # 打卡平台前端（部署到 GitHub Pages）
│   ├── index.html           #   入口页（window.LINUX_STUDY_API 写在这里）
│   ├── css/  theme.css app.css member.css
│   └── js/   config util api store ui member + views/{login,student,admin} + app
├── learn/                   # 学习平台前端（由 study_linux.html 接入后端生成）
│   ├── index.html           #   生成产物（勿手改，改 tools/build-learn.js 后重新构建）
│   ├── bridge.css           #   桥接层样式（会员徽标 / 门禁 / 定价 / 倒计时）
│   └── bridge.js            #   桥接层逻辑（注册登录 / 章节门禁 / 打卡与导出）
├── server/                  # 后端（部署到 Railway / 自建服务器）
│   ├── src/index.js         #   Express 入口（/api + /learn + 打卡平台静态托管）
│   ├── src/member.js        #   会员核心：开通/叠加/到期降级/惰性判定
│   ├── src/{auth,sms,captcha,exporter}.js
│   ├── src/routes/          #   auth(注册登录验证码) / student / member / admin 四组 API
│   ├── src/scripts/init-db.js  # 一键初始化数据库（--force 重建）
│   └── test/smoke.js        #   后端冒烟测试
├── db/
│   ├── schema.sql           # v2 全量表结构（MySQL 5.7+ 兼容）
│   ├── migrate_v2_member.sql#   v1 → v2 会员体系幂等迁移脚本
│   ├── seed_accounts.sql / seed_content.sql / gen_seed.py
├── tools/build-learn.js     # 学习平台构建脚本（给 study_linux.html 打 13 条补丁）
├── tests/
│   ├── api-member-smoke.js  # 会员体系接口端到端测试（123 项）
│   ├── browser-smoke.js     # 打卡平台浏览器端到端测试（101 项）
│   ├── browser-member.js    # 会员体系浏览器端到端测试（77 项）
│   └── lib/cdp.js           #   CDP 无头 Chrome 测试脚手架
└── .github/workflows/deploy-pages.yml   # 前端自动发布流水线
```

*文档版本：2026-10-02 · 对应当前代码（后端 123 项 + 打卡平台浏览器 101 项 + 会员浏览器 77 项端到端测试全部通过）*
