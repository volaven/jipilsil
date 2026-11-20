// 정적 집필 앱만 _site 폴더로 모아요 (Firebase Hosting 배포용).
// 원고·로컬 AI 서버·테스트는 넣지 않아요. 실행: node scripts/build-site.mjs
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'icons'), { recursive: true });
mkdirSync(join(OUT, 'img'), { recursive: true });

for (const f of ['index.html', 'config.js', 'manifest.webmanifest', 'sw.js', 'css', 'js']) cpSync(join(ROOT, f), join(OUT, f), { recursive: true });
for (const f of readdirSync(join(ROOT, 'icons')).filter(f => f.endsWith('.svg'))) cpSync(join(ROOT, 'icons', f), join(OUT, 'icons', f));
for (const [src, dst] of [['icons-b64', 'icons'], ['img-b64', 'img']]) {
  for (const f of readdirSync(join(ROOT, src)).filter(f => f.endsWith('.b64'))) {
    writeFileSync(join(OUT, dst, basename(f, '.b64')), Buffer.from(readFileSync(join(ROOT, src, f), 'utf8'), 'base64'));
  }
}

// 배포마다 서비스워커 캐시 이름이 바뀌어야 새 버전이 깔끔하게 반영돼요
const build = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 12) : 'local-' + Date.now().toString(36);
const sw = join(OUT, 'sw.js');
writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', build));

console.log(`_site 준비 완료 (build ${build})`);
