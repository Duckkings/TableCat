# TableCat 脚本接口与协议说明

更新时间：2026-02-27
适用代码：`src/` 当前实现

## 1. 边界与约定
- 主进程：`src/main.ts` + `src/core/*`
- 渲染进程：`src/app/renderer.js` + `src/app/index.html`
- 进程桥接：`src/preload.js`
- 约定：所有跨进程交互必须走 IPC（`ipcMain.handle` / `ipcRenderer.invoke`）

## 2. 数据协议

### 2.1 RoleCard（角色卡）
来源：`src/shared/types.ts`、`src/core/roleCard.ts`

```json
{
  "name": "string (required)",
  "prompt": "string (required)",
  "api": "string?",
  "scale": "number?",
  "wake_word": "string?",
  "pet_icon_path": "string?",
  "memory": ["string", "..."]
}
```

校验规则：
- `name`、`prompt` 必填且非空字符串
- `scale` 若存在必须是 number
- `wake_word` / `pet_icon_path` 若存在必须是 string
- `memory` 若存在必须是数组（当前未逐项校验字符串类型）

### 2.2 AppConfig（应用配置）
来源：`src/core/config.ts`

```json
{
  "role_card_path": "string (required)",
  "openai": {
    "api_key": "string (required)",
    "model": "string (required)"
  },
  "bubble_timeout_sec": "number?",
  "perception_interval_sec": "integer 5..30?",
  "enable_perception_loop": "boolean?",
  "enable_screen": "boolean?",
  "enable_mic": "boolean?",
  "enable_system_audio": "boolean?"
}
```

### 2.3 ModelRequest / ModelResponse
来源：`src/shared/types.ts`、`src/core/responseParser.ts`

```json
// ModelRequest
{
  "inputs": [{ "source": "screen|mic|system_audio", "content": "string" }],
  "memory": "string?",
  "role_prompt": "string",
  "default_prompt": "string"
}
```

```json
// ModelResponse（严格要求4字段）
{
  "reasoning": "string",
  "emotion": "string",
  "content": "string",
  "memory_summary": "string"
}
```

## 3. IPC 协议（主进程对外）
来源：`src/main.ts`、`src/preload.js`

### 3.1 Invoke 通道
- `rolecard:load`
  - 请求：`(roleCardPath: string)`
  - 响应：`RoleCard`
  - 副作用：更新主进程 `activeRoleCard` / `activeRoleCardPath`

- `config:get`
  - 请求：无
  - 响应：`AppConfig | null`

- `config:update`
  - 请求：`AppConfigPatch`
  - 响应：`AppConfig`
  - 副作用：
    - 广播 `ui:config`
    - 重启感知调度器
    - 若切换角色卡：广播 `pet:icon` 并自动触发首次问候（失败时发错误气泡）

- `model:first-greeting`
  - 请求：`{ apiKey: string; model: string }`
  - 响应：`ModelResponse`

- `model:request`
  - 请求：`(config, request)`
    - `config`: `{ apiKey: string; model: string }`
    - `request`: `ModelRequest`
  - 响应：`ModelResponse`

- `chat:send`
  - 请求：`(text: string)`
  - 响应：`ModelResponse`
  - 副作用：广播 `bubble:update`（回复内容）

- `api:test-connection`
  - 请求：无
  - 响应：`{ ok: true }`
  - 行为：用轻量模型请求验证 API 可用性

### 3.2 主进程广播事件
- `bubble:update`
  - 载荷：`string`
  - 语义：更新桌宠气泡文本

- `pet:icon`
  - 载荷：`string`（本地图片路径，可能为空）
  - 语义：更新宠物图标

- `ui:config`
  - 载荷：
  ```json
  {
    "bubbleTimeoutSec": "number",
    "enablePerceptionLoop": "boolean",
    "perceptionIntervalSec": "number",
    "enableScreen": "boolean",
    "enableMic": "boolean",
    "enableSystemAudio": "boolean"
  }
  ```

## 4. 预加载 API 协议（renderer 可调用）
来源：`src/preload.js`

挂载对象：`window.tablecat`

- `loadRoleCard(path)` -> Promise<RoleCard>
- `getConfig()` -> Promise<AppConfig | null>
- `updateConfig(patch)` -> Promise<AppConfig>
- `sendChatMessage(text)` -> Promise<ModelResponse>
- `testApiConnection()` -> Promise<{ ok: true }>
- `requestFirstGreeting(config)` -> Promise<ModelResponse>
- `requestModel(config, request)` -> Promise<ModelResponse>
- `onBubbleUpdate(handler)` -> 订阅 `bubble:update`
- `onPetIcon(handler)` -> 订阅 `pet:icon`
- `onUiConfig(handler)` -> 订阅 `ui:config`

## 5. 脚本级接口台账

### 5.1 `src/main.ts`
- 职责：主流程编排、窗口创建、IPC 注册、首次问候、调度器生命周期。
- 内部协议：维护 `activeRoleCard`、`activeRoleCardPath`、`perceptionScheduler` 状态。
- 对外接口：见第 3 节 IPC。

### 5.2 `src/core/config.ts`
- `loadAppConfig(configPath?) => AppConfig | null`
- `updateAppConfig(patch, configPath?) => AppConfig`
- 异常：配置缺失/字段非法时抛错并记录日志。

### 5.3 `src/core/roleCard.ts`
- `loadRoleCard(path) => RoleCard`
- `saveRoleCard(path, roleCard) => void`
- `appendMemory(roleCard, memorySummary) => RoleCard`
- 异常：字段校验失败抛 `RoleCardError`。

### 5.4 `src/core/modelRequest.ts`
- `buildModelRequest(inputs, roleCard, memory?) => ModelRequest`
- 协议：未传 `memory` 时默认拼接角色卡 `memory`。

### 5.5 `src/core/firstGreeting.ts`
- `buildFirstGreetingRequest(roleCard) => ModelRequest`
- 协议：首问候固定单输入、强制不带历史记忆（`memory: ""`）。

### 5.6 `src/core/openai.ts`
- `requestModel(config, request) => Promise<string>`
- `testOpenAIConnection(config) => Promise<void>`
- 协议：
  - 默认走 `fetch`
  - Windows `fetch` 失败时回退 PowerShell
  - 请求端点：`/v1/chat/completions`（业务）、`/v1/models`（连通性测试）

### 5.7 `src/core/responseParser.ts`
- `parseModelResponse(raw) => ModelResponse`
- `validateResponse(parsed) => void`
- 异常：非 JSON 或缺字段抛 `ResponseParseError`。

### 5.8 `src/core/memory.ts`
- `writeMemoryToRoleCard(roleCardPath, roleCard, memorySummary) => RoleCard`
- 协议：将 `memory_summary` 追加后持久化到角色卡文件。

### 5.9 `src/core/assistant.ts`
- `handleModelResponse(raw, roleCardPath, roleCard) => { response, roleCard }`
- `handleModelError(error) => void`
- 协议：负责“解析 + 记忆回写”的组合事务。

### 5.10 `src/core/perception/scheduler.ts`
- `PerceptionScheduler(intervalMs, handler)`
- `start(onBatch)` / `stop()`
- 协议：按固定间隔回调，不做并发保护（并发由上层控制）。

### 5.11 `src/core/logger.ts`
- `logInfo(message)` / `logError(message, error?)`
- 协议：日志落盘 `LOG/app.log`。

### 5.12 `src/core/settings.ts`
- `DEFAULT_SETTINGS`：默认应用设置常量。

### 5.13 `src/shared/defaults.ts`
- `DEFAULT_ROLE_PROMPT`：默认系统提示词模板（结构化 JSON 要求）。

### 5.14 `src/shared/types.ts`
- 全局类型协议定义：`RoleCard`、`PerceptionInput`、`ModelRequest`、`ModelResponse` 等。

### 5.15 `src/preload.js`
- 职责：把 IPC 包装为 `window.tablecat`。
- 协议：渲染层不得直接访问 `ipcRenderer`。

### 5.16 `src/app/renderer.js`
- 职责：UI 交互与状态管理（气泡、设置、历史、聊天）。
- 依赖协议：
  - 必须存在 `window.tablecat` API
  - 必须接收 `ui:config`/`bubble:update`/`pet:icon`
  - 依赖 `index.html` 中固定 DOM id

### 5.17 `src/app/index.html`
- 职责：桌宠 UI 容器、设置面板、聊天面板、历史面板。
- 依赖协议：DOM id 不可随意改名（由 `renderer.js` 绑定）。

## 6. 协作注意事项
- 新增 IPC 必须同步修改：`main.ts` + `preload.js` + 本文档。
- 修改数据结构必须同步修改：`src/shared/types.ts` + 校验逻辑 + 本文档。
- 任何配置项新增都要落到：`AppConfig`、`AppConfigPatch`、设置 UI、`app.config.sample.json`。
