
# 🐾 全局陪伴型桌宠 —— 多级门控 + 多图 ROI 完整设计方案

## 项目目标
实现一个开机全程陪伴的桌宠系统，在任意场景下：
- 低成本运行
- 低延迟响应
- 不频繁打扰
- 只在“值得开口”的时刻发言

---

# 一、总体架构

Screen Capture  
→ Frame Gate (L0/L1)  
→ ROI Proposer  
→ Moment Scorer  
→ Trigger Queue  
→ LLM Orchestrator  
→ Persona Engine  
→ UI Render  

LLM 调用比例目标：< 5%

---

# 二、多级门控设计

## L0：极低成本过滤
- 缩略图 (160x90)
- 灰度化
- 帧差 / SSIM / 感知哈希
- 键鼠频率检测
- 冷却时间检查

输出：
```yaml
visual_delta: 0.42
input_intensity: 0.15
cooldown_ok: true
pass: true
```

---

## L1：轻量上下文判断
- 前台窗口变化
- 音量峰值
- 变化区域聚集度

---

# 三、ROI 提案

方法：
- 8x8 网格分块
- 计算每块变化强度
- 选择 Top 2~3 块
- 合并相邻块

输出：
```yaml
roi_boxes:
  - [x, y, w, h]
  - [x, y, w, h]
coverage_ratio: 0.23
```

---

# 四、三维评分模型

定义三个核心分数（0~1）：

1. ExcitementScore（变化强度）
2. InterruptScore（可打断性）
3. NoveltyScore（新鲜度）

最终：

MomentScore = Excitement × Interrupt × Novelty

触发阈值建议：0.35

---

# 五、多图输入策略

发送给模型：
- 当前 ROI
- 2 秒前 ROI
- 全局缩略图

提示：
“比较两张图的变化，仅描述新增或消失内容。”

---

# 六、冷却与去重

- 全局冷却：30~120 秒
- 同类型事件冷却更长
- 最近 30 条发言缓存
- 相似度高则降权

---

# 七、主动陪伴模式

当长时间稳定：
- 每 5~10 分钟一次轻评论
- 提醒喝水
- 轻度吐槽当前标题

---

# 八、性能建议

CPU-only：强门控 + 低频采样  
核显：可加轻量 embedding  
独显：可加 CLIP 评分  

---

# 九、数据结构示例

```yaml
MomentCandidate:
  ts: 1700000000
  excitement: 0.72
  interrupt: 0.85
  novelty: 0.63
  final_score: 0.39
  roi_boxes:
    - [1200, 200, 300, 180]
  reason:
    - "large_ui_change"
    - "user_idle"
```

---

# 十、系统目标指标

- AI 调用比例 < 5%
- 响应延迟 < 800ms
- 用户打断率 < 10%

---

# 总结

桌宠的核心不是“理解世界”，
而是“抓住节奏”。

多级门控 + 多图 ROI + 三维评分 = 低成本陪玩级体验。
