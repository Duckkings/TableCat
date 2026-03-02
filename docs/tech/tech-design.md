# TableCat 技术设计
更新日期：2026-03-02

## 1. 目标
本文档描述 TableCat 当前代码实现对应的总体技术方案，重点覆盖：
- 主进程与渲染层职责
- 感知与模型请求链路
- 屏幕门控与触发调度
- Prompt、日志、调试和配置

更细的触发细节见：
- `docs/tech/multilevel-gating.md`
- `docs/tech/trigger-mechanism.md`

## 2. 总体架构
### 2.1 运行环境
- Electron 主进程负责调度、截图、模型请求、日志、配置
- Renderer 负责宠物 UI、设置面板、历史记录、评分 debug 显示
- OpenAI Chat Completions 负责结构化角色回复

### 2.2 模块划分
- `src/main.ts`
  - 应用启动
  - 配置加载
  - 角色卡加载
  - 角色卡缩放同步与窗口尺寸联动
  - 门控与旧轮询调度
  - 模型请求派发
  - 气泡显示与抢占控制
- `src/core/roleCard.ts`
  - 角色卡校验
  - 旧版记忆迁移
  - 角色卡落盘
- `src/core/memoryEntry.ts`
  - 结构化记忆构造
  - 记忆迁移与送模格式化
- `src/core/perception/*`
  - 截图采集
  - 屏幕门控
  - ROI 提案
  - 分数计算
  - 冷却与去重
  - 前台窗口读取
- `src/core/openai.ts`
  - OpenAI 请求
  - PowerShell 回退
  - API 连通性测试
- `src/core/prompts.ts`
  - 从 `prompts.csv` 读取基础 Prompt
- `src/app/*`
  - 宠物面板
  - 设置界面
  - Debug 评分牌

## 3. 感知链路拆分
### 3.1 旧轮询链路
旧轮询主要服务于：
- `mic`
- `system_audio`

相关配置：
- `enable_perception_loop`
- `perception_interval_sec`

当前约束：
- 默认 `5s`
- 最低 `1s`
- 最高 `30s`

### 3.2 屏幕门控链路
屏幕感知单独拥有一条专用链路，由 `ScreenAttentionLoop` 驱动。

相关配置：
- `screen_attention_enabled`
- `screen_gate_tick_ms`
- `screen_active_sampling_enabled`
- `screen_trigger_threshold`
- `screen_global_cooldown_sec`
- `screen_same_topic_cooldown_sec`
- `screen_busy_cooldown_sec`
- `screen_debug_save_gate_frames`

当前默认值：
- `screen_attention_enabled = true/false` 由配置控制
- `screen_gate_tick_ms = 500`
- `screen_active_sampling_enabled = false`
- `screen_trigger_threshold = 0.35`
- `screen_global_cooldown_sec = 1`
- `screen_same_topic_cooldown_sec = 0`（未配置时关闭）
- `screen_busy_cooldown_sec = 0`（未配置时关闭）

### 3.3 为什么拆成两层频率
当前实现明确区分：
- 检测频率：多久采样一次屏幕
- 提交频率：多久允许发一次 AI 请求

原因：
- 高频观察不代表要高频花费模型请求
- 高频观察才能支持“更高分事件抢占”
- 提交频率必须受冷却保护，否则成本和打扰都会失控

## 4. 屏幕门控流程
单次 tick 的主流程如下：
1. 采集一张低分辨率桌面图
2. 生成灰度图、网格能量和签名
3. 读取系统 idle 时间
4. 读取前台窗口标题和进程
5. 基于上一帧计算视觉差异、hash 差异和聚集度
6. 进行 L0/L1 门控
7. 生成 ROI
8. 计算三类评分和最终分
9. 结合冷却、去重、忙碌保护和当前回复状态决定是否触发
10. 触发后生成多图输入并异步送模

## 5. 评分与触发
### 5.1 评分模型
当前代码中的最终分公式为：

```ts
finalScore =
  excitementScore * 0.45 +
  interruptScore * 0.30 +
  noveltyScore * 0.25
```

各项来源：
- `excitementScore`
  - `max(visualDelta, hashDistance / 64, clusterScore)`
- `interruptScore`
  - `userIdleScore * 0.7 + cooldownOk * 0.3`
- `noveltyScore`
  - 基于最近触发签名的最小海明距离归一化

### 5.2 当前回复抢占
主进程维护三类状态：
- 当前正在飞的感知请求分数
- 当前气泡对应的回复分数
- 待抢占的更高分请求

行为规则：
- 若没有正在进行的请求，则按正常门控触发
- 若已有请求在飞，新事件只有在 `allow_interrupt=true` 且分数更高时才进入待处理队列
- 若旧请求返回时已落后于待处理的新高分事件，则旧结果不上屏
- 更高分事件随后立即发起

这套机制的目标是把回复资源优先给真正更值得说的事件。

## 6. 多图送模设计
屏幕触发时使用多图输入：
- 当前 ROI
- 约 2 秒前 ROI
- 当前全局图

门控打分仍基于低分辨率缩略图。

送模图片默认始终使用主屏原始分辨率截图来源，并维护当前 ROI、约 2 秒前 ROI 与当前全局图的原图版本。

当 `screen_send_foreground_window_only = true` 时，第三张全局图会从“整屏原图”切换成“当前前台窗口原图”。

如果 ROI 缺失，则退化为全局图。

模型编排方式：
- 文本部分先用 `prompts.csv` 中的 `screen_input_template`
- 图片部分通过 `attachments` 展平成多段 `image_url`
- 统一走 `requestModel()`

## 7. Prompt 设计
基础 Prompt 已配置化到 `prompts.csv`。

技术约束：
- 程序启动时会校验 CSV 必需项
- 默认系统 Prompt 与各输入模板都从表中读取
- 历史记忆送模前会格式化为逐行 JSON 对象
- 便于后续在线修改提示词而不改代码

## 7.1 角色卡记忆设计
角色卡 `memory` 当前使用对象数组而不是字符串数组：

```json
[
  {
    "返回时间": "2026-03-02 21:30:00 +08:00",
    "回复时的心情": "好奇",
    "记忆内容": "用户正在调整记忆存储格式。"
  }
]
```

技术行为：
- 新回复写回时直接生成结构化对象
- 旧角色卡中的纯字符串或 JSON 字符串会在加载阶段自动迁移
- 模型请求阶段会把对象重新格式化成逐行 JSON 文本注入 prompt

## 8. 日志与调试
### 8.1 运行日志
当前会同时写两类日志：
- `LOG/app.log`
- `LOG/sessions/<timestamp>_pid<id>.log`

并写入：
- `LOG/latest-session.txt`

启动时日志记录：
- `session_id`
- `pid`
- `platform`
- `cwd`

### 8.2 门控调试目录
目录：
- `LOG/screen-attention/<session>/`

包含：
- `events/*.json`
- `frames/*.png`
- `roi/*.png`
- `llm/*.json`
- `metrics/summary.json`

### 8.3 截图目录
用户可单独打开：
- `LOG/screenshots/<session>/`

用于回溯实际上传给 AI 的截图来源。

## 9. 配置设计
### 9.1 已实现关键字段
```json
{
  "bubble_timeout_sec": 3,
  "perception_interval_sec": 5,
  "enable_perception_loop": true,
  "enable_screen": true,
  "enable_mic": false,
  "enable_system_audio": false,
  "screen_attention_enabled": true,
  "screen_gate_tick_ms": 500,
  "screen_active_sampling_enabled": false,
  "screen_trigger_threshold": 0.35,
  "screen_global_cooldown_sec": 1,
  "screen_debug_save_gate_frames": true,
  "active_companion_enabled": false,
  "active_companion_interval_min": 7
}
```

### 9.2 语义说明
- `perception_interval_sec`
  - 旧通道轮询频率
- `screen_gate_tick_ms`
  - 屏幕门控检测频率
- `screen_global_cooldown_sec`
  - 屏幕门控最短 AI 提交间隔

## 10. 界面与 IPC
Renderer 当前通过 IPC 接收：
- `bubble:update`
- `pet:icon`
- `ui:config`
- `debug:score`

Renderer 当前还可主动调用：
- `rolecard:update-scale`

Renderer 当前展示：
- 气泡
- 历史记录
- 聊天面板
- 设置面板
- 门控评分牌

缩放链路：
- 角色卡 `scale` 作为持久化来源
- Renderer 在宠物面板滚轮和设置滑条中产生缩放请求
- Renderer 将缩放应用到 `pet-stage` 根容器，统一缩放宠物面板、气泡、设置/历史/聊天面板和字体
- Main 进程保存角色卡并重新广播 `ui:config.panelScale`
- Main 同时按舞台基准尺寸和缩放倍率重算窗口尺寸，避免大倍率时内容被固定内部边界裁切

## 11. 当前已知边界
- 旧轮询与屏幕门控同时存在，尚未统一成一个感知总线
- 回复抢占是“请求级/结果级”抢占，不是流式 token 中断
- `foregroundWindow` 依赖 PowerShell + Win32，机器兼容性仍需观察
- 评分参数仍以调试优先，尚未完成最终体验收敛

## 12. 相关专项文档
- `docs/tech/multilevel-gating.md`
- `docs/tech/trigger-mechanism.md`
