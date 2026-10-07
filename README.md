# AI 3D Figurine Generator

A Cloudflare Worker that turns a photo into a 3D figurine style image using Workers AI (FLUX.2 klein-4b).

## Features

- Four styles: chibi, realistic, pixel, cyberpunk
- Upload a photo, get a 3D figurine in 10-30 seconds
- Frontend compresses images to 512x512 before upload
- Runs on Cloudflare Workers AI — no API keys
- Built-in rate limiting (20 requests/min per IP)
- Photo is not stored
- Multi-language interface (EN + ZH)

## Setup

```bash
npm install
npx wrangler deploy
```

## Routes

Add to `tool-proxy`:
- `toolara.dev/ai-3d-figurine-generator/*`
- `www.toolara.dev/ai-3d-figurine-generator/*`

## Known limitations

- FLUX.2 klein-4b has a content filter that may misidentify harmless images. If generation fails, try a different photo.
- Input images must be smaller than 512x512 (the frontend handles this automatically).
- The model uses multipart form data, serialized via a Request object.

## License

MIT
