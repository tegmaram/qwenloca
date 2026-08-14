/**
 * downloads.js — downloads the model files straight to the device
 * (Downloads folder on Android) using the browser's native downloader.
 *
 * The files are NOT stored inside the website: they land on your device,
 * so the next time you visit you just re-select them with the file picker.
 */

import { CONFIG, formatBytes } from './config.js';
import { el } from './ui.js';

export function fileUrl(name) {
  return CONFIG.hfResolve + name + '?download=true';
}

/** Programmatically tap a download link. */
export function triggerDownload(name) {
  const a = document.createElement('a');
  a.href = fileUrl(name);
  a.download = name;
  a.rel = 'noopener';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Download every file of a variant, one after another, using native
 * downloads (streamed to disk by the browser — no big blobs in memory).
 * The browser may ask "allow multiple downloads" once; if some files are
 * blocked, the UI keeps per-file buttons for manual taps.
 */
export async function downloadAll(files, { onFileStart = () => {}, onAllDone = () => {} } = {}) {
  for (const f of files) {
    onFileStart(f);
    triggerDownload(f.name);
    await new Promise((r) => setTimeout(r, 900)); // space the requests out
  }
  onAllDone(files);
}

/** Renders the download panel into a container. */
export function renderDownloadPanel(root, variantKey, { onDone, onLoadInstead }) {
  const variant = CONFIG.variants[variantKey];
  const files = variant.files;

  const total = files.reduce((a, f) => a + f.size, 0);
  const started = new Set();

  const rows = files.map((f) => {
    const state = el('span', { class: 'fstate' }, 'pending');
    const btn = el('a', {
      class: 'btn btn-secondary btn-sm',
      href: fileUrl(f.name),
      download: f.name,
      rel: 'noopener',
      target: '_blank',
      onClick: () => {
        started.add(f.name);
        row.classList.add('started');
        state.textContent = 'downloading…';
        setTimeout(() => {
          if (started.has(f.name)) state.textContent = 'check Downloads 📁';
        }, 2500);
      },
    }, 'Download');
    const row = el('div', { class: 'file-row' }, [
      el('span', { class: 'fname', text: f.name }),
      el('span', { class: 'fsize', text: formatBytes(f.size) }),
      state,
      btn,
    ]);
    return { row, state };
  });

  root.innerHTML = '';
  const card = el('section', { class: 'card wide' }, [
    el('p', { class: 'kicker' }, 'Step 1 of 2 · Download'),
    el('h1', { text: 'Download the model files' }),
    el('p', {
      html: `We’ll download <strong>${files.length} files</strong> (${formatBytes(total)}) from the
        <a href="${CONFIG.repoUrl}" target="_blank" rel="noopener">ONNX Community repo</a>.
        They land in your <strong>Downloads</strong> folder — the website itself never saves them.`,
    }),
    el('p', { class: 'small muted' }, `Variant: ${variant.label} — ${variant.tagline}`),
  ]);

  const list = el('div', {}, rows.map((r) => r.row));
  card.append(list);

  const note = el('div', { class: 'step-note' }, [
    el('p', { text: '💡 Tap “Download all” once. If Chrome asks “Allow multiple downloads?”, tap Allow. If a file is blocked, just tap its Download button again.' }),
  ]);
  card.append(note);

  const row = el('div', { class: 'btn-row' }, [
    el('button', {
      class: 'btn btn-primary btn-big',
      type: 'button',
      onClick: async () => {
        downloadAll(files, {
          onFileStart: (f) => {
            started.add(f.name);
            const i = files.indexOf(f);
            rows[i].state.textContent = 'download started…';
            rows[i].row.classList.add('started');
          },
        });
      },
    }, '⬇️ Download all'),
    el('button', {
      class: 'btn btn-secondary btn-big',
      type: 'button',
      onClick: () => onLoadInstead(),
    }, 'I already have the files'),
  ]);
  card.append(row);

  card.append(el('button', {
    class: 'btn btn-secondary btn-big',
    type: 'button',
    style: 'width:100%;margin-top:10px',
    onClick: () => {
      onDone(); // user believes files are downloaded -> go select them
    },
  }, '✓ Done — open file picker & load the model'));

  root.append(card);
  return { rows };
}
