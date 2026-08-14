/**
 * libs.js — lazy loader for the transformers.js library (ES module from CDN).
 *
 * transformers.js is the engine that runs the ONNX model (via onnxruntime-web
 * WASM). We load it as an ES module; jsdelivr rewrites its bare imports so it
 * works directly in the browser. All heavy lifting stays on the device.
 */
import { CONFIG } from './config.js';

let cache = null;

export async function loadTransformers() {
  if (!cache) {
    cache = import(/* webpackIgnore: true */ CONFIG.transformersCdn).catch((err) => {
      cache = null; // allow retry
      throw new Error(`Failed to load transformers.js from CDN: ${err.message}`);
    });
  }
  return cache;
}
