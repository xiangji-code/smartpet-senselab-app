# Issue 02: Device Binding — 扫码与手动绑定

**Labels:** `ready-for-agent`（需 01 完成）  
**Blocked by:** issue-01-app-session

## What to build

**Device Binding** 纵向切片：App User 通过 Device SN 将 **Device** 绑定到自己账号。

- 扫码绑定页：相机扫二维码 + 手动输入 Device SN
- 页面不要求用户选择 device_type；由后端根据 SN 识别
- 云端先登记为 `pending_verification` → **Connection Setup** 页完成真实 BLE 验证 → 正式绑定
- 失败展示明确错误：设备不存在、已被他人绑定、已停用、网络失败

## Acceptance criteria

- [x] 扫码与手输 SN 均可触发绑定
- [x] 登记后进入连接设置，且设备上下文不丢失
- [x] BLE 验证前不可关联宠物或上传数据，验证成功后才转为 `bound`
- [x] 待验证设备可取消，且不能被其他账号抢占
- [x] 上述错误码/文案对用户可见
- [x] 未登录用户不能进入绑定页

## 实现说明（issue-02）

- 登记接口：`POST /api/app/devices/verifications`；BLE 成功后调用
  `PUT /api/app/devices/{id}/verification`，取消使用对应 `DELETE` 接口。
- 扫码：`expo-camera` `CameraView` 扫 QR（含 code128/ean13），带取景框与防重复回调锁；
  Web 预览不支持扫码，引导手动输入。相机权限在 `app.json` 的 `expo-camera` 插件声明。
- 手动输入：任意非空 SN 可提交（回车或按钮）。
- 登记后调用 `refreshDevices()` 刷新设备列表，跳转 `connection-setup`，
  通过路由 query 携带 deviceId / deviceSn / deviceName，保证设备上下文不丢失。
- 错误文案：404 设备不存在、409 已被他人登记或绑定、403 已停用、422 SN 格式、其余/网络异常。
- 绑定页位于登录后的 (tabs) 分组，未登录会被守卫重定向到登录页。

## Blocked by

- issue-01-app-session

## User stories covered

- 扫码绑定、手动输入设备码（文档 §3、§6 首次使用 7–8）
