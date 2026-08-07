# SmartPet SenseLab App

移动端应用上下文：帮助 App 用户绑定智能硬件、管理宠物档案、控制训狗/止吠设备、查看行为数据，并在后台将设备音频上传到云端。

## Language

### 账号与授权

**App User**:
使用邮箱注册的终端用户；所有 App 数据按 `app_user_id` 隔离。
_Avoid_: 用户、账号、customer

**App Session**:
由 access token 与 refresh token 组成的登录态；仅用于 App API。
_Avoid_: 登录态、token 混称

**Data Collection Consent**:
用户勾选授权后，App 才可采集并上传设备声音、行为与状态数据。
_Avoid_: 隐私勾选、协议同意（泛指时）

### 设备

**Device**:
已绑定到当前 App User 的物理智能硬件。
_Avoid_: 终端、硬件实例

**Device SN**:
设备唯一序列号；扫码或手动输入的「设备码」即 Device SN。
_Avoid_: 设备码与 SN 混用不同含义

**Trainer**:
训狗器类型设备，提供声音、震动、电击控制。
_Avoid_: 训练项圈（产品文案可用，领域术语用 Trainer）

**Bark Stopper**:
止吠器类型设备，监测吠叫并提供灵敏度与犬型设置。
_Avoid_: 止吠项圈（产品文案可用）

**Device Binding**:
App User 与 Device 的归属关系；解绑后设备对该用户变为 inactive，而非物理删除设备记录。
_Avoid_: 配对（配对指蓝牙链路，不是用户归属）

**Connection Setup**:
设备绑定成功后，完成蓝牙连接、设备状态读取与缓存数据同步的设置流程。
_Avoid_: 绑定（绑定指用户归属，不是无线连接）

### 宠物

**Pet Profile**:
App User 创建的宠物档案；v1 默认物种为狗。
_Avoid_: 宠物、狗档案

**Device-Pet Binding**:
Device 与 Pet Profile 的使用关系；同一时刻一台 Device 只能 active 绑定一只 Pet Profile。解除绑定时保留历史记录。
_Avoid_: 关联、挂载

### 数据与上传

**BLE Transfer**:
App 连接设备后读取端侧缓存状态，再按分片拉取音频、六轴与行为记录；每批 ACK 推进断点。
_Avoid_: 一次性读完、手动上传

**Bark Record**:
狗吠叫相关的行为记录，用于数据记录页展示。
_Avoid_: 吠叫事件、bark 数据（口语）

**Motion Record**:
六轴传感器产生的运动数据或运动分析结果（含 IMU 原始采样与 motion 分析）。
_Avoid_: 传感器数据（太宽泛）

**Message**:
App 内展示的提醒，包括吠叫提醒、设备提醒（低电量/离线）、系统通知（如固件升级）。
_Avoid_: 通知、推送（推送是送达渠道）

### 设备状态（App 展示层）

**Online Status**:
设备是否可被云端或 App 认为在线；由 `last_seen_at` 或实时连接推断。
_Avoid_: 连接状态（连接状态过宽，需说明是在线还是蓝牙连接）

**Bluetooth Status**:
近距离蓝牙链路状态；在 Connection Setup 与设备详情中展示，用于控制指令和缓存数据同步。
