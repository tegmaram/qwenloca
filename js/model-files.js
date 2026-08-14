/**
 * model-files.js — maps selected Files to the exact files transformers.js
 * requests, and detects which quantized variant the user downloaded.
 */
import { CONFIG, formatBytes } from './config.js';

const SUFFIX_TO_DTYPE = {
  '': 'fp32',
  _fp16: 'fp16',
  _quantized: 'q8',
  _q4: 'q4',
  _q4f16: 'q4f16',
};

/** Which file names are required for a variant to load. */
export function requiredNames(variantKey) {
  return CONFIG.variants[variantKey].files.map((f) => f.name);
}

/** Files (of a variant) missing from the store. */
export function missingFiles(store, variantKey) {
  return requiredNames(variantKey).filter((name) => !store.has(name));
}

/**
 * Detect the dtype from the selected decoder model file name.
 * Returns { dtype, label, warn } or null if no decoder file was selected.
 *
 * `warn` may be:
 *   - "mix:<decoderDtype>:<embedDtype>" — files from two different variants
 *   - a human-readable warning for heavy variants (fp32/q8)
 */
export function detectVariant(store) {
  const decoder = store.list.find((f) => /^decoder_model_merged.*\.onnx$/i.test(f.name));
  if (!decoder) return null;
  const m = /^decoder_model_merged(.*)\.onnx$/i.exec(decoder.name);
  const suffix = (m ? m[1] : '').toLowerCase();
  const dtype = SUFFIX_TO_DTYPE[suffix];

  // Check the embeddings file matches the same variant.
  const embed = store.list.find((f) => /^embed_tokens.*\.onnx$/i.test(f.name));
  let embedDtype = null;
  if (embed) {
    const em = /^embed_tokens(.*)\.onnx$/i.exec(embed.name);
    embedDtype = SUFFIX_TO_DTYPE[(em ? em[1] : '').toLowerCase()] ?? null;
  }

  if (!dtype) return { dtype: null, label: `"${decoder.name}"`, warn: `Unknown model file variant "${decoder.name}".` };

  let warn = null;
  if (embedDtype && embedDtype !== dtype) {
    warn = `mix:${dtype}:${embedDtype}`;
  } else if (dtype === 'fp32') {
    warn =
      'You selected the full-precision (fp32) model — it is about 9.5 GB and will very likely crash phones. The 4-bit variant is recommended.';
  } else if (dtype === 'q8') {
    warn =
      'You selected the int8 (quantized) model (~2.2 GB). It works, but the 4-bit variant is faster and smaller.';
  }

  return { dtype, label: dtype, warn };
}

/** Human-readable "mix" explanation. */
export function mixExplanation(warn) {
  if (typeof warn !== 'string' || !warn.startsWith('mix:')) return null;
  const [, decoder, embed] = warn.split(':');
  return (
    `Your selection mixes two variants: the <strong>decoder</strong> is <code>${decoder}</code> but the ` +
    `<strong>embeddings</strong> are <code>${embed}</code>. All files must come from the <em>same</em> variant. ` +
    'Tap <strong>“Pick files again”</strong> and select only the files of one variant (preferably q4f16).'
  );
}

/** Total size of the selected files the engine will need (approx). */
export function selectedSize(store, variantKey) {
  return CONFIG.variants[variantKey].files.reduce((acc, f) => {
    const file = store.get(f.name);
    return acc + (file ? file.size : 0);
  }, 0);
}

export function describeMissing(names) {
  return names.map((n) => `• <span class="code-block" style="display:inline">${n}</span>`).join('<br>');
}

export function formatSizeHint(store, variantKey) {
  return formatBytes(selectedSize(store, variantKey));
}
