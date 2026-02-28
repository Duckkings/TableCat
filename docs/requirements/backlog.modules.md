# TableCat 模块化待办

依据文档：
- `docs/design/design.md`
- `docs/tech/tech-design.md`
- `docs/tech/multilevel-gating.md`
- `docs/tech/trigger-mechanism.md`

## 感知
- 统一 `screen / mic / system_audio` 的门控抽象
- 补齐真实输入强度统计
- 评估系统音量峰值接入

## 调度
- 继续收敛检测频率与 AI 提交频率的配置边界
- 评估更细的抢占阈值和优先级策略

## 调试
- 保持 session 日志、截图目录、门控目录一致
- 增强冷却原因、抢占原因和落盘说明

## 体验
- 完善设置面板文案
- 收敛主动陪伴触发策略
