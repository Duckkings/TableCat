# TableCat 多级门控专项技术设计
更新日期：2026-02-28
文档类型：当前实现态 + 后续扩展基线

## 1. 背景与目标
TableCat 的屏幕感知已经从“截图直通大模型”升级为“先算分、再触发”的门控模式，但仍处于第一阶段实现。

当前目标是：
- 高频、低成本地观察屏幕变化
- 低频、有价值地触发 AI 回复
- 把屏幕高光时刻优先级抬高
- 支持调试、回放和参数调优

当前实际实现并不是完整的终态多级门控系统，而是一个可运行、可观察、可继续迭代的 Phase 1 版本。

## 2. 与当前实现的差距
### 2.1 已落地
当前已经落地的能力：
- 独立的屏幕门控循环 `ScreenAttentionLoop`
- L0 / L1 两级判断
- 低分辨率截图采样
- 视觉差异、哈希差异、聚集度计算
- ROI 提案
- 三项评分与最终分
- 冷却、去重、忙碌保护
- 前台窗口读取
- 多图送模
- 高分事件抢占当前回复
- 调试面板和调试落盘

### 2.2 仍未完全落地
和最初设计方案相比，当前仍未完成：
- 真正的输入强度统计，`inputIntensity` 目前固定为 `0`
- 系统音量峰值接入
- `mic/system_audio` 与屏幕门控统一成同一种门控框架
- 真正的流式中断模型输出
- 更高级的新鲜度建模，例如 embedding / CLIP
- 主动陪伴的完整产品化策略

## 3. 总体架构
当前屏幕门控链路可拆成以下模块：
- `ScreenCaptureLoop`
- `FrameGateL0`
- `FrameGateL1`
- `ROIProposer`
- `MomentScorer`
- `TriggerQueue`
- `LLMOrchestrator`
- `DebugRecorder`

当前代码映射：
- `src/core/perception/attentionLoop.ts`
- `src/core/perception/frameGate.ts`
- `src/core/perception/momentScore.ts`
- `src/core/perception/triggerQueue.ts`
- `src/core/perception/foregroundWindow.ts`
- `src/core/perception/screenCapture.ts`
- `src/main.ts`

当前数据流：
1. 采集缩略图
2. 生成上一帧/当前帧差异特征
3. 做 L0/L1 门控
4. 生成 ROI
5. 计算 `excitement / interrupt / novelty / final`
6. 结合冷却、去重、忙碌保护与当前回复状态做决策
7. 若触发，则生成多图输入
8. 发给主进程进入模型请求链路
9. 若新事件更高分，可抢占旧回复

## 4. 门控分层设计
### 4.1 L0
L0 是最低成本过滤层。

当前输入：
- `visualDelta`
- `hashDistance`
- `inputIntensity`
- `cooldownOk`

当前实现说明：
- `visualDelta` 基于逐像素灰度差
- `hashDistance` 基于平均哈希签名海明距离
- `inputIntensity` 预留但尚未接入，当前固定为 `0`
- `cooldownOk` 用于判断是否处于全局冷却中

当前结构：

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

当前默认阈值：
- `screen_l0_visual_delta_threshold = 0.18`
- `screen_l0_hash_distance_threshold = 6`
- `screen_l0_input_intensity_threshold = 0.10`

当前失败原因：
- `baseline_pending`
- `global_cooldown`
- `l0_not_salient`

### 4.2 L1
L1 是轻上下文判断层。

当前输入：
- `clusterScore`
- `userIdleScore`
- `foregroundChanged`

当前结构：

```ts
interface L1GateResult {
  foregroundChanged: boolean;
  foregroundTitle?: string;
  foregroundProcessName?: string;
  clusterScore: number;
  userIdleScore: number;
  audioPeakScore: number;
  pass: boolean;
  reasons: string[];
}
```

当前默认阈值：
- `screen_l1_cluster_threshold = 0.25`

当前通过条件：
- `clusterScore >= threshold`
- 或 `userIdleScore >= 0.35`
- 或 `foregroundChanged === true`

当前说明：
- `foregroundChanged` 已接入
- `audioPeakScore` 仍是占位字段

## 5. ROI 提案设计
当前 ROI 方案已经接入，逻辑如下：
- 将屏幕差异图分成 `8x8` 网格
- 取变化最大的前 `3` 个格子
- 每个格子转换为 ROI 区域
- 对 ROI 扩边 `12%`
- 合并接触或重叠框
- 若总覆盖面积超过全屏 `35%`，则不使用 ROI，退回全局图

当前结构：

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

当前行为：
- 单次最多 `3` 个 ROI
- 过于分散时退化为全局图
- ROI 图会落盘到调试目录

## 6. 多图输入与模型编排
当前已经接入多图送模。

实际输入顺序：
- 当前 ROI
- 约 2 秒前 ROI
- 当前全局图

如果 ROI 缺失：
- 仍保留全局图
- 当前 ROI 会退回为全屏区域

当前实现并未单独引入 `ScreenAttentionPacket` 类型，而是通过 `PerceptionInput.attachments` 完成多图编排。

当前附带的触发元信息包括：
- `trigger_score`
- `allow_interrupt`
- `trigger_reason`

这使得屏幕门控输入在进入主进程后仍能保留调度语义。

## 7. 冷却、去重与主动陪伴
### 7.1 冷却
当前有三层冷却：
- 全局冷却 `screen_global_cooldown_sec`
- 同类事件冷却 `screen_same_topic_cooldown_sec`
- 忙碌保护冷却 `screen_busy_cooldown_sec`

当前默认值：
- `screen_global_cooldown_sec = 1`
- `screen_same_topic_cooldown_sec = 120`
- `screen_busy_cooldown_sec = 180`

设计说明：
- 全局冷却现在的最低值已经放开到 `1s`
- 这是为了让门控的高频检测与更快提交并存
- 旧的 `perception_interval_sec` 不再用来约束屏幕 AI 提交频率

### 7.2 去重
当前使用最近若干个签名做去重：
- 默认缓存大小 `30`
- 相似签名在同类事件冷却内不重复触发

签名由以下信息拼接而成：
- 帧哈希位串
- ROI 坐标串
- 前台进程名
- 前台窗口标题

### 7.3 主动陪伴
当前已做最小可用实现，但默认关闭。

触发条件：
- `active_companion_enabled = true`
- 用户较空闲
- 画面长时间稳定
- 当前不在冷却内
- 距离上次主动陪伴已超过配置间隔

当前默认：
- `active_companion_enabled = false`
- `active_companion_interval_min = 7`

主动陪伴不是“主动截图”，而是“在稳定场景下主动说一句轻打扰评论”。

## 8. 评分与抢占设计
### 8.1 当前分数模型
当前最终分公式：

```ts
finalScore =
  excitementScore * 0.45 +
  interruptScore * 0.30 +
  noveltyScore * 0.25
```

其中：
- `excitementScore = max(visualDelta, hashDistance / 64, clusterScore)`
- `interruptScore = userIdleScore * 0.7 + (cooldownOk ? 0.3 : 0)`
- `noveltyScore = recent signature distance normalized`

### 8.2 抢占式触发
当前已接入高分抢占机制。

当前主进程会维护：
- 正在飞的 perception 请求分数
- 当前气泡对应回复分数
- 待抢占的新请求

规则：
- 若当前无活动回复，则正常触发
- 若已有活动回复，且新分数更高，则允许抢占
- 若旧请求返回时已落后于待处理的新请求，则旧回复不上屏

当前抢占不是“中断流式输出”，而是：
- 请求级抢占
- 结果级覆盖

## 9. 配置与接口变更
### 9.1 当前关键配置
```json
{
  "screen_attention_enabled": true,
  "screen_gate_tick_ms": 500,
  "screen_active_sampling_enabled": false,
  "screen_trigger_threshold": 0.35,
  "screen_global_cooldown_sec": 1,
  "screen_same_topic_cooldown_sec": 120,
  "screen_busy_cooldown_sec": 180,
  "screen_debug_save_gate_frames": true,
  "active_companion_enabled": false,
  "active_companion_interval_min": 7
}
```

### 9.2 当前设置面板映射
当前设置区已经接入：
- `screen_attention_enabled`
- `screen_gate_tick_ms`
- `screen_active_sampling_enabled`
- `screen_trigger_threshold`
- `screen_global_cooldown_sec`
- `screen_debug_save_gate_frames`
- `active_companion_enabled`
- `active_companion_interval_min`

### 9.3 与旧轮询的关系
当前系统里有两套节奏：
- `perception_interval_sec`
  - 旧通道轮询
- `screen_gate_tick_ms`
  - 屏幕检测频率
- `screen_global_cooldown_sec`
  - 屏幕 AI 提交最短间隔

这是刻意拆开的。

## 10. 调试与观测设计
### 10.1 屏幕门控目录
当前目录：
- `LOG/screen-attention/<session-id>/`

包含：
- `events/`
- `frames/`
- `roi/`
- `llm/`
- `metrics/summary.json`

### 10.2 每次候选事件记录
当前事件 JSON 会记录：
- 时间戳
- L0 结果
- L1 结果
- ROI 结果
- 评分结果
- 冷却信息
- `decision`
- `reasons`

### 10.3 面板实时 debug
当前宠物面板显示：
- `finalScore`
- `E / I / N`
- `L0 / L1`
- 当前 tick
- 当前采样模式
- 原始差异指标
- 冷却剩余
- tick 耗时
- 前台进程
- 当前回复分数与阶段

### 10.4 启动日志
当前每次启动都会写：
- `LOG/app.log`
- `LOG/sessions/<session>.log`
- `LOG/latest-session.txt`

用于把一次运行完整串起来调试。

## 11. 分阶段实施状态
### 已完成
- 门控骨架
- ROI 提案
- 评分与冷却
- 多图送模
- 调试目录与日志
- 设置面板关键项
- 抢占式触发

### 待继续迭代
- 完整输入强度统计
- 系统音频峰值
- 流式真正中断
- 参数收敛
- `mic/system_audio` 门控统一化

## 12. 风险与回退方案
当前主要风险：
- 门控过严，几乎不触发
- 门控过松，成本上升
- ROI 过小导致误判
- 前台窗口读取超时
- 高分抢占过于频繁导致气泡抖动

当前回退方案：
- 关闭 `screen_attention_enabled`
- 提高 `screen_trigger_threshold`
- 提高 `screen_global_cooldown_sec`
- 关闭 `screen_active_sampling_enabled`
- 关闭 `active_companion_enabled`

## 13. 相关文档
- `docs/design/design.md`
- `docs/tech/tech-design.md`
- `docs/tech/trigger-mechanism.md`
