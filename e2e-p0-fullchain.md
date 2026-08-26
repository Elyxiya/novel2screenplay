# P0 全链路贯通验收（Task 3 · 阶段 D）

**北极星（P0）**：一条「小说 → 剧本 → 分镜」链路全程**无手工复制粘贴**，且**每步可回跳上游**（分镜 → 剧本场景 → 小说原文）。

系统分三个资产域：
- ① 剧本创作/导入（`/writer` 创作台、`/upload` 上传）
- ② 一键改编（LLM 剧本管线，任务 `jobId`）
- ③ 短剧分镜（`/shortdrama`，资产 `dramaId`）

---

## 0. 环境准备

- 启动 dev server（**必须 Node 24**，better-sqlite3 按 Node 24 编译）：
  ```powershell
  cd apps/screenplay
  $env:PATH = "E:\nvm\nodejs;" + $env:PATH
  & "E:\nvm\nodejs\node.exe" "E:\桌面\novel\novel2screenplay\node_modules\next\dist\bin\next" dev -p 3001
  ```
- 浏览器打开 `http://localhost:3001`（登录 / 注册一个账号）。
- `.env.local` 需含 `DEEPSEEK_API_KEY`，剧本管线走真实 LLM（约 1 分钟）。

---

## 1. 一键自动化验收（推荐）

整条链路已封装为无界面 Node 脚本，通过真实 API 全自动打通并断言溯源，**零手工复制粘贴**：

```powershell
cd e:\桌面\novel\novel2screenplay
$env:PATH = "E:\nvm\nodejs;" + $env:PATH
node e2e-p0-fullchain.mjs
```

- 输出末尾为 `ALL OK` 即验收通过；否则为 `E2E FAILED (N 项失败)`。
- 脚本断言覆盖：全新注册登录 → 创作台建小说+两章 → `convert` 物化 → 一键 `pipeline/start`（带 `novelId` 溯源）→ 轮询 completed → 一键 `drama/convert`（`source.sourceScreenplayId/sourceNovelId/sourceNovelTitle` 完整）→ `GET /api/drama/[id]` 取分镜，**每个镜头 `sceneNumber` 有效**，并推导 `/result/{jobId}?scene=N` 溯源回跳 URL。

---

## 2. 人工浏览器复现（逐步）

### ① 创作/导入小说（无复制粘贴）
1. 打开 **`/writer`**（创作台）→ 新建小说，填标题《××××》与作者。
2. 进入 **`/writer/<novelId>`** 编辑器，写至少 1~2 章正文（直接键入，非粘贴导入）。
3. 点 **「送去转剧本 →」**：前端调用 `POST /api/writer/novels/<novelId>/convert` 物化为资产，自动跳转 **`/configure?novel=<novelId>`**。
   - 若走上传导入：**`/upload`** → 选 `.txt` → 自动进入 `/configure`（sessionStorage 承载，见第 2 步配置）。

### ② configure：一键改编（选章节 → 开始转换）
4. 在 **`/configure?novel=<novelId>`** 检查章节已全量自动加载（标题/作者/章节列表无需重填）。
5. 勾选章节（默认全选）→ 选模型（`deepseek-chat`）→ 点 **「开始转换 N 章」**：调用 `POST /api/pipeline/start`（body 含 `novelText/title/author/modelId/novelId`，**novelId 溯源随任务落库**）。
6. 跳转 **`/convert`** 查看进度 → 完成后进入剧本页 **`/result/<jobId>`**。

### ③ 剧本 → 在结果页确认溯源
7. **`/result/<jobId>`** 展示剧本（场景/角色/地点/YAML 多标签）。场景卡含「原文对照」，可回看当前场景对应的小说原文段落（来自任务 `chapterTexts`，无需粘贴）。

### ④ 一键转分镜
8. 从剧本页进入 **`/shortdrama`** → 选对应剧本任务 → 点「生成分镜 / 转换」：调用 `POST /api/drama/convert`（body `{ jobId }`），系统读取剧本快照生成分镜资产并跳转 **`/shortdrama?id=<dramaId>`**。
   - 分镜详情页头部展示溯源：来源剧本任务、来源小说 asset。

### ⑤ 分镜溯源回跳（分镜 → 剧本场景 → 小说原文）
9. 分镜详情里每张 **Shot 卡** 都有一个「**溯源 · 剧本场景 #N**」链接，指向：

   ```
   /result/<sourceScreenplayId>?scene=<N>
   ```

   点击后在剧本页按 `?scene=N` 自动定位到对应场景；再切「原文对照」即回到该场景的小说原文。整条链路 **分镜 → 剧本 → 小说** 均可一键回跳，全程无复制粘贴。

---

## 3. 溯源一致性（自动化断言要点）

- `novelId → job → drama` 三者 ID 跨域不丢失：
  - job 历史/结果带 `novelId`、`sourceNovel`（来源小说标题）。
  - `POST /api/drama/convert` 返回 `source`：`sourceScreenplayId===jobId`、`sourceNovelId` 与上游一致、`sourceNovelTitle`。
- 每个分镜镜头 `shot.sceneNumber` 为有效的剧本场景号（≥1 整数），据此可推导 `/result/{sourceScreenplayId}?scene=N` 溯源 URL。

> 自动化验证仅需运行第 1 节的 `node e2e-p0-fullchain.mjs`，脚本输出的溯源闭环（小说资产 / 剧本任务 / 分镜资产 URL）即为当次验收证据。