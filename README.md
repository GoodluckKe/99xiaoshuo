# 99小说 SecondMe 登录 Demo

本项目用于联调并演示以下能力：
- SecondMe 登录（OAuth 授权码模式）
- 获取当前用户信息（`/api/secondme/user/info`）
- 登录后进入小说主页面（书城/创作/人格分析/每日运势）
- MCP 接口（`/mcp`）与集成元数据接口（`/api/integration/*`）

## 快速启动

```bash
npm install
cp .env.example .env
npm run dev
```

启动后访问：
- http://localhost:3000
- 登录成功后会自动跳转到 `/app`

可用测试命令：

```bash
npm run smoke
```

## 关键配置

- `SECONDME_CLIENT_ID`：你的 App ID
- `SECONDME_CLIENT_SECRET`：可不写在 `.env`，默认自动读取 `~/.secondme/client_secret`
- `SECONDME_REDIRECT_URI`：必须与 SecondMe Develop 里配置一致
- `SECONDME_SCOPE`：当前示例是 `userinfo`
- `SECONDME_REDIRECT_HOST_ALLOWLIST`：允许用于发起登录的本地主机（默认 `localhost:3000,127.0.0.1:3000`）

## State 校验失败排查

- 请尽量使用同一个主机完成登录全流程（建议一直用 `http://localhost:3000`）。
- 如果你用的是 `127.0.0.1`，确保 SecondMe Develop 的回调地址也包含 `http://127.0.0.1:3000/api/auth/callback`。

## 文档

- 接口对齐文档：`docs/secondme-api-alignment.md`
- 产品结构文档：`docs/product-architecture.md`
- 参考缓存：`references/api-reference.md`

## MCP 接口

- `POST /mcp`
  - 支持：`initialize`、`tools/list`、`tools/call`
- `GET /api/integration/manifest`
  - 输出可用于 SecondMe Develop integration 的 manifest 草案
- `GET /api/integration/tools`
  - 工具清单
- `POST /api/integration/execute`
  - 直接执行工具（便于联调）

默认工具：

- `get_user_profile`
- `get_persona_snapshot`
- `list_uploaded_novels`
- `save_note_archive`

## Vercel 部署

```bash
npx vercel --prod --yes
```

部署后请在环境变量中设置：

- `APP_BASE_URL`（生产域名，例如 `https://xxx.vercel.app`）
- `SECONDME_REDIRECT_URI`（`https://xxx.vercel.app/api/auth/callback`）
- `SECONDME_CLIENT_ID`
- `SECONDME_CLIENT_SECRET`
- `SESSION_SECRET`
