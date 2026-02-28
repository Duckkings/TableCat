# TableCat 多级门控感知专项技术设计

更新时间：2026-02-28
适用范围：`TableCat` 屏幕感知链路专项升级

## 1. 背景与目标

当前 `TableCat` 已具备真实桌面截图采集、OpenAI 多模态输入、结构化回复解析、角色卡记忆写回与桌宠气泡展示能力，但屏幕感知仍是“按固定周期采集一次，然后直接把截图送给模型”的直通模式。

这种模式有三个问题：
- 成本高：每次屏幕轮询都可能触发一次模型调用。
- 噪声大：大量无意义的小变化也会被送入模型。
- 打扰感强：桌宠容易在不值得开口的时候插话。

本专项的目标是把屏幕感知升级为“高频低成本观察 + 低频高价值触发”的多级门控模式。核心原则不是“每次截图都说话”，而是“只在值得开口时说话”。

本设计约束如下：
- 运行环境：Windows + Electron 桌宠。
- 计算策略：CPU-first，优先不依赖额外本地模型。
- 兼容当前角色卡、气泡、记忆写回、设置面板。
- 兼容当前 OpenAI 多模态输入链路。

目标指标：
- LLM 调用比例 `< 5%`
- 触发后首次响应延迟目标 `< 800ms`
- 用户感知打扰率目标 `< 10%`

## 2. 与当前实现的差距

当前实现现状：
- `enable_perception_loop + perception_interval_sec` 仍是固定轮询。
- 真实截图采集已经存在，但没有门控层。
- `source:screen` 直接进入模型，成本高、噪声大、打扰概率高。
- 没有 ROI 裁剪、变化评分、事件队列、冷却去重、主动陪伴。

当前代码边界：
- 调度主链路在 `src/main.ts`
- 固定间隔调度器在 `src/core/perception/scheduler.ts`
- 截图采集与落盘在 `src/core/perception/screenCapture.ts`
- 配置结构在 `src/core/config.ts`
- 多模态模型请求编排在 `src/core/openai.ts`

差距总结：
- 目前有“截图能力”和“送模能力”，但缺少“是否值得送模”的决策能力。
- 目前有“单帧输入”，但缺少“变化理解”和“区域聚焦”。
- 目前有“回复展示”，但缺少“低打扰策略”。

## 3. 总体架构

专项架构固定采用以下模块划分：

- `ScreenCaptureLoop`
- `FrameGateL0`
- `FrameGateL1`
- `ROIProposer`
- `MomentScorer`
- `TriggerQueue`
- `LLMOrchestrator`
- `PersonaResponder`
- `UIRenderer`
- `DebugRecorder`

数据流：
1. 高频采集低分辨率屏幕帧。
2. L0 先做极低成本过滤。
3. L1 做轻量上下文判断。
4. 通过后生成 ROI 候选。
5. 对候选打三维分数。
6. 进入触发队列做冷却与去重。
7. 仅在最终触发时采集并发送多图输入给模型。
8. 回复沿用现有结构化回复、气泡与记忆写回。

模块职责：
- `ScreenCaptureLoop`：按高频 tick 采集低分辨率帧和必要元数据。
- `FrameGateL0`：做视觉变化、输入强度、冷却检查。
- `FrameGateL1`：做前台窗口、聚集度、用户状态判断。
- `ROIProposer`：根据差异热图提出 1~3 个候选区域。
- `MomentScorer`：给候选事件计算是否值得开口的分数。
- `TriggerQueue`：处理节流、冷却、去重与最终触发。
- `LLMOrchestrator`：将多图与元信息编排为 OpenAI 多模态输入。
- `PersonaResponder`：沿用现有角色卡与结构化回复逻辑。
- `UIRenderer`：沿用现有气泡展示与历史回显。
- `DebugRecorder`：保存门控帧、ROI、事件 JSON 与统计文件。

## 4. 门控分层设计

### 4.1 L0：极低成本过滤

固定采用：
- 低分辨率缩略图：`160x90`
- 灰度化
- 帧差
- SSIM 或感知哈希二选一
- 键鼠活动强度
- 冷却状态检查

Phase 1 决策：
- 实现优先使用 `帧差 + 感知哈希 + 键鼠活动统计`
- `SSIM` 作为可选增强，不作为 P0 必需项

原因：
- 实现简单
- CPU 成本低
- 更适合当前 Node/Electron 环境直接接入

L0 输出结构固定为：

```ts
interface L0GateResult {
  visualDelta: number;
  hashDistance: number;
  inputIntensity: number;
  cooldownOk: boolean;
  pass: boolean;
  reasons: string[];
}
```

默认阈值：
- `visual_delta_threshold = 0.18`
- `hash_distance_threshold = 6`
- `input_intensity_threshold = 0.10`

L0 通过条件：
- `cooldownOk === true`
- `visualDelta >= threshold` 或 `hashDistance >= threshold`
- 用户输入强度达到门限，或视觉变化达到门限

### 4.2 L1：轻量上下文判断

固定采用：
- 前台窗口标题/进程变化
- 变化区域聚集度
- 系统音量峰值占位接口
- 用户最近交互状态

Phase 1 决策：
- 真正接入：
  - 前台窗口变化
  - 聚集度评分
  - 用户 idle / active 状态
- 暂不在 P0 接入真实系统音量峰值，只保留接口位

原因：
- 当前项目未完成系统音频采集模块
- 不应阻塞门控主链路

L1 输出结构固定为：

```ts
interface L1GateResult {
  foregroundChanged: boolean;
  clusterScore: number;
  userIdleScore: number;
  audioPeakScore: number;
  pass: boolean;
  reasons: string[];
}
```

建议规则：
- 若前台窗口变化明显，优先提高 `pass` 概率
- 若变化高度分散且 `clusterScore` 低，倾向于丢弃
- 若用户忙碌，降低可打断性

## 5. ROI 提案设计

ROI 策略固定为：
- 将差异图分成 `8x8` 网格
- 计算每块变化强度
- 取 Top `2~3` 块
- 合并相邻块
- 扩边 12% 作为安全边界
- 限制总覆盖面积不超过全屏 `35%`

ROI 输出结构固定为：

```ts
interface ROIBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ROIProposal {
  boxes: ROIBox[];
  coverageRatio: number;
  heatmapScore: number;
}
```

Phase 1 规则：
- 单次最多输出 `3` 个 ROI
- 若变化过于分散且 `coverageRatio > 0.35`，退化为全局截图，不做多 ROI
- ROI 图像保存到调试目录，与原始截图并列存储

实现要求：
- ROI 生成基于低分辨率热图
- 最终裁剪回到原始分辨率图像
- 保留每次 ROI 的来源原因，便于 debug

## 6. 多图输入与模型编排

模型输入固定采用三图方案：
- 当前 ROI
- `2s` 前 ROI
- 当前全局缩略图

如果 ROI 缺失：
- 回退为当前全屏 + `2s` 前全屏 + 当前缩略图

新增内部数据结构固定为：

```ts
interface ScreenAttentionPacket {
  source: "screen";
  currentFramePath: string;
  previousFramePath: string;
  globalThumbPath: string;
  roiPaths: string[];
  metadata: {
    ts: string;
    foregroundApp?: string;
    foregroundTitle?: string;
    finalScore: number;
    reasons: string[];
  };
}
```

与当前 `PerceptionInput` 的关系：
- 保留现有 `image_path` / `image_mime_type`
- Phase 1 不直接把 `PerceptionInput` 改成多图数组
- 新增一个屏幕专用编排层，把 `ScreenAttentionPacket` 展平为多段 OpenAI content parts

原因：
- 避免一次性改坏 `mic/system_audio` 通路
- 让屏幕专项优化与其他输入通道解耦

LLM 提示原则：
- 只描述变化内容
- 优先描述新增或消失内容
- 降低对静态背景的冗余描述
- 延续当前角色卡和 `prompts.csv` 的人格化表达

## 7. 冷却、去重与主动陪伴

### 7.1 冷却策略

固定采用三层冷却：
- 全局冷却：默认 `45s`
- 同类事件冷却：默认 `120s`
- 用户忙碌保护冷却：默认 `180s`

### 7.2 去重缓存

固定缓存：
- 最近 `30` 次触发候选
- 最近 `30` 条已播报内容
- 相似度高于 `0.85` 则降权或丢弃

Novelty 在 Phase 1 的实现：
- 不上本地 embedding
- 使用 `前台窗口签名 + 文本摘要签名 + 图像哈希` 混合近似新鲜度
- CLIP/embedding 留作 Phase 2

### 7.3 主动陪伴模式

Phase 1 仅纳入设计，不进入 P0 主实现。

触发条件：
- 屏幕长时间稳定
- 用户长时间 idle
- 最近没有主动发言

默认周期：
- `5~10 分钟`

额外约束：
- 主动陪伴受更长冷却保护
- 永远低优先级于真实高价值事件

## 8. 配置与接口变更

文档中固定新增配置项：

```json
{
  "screen_attention_enabled": true,
  "screen_gate_tick_ms": 500,
  "screen_thumb_width": 160,
  "screen_thumb_height": 90,
  "screen_l0_visual_delta_threshold": 0.18,
  "screen_l0_hash_distance_threshold": 6,
  "screen_l0_input_intensity_threshold": 0.10,
  "screen_l1_cluster_threshold": 0.25,
  "screen_trigger_threshold": 0.35,
  "screen_global_cooldown_sec": 45,
  "screen_same_topic_cooldown_sec": 120,
  "screen_busy_cooldown_sec": 180,
  "screen_recent_cache_size": 30,
  "screen_debug_save_gate_frames": true,
  "screen_debug_open_folder_button": true,
  "active_companion_enabled": false,
  "active_companion_interval_min": 7
}
```

兼容性决策：
- 保留现有 `enable_perception_loop`
- 保留现有 `perception_interval_sec`
- `enable_perception_loop` 继续控制 mic/system_audio 轮询
- `screen_attention_enabled` 单独控制新的屏幕门控链路

原因：
- 避免一次性重构所有感知模块
- 便于按通道逐步迁移

新增内部模块路径固定为：
- `src/core/perception/frameGate.ts`
- `src/core/perception/roi.ts`
- `src/core/perception/momentScore.ts`
- `src/core/perception/triggerQueue.ts`
- `src/core/perception/attentionLoop.ts`
- `src/core/perception/foregroundWindow.ts`
- `src/core/perception/userActivity.ts`

新增类型方向：
- `ScreenAttentionPacket`
- `L0GateResult`
- `L1GateResult`
- `ROIProposal`
- `MomentCandidate`

## 9. 调试与观测设计

调试目录固定为：
- `LOG/screen-attention/<session-id>/`

目录内容固定包括：
- `frames/`：原始帧或缩略图
- `roi/`：ROI 裁剪结果
- `events/`：每次候选的 JSON
- `llm/`：触发时送模态的元数据清单
- `metrics/summary.json`：会话级统计

每次候选事件记录固定字段：

```json
{
  "ts": "2026-02-28T10:30:00.000Z",
  "l0": {},
  "l1": {},
  "roi": {},
  "score": {},
  "cooldown": {},
  "decision": "drop|queue|trigger",
  "reasons": []
}
```

设置面板新增但不在 P0 首轮实现的项：
- 查看最近门控统计
- 开启/关闭门控调试落盘
- 打开 `screen-attention` 调试目录

观测指标：
- 每分钟门控总次数
- L0 通过率
- L1 通过率
- 触发率
- 模型调用率
- 平均响应时延

## 10. 分阶段实施策略

### Phase 1：屏幕门控骨架
- 新增 `attentionLoop`
- 新增 L0/L1 判定结果结构
- 新增事件日志落盘
- 验收：门控链路能独立运行，不依赖 LLM

### Phase 2：ROI 与评分
- 实现网格化 ROI
- 实现 `Excitement / Interrupt / Novelty / finalScore`
- 接入冷却与去重缓存
- 验收：只有通过阈值的事件进入触发阶段

### Phase 3：多图送模与兼容回退
- 生成当前 ROI、历史 ROI、全局缩略图
- 编排为 OpenAI 多图输入
- 失败时回退全屏直通
- 验收：可看到多图触发成功回复，失败时不会中断主流程

### Phase 4：设置与观测
- 新增门控总开关、采样 tick、触发阈值、调试开关
- 写回 `app.config.json`
- 提供打开调试目录入口
- 验收：配置重启后保留，运行中可生效

### Phase 5：主动陪伴
- 长稳态下的低频主动评论
- 更长冷却与低优先级
- 验收：不会频繁打扰，能在稳定场景偶发陪伴

## 11. 风险与回退方案

风险清单：
- 风险 1：门控过严，几乎不触发
- 风险 2：门控过松，调用比例超标
- 风险 3：ROI 过小导致模型误判
- 风险 4：Windows 前台窗口探测不稳定
- 风险 5：多图输入导致响应更慢

回退策略：
- 任一模块异常时可回退到当前“真实截图直通”模式
- 配置项 `screen_attention_enabled=false` 时完全停用新链路
- 若 ROI 失败则退回全屏图
- 若 foreground/user-activity 探测失败，不阻断主链路，仅置空对应分数

专项实施期间必须保证：
- 不影响现有聊天功能
- 不影响角色卡切换
- 不影响截图调试目录
- 不影响当前多模态直通链路的最小可用性

## 12. 验收指标

功能验收：
- 静态桌面连续 5 分钟，触发率接近 0
- 高频切换窗口时，L0/L1 通过率明显上升
- 局部区域变化时，ROI 能稳定锁定 1~3 块
- 触发后送出当前 ROI + 历史 ROI + 全局图
- 模型失败或非 JSON 返回时，主流程不崩溃
- 关闭 `screen_attention_enabled` 后恢复当前直通模式

性能验收：
- CPU-only 环境下门控 tick 不导致桌宠卡顿
- LLM 调用比例 `< 5%`
- 首次响应延迟目标 `< 800ms`

调试验收：
- 单次会话目录内能看到原始帧、ROI、事件 JSON、触发结果
- 可以基于调试数据回答“为什么触发”与“为什么没触发”

默认假设：
- 默认实现范围只覆盖屏幕感知，不同时改造 mic/system_audio
- Phase 1 采用 CPU-first，不引入本地 embedding/CLIP 依赖
- 评分模型首版使用加权和，不用纯乘积
- 现有 `docs/tech-design.md` 保持不删，只作为总文档继续存在
- 现有截图调试目录与新的门控调试目录并存，不强行合并
