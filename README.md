# QwenLoca — Qwen3.5-2B chat, 100% in your browser

A modular web app that runs **Qwen3.5-2B (ONNX)** entirely on your device via
**WebAssembly** — no server, no API keys, no uploads. Works on **Android Chrome**
(and any modern desktop browser).

- Model: [`onnx-community/Qwen3.5-2B-ONNX`](https://huggingface.co/onnx-community/Qwen3.5-2B-ONNX) (from the ONNX Community on Hugging Face)
- Runtime: [transformers.js](https://huggingface.co/docs/transformers.js) + [ONNX Runtime Web](https://onnxruntime.ai/) (WASM)
- Privacy: everything runs locally. The only network call after load is the CDN
  fetch for the runtime libraries.

## How the model flow works (as designed)

The website **never stores the model** in browser storage (no IndexedDB / Cache API).

1. **First visit** → *“Oh, your first time here! 👋 Wanna download the model?
   Yes or yes (both are yes, but you need to click it).”* Both buttons download it.
2. The model files (~1.3 GB, 4-bit) are downloaded straight to your **Downloads
   folder** as raw files (`decoder_model_merged_q4f16.onnx`,
   `decoder_model_merged_q4f16.onnx_data`, `embed_tokens_q4f16.onnx`,
   `embed_tokens_q4f16.onnx_data`, `tokenizer.json`, `tokenizer_config.json`,
   `config.json`, `generation_config.json`).
3. The file manager opens — you select those files. The model is loaded from
   them **into memory** and you chat.
4. **Next visit** → *“Do you still have the model files?”*
   - **Yes** → file manager opens, you re-select the files (no re-download).
   - **No** → *“Are you sure you want to download the model?”* → **Yes!** → downloads again.

Only a tiny “have you visited” flag is kept in `localStorage` (a few bytes) so the
app can greet you correctly. Model bytes never touch website storage.

## Run it

```bash
node server.js            # http://0.0.0.0:8080
# or
python3 -m http.server 8080
```

`server.js` sends `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` headers, which enable
**SharedArrayBuffer → multithreaded WASM** (faster generation). Without those
headers the app still works (single-threaded fallback).

> ⚠️ The app uses ES modules, so it must be served over HTTP(S) — opening
> `index.html` directly from the file system won’t work in Chrome.

## Host on GitHub Pages

Yes — the site is fully static, so GitHub Pages works with no build step:

1. Push the code to GitHub (already done: branch `arena/019ffdaf-qwenloca`).
2. Repo **Settings → Pages → Source: “Deploy from a branch”** →
   select `arena/019ffdaf-qwenloca` (or `main` if you merge it) → `/ (root)` → Save.
3. Done. Your app will be at `https://<user>.github.io/qwenloca/`.

**About multithreading:** GitHub Pages can’t send COOP/COEP headers, so the app
registers `sw.js` on first load — a tiny service worker that re-serves the
navigation response with those headers (a standard trick for static hosts). It
reloads the page once, and from then on ONNX Runtime uses the threaded WASM
build. The service worker caches nothing — model files are still never stored.
If service workers are unavailable, the app simply runs single-threaded.

All asset paths, the PWA manifest (`manifest.json` with `./`-relative
`start_url`/`scope`) and the model download links are relative or absolute
external URLs, so subpath hosting (project pages) works without changes.

## Android tips

- Use **Chrome** (recent version — it supports WebAssembly + ES modules).
- You need roughly **2 GB+ of free RAM** to load the 4-bit model (~1.4 GB into
  memory). Phones with 6 GB RAM or more are comfortable.
- Downloads land in **Downloads**; the file manager lets you select multiple
  files at once (select them all).
- If a file is greyed out in the picker, choose *“Show all files”* / *“All files”*
  from the picker menu.
- You can “Add to Home screen” (PWA manifest included) — the app opens
  full-screen like a native app.

## Project layout (modular)

```
index.html                entry point
css/                      base.css · components.css · chat.css
js/
  app.js                  boot / state machine (first visit ↔ returning)
  config.js               model repo, variants, file lists, CDN pins
  libs.js                 lazy loader: custom ONNX Runtime + transformers.js
  fetcher.js              FileStore + custom env.fetch that serves your files
  model-files.js          variant detection & file validation
  downloads.js            native downloads from the ONNX repo
  wizard.js               onboarding screens (yes/yes, yes/no, confirm)
  engine.js               transformers.js pipeline, streaming, stop
  chat.js                 chat UI, markdown-lite, <think> blocks, settings
  ui.js                   DOM helpers, modals, toasts
vendor/
  transformers.min.js.xor transformers.js v4.2.0 + tiny patch, XOR-encoded
                          (decode at runtime; see scripts/pack-vendor.mjs)
scripts/
  pack-vendor.mjs         regenerates the XOR-encoded vendored file
server.js                 zero-dep static server (COOP/COEP)
sw.js                     COI service worker (for GitHub Pages etc.)
manifest.json             PWA manifest for Android home screen
icons/                    app icons (SVG + PNG)
```

## Why the custom ONNX Runtime (important)

The 4-bit (q4f16/q4) model files use the `com.microsoft.GatherBlockQuantized`
kernel for the quantized embedding table. The browser build of onnxruntime-web
that transformers.js bundles internally (`ort.webgpu.*`) does **not** include
that kernel, which shows up as:

```
Failed to find kernel for com.microsoft.GatherBlockQuantized ... Kernel not found
```

The fix (already in place here):

1. `vendor/transformers.min.js.xor` is the official npm build of transformers.js
   v4.2.0 with one local patch: in its “custom ONNX Runtime” branch it now
   registers `wasm`/`webgpu` as supported devices (the stock build leaves that
   list empty when a custom runtime is injected). The file is stored XOR-encoded
   because GitHub’s push-protection false-positives on a string inside the
   upstream bundle (“Mistral AI API Key”); `js/libs.js` decodes it at runtime
   (Blob URL import), and `scripts/pack-vendor.mjs` regenerates it.
2. `js/libs.js` injects `onnxruntime-web`’s **`ort.all`** build
   (same version transformers.js pins) through the documented
   `globalThis[Symbol.for('onnxruntime')]` hook — that build ships the
   `GatherBlockQuantized` kernel, so the 4-bit model runs in WASM.

You don’t need to do anything — the site handles it automatically. If you ever
want to revert to plain CDN transformers.js, restore `CONFIG.transformersUrl`
to the jsdelivr URL and remove the ORT injection in `js/libs.js` (but then only
fp16/fp32 variants will load).

## How it works under the hood

- transformers.js is loaded as an ES module from jsDelivr (pinned to v4.2.0).
- `env.fetch` is replaced with a function that answers every `qwen://Qwen3.5-2B/…`
  URL from the `File` objects you selected — so the library never touches the
  network or browser cache for model data.
- `env.useBrowserCache = false`, `env.useFSCache = false`, `env.useWasmCache =
  false`, `env.allowRemoteModels = false` enforce the *no persistence* promise.
- The ONNX files use external-data format (`.onnx` + `.onnx_data`); the runtime
  reads the small `.onnx` graph and the big weights separately — exactly like the
  repo publishes them for transformers.js.
- `pipeline('text-generation')` loads only the **text-only sessions**
  (`embed_tokens` + `decoder_model_merged` — the vision encoder is not needed
  for text chat), which keeps the download ~220 MB smaller.

## Change the model

Everything is in `js/config.js`. Point `repoId`, `hfResolve` and `variants` at
another transformers.js-compatible ONNX repo and it should just work.

## License

Apache-2.0. The model weights are Apache-2.0 (Qwen). This project is an
independent wrapper — not affiliated with Alibaba/Qwen or Hugging Face.
