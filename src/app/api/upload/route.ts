import { NextRequest, NextResponse } from 'next/server';
import { validateFile, parseNovel } from '@/lib/novel/parser';
import { getNovelRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';
import * as iconv from 'iconv-lite';

export async function POST(request: NextRequest) {
  try {
    // 上传小说会创建/修改资产，必须登录
    const user = await getCurrentUser();
    if (!user) return authError();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const text = formData.get('text') as string | null;
    // 追加模式：指定已有小说资产，解析出的新章节并入该资产（工作台"追加章节"）
    const appendNovelId = (formData.get('novelId') as string | null) || null;

    let novelText: string;

    if (file) {
      const err = validateFile({ name: file.name, size: file.size, type: file.type });
      if (err) return NextResponse.json({ error: err }, { status: 400 });

      const buf = Buffer.from(await file.arrayBuffer());
      try {
        novelText = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        const decoded = iconv.decode(buf, 'gbk');
        if (decoded.includes('\uFFFD') || decoded.indexOf('\u0000') !== -1) {
          return NextResponse.json({ error: '无法识别文件编码，请保存为UTF-8格式后重试' }, { status: 400 });
        }
        novelText = decoded;
      }
    } else if (text) {
      novelText = text;
    } else {
      return NextResponse.json({ error: '请上传文件或粘贴文本' }, { status: 400 });
    }

    // 统一换行符为 LF：不同客户端（浏览器 / 脚本 / 文件保存格式）可能携带 CRLF，
    // 规范化后 findByText 复用与章节去重对换行符不敏感
    novelText = novelText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const result = parseNovel(novelText);
    if (result.chapters.length === 0) {
      return NextResponse.json({ error: result.warnings.join('; ') || '无有效章节' }, { status: 400 });
    }

    const novelRepo = getNovelRepository();
    const chaptersPayload = result.chapters.map((c) => ({
      index: c.index,
      title: c.title,
      paragraphCount: c.paragraphs.length,
      text: c.text,
    }));

    let novelId: string | null = null;
    let appended = 0;

    if (appendNovelId) {
      // 工作台"追加章节"：解析出的章节并入指定资产（校验归属）
      const asset = novelRepo.get(appendNovelId);
      if (!asset) return NextResponse.json({ error: '小说资产不存在' }, { status: 404 });
      if (asset.userId !== user.id) {
        return NextResponse.json({ error: '无权操作该资产' }, { status: 403 });
      }
      appended = novelRepo.appendChapters(appendNovelId, chaptersPayload);
      novelId = appendNovelId;
    } else {
      // 同一部小说重复上传时复用资产，并把新增章节并入（作者更新稿件场景）
      const existing = novelRepo.findByText(novelText, user.id);
      if (existing) {
        novelId = existing.id;
        if (result.chapters.length > existing.chapters.length) {
          appended = novelRepo.appendChapters(novelId, chaptersPayload);
        }
      } else {
        novelId = novelRepo.create({
          title: result.title,
          novelText,
          chapters: chaptersPayload,
          userId: user.id,
        });
      }
    }

    // 读取合并后的资产，返回完整章节与已转换标记
    const fresh = novelId ? novelRepo.get(novelId) : null;
    const outChapters = fresh
      ? fresh.chapterTexts.map((t, i) => ({
          index: i,
          title: fresh.chapters[i]?.title ?? `第${i + 1}章`,
          paragraphCount: fresh.chapters[i]?.paragraphCount ?? 0,
          text: t,
        }))
      : chaptersPayload;

    return NextResponse.json({
      projectId: `proj_${Date.now()}`,
      novelId,
      appended,
      title: fresh?.title ?? result.title,
      chapters: outChapters,
      convertedChapters: fresh?.convertedChapters ?? [],
      warnings: result.warnings,
    });
  } catch {
    return NextResponse.json({ error: '文件处理失败' }, { status: 500 });
  }
}
