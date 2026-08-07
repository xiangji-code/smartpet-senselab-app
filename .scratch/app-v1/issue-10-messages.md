# Issue 10: 消息提醒 — 列表与已读

**Labels:** `ready-for-agent`（需 01 完成）  
**Blocked by:** issue-01-app-session

## What to build

**Message** Tab 纵向切片：

- 拉取消息列表：吠叫提醒、设备提醒（低电量/离线）、系统通知（固件升级等）
- 未读显示 New 标识；支持标记已读
- 点击消息跳转相关 Device 详情或记录上下文

## Acceptance criteria

- [x] 三类消息均可展示（Mock 或 API）
- [x] 已读后 New 消失
- [x] 点击可导航到合理目标页
- [x] 未登录不可访问

## Blocked by

- issue-01-app-session

## User stories covered

- 消息提醒（文档 §3、§10）
