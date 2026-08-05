import type { Drama, Shot } from '@novel/contracts/drama';

// ── 枚举 → 中文标签 ──

export const SHOT_TYPE_LABELS: Record<string, string> = {
  'extreme-wide': '大远景',
  'wide': '远景',
  'full': '全景',
  'medium': '中景',
  'close-up': '近景',
  'extreme-close-up': '特写',
  'over-shoulder': '过肩',
  'two-shot': '双人',
};

export const CAMERA_MOVE_LABELS: Record<string, string> = {
  'static': '固定',
  'pan': '横摇',
  'tilt': '纵摇',
  'dolly-in': '推',
  'dolly-out': '拉',
  'track': '跟移',
  'crane': '升降',
  'handheld': '手持',
  'zoom-in': '变焦推近',
  'zoom-out': '变焦拉远',
};

// ── 统计结构 ──

export interface DramaStats {
  /** 全片预估时长（秒） */
  totalDurationSec: number;
  /** 对白镜头数 */
  dialogueShots: number;
  /** 纯动作镜头数 */
  actionShots: number;
  /** 对白+动作混合镜头数 */
  mixedShots: number;
  /** 台词总字数 */
  dialogueChars: number;
  /** 动作描述总字数 */
  actionChars: number;
  /** 景别分布（按镜头数降序） */
  shotTypeDist: Array<{ type: string; label: string; count: number }>;
  /** 运镜分布（按镜头数降序） */
  cameraDist: Array<{ move: string; label: string; count: number }>;
}

function isDialogueShot(shot: Shot): boolean {
  return shot.dialogue.trim().length > 0;
}

function isActionShot(shot: Shot): boolean {
  return shot.action.trim().length > 0;
}

/** 计算分镜统计（纯函数，无副作用） */
export function computeDramaStats(drama: Drama): DramaStats {
  const shotTypeCount = new Map<string, number>();
  const cameraCount = new Map<string, number>();
  let totalDurationSec = 0;
  let dialogueShots = 0;
  let actionShots = 0;
  let mixedShots = 0;
  let dialogueChars = 0;
  let actionChars = 0;

  for (const shot of drama.shots) {
    totalDurationSec += shot.durationSec ?? 0;
    shotTypeCount.set(shot.shotType, (shotTypeCount.get(shot.shotType) ?? 0) + 1);
    cameraCount.set(shot.cameraMove, (cameraCount.get(shot.cameraMove) ?? 0) + 1);

    const hasDlg = isDialogueShot(shot);
    const hasAct = isActionShot(shot);
    if (hasDlg && hasAct) mixedShots++;
    else if (hasDlg) dialogueShots++;
    else if (hasAct) actionShots++;

    dialogueChars += shot.dialogue.trim().length;
    actionChars += shot.action.trim().length;
  }

  const sortDesc = <T,>(arr: T[]) => arr.sort((a: T, b: T) =>
    (b as { count: number }).count - (a as { count: number }).count);

  const shotTypeDist = sortDesc(
    [...shotTypeCount.entries()].map(([type, count]) => ({ type, label: SHOT_TYPE_LABELS[type] ?? type, count })),
  );
  const cameraDist = sortDesc(
    [...cameraCount.entries()].map(([move, count]) => ({ move, label: CAMERA_MOVE_LABELS[move] ?? move, count })),
  );

  return {
    totalDurationSec,
    dialogueShots,
    actionShots,
    mixedShots,
    dialogueChars,
    actionChars,
    shotTypeDist,
    cameraDist,
  };
}

/** 秒 → 「X 分 X 秒」 */
export function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  if (m === 0) return `${s} 秒`;
  return `${m} 分 ${s} 秒`;
}
