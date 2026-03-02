# TableCat 触发机制专项文档
更新日期：2026-02-28

## 1. 目的
本文档专门说明当前屏幕门控的触发机制，回答三个问题：
- 读了哪些数据
- 做了哪些处理
- 最终如何算分并决定是否触发

本文档描述的是当前代码实现态，不是早期方案草图。

## 2. 触发链路入口
当前入口位于：
- `src/core/perception/attentionLoop.ts`

循环由 `ScreenAttentionLoop` 驱动，按 `screen_gate_tick_ms` 定时运行。

## 3. 每次 tick 会读取什么
### 3.1 配置
每次 tick 会读取并使用以下配置：
- `screen_thumb_width`
- `screen_thumb_height`
- `screen_l0_visual_delta_threshold`
- `screen_l0_hash_distance_threshold`
- `screen_l0_input_intensity_threshold`
- `screen_l1_cluster_threshold`
- `screen_trigger_threshold`
- `screen_global_cooldown_sec`
- `screen_same_topic_cooldown_sec`
- `screen_busy_cooldown_sec`
- `screen_recent_cache_size`
- `screen_active_sampling_enabled`
- `screen_debug_save_gate_frames`

### 3.2 当前屏幕图像
来自：
- `desktopCapturer.getSources()`

读取结果：
- 一张缩略图
- `pngBuffer`
- `bitmapBuffer`
- 截图时间
- 图像宽高

### 3.3 上一帧与历史帧
循环会维护：
- `previousFrame`
  - 上一帧的灰度数据、网格能量、签名
- `captureHistory`
  - 最近约 12 次截图

用途：
- 计算变化量
- 回溯 2 秒前 ROI

### 3.4 系统状态
每次 tick 还会读取：
- `powerMonitor.getSystemIdleTime()`
- 前台窗口标题、进程名、PID

前台窗口来自：
- `src/core/perception/foregroundWindow.ts`

### 3.5 当前回复状态
门控会读取主进程返回的当前回复状态：
- 是否已有请求在飞
- 当前气泡是否仍在显示
- 当前回复是否可被打断
- 当前回复分数是多少
- 当前回复阶段是 `idle / inflight / bubble`

这个状态直接决定是否允许“更高分事件抢占”。

### 3.6 最近触发历史
触发队列会读取并维护：
- 最近触发时间
- 最近忙碌触发时间
- 最近若干个事件签名

用途：
- 全局冷却
- 同类事件冷却
- 忙碌保护
- 新鲜度评分

## 4. 每次 tick 做了什么
### 4.1 截图与帧快照
先把截图变成 `FrameAnalysisSnapshot`，包含：
- 灰度数组 `grayscale`
- `8x8` 网格平均亮度 `gridEnergy`
- 平均哈希签名 `signatureBits`

### 4.2 视觉差异计算
当前实现会算三种核心特征：

#### `visualDelta`
基于当前帧和上一帧的逐像素灰度绝对差：

```ts
sum(abs(currentGray - previousGray)) / pixelCount / 255
```

#### `hashDistance`
基于两帧 `signatureBits` 的海明距离。

#### `clusterScore`
基于 `8x8` 差异网格：
- 先得到每个网格块的变化量
- 取变化最大的前三块
- 用 `top3 / total` 计算变化是否聚集

这三个量分别对应：
- 变了多少
- 变得像不像新画面
- 变化是不是集中在少数区域

### 4.3 L0 门控
L0 是最低成本过滤层。

当前使用的输入：
- `visualDelta`
- `hashDistance`
- `inputIntensity`
- `cooldownOk`

其中：
- `inputIntensity` 目前代码里仍为 `0`
- `cooldownOk` 代表全局冷却是否已结束

L0 默认阈值：
- `visualDelta >= 0.18`
- `hashDistance >= 6`
- `inputIntensity >= 0.10`

L0 的失败原因可能是：
- `baseline_pending`
- `global_cooldown`
- `l0_not_salient`

### 4.4 L1 门控
L1 是轻上下文判断层。

当前使用的输入：
- `clusterScore`
- `userIdleScore`
- `foregroundChanged`

当前逻辑：
- 只要满足以下任一条件即可通过：
  - `clusterScore >= screen_l1_cluster_threshold`
  - `userIdleScore >= 0.35`
  - `foregroundChanged === true`

L1 常见失败原因：
- `l0_blocked`
- `l1_not_worthy`

### 4.5 ROI 提案
当前 ROI 算法位于：
- `src/core/perception/frameGate.ts`

实现过程：
1. 计算当前帧与上一帧的 `8x8` 差异网格
2. 取变化量最大的前 3 个格子
3. 把每个格子还原成图像区域
4. 每个区域向外扩边 12%
5. 合并接触或重叠的相邻框
6. 如果总覆盖面积超过全屏 35%，则放弃 ROI，退回全局图

输出：
- `boxes`
- `coverageRatio`
- `heatmapScore`

### 4.6 新鲜度计算
签名由以下内容拼接：
- 当前帧的平均哈希位串
- ROI 位置串
- 前台进程名
- 前台窗口标题

然后与最近若干次签名做海明距离比较：
- 取最小距离
- 除以签名长度
- 归一到 `0~1`

这就是当前实现里的 `noveltyScore`。

## 5. 当前分数怎么算
### 5.1 `userIdleScore`
来自：

```ts
idleSeconds / 15
```

并限制在 `0~1`。

### 5.2 `excitementScore`
来自三者中的最大值：

```ts
max(visualDelta, hashDistance / 64, clusterScore)
```

含义：
- 视觉变化够大
- 画面签名明显变化
- 变化集中在局部高价值区域

### 5.3 `interruptScore`
当前公式：

```ts
userIdleScore * 0.7 + (cooldownOk ? 0.3 : 0)
```

含义：
- 用户越空闲，越容易打断
- 不在冷却中时，额外加分

### 5.4 `finalScore`
当前最终分：

```ts
finalScore =
  excitementScore * 0.45 +
  interruptScore * 0.30 +
  noveltyScore * 0.25
```

所有分值都会被限制在 `0~1`。

## 6. 决策规则
### 6.1 候选不足
以下情况直接不触发：
- 没有上一帧，进入 `idle`
- `finalScore < screen_trigger_threshold`

### 6.2 冷却限制
当前实现有三层冷却：
- 全局冷却 `screen_global_cooldown_sec`
- 同类事件冷却 `screen_same_topic_cooldown_sec`
- 忙碌保护冷却 `screen_busy_cooldown_sec`

补充说明：
- 只有 `screen_global_cooldown_sec` 未配置时仍会使用默认值 `1s`
- `screen_same_topic_cooldown_sec` 与 `screen_busy_cooldown_sec` 未配置时默认关闭
- 调试面板中的 `cooldown` 现在显示当前实际命中的那一层冷却剩余时间，不再只显示全局冷却

对应决策原因：
- `global_cooldown`
- `same_topic_cooldown`
- `busy_cooldown`

### 6.3 更高分抢占
如果当前已有回复在进行中，且：
- 当前回复允许打断
- 新事件分数更高

则触发队列会直接返回：
- `decision = trigger`
- `reason = interrupt_active_reply`

这一步会突破普通冷却限制。

## 7. 触发后进行了什么操作
### 7.1 生成多图输入
当前会生成：
- 当前 ROI 图
- 约 2 秒前 ROI 图
- 当前全局图

并写入：
- `LOG/screen-attention/<session>/llm/`

### 7.2 生成 PerceptionInput
触发后的输入会附带：
- `trigger_score`
- `allow_interrupt = true`
- `trigger_reason`
- `attachments`

### 7.3 发给主进程
主进程会把这批输入交给模型请求链路。

若当前已有请求在飞：
- 分数更高则进入待处理队列
- 当前请求返回时如果已经落后，会被判为 stale，不上屏

### 7.4 气泡展示
最终只有最新有效结果会显示到气泡。

气泡显示后，主进程会记录：
- 当前回复分数
- 当前回复是否可打断
- 当前气泡结束时间

## 8. 触发机制读取了哪些外部信息
总结为六类：
- 屏幕缩略图像素
- 上一帧与历史帧缓存
- Windows 前台窗口信息
- 系统 idle 时间
- 配置阈值和冷却参数
- 当前回复状态与最近触发历史

## 9. 写出了哪些调试数据
### 9.1 事件 JSON
会写入：
- 时间戳
- L0 结果
- L1 结果
- ROI 结果
- 评分结果
- 冷却相关信息
- `decision`
- `reasons`

### 9.2 图像文件
可选保存：
- 原始帧
- ROI 裁剪图
- 送模图

### 9.3 指标汇总
会写入：
- `tickCount`
- `triggerCount`
- `cooldownCount`
- `companionTriggerCount`
- `averageTickDurationMs`
- `lastTickDurationMs`
- `currentTickMs`
- `overrunCount`

## 10. 当前限制
- `inputIntensity` 还没有真正接入输入设备统计，目前固定为 `0`
- `foregroundWindow` 依赖 PowerShell，偶发可能超时
- 抢占不是流式取消，只是结果级覆盖
- 当前评分公式仍以易调试为主，不代表最终产品化参数

## 11. 相关代码入口
- `src/core/perception/attentionLoop.ts`
- `src/core/perception/frameGate.ts`
- `src/core/perception/momentScore.ts`
- `src/core/perception/triggerQueue.ts`
- `src/core/perception/foregroundWindow.ts`
- `src/main.ts`
