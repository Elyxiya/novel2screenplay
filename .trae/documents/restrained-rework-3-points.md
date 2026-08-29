# 克制改造 · 三点计划（conversion-quality 收口 + token 级流式 + Agent 工作台可嵌入）

> 阶段：Plan（待用户确认后执行）｜日期：2026-08-29｜版本 v0.2（并入评审意见）
> 目标：为 Coding Agent 类 JD 打造"最省力且诚实"的三个能力覆盖点，不因 JD 改变 conversion-quality 工程方向。
> 已确认决策：
> - ① 点 2 流式 = **预览流 + 原子提交**（评审补充：error UX + AbortController + 重试语义 + NDJSON 帧格式）
> - ② 点 3 = **web component + postMessage 桥 + 跨域 iframe 两宿主，Tauri 壳后置**（评审拍板：React 进 shadow DOM、iframe 真跨域 3002/3003）
> - ③ 点 1 = **策略 + 话术 + 决策记录写实**，并**纳入 1b 最小标注（2–3h）解锁数据链**（评审 pushback 采纳）
> - ④ **5.4 旧路径 flag 清理显式压后到 T2-C5 出数之后**，写入交付边界。
> - ⑤ 执行顺序 1 → 2 → 3；四个开工前动作已在本计划内全部内置解决。

---

## 0. 结论摘要（风险评估 / JD 契合度 / 项目价值）

**风险**
| 点 | 风险 | 依据 |
|---|---|---|
| 点 1 收口 + 1b 标注 | **低** | 代码侧零改动；1b 为纯人力标注 + 跑既有 eval 脚本。风险仅在"翻默认的叙事断链"——已用"决策记录写实 + 让 default 翻转有 T2.5 曲线数可依"堵上。 |
| 点 2 流式 | **低–中** | LLM 层 `chatStream` 已实现（DeepSeek/OpenAI/Custom）；`BaseProvider.streamFetch` **单次 fetch 无重试**（[BaseProvider.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\llm\BaseProvider.ts) L115-176）→ 流式路径天然无重复 delta。选定"预览流+原子提交"，不碰部分 JSON 解析。 |
| 点 3 嵌入 | **中–高** | 全库无 tauri/webcomponent/postMessage/iframe，全新架构。用"被动面板 + 桥 + iframe 跨域替身 + Tauri 后置"降风险。虚拟化如实按**真实新增**标注。 |

**JD 契合度（诚实版）**
| JD 条 | 覆盖 | 说明 |
|---|---|---|
| 1 全栈 | ✓ | 前端 + 后端 + AI 已具备 |
| 2 Coding Agent 域 | ◐ | 域不同（小说→剧本），编排形态同构（长篇小说=大 repo）。**真实代码工具链是空档**，不假装。 |
| 3 上下文管理+流式+效果评估 | ✓（1b 后更实） | 点 1（map-reduce/设定卡=代码索引/身份断言=测试断言/稳定性报告）+ 点 2（流式）。**1b 产出 T2.4 迷你版 + T2.5 双书分层曲线 → "效果评估"从"机制已落地"升级为"曲线已产出"**，是本叙事唯一硬证据位。 |
| 4 代码工具(Git/终端/文件/P4) | ✗ | 如实标注空档。 |
| 5 跨端 WebView 体验与性能 | ✓ | 点 3（桥协议、origin 安全、性能预算、虚拟化真实新增）。 |
| 6 通用组件/Agent 工程能力沉淀 | ✓ | 点 3 可嵌入包 + 既有 eval 基建。 |

**项目价值**：点 2 修产品真实痛点（生成从转圈→打字机）；点 3 把 Agent 工作台从"绑定 Next 单页"沉淀为可复用可嵌入能力；1b 让翻默认决策有数可依。

---

## 1. Point 1 · conversion-quality 收口 + 1b 最小标注

### 1.1 文档（仅新增 Markdown，不动 spec / 代码）
- `docs/conversion-quality/jd-analogy.md`（新）：同构类比表（长篇小说→大 repo、设定卡→代码索引、身份断言→测试断言、map-reduce→分模块摘要、四阶段 pipeline→任务执行链路、ReviewGate→代码评审门禁、局部重生成→单文件/单函数重写）+ 一句话口径"域不同、工程问题相同"。
- `docs/conversion-quality/jd-coverage.md`（新）：JD 1–6 逐条映射到已落地特性（带 commit/tag，如 `eval-task5-budget-guard`）；诚实标注 JD#4 与 JD#2 代码域空档。
- `docs/项目框架.md` 增加指向。

### 1.2 Task 5.3 决策记录写实（评审①）
- 新增 `docs/conversion-quality/flip-decision-record.md`（新），如实写"当前翻默认的**实际依据 = Task1-C6 代理/floor 判过**，分层曲线（T2.5）尚未产出，待 1b 补齐"。**不写"曲线判定通过"或任何暗示**。1b 完成后再补一节写曲线实测结论。

### 1.3 5.4 旧路径清理压后（评审① → 交付边界）
- conversion-quality spec 中 5.4"旧路径 flag 清理"**显式标注为"待 T2-C5 出数之后"**（旧路径是分层对比唯一 baseline 来源，删了 T2.5 永远跑不了）。此条同步写进"交付边界"。

### 1.4（1b）最小标注解锁数据链 · 纯人力 2–3h（评审④，本轮纳入）
- **素材**：`e:\文档\Downloads\《最后一个修真者》作者：纸上飞雪.txt`（已确认存在）。
- **切样**：用既有 `scripts/eval/prepare-sample.mjs` 生成骨架；因要跨 30k token 边界，按**章节区间切片**造两个样本：
  - `samples/xiuzhen-short`（type:short，目标 ≤30k token，取首部 ~15–20 章）；
  - `samples/xiuzhen-medium`（type:medium，目标跨 30k 边界，取中部 ~25–60 章）。
  - 若 `prepare-sample.mjs` 不支持章区间，给其加 `--range <start>:<end>` 参数（小改，见 1.5 验证）。
- **人工标注**（对照 `chapters.txt` 底稿，填 `deadCharacters` / `reveals` / `aliasIndex`，章号从 1 起）——纯人力，与点 3 编码并行。
- **数据链**：对两样本跑转换管线（产出 ScreenplayScene[]，写入 `scenesRef`）→ `identity.mjs` 规则 + `stability.mjs` 迷你 Δ_tail → 两书分层曲线（T2.5）；把曲线结论回填 1.2 决策记录。
- **取舍**：全量 6–10 本标注继续后置；本轮只做最有性价比的 1 短 + 1 中，让"效果评估"有硬数据位。

---

## 2. Point 2 · token 级流式（writer AI + revise 预览流进编辑器）

**现状核实**：`LLMProvider/LLMAdapter.chatStream` 已实现；`BaseProvider.streamFetch` 单次 fetch、**无重试**（确认 [BaseProvider.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\llm\BaseProvider.ts) L115-176）；`ModelRouter` 仅暴露 `chat`（[router.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\llm\adapter\router.ts) L99）；writer AI 用 `router.chat` 非流式（[route.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\app\api\writer\novels\[id]\ai\route.ts) L123）；`reviseScene` 用 `provider.chat` 非流式（[revise-scene.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\result\revise-scene.ts) L119）。消费端走 `fetch` reader（POST），EventSource 不可用 → **帧格式用 NDJSON**（每行 `{"delta":"..."}`），免去 SSE `event:/data:` 拼装。

### 2.1 `ModelRouter.chatStream` 转发 —— [router.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\llm\adapter\router.ts)
- 新增 `async *chatStream(messages, options?, modelId?)`：复用 `chat` 的 adapter 选择（`getAdapterForModel`），`yield* adapter.chatStream(messages, options, model)`；无 adapter 抛同款错误。最薄补丁。

### 2.2 Writer AI 流式路由 —— [..\ai\route.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\app\api\writer\novels\[id]\ai\route.ts)
- `POST .../ai?stream=1`：返回 `text/event-stream`，逐 delta 写 **NDJSON 行** `{"delta":"<text>"}`；收尾写 `{"done":true,"full":cleanModelOutput(全量),"model"}`；异常写 `{"error":"..."}`。用 inline `ReadableStream`+`TextEncoder`（单订阅者，不进 sse-client-manager）。`cleanModelOutput` **只在 done 时对全量执行**；chunk 阶段只透传 delta。
- 无 `?stream=1` 保持原 JSON 路径，向后兼容。

### 2.3 Writer 前端流式 —— [writer/[id]/page.tsx](e:\桌面\novel\novel2screenplay\apps\screenplay\src\app\writer\[id]\page.tsx)
- `runAi` 改走 `.../ai?stream=1`，`fetch` body `reader` 逐行累积到新 state `aiStreamBuf` 实时渲染（打字机）；`done` 归一化后置 `aiResult`。`applyAi` 不变。
- **AbortController**：`runAi` 每次新建 controller，卸载/重点时 abort；新增 in-flight 防重入（`isAiBusy`），防双流写同一 buffer。
- **error UX（评审）**：流中或 done 前失败 → **保留预览 aiStreamBuf + 保留输入框内容** + 错误提示可重试；绝不因提交失败清空已生成文本（"原子提交≠原子丢失"）。

### 2.4 revise 流式 lib —— [revise-scene.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\result\revise-scene.ts)
- 新增 `reviseSceneStream(sourceText, currentScene, instruction, options?): AsyncGenerator<{delta:string}|{full:Scene}>`：底层 `provider.chatStream` 产出文本 delta；末尾 parse + `normalizeScene` 产出 `{full}`；解析失败 `throw`。
- 重构 `reviseScene` 消费 `reviseSceneStream` 至 `full`，避免双实现；既有 `revise-scene.test.ts` 保持通过。

### 2.5 revise 流式路由 + 前端
- 路由 [..\result\revise\route.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\app\api\result\revise\route.ts) 支持 `?stream=1`：逐 delta NDJSON；完成后沿用现有 parse+`normalizeScene`+validator+落库 → `{"done":true,"message","scene"}`；失败 `{"error"}`。
- 前端 [result/[id]/page.tsx](e:\桌面\novel\novel2screenplay\apps\screenplay\src\app\result\[id]\page.tsx) `submitSceneRevise`（单场景）走 `?stream=1`：生成期显示**流式预览框**（原始 JSON delta）；`done` 后**原子提交**＝清输入 + ok 消息 + `fetchScreenplay()`。**失败保留预览 + 保留输入 + 可重试**。同 Abort/in-flight 守卫。`scope:'all'` 本轮一次性（收窄）。

### 2.6 重试语义（评审，显式一句）
- **流式路径禁用重试**——`BaseProvider.streamFetch` 本就单次 fetch 不重试，客户端不再叠加重试（避免重复 delta）；仅在"尚未发出任何字节前"的连接失败按网络错误提示重试。

### 2.7 单测 + 回归
- 新增：`router.chatStream` 转发（mock adapter）；`reviseSceneStream` 消费到 full 用例（扩 `revise-scene.test.ts`）。
- 回归：lint 0 / typecheck / 全量 test 全绿；手动验证 writer continue 打字机 + 单场景 revise 预览流原子提交 + 取消/错误 UX。

---

## 3. Point 3 · Agent 工作台可嵌入包（web component + 桥 + 跨域 iframe，Tauri 后置）

**现状核实**：`AgentChatPanel` 深度耦合 Next（`useRouter` 跳 `/convert`、相对 `fetch('/api/...')`、EventSource、cookie 认证）；全库无 tauri/webcomponent/postMessage/iframe；**长列表虚拟化不存在**（无 react-window/react-virtual，日志/场景列表全量 map）→ 包内**真实新增**，量化进简历时标注"真实新增"。

### 3.1 新包 `packages/agent-workbench/`
- esbuild 出单文件 IIFE，注册自定义元素 `agent-workbench`，不依赖 Next。
- **React 进 shadow DOM（评审拍板，方案 (a)）**：用 `react-dom/client` 把 `AgentChatPanel` 端口组件挂进 shadowRoot；代价是 IIFE 背 React 运行时（~140KB+），demo 阶段 artifact 大小非卖点，**"桥协议 + 安全 + 性能预算"才是**，顺手获 shadow DOM 宿主 CSS 隔离。端口 `agent-chat/chat-state` 的 reducer；`useRouter` 跳转改可选回调 `onNavigate`。
- 内置**任务日志虚拟化**（小骨架 virtual list，DOM 节点有界）——真实新增点。
- 通信只走桥：命令 `{type:'workbench:start|review|revise',payload}`；宿主事件 `{type:'workbench:event',event}`。

### 3.2 桥协议 —— `packages/agent-workbench/src/bridge/protocol.ts`
- 消息 schema + `MessageEvent.origin` **白名单双向校验**（build 期配置 origin=宿主列表）。
- **真实业务调用留在宿主**：`/api/agent/*` 的 fetch/SSE 由宿主执行（cookie/token 在宿主），面板被动展示 + 上报意图，鉴权不入面板。

### 3.3 两宿主 demo（评审拍板：iframe **真跨域**）
- `apps/embed-hosts/web/`（**端口 3002**）：静态 HTML，宿主注册桥并代理 `/api/agent/*`（same-origin）。
- `apps/embed-hosts/iframe/`：把 workbench 文档放 **`apps/embed-hosts/panel/`（端口 3003，端口不同即不同 origin）**，宿主页嵌 `<iframe src="http://localhost:3003/...">`。**拓扑写死：宿主 3002 ↔ 面板 3003 两个不同 origin**，postMessage origin 校验才能证明成立；配合 3.5 的伪造 origin 拒绝测试。演示跨域桥 + origin 安全 + 性能预算（SSE 节流 N fps + 虚拟化 DOM 计数）。

### 3.4 文档 + Tauri 后置
- `docs/agent-embed/bridge-protocol.md`（新）：协议、安全、性能预算口径。
- `docs/agent-embed/tauri-shell-followup.md`（新）：Tauri(Rust+WebView2) 壳为后续步骤 + 前置（本机 Rust 链）。
- `docs/项目框架.md` 增补包地址。

### 3.5 单测 + 回归
- `protocol.test.ts`：schema 校验、origin 白名单、**伪造 origin 拒绝**、事件封装往返。
- lint/typecheck/test 全绿；两宿主手动验证 approve/revise 全流程 + 跨域桥 + 虚拟化有界。

---

## 4. 交付边界（克制 · 评审更新）
- 不新增代码索引/检索（JD#4 空档，不在本轮）。
- **不启动全量 Task 2.2 标注；本轮仅点 1b 的 1 短 + 1 中最小标注**（其余继续后置）。
- **不删旧路径 flag（5.4）——显式压后到 T2-C5 出数之后**（分层对比唯一 baseline 来源）。
- 不做 Tauri 真实壳（本轮 iframe 替身 3002/3003）。
- 不做 `scope:'all'` 流式（本轮单场景）。
- IDEA 评审补充的诚实项：对角线已并入上表；虚拟化标注为**"真实新增"**，SSE 断线重连既有能力如实引用（非新增则不虚报）。

## 5. 假设与决策（复核清单）
1. LLM 层 `chatStream` 已存在，仅需 `ModelRouter` 转发——已核实接口与多 provider。
2. 非流式 JSON 为默认（`?stream=1` 显式开启），向后兼容。
3. `revise scope:'all'` 本轮一次性。
4. Web component = 被动面板；鉴权/真实调用在宿主；桥 = postMessage + origin 白名单。
5. Tauri 后置；iframe 跨域（3002↔3003）作 WebView 替身先跑通架构。
6. 长列表虚拟化为真实新增。
7. 尽量不加运行时依赖；embed 包 esbuild 单文件。**React 运行时例外（评审决定 (a) 方案）。**
8. 流式路径禁用重试（源自 streamFetch 单次 fetch 事实）。
9. 1b 采用章区间切片造样本；若 `prepare-sample.mjs` 缺 `--range`，做最小增强。

## 6. 验收 / 验证
- 每点落地单跑 `npm run lint` + `npm run typecheck` + `npm test` 全绿；全部完成后全量回归一次。
- 点 1：两份文档 + flip 决策记录落 `docs/conversion-quality/`；conversion-quality spec 仅"5.4 标注压后"，无其他改动。
- 点 1b：`samples/xiuzhen-short|medium` 生成 + 标注完成；两样本跑通 identity 规则 + 迷你 Δ_tail + 双书分层曲线；结论回填 flip 决策记录。
- 点 2：writer continue 打字机 + 可 apply；单场景 revise 预览流 + 原子提交 + 失败保留/重试 + 取消 in-flight 守卫。
- 点 3：web 宿主挂载 approve/revise 经桥全流程；iframe 面板跨域连通、伪造 origin 被拒、虚拟化 DOM 有界。

## 7. 执行顺序
**1 → 2 → 3**；点 1（1.2 决策记录写实 + 5.4 压后标注）零代码先行，1b 标注为纯人力块与点 3 编码并行；点 2 可直接开工（设计已拍板）。

---

## 8. Spec 细化 · 点 2 流式（含验收标准）

> 帧格式统一 **NDJSON**（每行一个 JSON，`\n` 结尾）。Content-Type：`text/event-stream`（保留，便于 fetch reader 按行读），必要时加 `Cache-Control: no-cache`。消费端全是 `fetch`+`reader`（POST），不用 EventSource。

### 8.1 `ModelRouter.chatStream`（[router.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\llm\adapter\router.ts)）
```ts
async *chatStream(
  messages: LLMMessage[],
  options?: LLMChatOptions,
  modelId?: string,
): AsyncGenerator<LLMStreamChunk> {
  const model = modelId || this.getDefaultModel();
  const adapter = this.getAdapterForModel(model);
  if (!adapter) throw new Error(`No adapter found for model: ${model}`);
  this.stats.totalRequests++;
  yield* adapter.chatStream(messages, options, model);
}
```
- 复用 `chat` 的选择逻辑；不吞错（错误向上抛，由路由层转 `{"error"}`）。
- **验收**：`router.test.ts`（或现有 test）新增用例——mock 一个最小 `LLMAdapter`（含 `chatStream`），断言 `chatStream` 逐 chunk 转发、无 adapter 时抛 `No adapter found`；default 命中 `getDefaultModel`。

### 8.2 Writer AI 路由 `?stream=1`（[..\ai\route.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\app\api\writer\novels\[id]\ai\route.ts)）
- 前置校验（鉴权/action/content/modelId）与现有完全一致；仅消费端换流。
- 流式分支：
  - 用 `router.chatStream(messages, {temperature:0.8}, modelId)`。
  - 累积 `full` 原文；每拿到非空文本 delta 写一行 `{"delta":"<text>"}`（JSON.stringify 转义）。
  - 收尾（`done` 无文本 或 流结束）写 `{"done":true,"full":cleanModelOutput(full),"model":"<model>"}`。
  - `try/catch`：异常写 `{"error":"<msg>"}`（模型未配置/401 复用现有 503 语义的 message 文案），然后 `controller.close()`。
- 用 `new ReadableStream({ start(controller){...} })` + `TextEncoder`；`enqueue` 以 `\n` 结尾的字符串。single-subscriber，不进 sse-client-manager。
- 非 `?stream=1`：走现有 `router.chat` 原逻辑，零改动。
- **验收**：手动 `curl -N -X POST '…/ai?stream=1' -d '{"action":"continue",…}'` 见逐行 `delta`，末尾 `done` 带 `full`/`model`；模拟异常（错 key）得 `{"error"}`；`next dev` 下结流向 OK。默认（无 stream）返回原 JSON。

### 8.3 Writer 前端（[writer/[id]/page.tsx](e:\桌面\novel\novel2screenplay\apps\screenplay\src\app\writer\[id]\page.tsx)）
- `runAi` 改造：
  - 新 AbortController，存 ref；进入时 `isAiBusy` guard，若 busy 直接 return（防重入）。
  - `fetch('…/ai?stream=1', {...body, signal})` → `res.body.getReader()`，`TextDecoder` 按行切，行内 `JSON.parse`：`delta` → 累`aiStreamBuf`；`done` → `setAiResult({result: full, model})` 并清 `aiStreamBuf`；`error` → 走错误分支。
  - 卸载/重新点击：`controller.abort()`；`finally` 里 `isAiBusy=false`。
  - **error 分支（保留）**：`aiStreamBuf` 已有内容 → **保留预览不清**；输入框原样保留；顶部错误条"重试"。不因失败清空已生成文本。
  - `applyAi`（continue 追加/其余替换）行为不变，输入源改 `aiResult`。
- **验收**：continue 打字机实时刷；done 后可 apply；流中点再次按钮不重复开启（guard）；点"停止/切页"中止并保留已生成预览；模拟 503 见错误保留+可重试。

### 8.4 `reviseSceneStream` + 重构 `reviseScene`（[revise-scene.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\result\revise-scene.ts)）
```ts
export type ReviseSceneStreamOut =
  | { delta: string }
  | { full: Scene };
export async function *reviseSceneStream(
  sourceText: string, currentScene: Scene, instruction: string,
  options: ReviseSceneOptions = {},
): AsyncGenerator<ReviseSceneStreamOut> {
  const provider = options.provider ?? resolveDefaultProvider(options.userId);
  if (!provider) throw new Error('未配置 LLM Provider，无法重生成场景');
  const messages = [{ role:'system', content: SYSTEM_PROMPT }, { role:'user', content: buildReviseScenePrompt(sourceText,currentScene,instruction) }];
  let full = '';
  for await (const ch of provider.chatStream(messages, { temperature: options.temperature ?? 0.7 })) {
    if (ch.type === 'text') { full += ch.content; yield { delta: ch.content }; }
  }
  const parsed = safeJsonParse(full);
  if (parsed == null || (typeof parsed === 'object' && !Array.isArray(parsed) && parsed._parseError === true)) {
    throw new Error('场景重生成结果解析失败');  // 调用方保留预览 + full 原文，不丢
  }
  yield { full: normalizeScene(currentScene, parsed, options.nameToCharacterId) };
}
```
- `reviseScene` 改为 `for await (const out of reviseSceneStream(...)) if ('full' in out) return out.full;`。
- **验收**：`revise-scene.test.ts` 全保持通过；新增用例——mock provider 的 `chatStream` 产出多段 delta + `done`，断言 `reviseSceneStream` 依次 yield `{delta}` 再 `{full}`、`reviseScene` 返回等于 `{full}.full`；mock 输出坏 JSON → `reviseSceneStream` throw 且**已产出的 delta 可见**（不因失败丢预览）。

### 8.5 revise 路由 `?stream=1`（[..\result\revise\route.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\app\api\result\revise\route.ts)）
- 复用现有 POST 的入参/鉴权/场景定位；`scope:'all'` 保持原一次JSON路径。
- 单场景 + `?stream=1`：逐 delta 写 `{"delta"}`；`reviseSceneStream` 出的 `{full}` 后走**现有持久化**（校验 + 落库 + 返回 message/scene）→ `{"done":true,"message","scene"}`；`error` 帧在 parse/校验失败时发。
- **验收**：单场景 revise 见打字机预览；done 后 JSON `{"done":true,"scene":…}` 与既有 `fetchScreenplay` 一致；坏场景（model 输出非 JSON）得 `{"error"}` 且**预览保留**。

### 8.6 重试语义（固化）
- `BaseProvider.streamFetch`（[BaseProvider.ts](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\llm\BaseProvider.ts) L115-176）**单次 fetch、无重试** → 流式路径全局禁用重试，客户端也**不再叠加重试**；仅连接期失败（`response` 都未返回）按"网络错误→可重试"提示。
- **验收**：code review 确认流式分支无任何 retry 循环；不在计划外新增流式重试。

### 8.7 点 2 全量验收
1. `npm run lint` 0 error；`npm run typecheck` 通过；`npm test` 全绿（含 8.1/8.4 新增）。
2. 手动：writer continue 打字机真实逐字；可 apply；取消中止 + 错误保留预览/输入 + 可重试。
3. 手动：result 单场景 revise 预览流 → 原子提交（清输入+ok+`fetchScreenplay` 生效）；`scope:'all'` 行为与改造前一致。
4. 默认（无 `?stream=1`）两条 JSON 路径行为不变。

---

## 9. Spec 细化 · 点 1 收口 + 1b（含验收标准）

### 9.1 文档
- `docs/conversion-quality/jd-analogy.md`：§同构类比表（长篇小说→大 repo / 设定卡→代码索引 / 身份断言→测试断言 / map-reduce→分模块摘要 / 四阶段 pipeline→任务执行链路 / ReviewGate→代码评审门禁 / 局部重生成→单文件重写）+ §一句话口径。附既有 commit/tag 引用。
- `docs/conversion-quality/jd-coverage.md`：JD1–6 逐条映射 + **诚实空档标注**（JD#4 代码工具、JD#2 真实代码域）；"效果评估"写"机制已落地、对比曲线见 9.3"。
- `docs/项目框架.md`：加 pointer。

### 9.2 决策记录写实
- `docs/conversion-quality/flip-decision-record.md`：
  - 现状：翻默认的**实际依据**＝Task1-C6 的代理/floor 判过（写明具体规则名/取值）。
  - 明确：T2.5 分层曲线**尚未产出**，Δ_tail 规则预注册但**无实测数据佐证**。
  - 待办：依赖 9.3 的迷你稳定性 + 分层曲线；出数后在本文补"实测结论"一节并更新结论。
  - **禁忌**：不得写"曲线判定通过/已验证"字眼。
- **验收**：文件存在；通读不含任何"曲线已通过"暗示；正文写明凭代理/floor 与待 9.3 补齐。

### 9.3 1b 最小标注（纯人力 2–3h，与点 3 并行）
1. **工具增强**：`scripts/eval/prepare-sample.mjs` 若缺章区间，加 `--range <start>:<end>`（章号 1 起、闭区间），按此切片产出骨架 + `chapters.txt` 摘要。
2. **切样**（输入 `e:\文档\Downloads\《最后一个修真者》作者：纸上飞雪.txt`）：
   - `samples/xiuzhen-short`：type short，取首部 ~15–20 章，目标 `inputTokensHint ≤ 30k`。
   - `samples/xiuzhen-medium`：type medium，取中部 ~25–60 章，目标**跨 30k 边界**。
3. **人工标注**：对照 `chapters.txt` 填 `deadCharacters`（deathChapter）、`reveals`（revealChapter）、`aliasIndex`；章号从 1 起。
   - **诚实纪律**：只填在篇真实事件。已核 `《最后一个修真者》` 切片区间内无干净死亡/揭隐——`xiuzhen-medium` 仅有 王老三(章8)/夏建仁(章36) 两起真实在篇死亡，`xiuzhen-short` 区间内**零**在篇事件；两样 death/reveal 按此如实填充（可为空），并在 annotation.json 加 `_note` 记录依据。**核心测量=语义 judge 的 Δ_tail**，不依赖 death/reveal。
4. **数据链**：两样本跑转换管线产出 `ScreenplayScene[]`（写 `scenesRef`）→ `identity.mjs` 规则（在有真实事件处跑真；death/reveal 为空的样本该规则格如实 P/跳过）→ `stability.mjs` 迷你 Δ_tail → T2.5 双书分层曲线。
5. **回填**：曲线结论写回 9.2 决策记录。
- **验收**：
  - `xiuzhen-short|medium/annotation.json` 存在，`deadCharacters/reveals` **如实填充（可为空，不允许为了凑非空而造假）**，章号合理；空处有 `_note` 说明依据。
  - 两样本各跑通 `identity.mjs`（规则格在存在事件处输出 P/F）+ 稳定性迷你版（Δ_tail 数值/区间）无脚本报错。
  - T2.5 双书分层曲线有输出文件（表格/JSON）；结论回填决策记录后，9.2 出现"实测结论"一节。
  - `npm test`/lint 不受影响（eval 脚本不入 app 单测，如加 `prepare-sample --range` 则补对应飞测或保持纯 CLI-verify）。

### 9.4 5.4 压后标注 + 交付边界
- conversion-quality spec 中 5.4 处加注"旧路径 flag 清理待 T2-C5 出数之后"；§4 交付边界已含同条。
- **验收**：spec diff 仅此一处行为性加注，其余不动；文本可见"晚于 T2-C5"。