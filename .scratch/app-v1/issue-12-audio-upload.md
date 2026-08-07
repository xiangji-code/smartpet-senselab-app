# Issue 12: 音频上传 — Audio Batch 与失败重试队列

**Labels:** `ready-for-agent`（需 04、06 完成）  
**Blocked by:** issue-04-device-list, issue-06-device-pet-binding

## What to build

**Audio Batch** 上传纵向切片：

- 仅对已绑定当前用户的 **Device** 上传
- 创建批次必须带 `device_id`；`pet_profile_id` 可选（设备有 active Device-Pet Binding 时可由后端推导）
- 上传文件/分片 → 完成批次
- 可查询批次状态（供记录页或内部调试）
- 网络失败、校验失败等：本地保留任务队列，支持重试
- 受 **Data Collection Consent** 控制；未授权不启动上传
- 设备音频按裸 PCM 小端格式解析：16 kHz、16 位、单声道；本地封装标准 WAV 后上传

不在 App 内做 5090 检测/标注。

## Acceptance criteria

- [x] 未绑定 Device 不能创建批次
- [x] 批次始终含 device_id
- [x] 上传失败保留本地队列并可重试
- [x] 完成批次后状态可查询
- [x] 未授权时不自动上传
- [x] 真实设备 PCM 封装为 `audio/wav`，上传采样率和计算所得时长

## Blocked by

- issue-04-device-list
- issue-06-device-pet-binding

## User stories covered

- 音频上传流程（文档 §5、§6、§10）
