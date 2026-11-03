export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.includes('/api/') && request.method === 'POST') {
      return handleApi(request, env, url);
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
  cyberpunk: 'Cyberpunk style 3D figurine of the person, neon accents, metallic texture, single object, high detail'
};

const SCENE_PROMPTS = {
  studio: 'plain seamless light gray studio backdrop, soft even product lighting',
  shelf: 'standing on a wooden collector shelf, blurred rows of collectible figures behind, warm ambient room light',
  gaming: 'on a desk in a gaming room, blurred RGB-lit monitor and keyboard behind, cool neon ambient light'
};

async function handleGenerate(request, env) {
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
    return json({
      error: 'Processing failed.',
      detail: err.message,
      code: err.code
    }, 500);
  }
}
