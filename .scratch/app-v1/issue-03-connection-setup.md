# Issue 03: Connection Setup — 蓝牙与 Wi-Fi 配网入口

**Labels:** `ready-for-agent`（需 02 完成）  
**Blocked by:** issue-02-device-binding

## What to build

绑定成功后的 **Connection Setup** 流程（Trainer 与 Bark Stopper 均先经过此页）：

- 展示设备已识别、Device SN、device_type
- 展示 **Bluetooth Status**、**Wi-Fi Status**
- 提供蓝牙连接入口、Wi-Fi 配网入口
- v1 允许硬件层先 Stub（模拟连接成功），但 UI 与状态机完整
- 连接完成后按 device_type 进入 Trainer 或 Bark Stopper 详情
- 状态变更预留上报后端接口

配对/配网入口仅在此页，不在设备详情页重复。

## Acceptance criteria

- [x] 绑定后必经连接设置再进详情
- [x] 蓝牙/Wi-Fi 状态在页面上可见且可更新
- [x] Trainer → 训犬器详情；Bark Stopper → 止吠器详情
- [x] 详情页无 433M/蓝牙配对按钮

## Blocked by

- issue-02-device-binding

## User stories covered

- 连接设置、蓝牙/Wi-Fi（文档 §3、§6 首次使用 9–10）
