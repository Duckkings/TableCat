# TableCat 脚本接口与协议说明

更新时间：2026-03-02
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
  "memory": [{
    "返回时间": "string",
    "回复时的心情": "string",
    "记忆内容": "string"
  }]
}
```

校验规则：
- `name`、`prompt` 必填且非空字符串
- `scale` 若存在必须是 `1..20` 间的 number
- `wake_word` / `pet_icon_path` 若存在必须是 string
- `memory` 若存在必须是结构化记忆对象数组
- 兼容旧角色卡中的字符串记忆；加载时会自动迁移并持久化回文件

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
  "enable_system_audio": "boolean?",
  "screen_same_topic_cooldown_sec": "integer 0..600?",
  "screen_busy_cooldown_sec": "integer 0..600?"
}
```

### 2.3 ModelRequest / ModelResponse
来源：`src/shared/types.ts`、`src/core/responseParser.ts`

```json
// ModelRequest
{
  "inputs": [{
    "source": "screen|mic|system_audio",
    "content": "string",
    "image_path": "string?",
    "image_mime_type": "string?"
  }],
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

补充约定：
- `emotion` 应使用简短中文心情词
- `memory_summary` 应使用中文；若本轮无需记忆，可返回空字符串

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

- `rolecard:update-scale`
  - 请求：`(scale: number)`
  - 响应：`RoleCard`
  - 副作用：更新当前角色卡 `scale`、持久化文件、同步整套宠物舞台缩放，并按舞台尺寸重算窗口边界

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

- `debug:open-screenshot-folder`
  - 请求：无
  - 响应：`{ path: string }`
  - 行为：打开本次启动对应的截图调试目录

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
    "panelScale": "number",
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
- `updateRoleCardScale(scale)` -> Promise<RoleCard>
- `getConfig()` -> Promise<AppConfig | null>
- `updateConfig(patch)` -> Promise<AppConfig>
- `sendChatMessage(text)` -> Promise<ModelResponse>
- `testApiConnection()` -> Promise<{ ok: true }>
- `openScreenshotFolder()` -> Promise<{ path: string }>
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
- `appendMemory(roleCard, memoryEntry) => RoleCard`
- `updateRoleCardScale(roleCard, scale) => RoleCard`
- 异常：字段校验失败抛 `RoleCardError`。
- 协议：加载角色卡时会自动把旧字符串记忆迁移为对象数组。

### 5.4 `src/core/modelRequest.ts`
- `buildModelRequest(inputs, roleCard, memory?) => ModelRequest`
- 协议：未传 `memory` 时默认将角色卡 `memory` 格式化为逐行 JSON 记忆块。

### 5.5 `src/core/firstGreeting.ts`
- `buildFirstGreetingRequest(roleCard) => ModelRequest`
- 协议：首问候固定单输入、强制不带历史记忆（`memory: ""`）。

### 5.6 `src/core/openai.ts`
- `requestModel(config, request) => Promise<string>`
- `testOpenAIConnection(config) => Promise<void>`
- 协议：
  - 默认走 `fetch`
  - Windows `fetch` 失败时回退 PowerShell
  - 支持 `source:screen` 附带图片输入
  - 请求端点：`/v1/chat/completions`（业务）、`/v1/models`（连通性测试）

### 5.7 `src/core/responseParser.ts`
- `parseModelResponse(raw) => ModelResponse`
- `validateResponse(parsed) => void`
- 异常：非 JSON 或缺字段抛 `ResponseParseError`。

### 5.8 `src/core/memory.ts`
- `writeMemoryToRoleCard(roleCardPath, roleCard, response) => RoleCard`
- 协议：将模型返回的 `memory_summary` 封装为结构化记忆对象后追加到角色卡文件。
- 当前写回格式示例：
```json
{"返回时间":"2026-03-02 21:30:00 +08:00","回复时的心情":"好奇","记忆内容":"用户正在调整记忆存储格式。"}
```

### 5.9 `src/core/assistant.ts`
- `handleModelResponse(raw, roleCardPath, roleCard) => { response, roleCard }`
- `handleModelError(error) => void`
- 协议：负责“解析 + 记忆回写”的组合事务。

### 5.10 `src/core/perception/scheduler.ts`
- `PerceptionScheduler(intervalMs, handler)`
- `start(onBatch)` / `stop()`
- 协议：按固定间隔回调，不做并发保护（并发由上层控制）。

### 5.11 `src/core/perception/screenCapture.ts`
- `captureScreenPerceptionInput() => Promise<PerceptionInput>`
- `openScreenshotSessionFolder() => Promise<string>`
- 协议：真实桌面截图落盘到 `LOG/screenshots/<启动时间>/`，并将图片作为 `source:screen` 的附加输入上传给模型。

### 5.12 `src/core/logger.ts`
- `logInfo(message)` / `logError(message, error?)`
- 协议：日志落盘 `LOG/app.log`。

### 5.13 `src/core/settings.ts`
- `DEFAULT_SETTINGS`：默认应用设置常量。

### 5.14 `src/core/prompts.ts`
- 负责读取 `prompts.csv` 并提供默认系统提示、首次问候、三路感知输入模板、记忆块与 API 测试提示。

### 5.15 `prompts.csv`
- 可编辑的基础 prompt 表；修改后会在后续请求中重新读取生效。

### 5.16 `src/shared/types.ts`
- 全局类型协议定义：`RoleCard`、`PerceptionInput`、`ModelRequest`、`ModelResponse` 等。

### 5.17 `src/preload.js`
- 职责：把 IPC 包装为 `window.tablecat`。
- 协议：渲染层不得直接访问 `ipcRenderer`。

### 5.18 `src/app/renderer.js`
- 职责：UI 交互与状态管理（气泡、设置、历史、聊天）。
- 依赖协议：
  - 必须存在 `window.tablecat` API
  - 必须接收 `ui:config`/`bubble:update`/`pet:icon`
  - 依赖 `index.html` 中固定 DOM id

### 5.19 `src/app/index.html`
- 职责：桌宠 UI 容器、设置面板、聊天面板、历史面板。
- 依赖协议：DOM id 不可随意改名（由 `renderer.js` 绑定）。

## 6. 协作注意事项
- 新增 IPC 必须同步修改：`main.ts` + `preload.js` + 本文档。
- 修改数据结构必须同步修改：`src/shared/types.ts` + 校验逻辑 + 本文档。
- 任何配置项新增都要落到：`AppConfig`、`AppConfigPatch`、设置 UI、`app.config.sample.json`。
