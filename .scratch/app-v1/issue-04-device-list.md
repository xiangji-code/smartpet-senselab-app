# Issue 04: Device 列表 — 查看、改名、解绑

**Labels:** `ready-for-human`
**Blocked by:** issue-01-app-session

## What to build

**我的设备** Tab 完整纵向切片：

- 拉取当前 App User 的全部 **Device**
- 展示 device_name、device_type、**Online Status**、电量（无数据时占位）
- 展示当前 **Device-Pet Binding** 宠物名，未关联显示「未关联宠物」
- 添加 Device → 跳转绑定流程（issue-02）
- 改名：调用更新接口
- 解绑：二次确认 → bind_status inactive / 解除用户绑定
- 点击 Device → 按类型进 Trainer 或 Bark Stopper 详情（详情内容见 07/08）

## Acceptance criteria

- [x] 进入页自动刷新设备列表
- [x] 改名、解绑成功后列表更新
- [x] 解绑有确认对话框
- [x] 空状态有「去绑定设备」引导
- [x] 仅展示属于当前用户的 Device
- [x] 不把账号侧 active/bound 状态误报为设备在线
- [x] 没有真实状态时明确显示状态、蓝牙和电量未知
- [x] 真实 BLE 广播数据与云端状态使用不同文案标明来源

## 实现说明（状态可信度）

- `Device.status` 仅表示账号侧启用状态，不用于推断实时在线状态。
- 后端尚未提供实时状态字段时，列表和详情统一显示「状态未知」。
- 不再按设备 ID 生成模拟电量、蓝牙连接和工作状态。
- 只有本次真实 BLE 连接/广播快照可显示「本次蓝牙已验证」「广播电量」
  以及广播解析出的工作状态；模拟 BLE 数据不会进入状态卡片。

## Blocked by

- issue-01-app-session

## User stories covered

- 设备列表、改名、解绑、添加（文档 §3 我的设备）
