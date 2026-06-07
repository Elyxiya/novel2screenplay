import { NextResponse } from 'next/server';
import { llmRegistry, initializeProviders } from '@/lib/llm/registry';

export async function GET() {
  initializeProviders();
  const providers = llmRegistry.getAll();
  const models = providers.map(p => ({ id: p.modelId, name: p.name, provider: p.name, contextWindow: p.contextWindow }));
  if (models.length === 0) return NextResponse.json({ models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', contextWindow: 65536 },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', contextWindow: 128000 },
  ], configured: false, message: '请在 .env.local 中配置 API Key' });
  return NextResponse.json({ models, configured: true });
}
