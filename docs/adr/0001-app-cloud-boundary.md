# ADR-0001: App 仅对接 App API，与后台系统隔离

## Status

Accepted

## Context

SmartPet SenseLab 同时存在 App 用户体系与 Backoffice 用户体系。云端后端对两类用户签发不同 scope 的 JWT（`app` vs `backoffice`），且数据权限模型不同。

App v1 开发文档明确要求：App 不负责后台登录、控制台、5090 Agent 工作流。

## Decision

1. App 只调用 **App API**；所有请求携带 `scope=app` 的 access token。
2. App 不使用手机号作为主登录方式；v1 仅 **email + password** 注册与登录。
3. 设备数据查询与音频上传前，必须确认设备已绑定当前 App User。
4. 音频上传批次 **必须** 包含 `device_id`；`pet_profile_id` 可选，可由后端根据 Device-Pet Binding 推导。
5. App 不实现后台能力：音频自动标注、模型训练、训练数据导出、权限管理。

## Consequences

- App 与 Backoffice 可独立演进；token 泄露面隔离。
- 部分展示字段（在线状态、电量、蓝牙/Wi-Fi 状态）可能先由 App 本地缓存或设备直连提供，待 App API 补齐后同步云端。
- 数据记录与消息若后端 v1 暂无独立接口，App 可先组合设备状态、上传批次与处理任务状态做兼容展示，但页面结构按 v1 文档保留。
