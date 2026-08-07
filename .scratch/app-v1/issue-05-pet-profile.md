# Issue 05: Pet Profile — 宠物档案 CRUD

**Labels:** `ready-for-agent`（需 01 完成）  
**Blocked by:** issue-01-app-session

## What to build

**Pet Profile** 基础能力，从「我的」进入：

- 列表、详情、创建、编辑
- 字段：name, species(默认 dog), breed, sex, birthday, weight_kg, avatar_url, notes, status
- 停用档案（非物理删除）
- 仅当前 App User 可见可改

本切片不要求设备关联（见 issue-06）。

## Acceptance criteria

- [x] 我的页有宠物档案入口
- [x] 可创建多只 Pet Profile
- [x] 编辑/停用后列表与详情一致
- [x] species 默认 dog

## Blocked by

- issue-01-app-session

## User stories covered

- 宠物档案 CRUD（文档 §3 宠物档案）
