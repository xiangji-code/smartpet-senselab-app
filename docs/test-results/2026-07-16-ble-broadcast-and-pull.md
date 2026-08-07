# 2026-07-16 BLE 广播与数据拉取测试记录

## 测试环境

- App：Android 开发版，后端地址 `http://47.99.60.124`
- 手机：小米 13（设备代号 `fuxi`），ADB 设备号 `245cd28f`
- BLE 设备：`GD-BLE-DEV`，设备 SN `XG7471AE10`
- 串口：CH340，115200、8N1、无流控
- 手机 HCI snoop：已开启完整日志

## 测试结果

### 1. 广播状态显示

串口发送 `S:75,0,0,0` 后，App 最终显示：

- 在线
- 电量 75%
- 工作状态：侦听中/待机
- 模式：训狗模式
- 待传数据：无

此前页面固定显示 57% 的原因是 App 使用了本地占位状态。App 已改为保留扫描阶段的广播数据，并在设备详情页显示真实 BLE 状态及原始状态字节。

### 2. 固件待传状态与广播不一致

串口操作：

1. `C:`：清空数据管理器。
2. `T:Hello`：加入一个数据块。
3. `Q:`：查询固件状态。

固件串口输出显示：

- Pending：有数据待传
- Blocks：1 pending
- Total bytes：7
- Block ID：1
- Type：3
- Payload：`Hello\n\n`，共 7 字节

但手机收到的广播原始状态字节为 `4B 00 00 00`，第 4 字节仍为 `00`，App 因而按协议正确显示“待传数据：无”。

结论：这是固件侧状态同步问题。数据管理器已经有待传块，但广播包中的待传标志没有同步为有数据；App 对收到的原始广播字节解析无误。

### 3. 手动拉取 BLE 数据

为排除错误广播标志的阻断，App 测试入口允许用户手动继续读取 GATT 数据。结果：

- 第一次读取：22 字节（15 字节帧头/校验信息 + 7 字节负载）
- 第二次读取：0 字节，表示传输结束
- App 提示：蓝牙数据拉取完成并已保存，共 1 个数据块
- 进度：7 B / 7 B
- 实际负载十六进制：`48 65 6C 6C 6F 0A 0A`
- SHA-256：`d9cd8d02c17c5dfa76991d216db8511c5b57f5c01cffa2e3378e183f4855259b`
- 本地队列状态：`pending_upload`

结论：BLE 连接、GATT 数据读取、帧解析、长度校验、哈希计算和 App 本地落盘均已通过。

## 当前结论

| 测试项 | 结果 | 归属/说明 |
| --- | --- | --- |
| 蓝牙连接与读取 | 通过 | App 能连接并读取固件数据 |
| 广播状态解析 | 通过 | App 显示与原始 `4B 00 00 00` 一致 |
| 固件待传标志更新 | 不通过 | 固件队列有数据，但广播第 4 字节仍为 `00` |
| 数据帧拉取 | 通过 | 成功拉取 1 块、7 字节 |
| App 本地持久化 | 通过 | `.bin` 与元数据进入待上传队列 |
| 模拟语音本地落盘 | 通过 | 生成有效 1 秒 WAV，16,044 字节，进入同一待上传队列 |
| 上传后端/OSS | 通过 | 后端修复并部署后，批次 6 完成，OSS 可读回且哈希一致 |

### 4. 模拟语音上传后端/OSS

App 新增了明确标注的“模拟语音拉取并上传 OSS”测试入口，执行：

1. 生成有效的 1 秒、8 kHz、单声道、16-bit PCM WAV。
2. 按 BLE 拉取完成后的同一路径写入 App 本地待上传队列。
3. 调用后端创建上传批次。
4. 用 multipart/form-data 上传真实本地 `.wav` 文件。
5. 成功后完成批次、显示 `storage_path`，最后清除本地队列。

首次实际结果：

- 模拟 WAV 生成和本地落盘通过，文件大小 16,044 字节。
- App 最初使用旧式 React Native `{ uri, name, type }` FormDataPart 时提示 `Unsupported FormDataPart implementation`；已改为 Expo `File`（标准 Blob）上传。
- 修正后，创建批次通过，但后端在“上传文件”阶段返回 `Internal Server Error`（HTTP 500）。
- 由于后端未完成，本地 `.wav` 按重试策略保留；重复误触产生的模拟文件已清理，仅保留一份。
- 每次重试会先创建新批次，后端可能留有若干无文件、状态为 `created` 的测试批次；当前 API 未提供删除入口，需后端按测试时间或账号清理。
- 当前尚未得到后端 `storage_path`，因此 OSS 上传未成功。

线上 `smartpet-backend.service` 日志已给出明确根因：

- `POST /api/app/uploads/batches` 返回 `201 Created`，证明鉴权、设备归属与创建批次正常。
- 批次 4、5 的 `/files` 请求均返回 HTTP 500。
- 异常发生在 `get_storage().save(...)` 初始化 OSS 客户端时。
- 后端在 FastAPI 工作线程中构造 `alibabacloud_credentials.Client`；该依赖尝试调用 `signal.signal(...)`，Python 抛出 `ValueError: signal only works in main thread of the main interpreter`。

结论：首次阻断点是后端 OSS 凭据客户端的初始化线程问题，不是 App 文件格式、蓝牙、本地队列、登录鉴权或设备绑定问题，也不是 OSS Bucket 权限错误。

修复与复测结果：

- 后端修复提交：`aa8b315 fix: initialize ECS OSS credentials safely in workers`
- 修复方法：关闭 ECS RAM Role 提供器会注册系统信号的后台调度器，保留凭据缓存及到期同步刷新。
- 回归测试：新增“在 FastAPI 请求工作线程初始化 OSS”测试；完整后端 38 项测试通过。
- 线上版本：`aa8b315`，`smartpet-backend.service` 运行正常，内网和公网 `/health` 均为 HTTP 200。
- App 重试复用了失败后保留的 WAV，没有重新生成重复文件。
- 创建批次：批次 `6`，HTTP 201。
- 上传文件：文件 `1`，HTTP 201。
- 完成批次：HTTP 200，批次状态 `completed`。
- OSS 路径：`smartpet-senselab-backend/app_user_1/batch_6/20260716113236214068_mrnf0sls-XG7471AE10-b60080-8bdd3902c766-otqvs8.wav`
- OSS 反向读取：16,044 字节。
- App、后端和 OSS 读回 SHA-256 均为 `8bdd3902c76625d51c4cfd92349493da76721a2288754b5b85becde1ed04f1c7`。
- 成功完成批次后，App 已删除本地模拟 WAV；原先从开发板真实拉取的 7 字节混合数据仍保留。

### 5. 桌面 WAV 经开发板传输的当前限制

桌面 `C:\Users\Administrator\Desktop\测试数据\audio` 中共有 2,000 个 WAV。抽查文件均为 441,044 字节；计划测试的第一个文件为 `1-100032-A-0.wav`。

根据《BLE 数据传输接口说明》现有固件测试能力：

- `T:` 只能加入文本数据，数据类型固定为 `0x03`（混合）。
- `R:` 只能生成随机数据，不能注入指定文件内容。
- 单个数据块最大 1,024 字节。
- 最多同时排队 10 个数据块。
- UART 接收缓冲区为 256 字节，建议单次发送不超过 128 字节。
- 文档虽定义 `0x01` 为音频类型，但没有定义“通过 UART 注入音频二进制文件”的命令。

因此 441,044 字节 WAV 目前不能原样执行“电脑 WAV → 开发板 → BLE → App → 后端 → OSS”。若直接把 WAV 放进 App，只能再次证明 App → OSS；若使用 `T:` 发送文件名或 Base64 小片段，只能证明文本通道，不等价于真实音频传输。

要完成真正的 WAV 全链路测试，固件至少需要新增：

1. UART 二进制文件接收模式，例如 `F:<总长度>,<类型>,<SHA256>` 后进入原始字节流接收。
2. 支持 `type=0x01` 的音频块。
3. 支持至少 441,044 字节的外部 Flash/分段缓存，或允许 App 边拉取边确认释放设备端分片。
4. 完成接收后的长度与 SHA-256/CRC 校验，并设置广播 pending 标志。
5. 明确 App 拉取完成后设备端数据的删除/确认机制。

### 6. 真实 7 字节设备数据上传 OSS

为证明非音频数据的真实设备链路，App 增加“上传已拉取的真实设备数据”测试入口。该入口只读取已经通过 BLE 拉取并校验落盘的队列项，不生成、替换或转换负载。

数据来源：

- 固件串口命令：`T:Hello`
- 固件 Block ID：1
- 固件类型：`0x03`（混合）
- BLE/App 实际负载：`48 65 6C 6C 6F 0A 0A`
- 长度：7 字节
- 原始 SHA-256：`d9cd8d02c17c5dfa76991d216db8511c5b57f5c01cffa2e3378e183f4855259b`

上传结果：

- 创建批次：批次 `7`，HTTP 201。
- 上传文件：文件 `2`，格式 `.bin`，HTTP 201。
- 完成批次：HTTP 200，状态 `completed`。
- OSS 路径：`smartpet-senselab-backend/app_user_1/batch_7/20260716114054567071_mrne3s8u-XG7471AE10-b1-d9cd8d02c17c-dl3x0a.bin`
- OSS 反向读取长度：7 字节。
- OSS 反向读取十六进制：`48 65 6C 6C 6F 0A 0A`。
- OSS SHA-256：`d9cd8d02c17c5dfa76991d216db8511c5b57f5c01cffa2e3378e183f4855259b`。
- 后端日志：`POST /batches` 201、`POST /batches/7/files` 201、`POST /batches/7/complete` 200，无异常堆栈。
- App 仅在批次完成后删除本地块；测试后手机 BLE 待上传队列为空。

结论：`开发板 → BLE → App 解析/校验/落盘 → 后端批次 → OSS → OSS 读回校验` 的真实设备数据链路已经通过。该结论适用于当前 7 字节混合数据，不代表 441,044 字节 WAV 音频链路已经通过。

## 证据

证据目录：`C:\Users\Administrator\Desktop\文档说明\BLE测试证据\broadcast-pull-20260716-182705`

- `app-adv-pending-mismatch.png`：广播待传状态不一致页面
- `app-pull-success.png`：数据拉取成功页面
- `android-logcat.txt`：Android/App 日志
- `android-bugreport.zip`：Android bugreport
- `hci\FS\data\misc\bluetooth\logs\btsnoop_hci_260716_182855.log`：本轮 HCI 日志
- 固件串口日志：需从串口助手另存，建议放入同一目录并命名为 `firmware-uart-20260716.txt`

## 后续验证边界

App 模拟语音 → 本地队列 → 后端批次 → OSS 存储链路已经通过，并完成 OSS 反向读取与哈希一致性验证。但该结果仍不证明固件已经通过 BLE 输出真实语音。要形成真正端到端铁证，固件还需提供可注入大文件的 `audio` 类型测试命令、足够的缓存/流式释放机制，并明确音频编码、采样率、声道数和分帧格式。
