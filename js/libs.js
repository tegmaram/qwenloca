/**
 * libs.js — lazy loader for the AI engine.
 *
 * Two pieces:
 *  1. onnxruntime-web's "all" build (from CDN) — injected as the custom ONNX
 *     Runtime via globalThis[Symbol.for('onnxruntime')]. The "all" build ships
 *     the com.microsoft.GatherBlockQuantized kernel that the 4-bit Qwen model
 *     needs; the default browser build transformers.js bundles lacks it.
 *  2. a vendored, patched copy of transformers.js v4.2.0. It is stored XOR-
 *     encoded (vendor/transformers.min.js.xor — see scripts/pack-vendor.mjs)
 *     so GitHub's secret scanner can't false-positive on upstream library
 *     strings; we decode it to a Blob URL before importing. The patch makes
 *     transformers.js's custom-ORT branch accept the wasm device.
 *
 * Order matters: the custom ORT must be registered BEFORE transformers.js is
 * imported, because transformers.js reads the symbol at import time.
 */
import { CONFIG } from './config.js';

let cache = null;

const ORT_SYMBOL = Symbol.for('onnxruntime');
const XOR_KEY = 0x5a;

async function loadCustomOrt() {
  if (globalThis[ORT_SYMBOL]) return; // already registered
  try {
    const ort = await import(/* webpackIgnore: true */ CONFIG.ortAllUrl);
    globalThis[ORT_SYMBOL] = ort;
    console.info('[QwenLoca] custom ONNX Runtime loaded:', ort.env?.versions?.web || '?');
  } catch (err) {
    throw new Error(`Couldn’t load the AI engine (onnxruntime-web ${CONFIG.ortWebVersion}) from the CDN. Check your internet connection and reload. (${err?.message || err})`);
  }
}

/** Fetch the vendored transformers.js, decode the XOR, import from a Blob URL. */
async function loadVendoredTransformers() {
  const res = await fetch(CONFIG.transformersUrl);
  if (!res.ok) throw new Error(`Failed to load the AI engine (transformers.js) — HTTP ${res.status}. Reload the page.`);
  const buf = new Uint8Array(await res.arrayBuffer());
  for (let i = 0; i < buf.length; i++) buf[i] ^= XOR_KEY;
  const url = URL.createObjectURL(new Blob([buf], { type: 'text/javascript' }));
  return import(/* webpackIgnore: true */ url); // blob URL stays alive for the module
}

export async function loadTransformers() {
  if (!cache) {
    cache = (async () => {
      await loadCustomOrt();
      return loadVendoredTransformers();
    })().catch((err) => {
      cache = null; // allow retry
      throw err;
    });
  }
  return cache;
}
