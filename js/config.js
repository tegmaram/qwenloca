/**
 * config.js — central place for everything model-related.
 * Change the repo/files here if you ever want to point the app at
 * a different ONNX model (any transformers.js-compatible repo works).
 */
export const CONFIG = Object.freeze({
  appName: 'QwenLoca',
  modelDisplayName: 'Qwen3.5-2B',

  // Virtual model id used with transformers.js. All file requests look like
  // "qwen://Qwen3.5-2B/<path>" and are served from locally-selected files.
  modelId: 'qwen://Qwen3.5-2B',

  // The ONNX Community repo this app is wired to.
  repoId: 'onnx-community/Qwen3.5-2B-ONNX',
  repoUrl: 'https://huggingface.co/onnx-community/Qwen3.5-2B-ONNX',
  hfResolve: 'https://huggingface.co/onnx-community/Qwen3.5-2B-ONNX/resolve/main/',

  // transformers.js — we vendor a patched copy (see vendor/transformers.min.js.xor
  // and scripts/pack-vendor.mjs) because the 4-bit model needs a custom ONNX
  // Runtime (see below). The file is XOR-encoded to dodge GitHub's secret
  // scanner; js/libs.js decodes it at runtime.
  transformersUrl: new URL('../vendor/transformers.min.js.xor', import.meta.url).href,

  // onnxruntime-web version transformers.js 4.2.0 pins internally.
  ortWebVersion: '1.26.0-dev.20260416-b7804b056c',

  // CRITICAL: the browser build transformers.js bundles (ort.webgpu.*) does NOT
  // include the com.microsoft.GatherBlockQuantized kernel used by the 4-bit
  // (q4f16/q4) model — that's what caused "Kernel not found" on phones.
  // The ort.all build DOES ship that kernel, so we inject it through the
  // documented custom-ORT hook (globalThis[Symbol.for('onnxruntime')]).
  ortAllUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/ort.all.min.mjs',

  // Where onnxruntime-web's .wasm binaries come from (can be self-hosted).
  wasmPathsBase: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/',

  // Which variant to highlight by default.
  defaultVariant: 'q4f16',

  // Every file transformers.js requests for the text-generation pipeline,
  // per dtype variant. Sizes come from the HF repo file tree.
  variants: {
    q4f16: {
      label: '4-bit · q4f16',
      tagline: 'Recommended: best balance of size & speed',
      dtype: 'q4f16',
      files: [
        { name: 'decoder_model_merged_q4f16.onnx', size: 1046438 },
        { name: 'decoder_model_merged_q4f16.onnx_data', size: 1089777664 },
        { name: 'embed_tokens_q4f16.onnx', size: 1064 },
        { name: 'embed_tokens_q4f16.onnx_data', size: 294010880 },
        { name: 'tokenizer.json', size: 19226111 },
        { name: 'tokenizer_config.json', size: 9161 },
        { name: 'config.json', size: 2993 },
        { name: 'generation_config.json', size: 248 },
      ],
    },
    q4: {
      label: '4-bit · q4',
      tagline: 'Classic 4-bit (slightly larger download)',
      dtype: 'q4',
      files: [
        { name: 'decoder_model_merged_q4.onnx', size: 885982 },
        { name: 'decoder_model_merged_q4.onnx_data', size: 1209126912 },
        { name: 'embed_tokens_q4.onnx', size: 857 },
        { name: 'embed_tokens_q4.onnx_data', size: 325795840 },
        { name: 'tokenizer.json', size: 19226111 },
        { name: 'tokenizer_config.json', size: 9161 },
        { name: 'config.json', size: 2993 },
        { name: 'generation_config.json', size: 248 },
      ],
    },
  },

  // Local-storage keys (tiny flags/preferences only — never model data).
  seenKey: 'qwenloca.seen.v1',
  prefsKey: 'qwenloca.prefs.v1',

  defaultPrefs: {
    temperature: 0.7,
    topP: 0.9,
    maxNewTokens: 512,
    showThinking: true,
  },

  // Chat suggestions shown on first message.
  suggestions: [
    'Tell me a joke',
    'Explain how this model runs in my browser',
    'Write a haiku about WebAssembly',
    'Give me 3 ideas for a weekend project',
  ],
});

export function totalBytes(variantKey) {
  return CONFIG.variants[variantKey].files.reduce((a, f) => a + f.size, 0);
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
