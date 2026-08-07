# Issue 01: App Session — 邮箱注册登录与退出

**Labels:** `ready-for-human`
**Blocked by:** issue-00-expo-scaffold

## What to build

端到端实现 **App User** 的 **App Session**：

- 登录/注册页：仅 email + password；底部 **Data Collection Consent** 未勾选不可提交
- 调用注册或登录 App API；access/refresh token 安全存储（SecureStore）
- 登录后拉取当前用户与 Device 列表
- 无 Device → 跳转扫码绑定；有 Device → 跳转设备列表
- Token 过期自动 refresh；失败回登录页
- 退出登录调用 logout 使 refresh token 失效并清空本地缓存

Google 登录入口可保留但置灰（后端无 OAuth 时）。

后端未就绪时可用 Mock，但接口形状与 `src/types/domain.ts` 一致。

## Acceptance criteria

- [x] 不支持手机号/验证码登录
- [x] 未勾选协议与授权不能登录/注册
- [x] 登录成功按设备数量正确跳转
- [x] refresh token 安全存储；退出后无法访问需鉴权页面
- [x] 邮箱格式、密码为空、凭证错误有明确提示
- [x] API 请求有超时、FastAPI 错误解析和安全 GET 重试
- [x] 网络或服务器临时故障不会误清登录信息，并提供显式重试入口

## 实现说明（issue-01）

- 后端 App API 前缀为 `/api/app`，端点：`auth/register`、`auth/login`、
  `auth/refresh`、`auth/logout`、`auth/me`，设备列表 `GET /api/app/devices`。
- `register` 仅返回用户，故「注册并登录」= 先 register 再 login。
- access token 仅存内存；refresh token 经 `src/auth/tokenStore.ts` 持久化
  （原生 SecureStore，Web 预览回退 localStorage）。
- 启动自举：用持久化 refresh token 静默续期并拉取 `me` + 设备列表。
- 401 自动 refresh（注入 `src/api/client.ts`），并发 401 共享同一次 refresh。
- 仅 refresh/session 凭证被后端明确拒绝时清空会话；断网、超时、限流或
  服务端故障会保留 refresh token，并显示可重试的会话恢复页。
- JSON 请求默认 15 秒超时；GET 临时故障自动重试一次，写请求不自动重放。
- 后端错误兼容 `message`、FastAPI `detail` 和校验错误数组，登录接口与
  登录后资料加载阶段分别提示，避免把后者误报成“密码错误”。
- 跳转：登录成功后根布局守卫按设备数量决定进「绑定」或「设备」Tab。

## Blocked by

- issue-00-expo-scaffold

## User stories covered

- 邮箱注册、登录、刷新 token、退出
- 首次使用 / 老用户登录流程（文档 §6）
