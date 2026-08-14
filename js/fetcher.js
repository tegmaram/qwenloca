/**
 * fetcher.js — serves the user-selected model files to transformers.js.
 *
 * transformers.js resolves every model file to a URL like
 *   "qwen://Qwen3.5-2B/onnx/decoder_model_merged_q4f16.onnx"
 * We install a custom `env.fetch` that answers those URLs straight from the
 * File objects the user picked — no server, no browser storage involved.
 */

/** Normalize a file name for matching ("file (1).onnx" → "file.onnx"). */
export function normalizeName(name) {
  let n = String(name).trim();
  n = n.replace(/\s*\(\d+\)\s*$/i, '');   // "file (1).onnx"
  n = n.replace(/\s+copy\s*$/i, '');      // "file copy.onnx"
  n = n.replace(/^copy\s+of\s+/i, '');    // "copy of file.onnx"
  n = n.replace(/^\.\//, '');
  return n.toLowerCase();
}

/** In-memory store of the Files the user selected (by normalized basename). */
export class FileStore {
  constructor() {
    this.byName = new Map(); // normalized basename -> File
    this.list = [];          // all selected files (insertion order)
  }

  add(file) {
    const key = normalizeName(file.name);
    if (!this.byName.has(key)) this.list.push(file);
    this.byName.set(key, file);
  }

  get(name) {
    return this.byName.get(normalizeName(name));
  }

  has(name) {
    return this.byName.has(normalizeName(name));
  }

  clear() {
    this.byName.clear();
    this.list = [];
  }

  get size() {
    return this.list.length;
  }
}

/** Build the fetch function transformers.js will use (assign to env.fetch). */
export function makeFetcher(store, modelUrl) {
  const realFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;

  return async function localFetcher(url, init = {}) {
    const u = String(url);
    if (u === modelUrl || u.startsWith(modelUrl + '/')) {
      const rel = u.slice(modelUrl.length + 1);
      const base = rel.split('/').pop(); // e.g. "decoder_model_merged_q4f16.onnx_data"
      const file = store.get(base);
      if (file) {
        return new Response(file, {
          status: 200,
          headers: {
            'content-length': String(file.size),
            'content-type': 'application/octet-stream',
          },
        });
      }
      return new Response(`Model file not found in your selection: ${base}`, { status: 404 });
    }
    if (realFetch) return realFetch(u, init);
    throw new Error(`No fetch available for ${u}`);
  };
}
