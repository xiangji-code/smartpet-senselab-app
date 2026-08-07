# Domain Docs

## Before exploring, read these

- **`CONTEXT.md`** — App 领域术语表（统一命名，避免 App 与后端文档用词漂移）
- **`docs/adr/`** — 架构决策；开发 App 功能前先读与当前任务相关的 ADR
- **`src/types/domain.ts`** — TypeScript 领域类型，与后端 JSON 字段对齐

## Backend alignment

云端后端代码位于同级目录 `SmartPet_SenseLab/`。对照关系：

| App 概念 | 后端模型 / 表 |
|----------|----------------|
| App User | `app_users` |
| Pet Profile | `pet_profiles` |
| Device | `devices` |
| Device-Pet Binding | `device_pet_bindings` |
| Audio Batch | `audio_batches` |
| Audio File | `audio_files` |

以下概念 v1 文档要求 App 展示，后端可能尚无独立表或 API，开发时需与后端确认：

- Bark Record、Motion Record、Message
- Device 的 `online_status`、`battery_level`、`bluetooth_status`、`wifi_status`

## Vocabulary

输出 issue、测试名、变量名时，使用 `CONTEXT.md` 中的 canonical term。
