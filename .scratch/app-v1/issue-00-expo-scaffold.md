# Issue 00: Expo 脚手架与导航骨架

**Labels:** `ready-for-agent`  
**Blocked by:** None — 可立即开始

## What to build

初始化 Expo + TypeScript 项目，搭建 App v1 的运行骨架：主题色（沿用原型绿色系）、底部 5 Tab 导航（设备 / 绑定 / 记录 / 消息 / 我的）、未登录时隐藏 Tab 的导航守卫占位、空页面路由到各核心屏。

同时建立 `src/api/client` 基础（base URL 环境变量、JSON 请求封装、401 时 refresh 钩子占位）和 `src/types/domain.ts` 的引用。

本切片不要求对接真实后端；各 Tab 可为占位页，但能点击切换。

## Acceptance criteria

- [x] `npx expo start` 可启动，iOS/Android/Web 至少一种可预览
- [x] 底部 5 Tab 与开发文档一致；登录态为 false 时不显示 Tab
- [x] 主题 token（主色、背景、卡片、文字）集中在一处，便于后续换肤
- [x] API client 骨架存在，支持配置 `EXPO_PUBLIC_API_URL`
- [x] 项目 README 含本地启动说明

## Blocked by

None

## User stories covered

- 登录前隐藏底部导航（结构就位）
- 登录后底部导航 5 Tab（结构就位）
