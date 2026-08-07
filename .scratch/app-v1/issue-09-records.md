# Issue 09: 数据记录 — 吠叫与六轴运动

**Labels:** `ready-for-agent`（需 01 完成）  
**Blocked by:** issue-01-app-session

## What to build

**数据记录** Tab 纵向切片，仅展示 **Bark Record** 与 **Motion Record**（imu / motion）：

- 按当前 App User 查询
- 筛选：device、pet、record_type、时间范围
- 列表展示时间、摘要、类型标签；关联宠物名（若有 Device-Pet Binding）
- 不展示训犬操作、配对等设备事件；无上传详情页

后端 API 未就绪时 Mock，但类型与 `domain.ts` 一致。

## Acceptance criteria

- [x] 仅 bark / imu / motion 三类
- [x] 筛选可用且结果正确
- [x] 记录可关联 device_id 与宠物名
- [x] 空状态有说明

## Blocked by

- issue-01-app-session

## User stories covered

- 数据记录页（文档 §3、§10）
