/**
 * app.js — entry point. Wires the onboarding wizard, the file picker,
 * the model engine and the chat screen together.
 *
 * Design notes:
 *  - The model is NEVER stored by the site (no IndexedDB/Cache-API). The
 *    “have you visited” flag is the only thing kept (a few bytes in
 *    localStorage) so we can greet returning visitors properly.
 *  - The engine is built lazily from the files the user selects each visit.
 */
import { CONFIG } from './config.js';
import { FileStore } from './fetcher.js';
import { createEngine, disposeEngine } from './engine.js';
import { ChatUI } from './chat.js';
import {
  showWelcome, showAskFiles, showDownload, showLoading, showPickPrompt,
  showLoadError, confirmRedownload, toastError,
} from './wizard.js';
import { detectVariant, missingFiles, requiredNames, mixExplanation } from './model-files.js';
import { confirmDialog, toast, el, openModal } from './ui.js';

const wizardRoot = document.getElementById('wizard-root');
const chatRoot = document.getElementById('chat-root');
const headerStatus = document.getElementById('header-status');
const headerActions = document.getElementById('header-actions');
const modelMenu = document.getElementById('model-menu');
const btnModelMenu = document.getElementById('btn-model-menu');
const btnNewChat = document.getElementById('btn-new-chat');

const store = new FileStore();
let chat = null;        // ChatUI instance
let currentVariant = CONFIG.defaultVariant;
let addMode = false;    // next file-pick ADDS to the store instead of replacing it
let activeFileInput = null; // current (fresh) <input type="file"> element

// ---------------------------------------------------------------- helpers

function isFirstVisit() {
  try {
    return !localStorage.getItem(CONFIG.seenKey);
  } catch {
    return true; // storage unavailable → always treat as returning flow
  }
}

function markVisited() {
  try { localStorage.setItem(CONFIG.seenKey, '1'); } catch { /* ignore */ }
}

function setHeaderStatus(text, kind) {
  headerStatus.hidden = false;
  headerStatus.innerHTML = '';
  headerStatus.append(
    el('span', { class: 'status-dot ' + (kind || '') }),
    el('span', { text: text }),
  );
}

function hideHeaderStatus() {
  headerStatus.hidden = true;
}

function showChatScreen() {
  wizardRoot.hidden = true;
  chatRoot.hidden = false;
  headerActions.hidden = false;
}

function showWizardScreen() {
  wizardRoot.hidden = false;
  chatRoot.hidden = true;
  headerActions.hidden = true;
  hideHeaderStatus();
}

/**
 * Open the system file manager.
 *
 * IMPORTANT: a FRESH <input type="file"> element is created on every call.
 * Android Chrome has a known bug where reusing the same input element
 * silently skips the 'change' event on the second pick — which made the
 * "missing files" screen never update. A new element per pick fixes it.
 * We also intentionally omit the `accept` attribute, because Android file
 * pickers often grey out .onnx / .onnx_data files when a filter is present.
 */
function openFilePicker(mode) {
  addMode = mode === 'add';

  if (activeFileInput) {
    try { activeFileInput.remove(); } catch { /* ignore */ }
    activeFileInput = null;
  }

  const input = document.createElement('input');
  activeFileInput = input;
  input.type = 'file';
  input.multiple = true; // no `accept` — see note above
  input.style.display = 'none';
  input.addEventListener('change', () => {
    if (activeFileInput === input) activeFileInput = null;
    try { input.remove(); } catch { /* ignore */ }
    if (input.files && input.files.length > 0) {
      handleFilesSelected(input.files);
    }
  });
  document.body.appendChild(input);
  input.click();
}

// ---------------------------------------------------------------- flows

/** Entry point after DOM ready. */
async function boot() {
  try {
    if (isFirstVisit()) {
      showWelcome({ onDownload: () => startDownloadFlow() });
    } else {
      showAskFiles({
        onHaveFiles: () => {
          markVisited();
          openFilePicker(); // user gesture → file manager opens right away
        },
        onNoFiles: async () => {
          if (await confirmRedownload(currentVariant)) {
            startDownloadFlow();
          } else {
            showAskFiles({
              onHaveFiles: () => {
                markVisited();
                openFilePicker();
              },
              onNoFiles: () => boot(),
            });
          }
        },
      });
    }
  } catch (err) {
    console.error(err);
  }
}

/** Download flow: download screen → select files → load → chat. */
function startDownloadFlow() {
  markVisited();
  showDownload(currentVariant, {
    onDone: () => startSelectFlow(),
    onLoadInstead: () => startSelectFlow(),
  });
}

/** File-selection flow: pick files → validate → load → chat. */
function startSelectFlow() {
  markVisited();
  showPickPrompt({
    onPick: () => openFilePicker('replace'),
    onDownload: () => startDownloadFlow(),
  });
}

function handleFilesSelected(fileList) {
  const incoming = Array.from(fileList || []);

  if (addMode) {
    // Add mode: keep everything already selected, just merge the new files in.
    let added = 0;
    let dupes = 0;
    for (const file of incoming) {
      if (!store.has(file.name)) {
        store.add(file);
        added += 1;
      } else {
        dupes += 1;
      }
    }
    if (added > 0) toast(`Added ${added} file${added === 1 ? '' : 's'} ✓`, 'ok');
    else if (dupes > 0) toast('Those files were already in your selection.', '');
  } else {
    store.clear();
    for (const file of incoming) store.add(file);
  }
  addMode = false;

  const variant = detectVariant(store);

  // Mixed variants (decoder from one, embeddings from another) — very common
  // on Android when the Downloads folder holds several download attempts.
  if (variant && variant.warn && typeof variant.warn === 'string' && variant.warn.startsWith('mix:')) {
    showLoadError({
      message: mixExplanation(variant.warn),
      found: requiredNames(CONFIG.defaultVariant).filter((n) => store.has(n)),
      missing: missingFiles(store, CONFIG.defaultVariant),
      onRetry: () => openFilePicker('replace'),
      onDownload: () => startDownloadFlow(),
      onBack: () => boot(),
    });
    return;
  }

  // Variant we don't support (fp32 / fp16 / q8 ...) — loading it would likely
  // crash the phone, so tell the user to get the 4-bit variant instead.
  if (variant && !Object.values(CONFIG.variants).some((v) => v.dtype === variant.dtype)) {
    showLoadError({
      message:
        `You selected the <strong>${variant.label}</strong> variant, which this app doesn’t support on phones. ` +
        (variant.warn ? `${variant.warn} ` : '') +
        'Please download the recommended 4-bit (q4f16) variant and select those files instead.',
      onRetry: () => openFilePicker('replace'),
      onDownload: () => startDownloadFlow(),
      onBack: () => boot(),
    });
    return;
  }

  if (!variant) {
    const missing = missingFiles(store, CONFIG.defaultVariant);
    showLoadError({
      message:
        'We couldn’t find the model file (<code>decoder_model_merged_….onnx</code>) in your selection. ' +
        'Please select all the files you downloaded — the <code>.onnx</code>, <code>.onnx_data</code> and <code>.json</code> files.',
      found: requiredNames(CONFIG.defaultVariant).filter((n) => store.has(n)),
      missing,
      onSelectMissing: missing.length ? () => openFilePicker('add') : null,
      onRetry: () => openFilePicker('replace'),
      onDownload: () => startDownloadFlow(),
      onBack: () => boot(),
    });
    return;
  }

  if (variant.warn) {
    // still allow, but tell the user
    toast(variant.warn, 'error');
  }

  // Find which configured variant matches the selected dtype (or use default).
  const variantKey = Object.keys(CONFIG.variants).find((k) => CONFIG.variants[k].dtype === variant.dtype);
  const effectiveVariant = variantKey || CONFIG.defaultVariant;
  currentVariant = effectiveVariant;

  const missing = missingFiles(store, effectiveVariant);
  if (missing.length > 0) {
    showLoadError({
      message:
        `Almost there — ${missing.length} file${missing.length === 1 ? '' : 's'} still missing from your selection. ` +
        'Tap <strong>“Select these files”</strong> to add just the missing ones (no need to re-pick everything).',
      found: requiredNames(effectiveVariant).filter((n) => store.has(n)),
      missing,
      onSelectMissing: () => openFilePicker('add'),
      onRetry: () => openFilePicker('replace'),
      onDownload: () => startDownloadFlow(),
      onBack: () => boot(),
    });
    return;
  }

  void loadModel(store, CONFIG.variants[effectiveVariant].dtype);
}

/** Build the engine from the store, then hand over to the chat screen. */
async function loadModel(files, dtype) {
  markVisited();
  disposeEngine(); // free the previous session (files/variant may have changed)
  showWizardScreen();
  const loading = showLoading({ variantKey: currentVariant, onCancel: () => boot() });

  let lastPct = 0;
  try {
    const engine = await createEngine(files, dtype, {
      onStatus: (msg) => loading.setStatus(msg),
      onProgress: ({ file, loaded, total }) => {
        const pct = total ? Math.round((loaded / total) * 100) : 0;
        const name = (file || '').split('/').pop();
        loading.setProgress(Math.max(lastPct, pct), `Reading ${name}… ${pct}%`);
        lastPct = Math.max(lastPct, pct);
      },
    });

    setHeaderStatus('running locally · WASM', 'ok');
    chat = new ChatUI(engine);
    showChatScreen();
  } catch (err) {
    console.error('QwenLoca model load failed:', err);
    disposeEngine();

    // Figure out exactly which file was missing (transformers.js puts the
    // failing qwen:// URL inside the error message).
    const failing = extractFailingFile(err);
    const variantKey = Object.keys(CONFIG.variants).find((k) => CONFIG.variants[k].dtype === dtype);
    const vKey = variantKey || currentVariant;
    const missing = failing ? [failing] : missingFiles(store, vKey);

    let message;
    if (missing.length > 0) {
      const names = missing.map((n) => `<code>${escHtml(n)}</code>`).join(', ');
      message =
        `Almost there — ${missing.length === 1 ? '1 file is' : `${missing.length} files are`} still missing from your selection: ${names}. ` +
        'Tap <strong>“Select these files”</strong> to add them (your current selection is kept).';
    } else {
      message = `The model couldn’t start: ${escHtml(err?.message || err)}`;
    }
    message += '<br><br><span class="small muted">Tip: 4-bit (q4f16) is the recommended variant for phones.</span>';

    showLoadError({
      message,
      found: requiredNames(vKey).filter((n) => store.has(n)),
      missing,
      onSelectMissing: missing.length ? () => openFilePicker('add') : null,
      onRetry: () => openFilePicker('replace'),
      onDownload: () => startDownloadFlow(),
      onBack: () => boot(),
      details: err?.message || String(err),
    });
  }
}

/** Pull the failing model-file name out of a transformers.js error message. */
function extractFailingFile(err) {
  if (!err || typeof err.message !== 'string') return null;
  const m = err.message.match(/qwen:\/\/[^/\s]+(?:\/[^/\s"']+)*\/([^/\s"']+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------- events



btnNewChat.addEventListener('click', () => {
  if (!chat) return;
  chat.clear();
  toast('New chat started ✨', 'ok');
});

btnModelMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  modelMenu.hidden = !modelMenu.hidden;
});

document.addEventListener('click', (e) => {
  if (!modelMenu.hidden && !modelMenu.contains(e.target) && e.target !== btnModelMenu) {
    modelMenu.hidden = true;
  }
});

modelMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  modelMenu.hidden = true;
  const action = btn.dataset.action;
  if (action === 'reload-files') {
    void confirmDialog({
      title: 'Load model files again',
      message: 'This replaces the current model with files you pick now. The chat history will be cleared.',
      yesLabel: 'Pick files',
    }).then((ok) => ok && startSelectFlow());
  } else if (action === 'redownload') {
    void confirmRedownload(currentVariant).then((ok) => ok && startDownloadFlow());
  } else if (action === 'settings') {
    chat?.showSettings();
  } else if (action === 'info') {
    showInfoModal();
  }
});

function showInfoModal() {
  openModal({
    title: 'About QwenLoca',
    body: el('div', {}, [
      el('p', { html: `This is <strong>${CONFIG.modelDisplayName}</strong> (ONNX) running <strong>100% locally</strong> in your browser via WebAssembly — powered by <a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noopener">transformers.js</a> + <a href="https://onnxruntime.ai" target="_blank" rel="noopener">ONNX Runtime Web</a>.` }),
      el('p', { html: `Model repo: <a href="${CONFIG.repoUrl}" target="_blank" rel="noopener">${CONFIG.repoId}</a>` }),
      el('p', { class: 'small muted', text: 'Privacy: nothing you type is sent to any server. The model files are loaded from your device every visit and are never stored by this website (only a tiny “visited” flag is kept in localStorage).' }),
    ]),
    buttons: [{ label: 'Close', class: 'btn btn-primary' }],
    wide: true,
  });
}

// ---------------------------------------------------------------- start

boot();
