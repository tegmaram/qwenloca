/**
 * engine.js — creates the in-browser model (transformers.js pipeline) from
 * the locally selected files, and runs chat generation with streaming + stop.
 *
 * Key settings for the "no persistence" promise:
 *   - allowRemoteModels=false  → transformers.js never fetches from the Hub
 *   - useBrowserCache=false    → no IndexedDB / Cache-API storage of the model
 *   - useFSCache=false         → no filesystem cache
 *   - useWasmCache=false       → the WASM binary is not cached either
 *   - env.fetch=localFetcher   → all model files come from the File objects
 */
import { CONFIG } from './config.js';
import { loadTransformers } from './libs.js';
import { makeFetcher } from './fetcher.js';

let enginePromise = null;

/**
 * @param {FileStore} store  selected model files
 * @param {string} dtype     'q4f16' | 'q4' | ... (must match the selected files)
 */
export function createEngine(store, dtype, { onStatus = () => {}, onProgress = () => {} } = {}) {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const { env, pipeline, TextStreamer, StoppingCriteria } = await loadTransformers();

    // --- environment for a fully local, non-persistent model ---
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useFS = false; // model files only ever come through env.fetch (in-memory)
    env.useBrowserCache = false;
    env.useFSCache = false;
    env.useCustomCache = false;
    env.useWasmCache = false;
    env.fetch = makeFetcher(store, CONFIG.modelId);

    // WASM binaries: let onnxruntime-web pick single- vs multi-threaded
    // based on whether the page is cross-origin isolated (COOP/COEP).
    env.backends.onnx.wasm.wasmPaths = CONFIG.wasmPathsBase;
    const isolated =
      typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
    env.backends.onnx.wasm.numThreads = isolated
      ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
      : 1;

    onStatus('Starting the model engine (WASM)…');

    const generator = await pipeline('text-generation', CONFIG.modelId, {
      device: 'wasm',
      dtype,
      progress_callback: (p) => {
        if (p.status === 'progress') {
          onProgress({ file: p.file || '', loaded: p.loaded || 0, total: p.total || 0 });
        } else if (p.status === 'initiate') {
          onStatus(`Loading ${p.file || 'model'}…`);
        } else if (p.status === 'ready') {
          onStatus('Ready!');
        }
      },
    });

    return { generator, TextStreamer, StoppingCriteria };
  })();
  return enginePromise;
}

/** Abort support: a stopping criterion that trips when the user hits Stop. */
function makeAbortCriterion(StoppingCriteria, isAborted) {
  return new (class extends StoppingCriteria {
    _call() {
      return [isAborted()];
    }
  })();
}

/**
 * Generate a reply for a chat history. Streams text chunks via onDelta.
 * Returns the final assistant message string.
 */
export async function generateReply(engine, messages, {
  temperature = 0.7,
  topP = 0.9,
  maxNewTokens = 512,
  onDelta = () => {},
  isAborted = () => false,
} = {}) {
  const streamer = new engine.TextStreamer(engine.generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => onDelta(text),
  });

  const output = await engine.generator(messages, {
    temperature,
    top_p: topP,
    max_new_tokens: maxNewTokens,
    streamer,
    stopping_criteria: [makeAbortCriterion(engine.StoppingCriteria, isAborted)],
  });

  const generated = output && output[0] && output[0].generated_text;
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    return typeof last?.content === 'string' ? last.content : '';
  }
  return typeof generated === 'string' ? generated : '';
}

export function disposeEngine() {
  enginePromise = null;
}
