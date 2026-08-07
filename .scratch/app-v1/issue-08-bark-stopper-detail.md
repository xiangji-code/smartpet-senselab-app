# Issue 08: Bark Stopper 详情 — 止吠设置与吠叫提醒 UI

**Labels:** `ready-for-agent`（需 03、04 完成）  
**Blocked by:** issue-03-connection-setup, issue-04-device-list

## What to build

**Bark Stopper** 设备详情页纵向切片：

- 设备状态信息 + 关联 Pet Profile
- 吠叫检测状态；检测到吠叫时卡片高亮闪烁
- 灵敏度 1–10；犬型 small / medium / large
- 吠叫次数累计；刷新与清零（清零需确认）
- 设置与计数同步设备并上报后端

## Acceptance criteria

- [x] 吠叫触发时 UI 明显闪烁/高亮
- [x] 灵敏度、犬型、计数可读写
- [x] 清零有确认且同步后端
- [x] 进入页加载止吠设置与计数

## Blocked by

- issue-03-connection-setup
- issue-04-device-list

## User stories covered

- 止吠器详情、吠叫提醒 UI（文档 §3、§10）
