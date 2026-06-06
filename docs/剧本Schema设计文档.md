# 剧本 YAML Schema 设计文档

## 概述

本文档定义了 AI 小说转剧本工具（novel2screenplay）的剧本输出格式。该格式使用 YAML 序列化，以 Zod Schema 作为类型系统保障，旨在提供一种**人类可读、机器可校验、可编辑**的结构化剧本表示。

### 核心设计目标

| 目标 | 说明 |
|------|------|
| **场景优先** | 剧本的基本单元是"场景"而非"章节" |
| **可编辑性** | 人类可直接修改 YAML 文件，字段有合理默认值 |
| **可追溯** | 每个剧本元素可追溯到原著位置，增加可信度 |
| **渐进增强** | 核心字段必填，高级字段可选，最小可用输出不含冗余信息 |

---

## Schema 完整结构

```yaml
formatVersion: novel2screenplay-v1

metadata:
  title: 琅琊榜之风起
  author: 海宴
  sourceNovel: 琅琊榜（节选）
  version: '1.0.0'
  createdAt: '2026-06-05T10:30:00Z'
  totalScenes: 14
  totalCharacters: 6
  totalLocations: 5

characters:
  - characterId: char_01
    name: 梅长苏
    aliases: [苏哲, 林殊]
    personalityTags: [足智多谋, 隐忍, 病弱]
    description: 江左盟宗主，化名苏哲
    sourceRef:
      chapterIndex: 1
      paragraphIndex: 2
      excerpt: '一个面色苍白的年轻人在榻上咳嗽'
    isMajor: true

locations:
  - locationId: loc_01
    name: 苏宅内厅
    type: interior
    description: 梅长苏在金陵的住所正厅

scenes:
  - sceneNumber: 1
    slugline: '内景. 苏宅内厅 - 夜'
    timeOfDay: night
    locationId: loc_01
    characterIds: [char_01, char_02]
    summary: 梅长苏与靖王密谈赤焰军旧案
    confidence: 0.92
    content:
      - type: action
        description: 烛火摇曳。梅长苏披着厚裘靠坐在榻上。
        sourceRefs:
          - chapterIndex: 1
            paragraphIndex: 5
            excerpt: '烛火摇曳中，梅长苏裹紧了身上的厚裘'
      - type: dialogue
        characterId: char_02
        line: 先生，我已经等了十年。还要等多久？
        direction: 停下脚步，语气焦灼
        sourceRefs:
          - chapterIndex: 1
            paragraphIndex: 6
            excerpt: '靖王停下脚步："先生，我已经等了十年。还要等多久？"'
```

---

## 字段详解

### 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `formatVersion` | `"novel2screenplay-v1"` | ✅ | 格式版本标识，用于未来兼容性 |
| `metadata` | object | ✅ | 剧本元信息 |
| `characters` | Character[] | ✅ | 角色列表 |
| `locations` | Location[] | ✅ | 地点列表 |
| `scenes` | Scene[] | ✅ | 场景列表 |
| `analytics` | object | ❌ | 改编分析数据（由流水线自动生成） |

### metadata

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 剧本标题 |
| `author` | string | ❌ | 剧本作者 |
| `sourceNovel` | string | ✅ | 原著名称 |
| `version` | string | ❌ | 剧本版本号，默认 `1.0.0` |
| `createdAt` | string (ISO 8601) | ✅ | 创建时间 |
| `totalScenes` | number | ✅ | 场景总数 |
| `totalCharacters` | number | ✅ | 角色总数 |
| `totalLocations` | number | ✅ | 地点总数 |

### Character

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `characterId` | string (`char_\d+`) | ✅ | 唯一标识，被 scenes 引用 |
| `name` | string | ✅ | 角色全名 |
| `aliases` | string[] | ❌ | 别名/昵称列表（如"黛玉"→"林黛玉"的映射） |
| `personalityTags` | string[] | ❌ | 人格标签（最多 10 个） |
| `description` | string | ❌ | 角色描述 |
| `sourceRef` | SourceRef | ❌ | 角色首次出现的原文位置 |
| `isMajor` | boolean | ❌ | 是否主要角色，默认 true |

### Location

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `locationId` | string (`loc_\d+`) | ✅ | 唯一标识，被 scenes 引用 |
| `name` | string | ✅ | 地点名称 |
| `type` | `"interior" | "exterior" | "abstract"` | ❌ | 场景类型，默认 interior |
| `description` | string | ❌ | 地点描述 |
| `sourceRef` | SourceRef | ❌ | 地点首次出现的原文位置 |

### Scene

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sceneNumber` | number (≥1) | ✅ | 场景编号，从 1 开始连续 |
| `slugline` | string | ✅ | 场景标题行，格式如 `内景. 苏宅内厅 - 夜` |
| `timeOfDay` | enum | ❌ | 时间段：`dawn/morning/afternoon/dusk/night/late-night/unknown` |
| `locationId` | string | ✅ | 引用 locations 的 ID |
| `characterIds` | string[] | ❌ | 本场出场的角色 ID 列表 |
| `content` | ContentBlock[] | ✅ | 内容块序列（至少 1 个） |
| `summary` | string | ❌ | 场景摘要，用于导航 |
| `sourceChapterRange` | [number, number] | ❌ | 原著章节范围 |
| `confidence` | number (0-1) | ❌ | LLM 转换置信度 |

### ContentBlock (discriminated union)

根据 `type` 字段分为两种：

#### ActionBlock (`type: "action"`)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"action"` | ✅ | 动作/描写块 |
| `description` | string | ✅ | 动作描写，使用现在时 |
| `sourceRefs` | SourceRef[] | ❌ | 原文引用列表 |

#### DialogueBlock (`type: "dialogue"`)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"dialogue"` | ✅ | 对白块 |
| `characterId` | string | ✅ | 说话角色 ID |
| `line` | string | ✅ | 对白内容 |
| `direction` | string | ❌ | 舞台指示/语气提示（如"轻声""站起"） |
| `sourceRefs` | SourceRef[] | ❌ | 原文引用列表 |

### SourceRef

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chapterIndex` | number (≥0) | ✅ | 章节索引（0-based） |
| `paragraphIndex` | number (≥0) | ✅ | 段落索引（0-based） |
| `excerpt` | string | ✅ | 原文摘录（用于用户对照） |
| `offsetStart` | number | ❌ | 在原文中的字符起始偏移 |
| `offsetEnd` | number | ❌ | 在原文中的字符结束偏移 |

---

## 设计原因

### 1. 为何选择 YAML 而非 JSON？

**原因**：YAML 的可读性显著优于 JSON。剧本本身是一种人类创作的文学形式，输出格式应优先考虑人类编辑体验。YAML 支持：
- **注释**（虽然本 Schema 未使用，但用户编辑时可自行添加）
- **多行字符串**（块标量 `|` 符号，适合长段动作描写）
- **更少的括号和引号**（在视觉上更接近剧本排版）
- **Git diff 友好**（修改一行不会导致整段重新缩进）

### 2. 为何使用 discriminatedUnion 分离 action 和 dialogue？

**原因**：动作描写和对白是剧本中两种本质不同的内容类型，具有不同的字段结构：
- Action：`description`（叙事文本）
- Dialogue：`characterId` + `line` + `direction`（角色+对白+指示）

使用 discriminated union（按 `type` 字段区分）带来：
- **类型安全**：TypeScript 编译器能根据 `type` 推导出具体字段
- **编辑器友好**：前端可根据 `type` 渲染不同样式（动作用斜体，对白用特定格式）
- **校验精确**：Zod 能针对每种类型做独立的字段校验

### 3. 为何引入 sourceRefs？

**原因**：AI 生成内容的"可信度"是用户最大的顾虑。`sourceRefs` 让每个剧本元素都可追溯到原著位置，实现：
- **溯源验证**：用户可以对照原文判断 AI 的改编是否忠实
- **降低幻觉风险**：无原文支撑的剧本元素会被标记（空的 `sourceRefs` 数组），提醒用户审阅
- **法律合规**：保留创作链条的完整记录

### 4. 为何角色和地点独立于场景外？

**原因**：如果将角色和地点嵌套在场景内，会导致大量重复定义（同一角色出现在多个场景）。独立定义带来：
- **全局一致性**：修改角色名只需改一处
- **减少体积**：避免序列化冗余
- **便于合并**：Phase 4 的角色去重只需在 `characters[]` 数组上操作

### 5. 为何使用 ID 引用而非嵌套？

**原因**：ID 引用（`locationId: "loc_01"` → `locations[0]`）比直接嵌套更加：
- **数据范式化**：符合数据库范式，避免数据冗余
- **自包含**：场景不携带角色/地点的完整信息，保持场景 YAML 的精简
- **便于交叉引用校验**：Zod 可以检查每个 scene 引用的 ID 是否存在于 `characters[]` 或 `locations[]` 中

### 6. confidence 字段的用途？

**原因**：LLM 转换并非 100% 可靠，`confidence` 字段让系统可以：
- **标记风险场景**：低置信度（<0.5）的场景高亮显示，提醒用户重点审核
- **渐进展示**：高置信度场景可以直接用于初稿，低置信度需要人工修改
- **质量度量**：`analytics.avgConfidence` 反映整体转换质量

### 7. sourceRefs 的精度限制

**已知限制**：`paragraphIndex` 依赖前端的段落分割算法，长段落内字符级别的偏移可能不精确。V1 版本仅提供 `excerpt` 字符串供用户搜索定位；V2 计划在原文中插入锚点标记 `[ref_001]` 以提升精度。

---

## 示例：两场景完整剧本

```yaml
formatVersion: novel2screenplay-v1

metadata:
  title: 青云传
  author: 佚名
  sourceNovel: 青云传（第一章至第三章）
  version: '1.0.0'
  createdAt: '2026-06-05T10:30:00Z'
  totalScenes: 2
  totalCharacters: 3
  totalLocations: 2

characters:
  - characterId: char_01
    name: 林墨
    aliases: [小林]
    personalityTags: [冷静, 聪明]
    isMajor: true
  - characterId: char_02
    name: 苏晚
    aliases: [晚儿]
    personalityTags: [温柔, 坚韧]
    isMajor: true
  - characterId: char_03
    name: 老者
    aliases: []
    personalityTags: [神秘]
    isMajor: false

locations:
  - locationId: loc_01
    name: 青云山顶
    type: exterior
    description: 云雾缭绕，罡风凛冽
  - locationId: loc_02
    name: 山腰草庐
    type: interior
    description: 简陋竹屋，一桌一榻

scenes:
  - sceneNumber: 1
    slugline: '外景. 青云山顶 - 日'
    timeOfDay: morning
    locationId: loc_01
    characterIds: [char_01, char_02]
    summary: 林墨与苏晚在山顶重逢
    content:
      - type: action
        description: 云雾散开，露出林墨清瘦的身影。他负手而立，望着山路上缓缓走来的苏晚。
      - type: dialogue
        characterId: char_02
        line: 你果然在这里。
        direction: 微笑
      - type: dialogue
        characterId: char_01
        line: 我知道你会来。
        direction: 未回头

  - sceneNumber: 2
    slugline: '内景. 山腰草庐 - 夜'
    timeOfDay: night
    locationId: loc_02
    characterIds: [char_01, char_03]
    summary: 老者深夜来访，告知林墨即将到来的劫数
    content:
      - type: action
        description: 油灯昏黄。林墨正对着一卷古卷出神，门外传来竹杖敲击声。
      - type: dialogue
        characterId: char_03
        line: 你可知，三日之后便是你的劫数？
        direction: 苍老的声音在门外响起
```

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-06-05 | 初始版本，定义 Schema 完整结构 |

---

## 附录：Zod Schema 定义

详见 `src/lib/schema/screenplay.schema.ts`，使用 TypeScript + Zod 实现，所有类型可从 Schema 自动推导。
