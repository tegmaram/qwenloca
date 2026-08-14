/**
 * ui.js — tiny DOM + UI helpers (elements, modals, toasts).
 */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    const isNode = typeof Node !== 'undefined' && c instanceof Node;
    node.append(isNode ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Open a centered modal. Returns { close, root }. */
export function openModal({ title, body, buttons = [], onClose = null, wide = false }) {
  const root = document.getElementById('modal-root');
  const modal = el('div', { class: 'modal' + (wide ? ' wide' : '') });
  if (title) modal.append(el('h3', { text: title }));
  if (body) modal.append(body);

  const row = el('div', { class: 'btn-row' });
  const close = () => {
    backdrop.remove();
    onClose && onClose();
  };

  for (const b of buttons) {
    row.append(
      el('button', {
        class: b.class || 'btn btn-secondary',
        type: 'button',
        onClick: () => {
          b.onClick && b.onClick(); // run the action FIRST so it settles the promise
          if (b.close !== false) close();
        },
      }, b.label),
    );
  }
  if (row.childNodes.length) modal.append(row);

  const backdrop = el('div', { class: 'modal-backdrop', onClick: (e) => {
    if (e.target === backdrop && onClose) close(); // click outside closes only if onClose provided
  } });
  backdrop.append(modal);
  root.append(backdrop);
  return { close, root: modal };
}

/** Ask a yes/no question. Resolves with true/false. */
export function confirmDialog({ title, message, yesLabel = 'Yes', noLabel = 'No', danger = false, wide = false }) {
  return new Promise((resolve) => {
    const body = el('div', {}, [el('p', { html: message })]);
    openModal({
      title,
      body,
      wide,
      buttons: [
        { label: noLabel, class: 'btn btn-secondary', onClick: () => resolve(false) },
        { label: yesLabel, class: danger ? 'btn btn-danger' : 'btn btn-primary', onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

/** Show a toast notification. */
export function toast(message, kind = '') {
  const root = document.getElementById('toast-root');
  const t = el('div', { class: 'toast ' + kind, text: message });
  root.append(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.4s';
    setTimeout(() => t.remove(), 420);
  }, 4200);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
