// host-bridge.js
// Point 3 · host-side bridge registration + a faithful agent-event duplicator.
//
// Truthful scope (restrained-rework-3-points §3.3):
//   The panel NEVER holds fetch/SSE/cookie — it only reports intents (workbench:start/review/revise)
//   through the bridge. In a real embedding app the HOST executes the actual /api/agent/* calls
//   (same-origin, cookie-bearing) and streams data.event lines back via bridge.sendEvent().
//   In this static demo (3002 / 3003, no app backend) the host substitutes a deterministic
//   "event duplicator" that replays the exact same data.event shapes a live SSE stream would
//   push, so the cross-origin bridge + origin-guard + virtualization are exercised end-to-end.
//
// Real-call stub (enable when the app host exists on the SAME origin as this page):
//   const taskId = await (await fetch('/api/agent/start', {method:'POST', headers:{'content-type':'application/json'},
//       body: JSON.stringify({ novelText, title, author, instruction })})).json().taskId;
//   const res = await fetch(`/api/agent/stream/${taskId}`);
//   for await (const line of readNDJSON(res.body)) { const evt=parse(line); if(evt?.data) bridge.sendEvent(evt.data); }

(function (global) {
  'use strict';
  const WB = global.NovelAgentWorkbench;
  if (!WB) {
    console.error('[embed-host] NovelAgentWorkbench bundle not loaded — add <script src="/lib/agent-workbench.umd.js">');
    return;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setupEmbedHost({ target, targetOrigin }) {
    let bridge;
    let current = { taskId: null, awaitingPhase: null };

    const emit = (evt) => bridge.sendEvent(evt);
    const log = (message, level = 'info') => emit({ event: 'log', taskId: current.taskId ?? '', level, message });

    // Handle each deferred callback per-phase.
    function phaseStart(id, name) { emit({ event: 'phase_start', taskId: current.taskId, phaseId: id, name }); }
    function phaseComplete(id, name) { emit({ event: 'phase_complete', taskId: current.taskId, phaseId: id, name }); }

    async function runStart(payload) {
      const taskId = `demo-${Date.now().toString(36)}`;
      current.taskId = taskId;
      current.awaitingPhase = null;
      emit({ event: 'task_start', taskId });
      log(`[宿主] 已接收启动意图（标题=${payload.title || '(无)'}，正文 ${payload.novelText ? payload.novelText.length : 0} 字符），开始四阶段转换`);

      // 阶段 1 分析
      phaseStart('analyze', 'analyze');
      await sleep(300);
      log('[Phase1 analyze] 解析 ${payload.novelText.length} 字符，抽取角色/地点/设定卡');
      await sleep(400);
      phaseComplete('analyze', 'analyze');

      // 阶段 2 场景切割
      phaseStart('segment', 'segment');
      await sleep(300);
      log('[Phase2 segment] 识别 8 个场景，含 3 处对白场景');
      await sleep(350);
      phaseComplete('segment', 'segment');

      // 阶段 3 场景转换 → 挂起，等待人工介入
      phaseStart('convert', 'convert');
      await sleep(400);
      log('[Phase3 convert] 场景 8 命中质量关卡：动作描写与角色设定冲突');
      current.awaitingPhase = 'convert';
      emit({
        event: 'phase_awaiting_manual',
        taskId,
        phaseId: 'convert',
        name: 'convert',
        reason: '质量关卡(manual_review)：场景 8 动作描写与角色"冷静谋士"设定冲突，需人工复核',
        gate: { decision: 'manual_review', reason: '场景 8 存在设定冲突，需人工复核' },
        outputSummary: '[场景8] 主角与二号位对峙，…（第 3 阶段草稿，待人工确认）',
      });
    }

    async function runReview(payload) {
      const { phaseId, action } = payload;
      log(`[宿主] 收到人工介入 action=${action}（phase=${phaseId}）`);
      if (action === 'discard') {
        log('用户选择放弃本条任务');
        emit({ event: 'task_complete', taskId: current.taskId, success: false, durationMs: 6800, phases: [] });
        return;
      }
      // approve / retry → 视为通过，继续合并阶段
      if (action === 'retry') log('重新生成场景 8 …（re-run localized）');
      emit({ event: 'gate_result', taskId: current.taskId, phaseId, gate: { decision: 'pass', reason: '人工已确认，重跑通过' } });
      phaseComplete('convert', 'convert');
      await sleep(250);

      phaseStart('merge', 'merge');
      await sleep(300);
      log('[Phase4 merge] 合并去重完成，输出剧本 YAML');
      await sleep(250);
      phaseComplete('merge', 'merge');
      emit({
        event: 'task_complete',
        taskId: current.taskId,
        success: true,
        durationMs: 7600,
        phases: [
          { id: 'analyze', name: 'analyze', status: 'completed' },
          { id: 'segment', name: 'segment', status: 'completed' },
          { id: 'convert', name: 'convert', status: 'completed' },
          { id: 'merge', name: 'merge', status: 'completed' },
        ],
      });
    }

    async function runRevise(payload) {
      log(`[宿主] 按建议重新生成（phase=${payload.phaseId}）：${payload.instruction}`);
      await sleep(500);
      // 建议生效 → 场景 8 过关，继续合并
      emit({ event: 'gate_result', taskId: current.taskId, phaseId: payload.phaseId, gate: { decision: 'pass', reason: '按建议词句修正后通过' } });
      phaseComplete('convert', 'convert');
      await sleep(250);
      phaseStart('merge', 'merge');
      await sleep(300);
      log('[Phase4 merge] 合并去重完成（revise 分支）');
      phaseComplete('merge', 'merge');
      emit({
        event: 'task_complete',
        taskId: current.taskId,
        success: true,
        durationMs: 8100,
        phases: [
          { id: 'analyze', name: 'analyze', status: 'completed' },
          { id: 'segment', name: 'segment', status: 'completed' },
          { id: 'convert', name: 'convert', status: 'completed' },
          { id: 'merge', name: 'merge', status: 'completed' },
        ],
      });
    }

    const handle = async (cmd) => {
      switch (cmd.type) {
        case 'workbench:start': return void runStart(cmd.payload);
        case 'workbench:review': return void runReview(cmd.payload);
        case 'workbench:revise': return void runRevise(cmd.payload);
        case 'workbench:hello': {
          bridge.send({ type: 'workbench:hello:ack', refId: cmd.refId, _v: 1, payload: { ok: true } });
          return;
        }
        default:
          log(`[宿主] 未处理命令 ${cmd.type}`);
      }
    };

    bridge = new WB.HostBridge({ target, targetOrigin, onCommand: handle });
    return { bridge };
  }

  global.setupEmbedHost = setupEmbedHost;
})(window);