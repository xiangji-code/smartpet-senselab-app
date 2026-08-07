# Issue 07: Trainer 详情 — 训犬控制与档位

**Labels:** `ready-for-agent`（需 03、04 完成）  
**Blocked by:** issue-03-connection-setup, issue-04-device-list

## What to build

**Trainer** 设备详情页纵向切片：

- 展示设备名、连接/电池/工作状态、购买时间（有则展示）
- 展示关联 **Pet Profile**
- 声音、震动、电击控制按钮 + 三档滑块（1–10）
- **电击**必须有防误触：二次确认或长按 + 安全提示
- 指令下发到设备（可 Stub）并上报后端执行结果
- 档位变更保存并同步

## Acceptance criteria

- [x] 进入页加载设备详情与实时状态
- [x] 三种控制均可触发且结果有反馈
- [x] 电击无防误触不能生效
- [x] 无配对按钮（配对仅在 Connection Setup）

## Blocked by

- issue-03-connection-setup
- issue-04-device-list

## User stories covered

- 训犬器详情与控制（文档 §3、§10）
