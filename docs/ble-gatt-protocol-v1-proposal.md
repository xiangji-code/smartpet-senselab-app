# SmartPet BLE GATT 与数据传输协议 V1 草案

## 文档状态

**待硬件、APP 和后端共同确认。**

这份文档规定手机 APP 和设备之间“怎么说话”。设备只要按本文档发送字节，APP 就应当能够理解；APP 按本文档发送命令，设备也必须给出确定的结果。

当前业务目标：

- 训狗器：通过 BLE 执行声音、振动、电击和停止控制。
- 止吠器：通过 BLE 查看和修改止吠模式、灵敏度、犬只体型等设置。
- 数据同步：设备在本地缓存音频、运动或混合数据，通过广播提示 APP，APP 连接后拉取数据并在后台上传后端。
- 数据不丢失：后端确认保存成功前，设备不能删除原始记录。

本文档中的命令字是拟定协议，并不表示当前开发板已经实现。当前可以先实现 `RAW_TEST` 测试数据和基础命令，业务数据格式后续按同一外层协议补齐。

## 1. 当前开发板的已知事实

蓝牙调试工具截图中高亮的是 `0x0103`，右侧显示“接收 25 Bytes”和 `Test hello`。这说明 `0x0103` 是设备向客户端发送数据的通道；客户端应通过 `0x0102` 向设备写入命令。

开发板实际暴露的 GATT 结构：

| 项目 | UUID | 属性 | 数据方向 |
| --- | --- | --- | --- |
| 数据服务 | `00000101-0000-1000-8000-00805F9B34FB` | - | - |
| 命令特征 | `00000102-0000-1000-8000-00805F9B34FB` | Write、Write Without Response | APP -> 设备 |
| 事件特征 | `00000103-0000-1000-8000-00805F9B34FB` | Read、Notify | 设备 -> APP |

此前 APP 报错是合理的：APP 当前寻找的是 `0x181F / 0x2B30 / 0x2B31`，而开发板提供的是 `0x0101 / 0x0102 / 0x0103`。写入 `Test hello` 只能证明蓝牙通道能收发，不能证明业务协议已经一致。

### 1.1 量产 UUID 建议

`0x0101 / 0x0102 / 0x0103` 可继续用于开发板联调。量产前建议生成企业自有的 128-bit UUID，并同时更新固件、APP 和文档。除非企业已经向 Bluetooth SIG 申请了正式 16-bit UUID，否则不应长期将自定义服务放在 Bluetooth Base UUID 下。

量产 UUID 尚未确定前，不影响本协议的帧格式和命令测试。

## 2. 用一句话理解整个流程

```text
设备广播“我有数据”
  -> APP连接设备并订阅0x0103
  -> APP查询记录清单
  -> APP分批拉取数据
  -> APP校验并保存到手机
  -> APP后台上传后端
  -> 后端确认成功
  -> APP下次连接时也可以通知设备删除已上传记录
```

“设备广播有数据”不等于设备直接在广播中发送音频。广播只是一张小纸条，告诉 APP 值得连接；真正的数据仍在建立 BLE 连接后传输。

## 3. 广播协议

APP 使用广播完成三件事：识别设备、显示基础状态、判断是否需要连接拉取数据。

V1 广播数据使用 10 字节固定格式：

```text
偏移  长度  字段
0     1     ProtocolVersion
1     1     ProductType
2     4     DeviceIdSuffix
6     1     BatteryPercent
7     1     DeviceState
8     1     Mode
9     1     Flags
```

字段说明：

- `ProtocolVersion`：V1 固定为 `0x01`。
- `ProductType`：`0x01` 训狗器，`0x02` 止吠器，其他值暂不支持。
- `DeviceIdSuffix`：稳定设备编号的低 4 字节，仅用于扫描匹配；完整设备编号连接后通过 `GET_DEVICE_INFO` 再次确认。
- `BatteryPercent`：`0-100`；`0xFF` 表示暂时无法读取。
- `DeviceState` 和 `Mode` 见第 7 节枚举表。
- `Flags`：bit0 表示有待同步数据，bit1 表示正在充电，bit2 表示允许连接，其余位固定为 0。

广播要求：

- 正常状态建议每 500 毫秒广播一次；等待绑定或有待同步数据时可缩短到 200 毫秒。
- 电量、状态、模式或待同步标记变化后，应在 1 秒内更新广播。
- APP 不能完全相信广播中的身份；只有完成安全连接，并确认完整设备编号与已绑定设备一致后，才能执行控制或确认删除数据。

开发板继续使用 `0x0101` 时，可将上述 10 字节放入该服务的 Service Data。量产改为 128-bit UUID 后，应重新确认广播包是否仍能放下全部字段。

## 4. GATT 传输总规则

1. APP 连接设备后，首先订阅 `0x0103` 的 Notify；订阅成功前不发送业务命令。
2. V1 所有 APP 命令通过 `0x0102` 使用 **Write With Response** 写入。
3. 所有响应、数据分片、错误和状态变化都通过 `0x0103` Notify 返回。Read 仅用于调试，不作为正常同步方式。
4. 一台设备同一时刻只允许一个 APP GATT 会话和一轮数据同步；第二个客户端连接时返回 `BUSY` 或拒绝连接。
5. APP 未订阅 Notify 且未发送开始同步命令前，设备不能主动推送缓存数据。
6. 多字节无符号整数统一使用**小端序**；文本使用 UTF-8；时间使用 UTC Unix 毫秒。
7. APP 和设备都必须校验外部输入，不能因为长度字段写了 1000 就直接读取 1000 字节。

### 4.1 MTU 与分片长度

MTU 可以理解为“蓝牙一次最多能装多少字节”。不同手机协商出的 MTU 不一样，所以不能把数据分片固定为 180 字节。

`DATA_CHUNK` 的固定开销为：ATT 3 字节 + 通用帧 10 字节 + 数据分片元数据 22 字节。因此：

```text
MaxChunkLength = min(180, NegotiatedMTU - 35)
```

示例：

| 协商 MTU | 单片最大数据 | V1 实际采用 |
| --- | ---: | ---: |
| 247 | 212 | 180 |
| 185 | 150 | 150 |
| 128 | 93 | 93 |

- V1 要求协商 MTU 不小于 128；如果小于 128，本轮数据同步返回 `MTU_TOO_SMALL`，但 PING 和基础状态读取仍可使用。选择 128 是为了保证包含完整元数据的 Manifest 也能在一个 Notify 中发送完成。
- APP 在 `START_SYNC` 中把自己实际可接收的 `MaxChunkLength` 告诉设备。
- 设备只能使用双方能力中的较小值，绝不能自行发送更大的分片。

## 5. 通用应用帧

写入 `0x0102` 和从 `0x0103` Notify 发出的每条消息都采用同一外壳：

```text
偏移量  长度  字段
0       1     SOF1 = 0xA5
1       1     SOF2 = 0x5A
2       1     ProtocolVersion = 0x01
3       1     MessageType
4       2     Sequence（uint16，小端）
6       2     PayloadLength（uint16，小端）
8       N     Payload
8 + N   2     CRC16（uint16，小端）
```

通俗理解：帧头用来找消息开头，类型表示“这是什么命令”，序号用来匹配请求和响应，长度告诉接收方后面有多少字节，CRC 用来检查消息有没有损坏。

规则：

- CRC 使用 `CRC-16/CCITT-FALSE`：多项式 `0x1021`，初始值 `0xFFFF`，不反射，最终异或 `0x0000`。
- CRC 范围是 `ProtocolVersion` 到 Payload 最后一字节，不包含两个 SOF 和 CRC 本身。
- 标准校验向量：ASCII `123456789` 的 CRC16 应为 `0x29B1`。
- `Sequence` 由 APP 从 1 开始递增，达到 65535 后回到 1；响应带回相同序号。设备主动事件使用 0。
- 数据类命令重试时必须复用原 `Sequence`。设备应缓存最近 16 个请求结果，收到重复序号和相同内容时只返回原结果，不重复执行。
- 接收方发现 SOF、版本、长度或 CRC 错误时丢弃该帧；若能够可靠识别请求序号，则返回 `ERROR`。
- 一条应用帧必须完整放进一次 GATT Write 或 Notify，不允许把同一应用帧拆到多个 GATT 操作中。因此应用帧总长度不得超过 `NegotiatedMTU - 3`。
- 响应失败时 Payload 可以只包含 `ResultCode`；响应成功时必须继续携带对应命令规定的字段。

### 5.1 命令编号范围

为避免未来命令号互相撞车，固定范围如下：

| 范围 | 用途 |
| --- | --- |
| `0x01-0x3F` | APP 请求 |
| `0x81-0xBF` | 设备响应，通常为请求值加 `0x80` |
| `0xE0-0xEF` | 设备主动事件 |
| 其他 | 保留，V1 不得使用 |

## 6. 结果码

每个命令响应 Payload 的第一个字节都是 `ResultCode`。

| 值 | 名称 | 通俗解释 |
| --- | --- | --- |
| `0x00` | OK | 已成功。 |
| `0x01` | BUSY | 设备正在忙，稍后再试。 |
| `0x02` | INVALID_COMMAND | 设备不认识这个命令。 |
| `0x03` | INVALID_PAYLOAD | 命令认识，但参数不对。 |
| `0x04` | NOT_AUTHORIZED | 没有完成安全绑定或没有权限。 |
| `0x05` | NOT_FOUND | 找不到指定记录、偏移或会话。 |
| `0x06` | CRC_ERROR | 数据校验失败，可能在传输中损坏。 |
| `0x07` | STORAGE_ERROR | 设备存储读取、保存或删除失败。 |
| `0x08` | EXECUTION_FAILED | 设备尝试执行，但执行失败。 |
| `0x09` | UNSUPPORTED_VERSION | 双方协议版本不一致。 |
| `0x0A` | TRANSFER_EXPIRED | 同步会话等待太久，已经失效。 |
| `0x0B` | MTU_TOO_SMALL | 当前蓝牙包太小，无法传业务数据。 |
| `0x0C` | SAFETY_LIMIT | 遥控参数超过固件安全限制。 |
| `0x0D` | RATE_LIMITED | 遥控太频繁，仍在冷却时间内。 |

## 7. 公共枚举

### 7.1 产品类型 ProductType

| 值 | 含义 |
| --- | --- |
| `0x01` | 训狗器 |
| `0x02` | 止吠器 |
| `0xFF` | 未知设备，APP 不允许控制 |

### 7.2 设备状态 DeviceState

| 值 | 含义 |
| --- | --- |
| `0x00` | 空闲 |
| `0x01` | 正在采集数据 |
| `0x02` | 正在同步数据 |
| `0x03` | 正在执行控制命令 |
| `0x04` | 电量过低 |
| `0x05` | 设备故障 |

### 7.3 设备模式 Mode

| 值 | 含义 |
| --- | --- |
| `0x00` | 普通/待机 |
| `0x01` | 训狗模式 |
| `0x02` | 止吠模式 |

### 7.4 CapabilityFlags

| 位 | 含义 |
| --- | --- |
| bit0 | 支持声音 |
| bit1 | 支持振动 |
| bit2 | 支持电击 |
| bit3 | 支持止吠设置 |
| bit4 | 支持音频数据 |
| bit5 | 支持 IMU 运动数据 |
| bit6 | 支持断点续传 |
| bit7 | 支持后台缓存 |
| bit8-bit31 | 保留，发送时固定为 0 |

APP 只能展示设备明确声明支持的功能，不能仅根据设备名称猜测能力。

## 8. 通用命令

| 请求 | 响应 | 名称 | 用途 |
| --- | --- | --- | --- |
| `0x01` | `0x81` | GET_DEVICE_INFO | 获取完整设备身份、版本和能力。 |
| `0x02` | `0x82` | GET_STATUS | 获取当前电量、模式和缓存状态。 |
| `0x03` | `0x83` | PING | 验证协议收发和 CRC 是否正确。 |
| `0x04` | `0x84` | SET_TIME | 校准设备时间。 |

### 8.1 GET_DEVICE_INFO

请求无 Payload。成功响应：

```text
ResultCode(1) | ProductType(1) | CapabilityFlags(4) |
DeviceIdLength(1) | DeviceId(UTF-8，最长32) |
FirmwareLength(1) | Firmware(UTF-8，最长16) |
HardwareLength(1) | Hardware(UTF-8，最长16) |
MaxSoundLevel(1) | MaxVibrationLevel(1) | MaxShockLevel(1) |
MaxOutputDurationMs(2) | ShockCooldownMs(2)
```

`DeviceId` 必须稳定且与二维码、Backend 设备记录一致。APP 发现不一致时立即停止控制和数据确认。

### 8.2 GET_STATUS

请求无 Payload。成功响应：

```text
ResultCode(1) | BatteryPercent(1) | Charging(1) | DeviceState(1) |
Mode(1) | PendingRecordCount(2) | PendingBytes(4)
```

`Charging`：0 未充电，1 正在充电，`0xFF` 未知。

### 8.3 PING

请求 Payload 为 8 字节客户端时间戳；成功响应为 `ResultCode(1) | ClientTimestamp(8)`。它不执行任何业务操作，因此是当前最适合开发板联调的第一条命令。

测试示例：时间戳全部填 0，Sequence 为 1：

```text
A5 5A 01 03 01 00 08 00 00 00 00 00 00 00 00 00 90 54
```

其中最后两个字节 `90 54` 是小端存放的 CRC16 `0x5490`。

### 8.4 SET_TIME

请求 Payload：`UtcUnixMs(8)`。设备没有可靠实时时钟时，连接后由 APP 调用。设备必须保存一个“时间是否可信”的状态；断电后时间失效时，采集记录的 `CapturedAtValid` 应为 0。

## 9. 数据格式

数据同步协议负责把一条完整记录原样送到 APP；`PayloadFormat` 说明这条记录内部是什么格式。

| 值 | 名称 | 用途 |
| --- | --- | --- |
| `0x01` | WAV | 完整 WAV 文件，包含 RIFF/WAVE 文件头。 |
| `0x02` | PCM_LE | 小端原始 PCM 音频。 |
| `0x10` | IMU_V1 | 固定格式运动数据。 |
| `0x20` | MIXED_TLV_V1 | 按时间排列的音频和 IMU 混合片段。 |
| `0xF0` | RAW_TEST | 无业务含义的测试字节，只用于当前联调。 |

### 9.1 元数据 TLV

为了降低固件实现难度，不要求固件生成 JSON。元数据使用 TLV：`Tag(1) | Length(1) | Value(N)`。

| Tag | Value | 适用格式 |
| --- | --- | --- |
| `0x01` | SampleRateHz(uint32) | PCM/WAV |
| `0x02` | BitsPerSample(uint8) | PCM/WAV |
| `0x03` | Channels(uint8) | PCM/WAV |
| `0x04` | ImuSampleRateHz(uint16) | IMU/混合 |
| `0x05` | AudioCodec(uint8)：0 PCM，1 WAV | 音频/混合 |

未知 Tag 必须跳过，不能导致整条记录解析失败。元数据总长度 V1 最多 64 字节。

### 9.2 IMU_V1

每个 IMU 样本固定 16 字节：

```text
RelativeTimeMs(uint32) |
AccelX_mg(int16) | AccelY_mg(int16) | AccelZ_mg(int16) |
GyroX_mdps(int16) | GyroY_mdps(int16) | GyroZ_mdps(int16)
```

### 9.3 MIXED_TLV_V1

混合数据由多个片段顺序组成：

```text
SegmentType(1) | RelativeTimeMs(4) | SegmentLength(2) | SegmentPayload(N)
```

- `SegmentType = 0x01`：音频片段。
- `SegmentType = 0x02`：一个或多个 `IMU_V1` 样本。

硬件还没有确定真实采样参数时，可以先生成 `RAW_TEST`。这样能够测试 BLE、APP 落盘和后端上传，但不能用于验证音频或运动分析是否正确。

## 10. 缓存数据同步

### 10.1 数据身份与删除原则

- 每条设备记录使用非零 `RecordId(uint64)`。
- `RecordId` 必须写入非易失存储，重启后不能从 1 重新开始；达到上限后的处理需在下一协议版本定义。
- Backend 唯一键为 `DeviceId + RecordId`。
- CRC32 用于检查内容，不作为记录身份；同一 `RecordId` 但 CRC 不同属于严重数据冲突，后端必须拒绝并报警。
- 设备只有收到 `CONFIRM_RECORD_DELIVERED` 的成功确认后，才允许删除对应记录。

数据内容校验使用 `CRC-32/ISO-HDLC`：多项式 `0x04C11DB7`，初始值 `0xFFFFFFFF`，输入和输出反射，最终异或 `0xFFFFFFFF`。ASCII `123456789` 的结果应为 `0xCBF43926`。

### 10.2 命令与事件

| 类型 | 编号 | 方向 | 用途 |
| --- | --- | --- | --- |
| START_SYNC / 响应 | `0x10 / 0x90` | APP -> 设备 | 建立同步会话并协商分片大小。 |
| LIST_RECORDS / 响应 | `0x11 / 0x91` | APP -> 设备 | 分页获取待同步记录清单。 |
| PULL_RECORD / 响应 | `0x12 / 0x92` | APP -> 设备 | 从指定偏移开始拉取一条记录。 |
| ACK_PROGRESS / 响应 | `0x13 / 0x93` | APP -> 设备 | 告诉设备 APP 已收到哪里，可以继续发送。 |
| CONFIRM_RECORD_DELIVERED / 响应 | `0x14 / 0x94` | APP -> 设备 | 后端已成功保存，设备可删除记录。 |
| CANCEL_SYNC / 响应 | `0x15 / 0x95` | APP -> 设备 | 取消同步，但不删除记录。 |
| RECORD_MANIFEST | `0xE0` | 设备 -> APP | 一条记录的基本信息。 |
| MANIFEST_END | `0xE1` | 设备 -> APP | 当前清单页发送完毕。 |
| DATA_CHUNK | `0xE2` | 设备 -> APP | 一个数据分片。 |
| RECORD_END | `0xE3` | 设备 -> APP | 当前记录发送完毕。 |
| SYNC_END | `0xE4` | 设备 -> APP | 当前没有更多待同步记录。 |

### 10.3 START_SYNC

请求：

```text
RequestedMaxChunkLength(2) | RequestedWindowSize(1)
```

- `RequestedMaxChunkLength` 按第 4.1 节计算。
- `RequestedWindowSize` 范围 1-4，建议默认 4。

成功响应：

```text
ResultCode(1) | TransferId(4) | AcceptedMaxChunkLength(2) |
AcceptedWindowSize(1) | PendingRecordCount(2) | PendingBytes(4)
```

`TransferId` 只用于当前连接中的拉取过程。它不是记录身份，也不能用于后端上传成功后的删除确认。

### 10.4 LIST_RECORDS

请求：

```text
TransferId(4) | Cursor(4) | PageSize(1)
```

- 首次查询 `Cursor = 0`。
- `PageSize` 范围 1-10，建议默认 10；禁止使用 0 表示无限条。

设备先返回 `0x91`：`ResultCode(1) | TransferId(4)`，再依次发送本页 `RECORD_MANIFEST`，最后发送 `MANIFEST_END`。

`RECORD_MANIFEST`：

```text
TransferId(4) | RecordId(8) | DataType(1) | PayloadFormat(1) |
PayloadFormatVersion(1) | CapturedAtValid(1) | CapturedAtMs(8) |
TotalLength(4) | PayloadCrc32(4) | MetadataLength(1) | MetadataTLV(N)
```

`MANIFEST_END`：

```text
TransferId(4) | ReturnedCount(1) | HasMore(1) | NextCursor(4)
```

这样做是为了避免设备一次把几百条记录全部推给手机，导致手机还没处理完就丢包。

### 10.5 PULL_RECORD 与流量控制

`PULL_RECORD` 请求：

```text
TransferId(4) | RecordId(8) | StartOffset(4)
```

正常从 `StartOffset = 0` 开始；断线重连后可以从 APP 已完整保存并校验的偏移继续。

设备返回 `0x92`：`ResultCode(1) | TransferId(4) | RecordId(8)`。成功后最多连续发送 `AcceptedWindowSize` 个 `DATA_CHUNK`，然后停下来等待 APP 的 `ACK_PROGRESS`。

`DATA_CHUNK`：

```text
TransferId(4) | RecordId(8) | Offset(4) | TotalLength(4) |
ChunkLength(2) | ChunkBytes(N)
```

规则：

- `ChunkLength` 不得超过 `AcceptedMaxChunkLength`。
- 分片必须从 `StartOffset` 开始连续发送。
- `Offset + ChunkLength` 不得超过 `TotalLength`。
- APP 收到重复 Offset 时可以丢弃重复分片，但内容不一致时必须停止同步并报错。

`ACK_PROGRESS` 请求：

```text
TransferId(4) | RecordId(8) | NextOffset(4)
```

`NextOffset` 表示 APP 已经连续、正确收到此前所有字节，希望设备从这里继续。设备回复 `0x93`：`ResultCode(1) | RecordId(8) | NextOffset(4)`，然后再发送下一窗口。

全部发送完成后，设备发 `RECORD_END`：

```text
TransferId(4) | RecordId(8) | TotalLength(4) | PayloadCrc32(4)
```

APP 只有在长度和 CRC32 都正确时才把记录标记为完整，并立即写入持久化待上传队列。

### 10.6 后端确认与设备删除

`CONFIRM_RECORD_DELIVERED` 不依赖 `TransferId`，因此即使上传发生在 BLE 断开几小时后，APP 下次连接仍能确认删除。

请求：

```text
RecordId(8) | PayloadCrc32(4)
```

规则：

- 仅在 Backend 已可靠保存并返回成功后发送。
- CRC 与设备记录不一致时返回 `INVALID_PAYLOAD`，不得删除。
- 已删除记录再次收到相同确认时仍返回 `OK`，避免 APP 因响应丢失而无法结束任务。
- 设备不需要知道 Backend 内部回执编号，避免 BLE 协议依赖后端实现细节。

成功响应为 `ResultCode(1) | RecordId(8)`。

### 10.7 取消与同步结束

`CANCEL_SYNC` 请求为 `TransferId(4)`；成功响应为 `ResultCode(1) | TransferId(4)`。取消只关闭当前传输会话，不删除任何记录，也不改变已上传记录的确认状态。

设备确认当前没有更多待同步记录时可以发送 `SYNC_END`：

```text
TransferId(4) | RemainingRecordCount(2)
```

`RemainingRecordCount` 必须为 0；如果又产生了新记录，应通过广播和 `STATUS_CHANGED` 告知 APP，由 APP 发起新一轮同步。

### 10.8 断线、重试与缓存满

- 断连、超时、APP 崩溃、CRC 错误或后台上传失败时，设备保留原记录。
- 数据命令超时后，APP 最多重试 3 次，并复用相同 `Sequence`。
- Backend 上传必须以 `DeviceId + RecordId` 幂等，同一记录重复上传只保存一次。
- 缓存未满时不得覆盖未确认记录。
- 缓存满时的正式策略待硬件确认。V1 建议停止新增采集并通过状态和广播报告 `STORAGE_FULL`，不要静默覆盖旧数据。

## 11. 训狗器遥控命令

遥控命令会产生真实物理输出，尤其电击命令必须防止“响应丢了，APP 重试，设备又执行一次”。

| 请求 | 接受响应 | 名称 | 请求 Payload |
| --- | --- | --- | --- |
| `0x20` | `0xA0` | TRAINER_SOUND | CommandId(4)、Level(1)、DurationMs(2) |
| `0x21` | `0xA1` | TRAINER_VIBRATION | CommandId(4)、Level(1)、DurationMs(2) |
| `0x22` | `0xA2` | TRAINER_SHOCK | CommandId(4)、Level(1)、DurationMs(2) |
| `0x23` | `0xA3` | STOP_TRAINER_OUTPUT | CommandId(4) |

接受响应：

```text
ResultCode(1) | CommandId(4)
```

`ResultCode = OK` 只表示设备接受了任务，不代表已经执行完成。最终结果由 `COMMAND_RESULT(0xE6)` 返回：

```text
OriginatingRequestType(1) | CommandId(4) | ResultCode(1) |
AppliedLevel(1) | AppliedDurationMs(2)
```

安全规则：

- `Level` 允许范围以 `GET_DEVICE_INFO` 返回的能力为准，协议字段最大 10。
- `DurationMs` 以固件安全上限为准，协议绝对上限 3000 毫秒。
- 设备至少缓存最近 16 个 `CommandId`，或保留 60 秒，以时间更长者为准。重复 `CommandId` 只返回原结果，不能再次执行。
- APP 不得自动用新的 `CommandId` 重试电击命令；必须由用户再次主动操作。
- 电击冷却时间由 `GET_DEVICE_INFO` 返回，冷却中返回 `RATE_LIMITED`。
- 断连、超时或收到停止命令时，设备必须立即停止输出。
- APP 只能在前台、用户明确操作且设备身份验证通过时发送电击命令。

## 12. 止吠器命令

| 请求 | 响应 | 名称 | 请求 Payload |
| --- | --- | --- | --- |
| `0x30` | `0xB0` | GET_ANTI_BARK_SETTINGS | 无 |
| `0x31` | `0xB1` | SET_ANTI_BARK_MODE | Mode(1) |
| `0x32` | `0xB2` | SET_BARK_SENSITIVITY | Level(1) |
| `0x33` | `0xB3` | SET_DOG_SIZE | Size(1) |
| `0x34` | `0xB4` | SET_AUTO_ANTI_BARK | Enabled(1) |

完整设置结构：

```text
ResultCode(1) | AntiBarkMode(1) | Sensitivity(1) |
DogSize(1) | AutoEnabled(1)
```

- 模式：0 仅声音，1 声音加振动，2 渐进模式。
- 灵敏度：1-5。
- 犬只体型：0 小型，1 中型，2 大型。
- 自动止吠：0 关闭，1 开启。
- 每次设置成功后都返回完整设置，APP 以设备返回值更新界面，不能只相信本地输入。

## 13. 设备主动事件

| 类型 | 名称 | Payload |
| --- | --- | --- |
| `0xE5` | STATUS_CHANGED | 与 `GET_STATUS` 成功响应相同，但不含 ResultCode |
| `0xE6` | COMMAND_RESULT | 遥控命令最终执行结果 |
| `0xEF` | ERROR | OriginatingRequestType(1)、Sequence(2)、ResultCode(1)、DetailLength(1)、Detail(UTF-8，最长64) |

设备状态变化、有新缓存数据或设备故障时发送 `STATUS_CHANGED`。错误文字只用于调试和展示，APP 的判断必须以 `ResultCode` 为准，不能依赖具体文字。

## 14. 超时与状态顺序

| 场景 | 超时 | 处理 |
| --- | ---: | --- |
| 扫描设备 | 30 秒 | 提示未发现设备，可重新扫描。 |
| 建立连接 | 10 秒 | 断开并重新扫描。 |
| 普通命令响应 | 3 秒 | 数据命令最多重试 3 次。 |
| 等待 DATA_CHUNK | 3 秒 | 重发相同 ACK_PROGRESS，最多 3 次。 |
| 等待 ACK_PROGRESS | 3 秒 | 设备暂停发送，不继续堆积 Notify。 |
| 同步会话空闲 | 60 秒 | 会话失效，但记录保留。 |
| 遥控最终结果 | 5 秒 | APP 显示执行结果未知，不自动重新执行。 |

响应和事件顺序固定：设备先返回对应命令响应，再发送由该命令触发的事件。APP 收到响应前的相关事件应暂存，不能直接丢弃。

## 15. 配对、身份和解绑

APP 当前没有显式调用 Android 的 `createBond`，并已实现 GATT 会话复用。此前日志显示一次连接中出现两次 SMP 配对/安全确认，因此更可能是固件安全流程重复，而不是 APP 建立两条连接。

固件要求：

1. `0x0102` 与 `0x0103` 使用一致的安全等级：加密且已绑定。
2. 绑定和加密成功后，除非明确解除绑定，否则不得再次发起 Security Request 或 Pairing Request。
3. 绑定信息必须持久化，正常断连和重启不能清除。
4. 固件文档需写明 IO 能力、Bonding、MITM、Secure Connections、密钥分发和随机地址策略。
5. 控制命令、设置命令和删除确认必须要求加密且已绑定；广播和基础发现可以公开。
6. V1 建议一台设备只有一个所有者。换手机或换账号时，必须通过已登录 APP 解绑，或通过设备物理操作恢复出厂设置。
7. 恢复出厂设置应清除 Bond、所有者信息和设置，但是否清除业务缓存必须由产品明确确认，不能默认一起删除。

发给硬件工程师的配对问题：

> APP 连接 GD-BLE-DEV 时，Android 在同一轮绑定中出现两次配对请求。日志显示一次 GATT 连接内发生两次 BLE SMP 配对/安全确认；取消第二次后绑定失败。请检查固件是否重复发送 Security Request/Pairing Request，或首次确认后重新初始化安全状态。请同时确认 `0x0102` 与 `0x0103` 是否使用兼容的加密/认证权限，以及绑定信息是否被正确保存和复用。


## 16. 硬件必须确认的事项

- `0x0101 / 0x0102 / 0x0103` 是临时接口还是量产接口？
- `0x0103` 是否真正支持 Notify？
- 是否接受本文档的帧、CRC、小端序、命令字和流量控制？
- Android/iOS 的实际 MTU 和 Notify 吞吐量是多少？
- 是否能先实现 `PING` 和一条固定 `RAW_TEST` 缓存记录？
- 真实音频、IMU、混合数据的采样参数是什么？
- `RecordId(uint64)` 能否跨重启保持稳定？
- 缓存满后是停止采集还是覆盖旧记录？
- 训狗器声音、振动、电击的固件安全上限和冷却时间是多少？
- 两次配对是否由固件重复发起安全请求导致？
- 正式解绑和恢复出厂设置分别清除哪些内容？

## 17. 与旧协议的兼容决策

现有 APP 和较早测试脚本使用旧的 `0x181F / 0x2B30 / 0x2B31` 协议及另一套 Read 帧格式，不能默认与本文档兼容。

硬件确认本文档后，应同步更新：

- APP UUID、广播解析、帧解析和 Notify 同步逻辑。
- 协议单元测试和 CRC 测试向量。
- `test_scripts` 中的模拟广播、模拟分片和异常测试脚本。
- Backend 的 `DeviceId + RecordId` 幂等约束和数据格式记录。

如果 `0x0101 / 0x0102 / 0x0103` 只是临时开发板接口，应单独实现并明确标注兼容适配层，不得在同一正式路径中混用两套格式。
