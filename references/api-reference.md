---
fetched_at: 2026-03-29
source_oauth: https://develop-docs.second.me/en/docs/api-reference/oauth
source_secondme: https://develop-docs.second.me/en/docs/api-reference/secondme
---

# SecondMe API Reference (Core Login + User Info)

## OAuth Authorization Entry
- Method: `GET`
- URL: `https://go.second.me/oauth/`
- Query:
  - `client_id` (string, required)
  - `redirect_uri` (string, required, must match app config)
  - `response_type` (string, required, value `code`)
  - `scope` (string, required)
  - `state` (string, optional but strongly recommended)

## Exchange Code For Token
- Method: `POST`
- URL: `https://api.mindverse.com/gate/lab/api/oauth/token/code`
- Header: `Content-Type: application/x-www-form-urlencoded`
- Body:
  - `grant_type=authorization_code`
  - `code`
  - `redirect_uri`
  - `client_id`
  - `client_secret`
- Success shape:
  - `code` (0)
  - `data.accessToken`
  - `data.refreshToken`
  - `data.tokenType` (`Bearer`)
  - `data.expiresIn`
  - `data.scope` (string array)

## Get User Info
- Method: `GET`
- URL: `https://api.mindverse.com/gate/lab/api/secondme/user/info`
- Header: `Authorization: Bearer <accessToken>`
- Required permission: `user.info` (docs wording)
- Success shape:
  - `code` (0)
  - `data.userId`
  - `data.name`
  - `data.email`
  - `data.avatar`
  - `data.bio`
  - `data.selfIntroduction`
  - `data.profileCompleteness`
  - `data.route`

## Common Response Contract
- Success: `{ "code": 0, "data": { ... } }`
- Error: `{ "code": <non-zero>, "message": "...", "subCode": "..." }`
