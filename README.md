# SmartPet SenseLab App

智能宠物项圈 App（Expo + React Native + TypeScript）。对接 `SmartPet_SenseLab` 云端后端的 **App API**。

## 技术栈

- **Expo SDK 57** + React Native（New Architecture）
- **Expo Router**：文件式路由（`app/` 目录）
- **TypeScript**：严格模式

## 环境要求

- Node.js 18+（当前使用 v24）
- 手机安装 development build，或使用 iOS 模拟器 / Android 模拟器

## 本地启动

```bash
# 1. 安装依赖（已安装可跳过）
npm install

# 2. 配置后端地址（默认 https://47.99.60.124）
cp .env.example .env
# 编辑 .env 里的 EXPO_PUBLIC_API_URL

# 3. 启动开发服务器
npm start
```

启动后：

- 按 `w` 在浏览器打开（Web 预览，最快）
- 按 `a` 打开 Android，`i` 打开 iOS 模拟器
- 用手机 development build 扫描终端二维码

## 目录结构

```
app/                    # Expo Router 路由（页面）
  _layout.tsx           # 根布局 + 登录守卫 + Auth/Consent Provider
  (auth)/login.tsx      # 登录 / 注册页
  (tabs)/               # 登录后底部 5 Tab
    _layout.tsx         # Tab 导航：设备/绑定/记录/消息/我的
    index.tsx           # 设备列表（改名/解绑/关联宠物/进详情）
    bind.tsx            # 扫码 / 手动绑定
    records.tsx         # 数据记录（吠叫/IMU/运动 + 筛选）
    messages.tsx        # 消息（三类 + 已读 + 跳转）
    me.tsx              # 我的（账号/授权/宠物入口/退出）
  connection-setup.tsx  # 连接设置（蓝牙连接/数据同步 → 进详情）
  device/[id].tsx       # 设备详情（Trainer / Bark Stopper 控制）
  link-pet.tsx          # 设备关联宠物
  pets/                 # 宠物档案 列表 / 新建 / 编辑
src/
  api/                  # client + auth/devices/pets/bindings/uploads + records/messages(mock)
  auth/                 # AuthContext + tokenStore（refresh token 安全存储）
  ble/                  # BLE 协议、控制指令、分片同步状态机
  consent/              # 数据采集授权上下文（持久化）
  hooks/                # useDevicesWithPets 等
  lib/                  # kv 存储 / 路由 href / 设备状态 stub
  components/           # Screen、SectionCard、StatusPill、LevelStepper、Confirm/Prompt、PetForm 等
  theme/theme.ts        # 主题 token（配色/圆角/间距/字号）
  types/domain.ts       # 领域类型（与后端字段对齐）
CONTEXT.md              # 领域术语表
docs/adr/               # 架构决策记录
.scratch/app-v1/        # v1 开发任务清单（issue-00 ~ issue-12）
```

## 开发状态

**App v1 全部切片（issue-00 ~ issue-12）已完成。** web 打包（`expo export`）通过。

真实对接后端 App API 的能力：
- **App Session**：邮箱注册/登录/退出，SecureStore 存 refresh token，启动自举，401 自动 refresh。
- **设备绑定**：扫码（expo-camera）/ 手输 SN，SN 前缀识别类型（XG→训狗器、ZF→止吠器）。
- **连接设置**：蓝牙连接、设备缓存状态读取、分片同步入口，完成后按类型进详情。
- **设备列表**：刷新、改名、解绑（二次确认）、关联宠物、空状态引导。
- **宠物档案**：创建/编辑/停用（软删除），我的页入口。
- **设备关联宠物**：单 active 绑定，替换有确认，解除保留历史。
- **后台数据同步**：设备声音、行为与状态数据由后台采集并同步；用户侧不提供手动上传入口或上传记录。

BLE / Stub（硬件协议仍在联调）：
- **BLE 协议层**：按 0xFFE0 服务、0xFFE2 控制、0xFFE3 数据块、0xFFE4 传输状态、0xFFE5 传输控制、0xFFE6 通知封装。
- **数据同步**：读取设备缓存状态，按块拉取数据，每 10 块 ACK，异常断开保留断点。
- **Trainer / Bark Stopper 控制**：已接入蓝牙命令层；未接入真实设备或 Web 预览时走模拟兜底（电击有二次确认防误触）。
- **设备实时状态**：客户端 Stub。
- **数据记录、消息提醒**：Mock 数据，形状对齐 `types/domain.ts`。

> 提示：Web 预览不支持相机扫码和真实蓝牙，请在 Android development build 中测试 BLE；测试可用 `XG-001` / `ZF-001` 之类前缀体验不同设备详情。

## 常用命令

```bash
npm start          # 启动 Expo 开发服务器
npm run web        # 直接启动 Web
npm run typecheck  # TypeScript 类型检查
```
