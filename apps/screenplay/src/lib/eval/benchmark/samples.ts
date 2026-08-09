/**
 * 质量基准集（P-评估）
 *
 * 内置已知质量档次的剧本样本（golden samples），用于：
 * - 验证 LLM 评估器区分度：高分样本应显著高于低分样本
 * - 回归：修改评估 Prompt/逻辑后确认评分档位不漂移
 * - 手动调参：调整评估器后一键重跑
 *
 * 样本均通过 ScreenplaySchema.parse 校验（保证结构合法）。
 * expectedGrade 与 flow-evaluator 的档位一致：≥85 excellent / ≥70 good / ≥55 fair / 否则 poor。
 */

import { ScreenplaySchema, type Screenplay } from '@novel/contracts/screenplay';

export type ExpectedGrade = 'excellent' | 'good' | 'fair' | 'poor';

export interface BenchmarkSample {
  id: string;
  name: string;
  description: string;
  /** 预期质量档位（用于校验评估器排序） */
  expectedGrade: ExpectedGrade;
  screenplay: Screenplay;
}

type ContentItem = Screenplay['scenes'][number]['content'][number];

const act = (description: string): ContentItem => ({ type: 'action', description, sourceRefs: [] });
const dlg = (characterId: string, line: string): ContentItem => ({
  type: 'dialogue',
  characterId,
  line,
  sourceRefs: [],
});

function scene(n: number, slugline: string, locationId: string, content: ContentItem[]) {
  return { sceneNumber: n, slugline, timeOfDay: 'night' as const, locationId, characterIds: [], content, summary: 'summary', confidence: 0.9 };
}

// ── 样本 1：优秀（完整结构 + 对白平衡 + 引用有效） ──────────────────────
const excellent = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-优秀样本',
    author: 'benchmark',
    sourceNovel: '基准-优秀样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 3,
    totalCharacters: 3,
    totalLocations: 2,
  },
  characters: [
    { characterId: 'char_1', name: '林远', isMajor: true, personalityTags: ['坚毅'], description: '少年剑客' },
    { characterId: 'char_2', name: '苏晚', isMajor: true, personalityTags: ['聪慧'], description: '医者' },
    { characterId: 'char_3', name: '追兵首领', isMajor: false, personalityTags: [], description: '蒙面' },
  ],
  locations: [
    { locationId: 'loc_1', name: '山门', type: 'exterior', description: '雾气缭绕的石阶' },
    { locationId: 'loc_2', name: '药庐', type: 'interior', description: '草药香气弥漫' },
  ],
  scenes: [
    scene(1, 'INT. 药庐 - NIGHT', 'loc_2', [
      act('苏晚拨亮油灯，用银针挑开林远的衣袖，伤口乌黑。'),
      dlg('char_2', '七步寒……这毒只有师父会配。'),
      dlg('char_1', '下山前夜，师父告诉我别信任何人。'),
      act('她手上的动作一顿，没接话。'),
    ]),
    scene(2, 'EXT. 山门 - NIGHT', 'loc_1', [
      act('火把将山门照得通明，为首者策马上前。'),
      dlg('char_3', '苏晚，你藏了三个月，该跟我们回去了。'),
      dlg('char_1', '想带人，先问过我手里的剑。'),
      act('他横剑而立，山风卷起衣角。苏晚却抢先一步挡在他身前。'),
      dlg('char_2', '别动。你剑伤未愈，走不了。'),
    ]),
    scene(3, 'INT. 药庐 - NIGHT', 'loc_2', [
      act('屋外马蹄声渐远。苏晚垂眼替他重新上药。'),
      dlg('char_2', '毒是我研的。只有我配的解药，师父才会回来。'),
      dlg('char_1', '你……拿我当饵？'),
      dlg('char_2', '是。'),
      act('她抬头，灯火映着微微发红的眼角。'),
    ]),
  ],
  analytics: {
    totalWords: 280,
    dialoguePercentage: 45,
    actionPercentage: 55,
    avgSceneLength: 93,
    longestScene: 110,
    shortestScene: 75,
  },
});

// ── 样本 2：良好（结构完整但戏剧性平缓 + 细节不突出） ─────────────────
const good = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-良好样本',
    author: 'benchmark',
    sourceNovel: '基准-良好样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 3,
    totalCharacters: 2,
    totalLocations: 2,
  },
  characters: [
    { characterId: 'char_1', name: '陈靖', isMajor: true, personalityTags: ['寡言'], description: '镖师' },
    { characterId: 'char_2', name: '阿兰', isMajor: false, personalityTags: [], description: '' },
  ],
  locations: [
    { locationId: 'loc_1', name: '客栈', type: 'interior', description: '临街二层小楼' },
    { locationId: 'loc_2', name: '城郊', type: 'exterior', description: '枯树林' },
  ],
  scenes: [
    {
      sceneNumber: 1,
      slugline: 'INT. 客栈 - NIGHT',
      timeOfDay: 'night',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        act('陈靖推门走进客栈，阿兰抬头看了一眼。'),
        dlg('char_1', '一间房。'),
        dlg('char_2', '上楼左转。'),
        act('陈靖丢下一枚铜板，径直上楼。'),
      ],
      summary: '陈靖投宿',
      confidence: 0.85,
    },
    {
      sceneNumber: 2,
      slugline: 'EXT. 城郊 - MORNING',
      timeOfDay: 'morning',
      locationId: 'loc_2',
      characterIds: ['char_1'],
      content: [
        act('枯树林里雾气未散，陈靖牵马独行。'),
        act('他低头看了看系在腰间的旧刀，脚步没停。'),
      ],
      summary: '陈靖出城赶路',
      confidence: 0.85,
    },
    {
      sceneNumber: 3,
      slugline: 'INT. 客栈 - NIGHT',
      timeOfDay: 'night',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        act('傍晚陈靖回到客栈，阿兰正收拾柜台。'),
        dlg('char_2', '事情办完了？'),
        dlg('char_1', '嗯。'),
        act('他付了房钱，转身走进夜色。'),
      ],
      summary: '陈靖离去',
      confidence: 0.85,
    },
  ],
  analytics: {
    totalWords: 150,
    dialoguePercentage: 30,
    actionPercentage: 70,
    avgSceneLength: 50,
    longestScene: 60,
    shortestScene: 40,
  },
});

// ── 样本 3：一般（对白偏少 + 地点细节缺失 + 场景较空） ───────────────────
const fair = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-一般样本',
    author: 'benchmark',
    sourceNovel: '基准-一般样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 2,
    totalCharacters: 2,
    totalLocations: 1,
  },
  characters: [
    { characterId: 'char_1', name: '阿青', isMajor: true, personalityTags: [], description: '' },
    { characterId: 'char_2', name: '掌柜', isMajor: false, personalityTags: [], description: '' },
  ],
  locations: [{ locationId: 'loc_1', name: '客栈', type: 'interior', description: '' }],
  scenes: [
    scene(1, '客栈 - 夜', 'loc_1', [
      act('阿青走进客栈。'),
      dlg('char_1', '来一间房。'),
      act('掌柜递过钥匙。'),
    ]),
    scene(2, '客栈 - 夜', 'loc_1', [
      act('阿青坐在窗前，望着外面。'),
      act('他叹了口气。'),
    ]),
  ],
  analytics: {
    totalWords: 90,
    dialoguePercentage: 15,
    actionPercentage: 85,
    avgSceneLength: 45,
    longestScene: 50,
    shortestScene: 40,
  },
});

// ── 样本 3：差（场景断号 + 角色引用悬空 + 无对白 + 无摘要） ──────────────
const poor = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-差样本',
    author: 'benchmark',
    sourceNovel: '基准-差样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 2,
    totalCharacters: 1,
    totalLocations: 1,
  },
  characters: [
    { characterId: 'char_1', name: '路人甲', isMajor: true, personalityTags: [], description: '' },
  ],
  locations: [{ locationId: 'loc_1', name: '某处', type: 'abstract', description: '' }],
  scenes: [
    { sceneNumber: 1, slugline: '某处', timeOfDay: 'unknown', locationId: 'loc_1', characterIds: ['char_99'], content: [act('有人走过。')], summary: '' },
    { sceneNumber: 3, slugline: '某处', timeOfDay: 'unknown', locationId: 'loc_1', characterIds: ['char_99'], content: [act('又有人走过。')], summary: '' },
  ],
  analytics: {
    totalWords: 20,
    dialoguePercentage: 0,
    actionPercentage: 100,
    avgSceneLength: 10,
    longestScene: 12,
    shortestScene: 8,
  },
});

// ── 样本 4：一致性缺陷（角色性格前后矛盾 + 称呼混乱） ─────────────────
const weakConsistency = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-一致性缺陷样本',
    author: 'benchmark',
    sourceNovel: '基准-一致性缺陷样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 3,
    totalCharacters: 2,
    totalLocations: 1,
  },
  characters: [
    { characterId: 'char_1', name: '方大勇', isMajor: true, personalityTags: ['沉稳'], description: '管家' },
    { characterId: 'char_2', name: '阿秀', isMajor: false, personalityTags: [], description: '' },
  ],
  locations: [{ locationId: 'loc_1', name: '堂屋', type: 'interior', description: '' }],
  scenes: [
    {
      sceneNumber: 1,
      slugline: 'INT. 堂屋 - NIGHT',
      timeOfDay: 'night',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        act('方大勇端着茶盏，缓缓吹了一口热气。'),
        dlg('char_2', '方爷，这事当真要瞒着老爷？'),
        dlg('char_1', '慌什么，把心放回肚子里。'),
        act('他说话不疾不徐，眼神平静。'),
      ],
      summary: '',
      confidence: 0.9,
    },
    {
      sceneNumber: 2,
      slugline: 'INT. 堂屋 - NIGHT',
      timeOfDay: 'night',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        act('方大勇猛地将茶盏摔在地上，瓷片四溅。'),
        dlg('char_1', '小方我这辈子就没受过这种气！'),
        dlg('char_2', '方爷……您这是怎么了？'),
        dlg('char_1', '滚！都给我滚！'),
        act('他双目赤红，浑身发抖，与方才判若两人。'),
      ],
      summary: '',
      confidence: 0.9,
    },
    {
      sceneNumber: 3,
      slugline: 'INT. 堂屋 - NIGHT',
      timeOfDay: 'night',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        act('方大勇又恢复了一贯的温和，亲手为阿秀斟茶。'),
        dlg('char_1', '方才失态，莫要放在心上。'),
        dlg('char_2', '方爷言重了。'),
      ],
      summary: '',
      confidence: 0.9,
    },
  ],
  analytics: {
    totalWords: 140,
    dialoguePercentage: 55,
    actionPercentage: 45,
    avgSceneLength: 46,
    longestScene: 60,
    shortestScene: 35,
  },
});

// ── 样本 5：连贯性缺陷（场景跳转无因果 + 时间线混乱） ─────────────────
const weakCoherence = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-连贯性缺陷样本',
    author: 'benchmark',
    sourceNovel: '基准-连贯性缺陷样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 3,
    totalCharacters: 1,
    totalLocations: 3,
  },
  characters: [{ characterId: 'char_1', name: '阿凯', isMajor: true, personalityTags: [], description: '' }],
  locations: [
    { locationId: 'loc_1', name: '码头', type: 'exterior', description: '' },
    { locationId: 'loc_2', name: '山道', type: 'exterior', description: '' },
    { locationId: 'loc_3', name: '庙宇', type: 'interior', description: '' },
  ],
  scenes: [
    {
      sceneNumber: 1,
      slugline: 'EXT. 码头 - NIGHT',
      timeOfDay: 'night',
      locationId: 'loc_1',
      characterIds: ['char_1'],
      content: [act('阿凯站在码头，望着漆黑的水面等船。')],
      summary: '',
      confidence: 0.9,
    },
    {
      sceneNumber: 2,
      slugline: 'EXT. 山道 - MORNING',
      timeOfDay: 'morning',
      locationId: 'loc_2',
      characterIds: ['char_1'],
      content: [act('天亮后阿凯出现在山道上，与几个陌生人打作一团，无人解释来龙去脉。')],
      summary: '',
      confidence: 0.9,
    },
    {
      sceneNumber: 3,
      slugline: 'INT. 庙宇 - LATE-NIGHT',
      timeOfDay: 'late-night',
      locationId: 'loc_3',
      characterIds: ['char_1'],
      content: [act('深夜，阿凯跪在庙里默默烧香，此前的情节再未提起。')],
      summary: '',
      confidence: 0.9,
    },
  ],
  analytics: {
    totalWords: 95,
    dialoguePercentage: 0,
    actionPercentage: 100,
    avgSceneLength: 31,
    longestScene: 35,
    shortestScene: 28,
  },
});

// ── 样本 6：戏剧性缺陷（平铺直叙无冲突无悬念） ─────────────────────────
const weakDrama = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-戏剧性缺陷样本',
    author: 'benchmark',
    sourceNovel: '基准-戏剧性缺陷样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 3,
    totalCharacters: 2,
    totalLocations: 1,
  },
  characters: [
    { characterId: 'char_1', name: '老周', isMajor: true, personalityTags: [], description: '' },
    { characterId: 'char_2', name: '小李', isMajor: false, personalityTags: [], description: '' },
  ],
  locations: [{ locationId: 'loc_1', name: '办公室', type: 'interior', description: '' }],
  scenes: [
    {
      sceneNumber: 1,
      slugline: 'INT. 办公室 - MORNING',
      timeOfDay: 'morning',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        act('老周整理文件，把笔放进笔筒。'),
        dlg('char_2', '周哥，报告放你桌上了。'),
        dlg('char_1', '好。'),
        act('老周继续整理。'),
      ],
      summary: '',
      confidence: 0.9,
    },
    {
      sceneNumber: 2,
      slugline: 'INT. 办公室 - AFTERNOON',
      timeOfDay: 'afternoon',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        act('小李端着水杯走过走廊，老周点头示意。'),
        dlg('char_2', '下午好。'),
        dlg('char_1', '嗯。'),
      ],
      summary: '',
      confidence: 0.9,
    },
    {
      sceneNumber: 3,
      slugline: 'INT. 办公室 - DUSK',
      timeOfDay: 'dusk',
      locationId: 'loc_1',
      characterIds: ['char_1'],
      content: [
        act('下班时间，老周关掉台灯，锁门离开。'),
        act('走廊的灯亮了又暗。'),
      ],
      summary: '',
      confidence: 0.9,
    },
  ],
  analytics: {
    totalWords: 110,
    dialoguePercentage: 25,
    actionPercentage: 75,
    avgSceneLength: 36,
    longestScene: 45,
    shortestScene: 30,
  },
});

// ── 样本 7：格式缺陷（对白混入动作块 + 场景标题不规范） ─────────────────
const weakFormat = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-格式缺陷样本',
    author: 'benchmark',
    sourceNovel: '基准-格式缺陷样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 2,
    totalCharacters: 2,
    totalLocations: 1,
  },
  characters: [
    { characterId: 'char_1', name: '老王', isMajor: true, personalityTags: [], description: '' },
    { characterId: 'char_2', name: '小翠', isMajor: false, personalityTags: [], description: '' },
  ],
  locations: [{ locationId: 'loc_1', name: '院子', type: 'exterior', description: '' }],
  scenes: [
    {
      sceneNumber: 1,
      slugline: '场景一 院子',
      timeOfDay: 'unknown',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        act('老王站在院子里，看着天说：今天天气不错。小翠回答说：是啊，晒晒被子正好。老王又说：那你去晒吧。两个人在院子里聊了很长时间的家常话，从天气聊到晚饭再聊到隔壁邻居家新来的猫。'),
      ],
      summary: '',
      confidence: 0.9,
    },
    {
      sceneNumber: 2,
      slugline: '场景二 院子里',
      timeOfDay: 'unknown',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        act('老王又说：你听说了吗，村口那棵老树倒了。小翠说：听说了，压坏了张家的墙。老王说：那可真麻烦。'),
      ],
      summary: '',
      confidence: 0.9,
    },
  ],
  analytics: {
    totalWords: 180,
    dialoguePercentage: 0,
    actionPercentage: 100,
    avgSceneLength: 90,
    longestScene: 95,
    shortestScene: 85,
  },
});

export const BENCHMARK_SAMPLES: BenchmarkSample[] = [
  {
    id: 'excellent',
    name: '优秀样本（完整结构 + 对白平衡）',
    description: '3 场景、对白占比 40%、角色/地点引用有效、场景编号连续。预期 ≥85（excellent）。',
    expectedGrade: 'excellent',
    screenplay: excellent,
  },
  {
    id: 'good',
    name: '良好样本（结构完整但戏剧性平缓）',
    description: '3 场景、对白占比 30%、结构完整但冲突平缓、细节不突出。预期 70-84（good）。',
    expectedGrade: 'good',
    screenplay: good,
  },
  {
    id: 'fair',
    name: '一般样本（对白偏少 + 细节缺失）',
    description: '2 场景、对白占比 15%、地点无描述、场景内容单薄。预期 55-84（fair/good 区间）。',
    expectedGrade: 'fair',
    screenplay: fair,
  },
  {
    id: 'poor',
    name: '差样本（断号 + 悬空引用 + 无对白）',
    description: '场景编号断号、角色引用悬空、对白为 0、无摘要。预期 <55（poor）。',
    expectedGrade: 'poor',
    screenplay: poor,
  },
  {
    id: 'weak-consistency',
    name: '一致性缺陷样本（性格矛盾 + 称呼混乱）',
    description: '角色性格前后反复横跳、自称与称呼混乱（方爷/小方）。预期 55-84（fair 档）。',
    expectedGrade: 'fair',
    screenplay: weakConsistency,
  },
  {
    id: 'weak-coherence',
    name: '连贯性缺陷样本（跳转无因果 + 时间线混乱）',
    description: '场景时间/地点乱跳、事件因果断裂、无对白。真实评估约 50 分，预期 <55（poor）。',
    expectedGrade: 'poor',
    screenplay: weakCoherence,
  },
  {
    id: 'weak-drama',
    name: '戏剧性缺陷样本（平铺直叙无冲突）',
    description: '全流水账、无冲突无悬念无情感起伏。真实评估约 50-55 分（fair/poor 边界），预期 <55（poor）。',
    expectedGrade: 'poor',
    screenplay: weakDrama,
  },
  {
    id: 'weak-format',
    name: '格式缺陷样本（对白混入动作块 + 标题不规范）',
    description: '对白未按 dialogue 块拆分、场景标题不规范、动作块冗长。真实评估约 40 分，预期 <55（poor）。',
    expectedGrade: 'poor',
    screenplay: weakFormat,
  },
];
