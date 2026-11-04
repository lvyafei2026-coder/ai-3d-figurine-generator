export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.includes('/api/') && request.method === 'POST') {
      return handleApi(request, env, url);
    }

    // Clean URL for the guide page (html_handling is "none", so extensionless paths would hit the SPA fallback)
    if (url.pathname === '/3d-print-guide') {
      return env.ASSETS.fetch(new URL('/3d-print-guide.html', url.origin));
    }

    return env.ASSETS.fetch(request);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/$/, '');

  if (!path.endsWith('/api/generate')) {
    return json({ error: 'Not found' }, 404);
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const { success } = await env.AI_RATE_LIMITER.limit({ key: 'figurine:' + ip });

  if (!success) {
    return json({
      error: 'Too many requests. Please wait a minute and try again.',
      code: 'RATE_LIMITED'
    }, 429);
  }

  return handleGenerate(request, env);
}

// 提示词与页面上「Action figure prompt ideas」一节展示的文本必须一致（对用户可见=可复现）
// 结构：风格只管人物造型，背景一律交给场景（scene），两者拼接后再送模型
const STYLE_PROMPTS = {
  actionfigure: 'the person as a collectible action figure in a clear blister pack on a printed cardboard card back, full body, articulated joints, 6-inch scale, product photography, high detail',
  doll: 'the person as a soft vinyl doll, large glossy eyes, pastel outfit, smooth matte skin, single object, high detail',
  chibi: '3D chibi figurine of the person, cute style, big head, small body, smooth plastic texture, product photography, high detail, single object',
  realistic: 'Realistic 3D sculpture of the person, marble texture, museum lighting, single object, front view, high detail',
  pixel: 'Pixel art 3D figurine of the person, voxel style, isometric view, soft shadows, single object',
  cyberpunk: 'Cyberpunk style 3D figurine of the person, neon accents, metallic texture, single object, high detail',
  pop: 'the person as a Funko Pop style vinyl collectible figure, oversized square head, round black bead eyes, small simplified body, standing on a round display base, single object, high detail',
  brick: 'the person as a small plastic building-brick toy minifigure, blocky cylindrical head, simple printed face, C-shaped claw hands, trapezoid torso, glossy plastic, single object, high detail',
  anime: 'anime style PVC figurine of the person, manga proportions, dynamic pose, glossy painted figure on a round display base, single object, high detail',
  bobblehead: 'the person as a bobblehead figurine, oversized head connected by a spring on a small body, warm polymer clay finish, playful expression, single object, high detail',
  plush: 'the person as a soft plush stuffed toy version of themselves, fluffy felt fabric, stitched smile, round button eyes, chibi proportions, single object, high detail',
  clay: 'the person as a handcrafted claymation character, smooth colorful plasticine surface, clean cheerful finish, stop-motion animation style, single object, high detail'
};

const SCENE_PROMPTS = {
  studio: 'plain seamless light gray studio backdrop, soft even product lighting',
  shelf: 'standing on a wooden collector shelf, blurred rows of collectible figures behind, warm ambient room light',
  gaming: 'on a desk in a gaming room, blurred RGB-lit monitor and keyboard behind, cool neon ambient light'
};

// 全局每日生成上限：账户 Workers AI 免费层 10,000 neurons/天（UTC 日切），全站群共享。
//   flux-2-klein-4b 1024x1024 实测单张约 250-400 neurons（按 330 估）。
//   2026-11-04 二次切分：radar 的 autopilot 自动分析停用（额度让给产品站），本站 8 → 12 张。
//     本站出图 12 张 ≈4.0k + creative 出图 8 张 ≈2.6k + radar 手动 5 次 ≈1.3k，
//     余 ~2.1k 给 music 封面 / 3b 文案站 / 突发。
//   两站共用一个 KV namespace（QUOTA_KV），靠 key 前缀区分，不各算各的。
//   撞账户 4006 时写 img:alert:<UTC日> 旗——radar 的预警巡检每 2 小时读一次并发邮件。
const DAILY_LIMIT = 12;
const QUOTA_PREFIX = 'img:figurine:';

function todayKey() {
  return QUOTA_PREFIX + new Date().toISOString().slice(0, 10);
}

// 预占一格：先记账再调模型，失败（含 4006）时 refund 还回去
async function checkDailyQuota(env) {
  const key = todayKey();
  const current = parseInt((await env.QUOTA_KV.get(key)) || '0', 10);
  if (current >= DAILY_LIMIT) {
    return { ok: false, current };
  }
  await env.QUOTA_KV.put(key, String(current + 1), { expirationTtl: 172800 });
  return { ok: true, current };
}

async function refundQuota(env) {
  const key = todayKey();
  const current = parseInt((await env.QUOTA_KV.get(key)) || '0', 10);
  if (current > 0) await env.QUOTA_KV.put(key, String(current - 1), { expirationTtl: 172800 });
}

// 账户额度见底：立旗给 radar 的预警巡检（每 2 小时读一次，发邮件提醒）
async function flagQuotaExhausted(env) {
  try {
    await env.QUOTA_KV.put('img:alert:' + new Date().toISOString().slice(0, 10),
      new Date().toISOString(), { expirationTtl: 172800 });
  } catch (e) { console.error('flagQuotaExhausted failed:', e.message); }
}

async function handleGenerate(request, env) {
  let quotaReserved = false;
  try {
    const formData = await request.formData();
    const styleKey = formData.get('style') || 'actionfigure';
    const sceneKey = formData.get('scene') || 'studio';
    const image0 = formData.get('image_0');

    if (!image0 || !(image0 instanceof File)) {
      return json({ error: 'Please upload a photo.' }, 400);
    }

    const MAX_SIZE = 5 * 1024 * 1024;
    if (image0.size > MAX_SIZE) {
      return json({ error: 'Image must be under 5MB.' }, 400);
    }

    const stylePrompt = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS.actionfigure;
    const scenePrompt = SCENE_PROMPTS[sceneKey] || SCENE_PROMPTS.studio;
    const finalPrompt = stylePrompt + ', ' + scenePrompt;

    const quota = await checkDailyQuota(env);
    if (!quota.ok) {
      return json({
        error: "Today's free quota is used up. Please come back tomorrow.",
        code: 'QUOTA_EXCEEDED'
      }, 429);
    }
    quotaReserved = true;

    // 组装 multipart
    const apiForm = new FormData();
    apiForm.append('prompt', finalPrompt);
    apiForm.append('width', '1024');
    apiForm.append('height', '1024');

    const buf0 = await image0.arrayBuffer();
    apiForm.append('input_image_0', new File([buf0], 'input_0.png', { type: 'image/png' }));

    // 官方要求：用 Request 序列化 FormData，以生成正确的 Content-Type 边界[citation:1][citation:19]
    const formRequest = new Request('http://dummy', {
      method: 'POST',
      body: apiForm
    });

    const response = await env.AI.run('@cf/black-forest-labs/flux-2-klein-4b', {
      multipart: {
        body: formRequest.body,
        contentType: formRequest.headers.get('content-type')
      }
    });

    if (!response || !response.image) {
      return json({ error: 'Generation failed. Please try again.' }, 500);
    }

    return json({ image: response.image });
  } catch (err) {
    console.error('Generate error:', {
      message: err.message,
      code: err.code,
      name: err.name
    });
    // Workers AI 免费层日配额耗尽（4006 neurons exhausted）：
    // 额度判定在入口，没产生推理，把预占的那一格还回去，别让额度耗尽时的失败把当天配额也耗光；
    // 同时立旗（img:alert:<UTC日>），radar 的预警巡检读到就发邮件
    if (String(err.message || '').includes('4006') || err.code === 4006) {
      if (quotaReserved) await refundQuota(env);
      await flagQuotaExhausted(env);
      return json({
        error: "Today's free quota is used up. Please come back tomorrow.",
        code: 'QUOTA_EXCEEDED'
      }, 429);
    }
    return json({
      error: 'Processing failed.',
      detail: err.message,
      code: err.code
    }, 500);
  }
}
