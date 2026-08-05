'use client';

import * as XLSX from 'xlsx';
import type { Drama } from '@/lib/schema/drama.schema';
import { SHOT_TYPE_LABELS, CAMERA_MOVE_LABELS } from '@/lib/drama/drama-stats';

/** 触发浏览器下载 Blob */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 导出分镜为 JSON 文件 */
export function exportDramaJson(drama: Drama): void {
  const blob = new Blob([JSON.stringify(drama, null, 2)], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, `${drama.metadata.title}-分镜.json`);
}

/** 导出分镜为 Excel（xlsx）：镜头明细表 + 统计表 */
export function exportDramaExcel(drama: Drama): void {
  const title = drama.metadata.title || 'shortdrama';

  const rows = drama.shots.map((s, i) => ({
    镜号: s.shotNumber,
    场景: s.sceneNumber,
    场景标题: s.slugline,
    景别: SHOT_TYPE_LABELS[s.shotType] ?? s.shotType,
    运镜: CAMERA_MOVE_LABELS[s.cameraMove] ?? s.cameraMove,
    时长秒: s.durationSec,
    说话人: s.speaker ?? '',
    台词: s.dialogue,
    画面提示: s.visual,
    动作: s.action,
    备注: s.notes ?? '',
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [
    { wch: 6 }, { wch: 6 }, { wch: 14 }, { wch: 8 }, { wch: 10 },
    { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 40 }, { wch: 30 }, { wch: 16 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, '镜头明细');
  XLSX.writeFile(wb, `${title}-分镜.xlsx`);
}
