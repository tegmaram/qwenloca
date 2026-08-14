/**
 * wizard.js — onboarding screens.
 *
 * Flow per the design:
 *   first visit  → “Oh, your first time here! 👋 Wanna download the model?
 *                   Yes or yes (both are yes, but you need to click it)”
 *   later visits → “Do you still have the model files?”  Yes → file picker
 *                  No → “Are you sure you want to download the model?” Yes!
 */
import { CONFIG, formatBytes, totalBytes } from './config.js';
import { renderDownloadPanel } from './downloads.js';
import { el, clear, confirmDialog, toast } from './ui.js';

const root = () => document.getElementById('wizard-root');

/** “Oh, your first time here!” — both buttons are Yes. */
export function showWelcome({ onDownload }) {
  clear(root());
  const card = el('section', { class: 'card' }, [
    el('p', { class: 'kicker' }, 'First time here'),
    el('h1', { text: 'Oh, your first time here! 👋' }),
    el('p', { class: 'lead', html: 'Welcome to <strong>QwenLoca</strong> — a real <strong>Qwen3.5-2B</strong> AI chat that runs <em>entirely in your browser</em> via WebAssembly. No servers, no accounts, no data leaving your device.' }),
    el('p', { html: `To work, the site needs the model files (<strong>${formatBytes(totalBytes(CONFIG.defaultVariant))}</strong>) from the <a href="${CONFIG.repoUrl}" target="_blank" rel="noopener">ONNX Community</a>. They download to your device — the website itself never stores them.` }),
    el('div', { class: 'step-note' }, [
      el('p', { text: 'Wanna download the model? Yes or yes. (Both buttons are yes — you just have to click one. 😄)' }),
    ]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-primary btn-big', type: 'button', onClick: () => onDownload() }, 'Yes — download the model 😍'),
      el('button', { class: 'btn btn-secondary btn-big', type: 'button', onClick: () => onDownload() }, 'Yes — download it 💪'),
    ]),
  ]);
  root().append(card);
}

/** Returning visit: “Do you still have the model files?” */
export function showAskFiles({ onHaveFiles, onNoFiles }) {
  clear(root());
  const card = el('section', { class: 'card' }, [
    el('p', { class: 'kicker' }, 'Welcome back'),
    el('h1', { text: 'Hey again! 👋' }),
    el('p', { class: 'lead', text: 'Do you still have the model files on this device?' }),
    el('p', { class: 'small muted', text: 'They’re the files that were downloaded to your Downloads folder last time (about 1.3 GB).' }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-primary btn-big', type: 'button', onClick: () => onHaveFiles() }, 'Yes, I have them 📁'),
      el('button', { class: 'btn btn-secondary btn-big', type: 'button', onClick: () => onNoFiles() }, 'No, I don’t ❌'),
    ]),
  ]);
  root().append(card);
}

/** Download screen for a variant. */
export function showDownload(variantKey, { onDone, onLoadInstead }) {
  clear(root());
  renderDownloadPanel(root(), variantKey, { onDone, onLoadInstead });
}

/** Confirm-before-redownload modal. */
export async function confirmRedownload(variantKey) {
  const ok = await confirmDialog({
    title: 'Download the model again?',
    message: `Are you sure you want to download the model again? It’s about <strong>${formatBytes(totalBytes(variantKey))}</strong>. The files will go to your Downloads folder.`,
    yesLabel: 'Yes! ⬇️',
    noLabel: 'Actually no',
    danger: false,
  });
  return ok;
}

/** Loading screen while the model is read into WASM memory. */
export function showLoading({ variantKey, onCancel }) {
  clear(root());
  const fill = el('div', { class: 'progress-fill' });
  const label = el('div', { class: 'progress-label' }, 'Starting…');
  const card = el('section', { class: 'card' }, [
    el('p', { class: 'kicker' }, 'Step 2 of 2 · Load'),
    el('h1', { text: 'Loading the model…' }),
    el('p', { class: 'small muted', text: `Reading ${formatBytes(totalBytes(variantKey))} into WebAssembly memory. Keep this tab open — it can take a minute or two on a phone.` }),
    el('div', { class: 'progress-track' }, fill),
    label,
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', onClick: () => onCancel() }, 'Cancel'),
    ]),
  ]);
  root().append(card);
  return {
    setStatus(msg) { label.textContent = msg; },
    setProgress(pct, msg) {
      fill.style.width = Math.max(2, Math.min(100, pct)) + '%';
      if (msg) label.textContent = msg;
    },
  };
}

/** A simple “pick your files” helper card (shown when file dialog is skipped). */
export function showPickPrompt({ onPick, onDownload, message }) {
  clear(root());
  const card = el('section', { class: 'card' }, [
    el('p', { class: 'kicker' }, 'Select the model files'),
    el('h1', { text: 'Time to load the model' }),
    el('p', { html: message || 'Open your file manager and select <strong>all</strong> the model files you downloaded (the <code>.onnx</code>, <code>.onnx_data</code> and <code>.json</code> files).' }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-primary btn-big', type: 'button', onClick: () => onPick() }, '📂 Open file manager'),
      el('button', { class: 'btn btn-secondary btn-big', type: 'button', onClick: () => onDownload() }, '⬇️ Download instead'),
    ]),
  ]);
  root().append(card);
}

/**
 * Error screen after a failed load / incomplete selection.
 * @param {object} opts
 * @param {string} opts.message
 * @param {string[]} [opts.found]  files already in the selection
 * @param {string[]} [opts.missing] files still needed
 * @param {Function} [opts.onSelectMissing] picks ONLY the missing files (add mode)
 */
export function showLoadError({ message, onRetry, onDownload, onBack, onSelectMissing = null, found = [], missing = [] }) {
  clear(root());

  const body = [el('p', { html: message })];

  if (found.length || missing.length) {
    const summary = el('div', { class: 'selection-summary' }, []);
    if (found.length) {
      summary.append(el('div', { class: 'sum-col' }, [
        el('p', { class: 'sum-title ok', text: `✓ Found (${found.length})` }),
        el('ul', { class: 'sum-list' }, found.map((n) => el('li', { text: n }))),
      ]));
    }
    if (missing.length) {
      summary.append(el('div', { class: 'sum-col' }, [
        el('p', { class: 'sum-title bad', text: `✗ Missing (${missing.length})` }),
        el('ul', { class: 'sum-list' }, missing.map((n) => el('li', { text: n }))),
      ]));
    }
    body.push(summary);
  }

  const buttons = [];
  if (onSelectMissing && missing.length) {
    buttons.push(
      el('button', { class: 'btn btn-primary btn-big', type: 'button', onClick: () => onSelectMissing() },
        `📎 Select these files`),
    );
  }
  if (onRetry) {
    buttons.push(
      el('button', { class: 'btn btn-secondary btn-big', type: 'button', onClick: () => onRetry() },
        '🔁 Pick files again'),
    );
  }
  if (onDownload) {
    buttons.push(
      el('button', { class: 'btn btn-secondary btn-big', type: 'button', onClick: () => onDownload() },
        '⬇️ Download the model'),
    );
  }
  if (onBack) {
    buttons.push(
      el('button', { class: 'btn btn-ghost', type: 'button', onClick: () => onBack() }, '← Back'),
    );
  }
  if (onSelectMissing && missing.length) {
    body.push(el('p', { class: 'small muted' }, '💡 “Select these files” only asks for the missing ones — your current selection is kept, so you don’t have to pick everything again.'));
  }

  const card = el('section', { class: 'card' }, [
    el('p', { class: 'kicker' }, 'Something went wrong'),
    el('h1', { text: 'Could not load the model 😕' }),
    ...body,
    el('div', { class: 'btn-row' }, buttons),
  ]);
  root().append(card);
}

export function toastError(msg) {
  toast(msg, 'error');
}
