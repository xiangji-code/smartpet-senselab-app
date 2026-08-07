# Issue 06: Device-Pet Binding — 设备关联宠物

**Labels:** `ready-for-agent`（需 04、05 完成）  
**Blocked by:** issue-04-device-list, issue-05-pet-profile

## What to build

**Device-Pet Binding** 端到端：

- 设备详情页与设备列表提供「关联宠物」入口
- 从当前用户的 Pet Profile 中选择一只绑定到 Device
- 同一 Device 同时仅一个 active 绑定；绑新宠前先处理旧 active 关系
- 解除绑定：status → inactive，保留历史（unbound_at）
- 绑定成功后设备列表与详情展示宠物名称

## Acceptance criteria

- [x] 关联/解除后 UI 即时反映宠物名
- [x] 不能绑定他人 Pet Profile
- [x] 解除后不再展示 active 绑定，历史由后端保留
- [x] 设备已 active 绑定其他宠物时有明确提示

## Blocked by

- issue-04-device-list
- issue-05-pet-profile

## User stories covered

- 设备绑定宠物流程（文档 §6）
