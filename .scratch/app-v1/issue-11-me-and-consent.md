# Issue 11: 我的 — 账号、授权与退出

**Labels:** `ready-for-agent`（需 01、05 完成）  
**Blocked by:** issue-01-app-session, issue-05-pet-profile

## What to build

**我的** Tab 纵向切片：

- 展示 App User 邮箱与 status
- 宠物档案入口（跳转 issue-05 页面）
- 隐私与 **Data Collection Consent** 管理：关闭后停止采集/上传行为
- 帮助与反馈入口（可先占位页）
- 退出登录（复用 issue-01 logout）

## Acceptance criteria

- [x] 邮箱与状态正确展示
- [x] 授权关闭后音频上传等采集行为被阻止或提示
- [x] 退出后回到登录页并清 token
- [x] 宠物档案入口可用

## Blocked by

- issue-01-app-session
- issue-05-pet-profile

## User stories covered

- 我的页、隐私授权、退出（文档 §3、§8、§10）
