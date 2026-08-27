// P1-1 验收：跑一次真实传统管线转换，产出可用于 /debug 评测的 jobId
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'http://localhost:3001';
const USERNAME = 'p11_' + Date.now().toString(36).slice(-6);
const PASSWORD = 'pass-123456';

const NOVEL = `夜雨敲窗，林小满伏在案前修改剧本。桌上摊开的小说泛黄，第三幕的字迹被反复划改。她抬头看向窗外，雨丝连成银线。

陈默推门进来，抖落肩头的雨水："这么晚还在改？"
"导演明天要看第三幕。"林小满头也不抬，笔尖沙沙作响。
陈默走近，瞥见满纸红笔："这场戏的台词太满了。"
"我知道。"林小满搁笔，揉了揉眉心，"但删掉哪句都舍不得。"

凌晨三点，两人终于敲定终稿。林小满望向窗外渐收的雨势，轻轻呼出一口气。

翌日清晨，剧组围读剧本。陈默站在白板前，将第三幕的场景一一列出。制片人老周敲着桌面："结尾太温吞了，得加一场反转。"

林小满沉默片刻，抬头："那就让陈默在最后一刻才知道真相。"
会议室安静下来。老周笑了："好，这才够劲。"`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 注册 + 登录（Node fetch 需要手动维护 cookie）
  const jar = new Map();
  const setCookies = (res) => {
    const sc = res.headers.getSetCookie?.() ?? [];
    for (const c of sc) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  };
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  setCookies(loginRes);
  const login = await loginRes.json();
  console.log(`[1] 登录: ${login.user?.username ?? '?'}`);

  // 启动传统管线
  const startRes = await fetch(`${BASE}/api/pipeline/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({
      novelText: NOVEL,
      title: '雨夜改稿',
      author: '测试作者',
      modelId: 'deepseek-chat',
      temperature: 0.7,
      selectedChapters: [0],
    }),
  });
  const { jobId, error } = await startRes.json();
  if (!jobId) {
    console.error('[2] 启动失败:', error);
    process.exit(1);
  }
  console.log(`[2] 管线任务已启动: ${jobId}`);

  // 轮询状态
  const deadline = Date.now() + 240000;
  let status = '';
  while (Date.now() < deadline) {
    await wait(3000);
    const stRes = await fetch(`${BASE}/api/pipeline/status/${jobId}`, {
      headers: { Cookie: cookieHeader() },
    });
    if (stRes.ok) {
      const st = await stRes.json();
      status = st.status;
      console.log(`   [poll] status=${st.status} progress=${st.progress}% ${new Date().toISOString().slice(11, 19)}`);
      if (st.status === 'completed' || st.status === 'failed' || st.status === 'cancelled') break;
    }
  }

  if (status === 'completed') {
    writeFileSync(path.join(ROOT, 'pr-evidence/.p11-jobid.txt'), jobId, 'utf8');
    console.log(`[3] 转换完成，jobId=${jobId}（已写入 pr-evidence/.p11-jobid.txt）`);
    console.log('ALL OK');
  } else {
    console.error(`[3] 最终状态: ${status}（非 completed）`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
