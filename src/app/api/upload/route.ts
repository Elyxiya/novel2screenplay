import { NextRequest, NextResponse } from 'next/server';
import { validateFile, parseNovel } from '@/lib/novel/parser';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const text = formData.get('text') as string | null;

    let novelText: string;
    let fileName = '';

    if (file) {
      const err = validateFile({ name: file.name, size: file.size, type: file.type });
      if (err) return NextResponse.json({ error: err }, { status: 400 });

      const buf = await file.arrayBuffer();
      try { novelText = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch { return NextResponse.json({ error: '文件编码不是 UTF-8，请转码后重试' }, { status: 400 }); }
      fileName = file.name.replace(/\.\w+$/, '');
    } else if (text) {
      novelText = text;
    } else {
      return NextResponse.json({ error: '请上传文件或粘贴文本' }, { status: 400 });
    }

    const result = parseNovel(novelText, fileName || '未命名');
    if (result.chapters.length === 0) return NextResponse.json({ error: result.warnings.join('；') || '无有效章节' }, { status: 400 });

    return NextResponse.json({
      projectId: `proj_${Date.now()}`,
      title: result.title,
      chapters: result.chapters.map(c => ({ index: c.index, title: c.title, paragraphCount: c.paragraphs.length, text: c.text })),
      warnings: result.warnings,
    });
  } catch { return NextResponse.json({ error: '文件处理失败' }, { status: 500 }); }
}
