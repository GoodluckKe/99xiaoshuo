# 99小说 App 接口对齐（登录 + 用户信息）

## 1) 接口清单

### A. OAuth 授权入口（前端跳转）
- 用途：让用户在 SecondMe 完成授权并回跳到你的回调地址。
- 认证方式：无服务端认证，浏览器重定向。
- 方法与地址：`GET https://go.second.me/oauth/`
- 请求参数（query）：
  - `client_id`：SecondMe Develop 的 App ID（必填）
  - `redirect_uri`：回调地址（必填，必须与后台配置一致）
  - `response_type`：固定 `code`（必填）
  - `scope`：权限范围（必填，当前最小场景为 `userinfo`）
  - `state`：防 CSRF 随机串（推荐）
- 返回结构：
  - 成功：回调到 `redirect_uri?code=xxx&state=xxx`
  - 失败：回调到 `redirect_uri?error=...&error_description=...`

### B. 用 code 换 token
- 用途：将授权回调里的 `code` 兑换成 `accessToken`。
- 认证方式：应用级认证（`client_id` + `client_secret`）。
- 方法与地址：`POST https://api.mindverse.com/gate/lab/api/oauth/token/code`
- 请求参数（`application/x-www-form-urlencoded`）：
  - `grant_type=authorization_code`
  - `code`
  - `redirect_uri`
  - `client_id`
  - `client_secret`
- 返回结构（成功）：
  - `code: 0`
  - `data.accessToken`
  - `data.refreshToken`
  - `data.tokenType`（`Bearer`）
  - `data.expiresIn`
  - `data.scope`（数组）

### C. 获取用户信息
- 用途：读取当前已授权用户的基础信息，用于个人名片展示。
- 认证方式：用户级 Bearer Token。
- 方法与地址：`GET https://api.mindverse.com/gate/lab/api/secondme/user/info`
- 请求头：
  - `Authorization: Bearer <accessToken>`
- 请求参数：无
- 返回结构（成功）：
  - `code: 0`
  - `data.userId`
  - `data.name`
  - `data.email`
  - `data.avatar`
  - `data.bio`
  - `data.selfIntroduction`
  - `data.profileCompleteness`
  - `data.route`

## 2) 接入顺序（推荐）
1. 前端点击“SecondMe 登录”，重定向到 OAuth 授权入口。
2. 用户授权后回调到 `redirect_uri`，拿到 `code` 与 `state`。
3. 服务端校验 `state` 后，调用 code 换 token 接口。
4. 用 `accessToken` 调用用户信息接口，拿到名片数据。
5. 将数据渲染到个人名片页。

## 3) 当前 Demo 的环境映射
- `SECONDME_CLIENT_ID`：`8614994a-75b1-4394-a765-ba9b321a553a`
- `SECONDME_REDIRECT_URI`：`http://localhost:3000/api/auth/callback`
- `SECONDME_SCOPE`：`userinfo`
- `SECONDME_CLIENT_SECRET`：默认从 `~/.secondme/client_secret` 读取

## 4) 文档来源
- OAuth: https://develop-docs.second.me/en/docs/api-reference/oauth
- SecondMe API: https://develop-docs.second.me/en/docs/api-reference/secondme
