// 为 figurine 站生成 6 新风格 × 3 场景 = 18 张示例图
// 走 Workers AI REST API（OAuth token 取自 wrangler 配置，scope 含 ai:write）
// 用法: node gen-examples.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN_FILE = path.join(os.homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml');
const ACCOUNT = 'dfdd100d98b3565f74523252e797334f';
const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`;

const ROOT = 'C:/github_repository/lvyafei2026-coder/ai-3d-figurine-generator/public/examples';
const SRC = ROOT + '/sample.jpg';

const token = fs.readFileSync(TOKEN_FILE, 'utf8').match(/oauth_token = "([^"]+)"/)[1];

const SCENE_PROMPTS = {
  studio: 'plain seamless light gray studio backdrop, soft even product lighting',
  shelf: 'standing on a wooden collector shelf, blurred rows of collectible figures behind, warm ambient room light',
  gaming: 'on a desk in a gaming room, blurred RGB-lit monitor and keyboard behind, cool neon ambient light'
};
const STYLE_PROMPTS = {
  pop: 'the person as a Funko Pop style vinyl collectible figure, oversized square head, round black bead eyes, small simplified body, standing on a round display base, single object, high detail',
  brick: 'the person as a small plastic building-brick toy minifigure, blocky cylindrical head, simple printed face, C-shaped claw hands, trapezoid torso, glossy plastic, single object, high detail',
  anime: 'anime style PVC figurine of the person, manga proportions, dynamic pose, glossy painted figure on a round display base, single object, high detail',
  bobblehead: 'the person as a bobblehead figurine, oversized head connected by a spring on a small body, warm polymer clay finish, playful expression, single object, high detail',
  plush: 'the person as a soft plush stuffed toy version of themselves, fluffy felt fabric, stitched smile, round button eyes, chibi proportions, single object, high detail',
  clay: 'the person as a handcrafted claymation character, plasticine texture, visible thumbprint surface, stop-motion animation style, single object, high detail'
};

async function genOne(scene, style) {
  const prompt = STYLE_PROMPTS[style] + ', ' + SCENE_PROMPTS[scene];
  const fd = new FormData();
  fd.append('prompt', prompt);
  fd.append('width', '1024');
  fd.append('height', '1024');
  fd.append('input_image_0', new File([fs.readFileSync(SRC)], 'input_0.png', { type: 'image/png' }));
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.success && data.result && data.result.image) {
    fs.writeFileSync(`${ROOT}/${scene}/${style}.jpg`, Buffer.from(data.result.image, 'base64'));
    return { ok: true };
  }
  return { ok: false, status: res.status, err: JSON.stringify(data).slice(0, 200) };
}

let fail = 0;
for (const scene of ['studio', 'shelf', 'gaming']) {
  for (const style of Object.keys(STYLE_PROMPTS)) {
    let r = await genOne(scene, style);
    if (!r.ok) {
      console.log(`retry ${scene}/${style}: ${r.status} ${r.err}`);
      await new Promise(res => setTimeout(res, 4000));
      r = await genOne(scene, style);
    }
    if (r.ok) console.log(`OK ${scene}/${style}`);
    else { console.log(`FAIL ${scene}/${style}: ${r.status} ${r.err}`); fail++; }
    await new Promise(res => setTimeout(res, 1200));
  }
}
console.log(fail ? `DONE with ${fail} failures` : 'ALL 18 DONE');
