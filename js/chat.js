/**
 * chat.js — the chat screen: message list, streaming render, markdown-lite,
 * think-blocks, composer, settings.
 */
import { CONFIG } from './config.js';
import { generateReply } from './engine.js';
import { el, clear, openModal, toast } from './ui.js';

const SYSTEM_PROMPT =
  'You are Qwen, created by Alibaba Cloud. You are a helpful assistant running locally in the user\'s browser. Be concise, friendly, and accurate.';

export class ChatUI {
  /**
   * @param {object} engine  { generator, TextStreamer, StoppingCriteria }
   */
  constructor(engine) {
    this.engine = engine;
    this.history = [{ role: 'system', content: SYSTEM_PROMPT }];
    this.generating = false;
    this.aborted = false;
    this.els = {
      scroll: document.getElementById('chat-scroll'),
      messages: document.getElementById('chat-messages'),
      composer: document.getElementById('composer'),
      send: document.getElementById('btn-send'),
      stop: document.getElementById('btn-stop'),
    };

    this.els.send.addEventListener('click', () => this.submit());
    this.els.stop.addEventListener('click', () => this.stop());
    this.els.composer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.submit();
      }
    });
    this.els.composer.addEventListener('input', () => this._autosize());

    this._addWelcome();
  }

  // ---------------- rendering helpers ----------------

  _addWelcome() {
    const wrap = el('div', { class: 'msg bot welcome-msg' }, [
      el('div', { class: 'avatar' }, '◈'),
      el('div', { class: 'bubble' }, [
        el('h3', { text: `Hi! I'm ${CONFIG.modelDisplayName} 👋` }),
        el('p', { html: 'I’m running <strong>100% on your device</strong> (WebAssembly + ONNX). No internet needed after this page loads, and nothing you type is sent anywhere. Try one of these:' }),
        el('div', { class: 'chip-row' }, CONFIG.suggestions.map((s) =>
          el('button', { class: 'chip', type: 'button', onClick: () => this.submit(s) }, s),
        )),
      ]),
    ]);
    this.els.messages.append(wrap);
  }

  _addUserMessage(text) {
    this.els.messages.append(el('div', { class: 'msg user' }, [
      el('div', { class: 'avatar' }, '🙂'),
      el('div', { class: 'bubble' }, el('p', { text: text })),
    ]));
  }

  _addAssistantBubble() {
    const bubble = el('div', { class: 'bubble streaming' }, '');
    const msg = el('div', { class: 'msg bot' }, [
      el('div', { class: 'avatar' }, '◈'),
      bubble,
    ]);
    this.els.messages.append(msg);
    this._scrollDown();
    return { msg, bubble };
  }

  _scrollDown() {
    requestAnimationFrame(() => {
      this.els.scroll.scrollTop = this.els.scroll.scrollHeight;
    });
  }

  // ---------------- actions ----------------

  submit(presetText) {
    if (this.generating) return;
    const text = (presetText ?? this.els.composer.value).trim();
    if (!text) return;

    this.els.composer.value = '';
    this._autosize();
    this.history.push({ role: 'user', content: text });
    this._addUserMessage(text);
    void this._run();
  }

  stop() {
    this.aborted = true; // generation halts at the next token (stopping criterion)
  }

  async _run() {
    this.generating = true;
    this.aborted = false;
    this.els.send.hidden = true;
    this.els.stop.hidden = false;

    const { bubble } = this._addAssistantBubble();
    let raw = '';
    let rafPending = false;

    const render = () => {
      rafPending = false;
      bubble.innerHTML = renderMarkdown(raw);
      this._scrollDown();
    };
    const scheduleRender = () => {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(render);
      }
    };

    const prefs = this.prefs;
    try {
      const finalText = await generateReply(this.engine, this.history, {
        temperature: prefs.temperature,
        topP: prefs.topP,
        maxNewTokens: prefs.maxNewTokens,
        onDelta: (chunk) => {
          raw += chunk;
          scheduleRender();
        },
        isAborted: () => this.aborted,
      });

      if (this.aborted) {
        if (!raw) raw = '*(stopped)*';
        toast('Generation stopped.');
      } else if (finalText && !raw) {
        raw = finalText; // fallback if the streamer produced nothing
      }

      // Remove the assistant turn we pushed optimistically; keep model output only.
      this.history.push({ role: 'assistant', content: raw || finalText || '' });
    } catch (err) {
      console.error(err);
      raw = `⚠️ Generation failed: ${err.message || err}`;
      toast('Generation failed — see message.', 'error');
      this.history.push({ role: 'assistant', content: raw });
    } finally {
      this.generating = false;
      this.aborted = false;
      bubble.classList.remove('streaming');
      render();
      this.els.send.hidden = false;
      this.els.stop.hidden = true;
      this.els.composer.focus();
    }
  }

  clear() {
    clear(this.els.messages);
    this.history = [{ role: 'system', content: SYSTEM_PROMPT }];
    this._addWelcome();
  }

  _autosize() {
    const c = this.els.composer;
    c.style.height = 'auto';
    c.style.height = Math.min(c.scrollHeight, 160) + 'px';
  }

  // ---------------- settings ----------------

  get prefs() {
    try {
      return { ...CONFIG.defaultPrefs, ...JSON.parse(localStorage.getItem(CONFIG.prefsKey) || '{}') };
    } catch {
      return { ...CONFIG.defaultPrefs };
    }
  }

  savePrefs(p) {
    try { localStorage.setItem(CONFIG.prefsKey, JSON.stringify(p)); } catch { /* ignore */ }
  }

  showSettings() {
    const prefs = this.prefs;
    const body = el('div', {});
    const makeRange = (label, key, min, max, step, fmt) => {
      body.append(el('label', { class: 'setting' }, [
        el('span', { text: label }),
        el('span', { class: 'setting-value', id: 'sv-' + key }),
      ]));
      const input = el('input', {
        type: 'range', min, max, step, value: prefs[key],
        onInput: () => {
          const v = parseFloat(input.value);
          document.getElementById('sv-' + key).textContent = fmt(v);
          prefs[key] = v;
          this.savePrefs(prefs);
        },
      });
      body.append(input);
      document.getElementById('sv-' + key).textContent = fmt(prefs[key]);
    };

    makeRange('Temperature', 'temperature', 0, 1.5, 0.05, (v) => v.toFixed(2));
    makeRange('Top-p', 'topP', 0.05, 1, 0.05, (v) => v.toFixed(2));
    makeRange('Max new tokens', 'maxNewTokens', 32, 1024, 32, (v) => String(Math.round(v)));

    body.append(el('label', { class: 'setting' }, 'Show reasoning (<think> blocks)'));
    const cb = el('input', {
      type: 'checkbox',
      checked: prefs.showThinking,
      onChange: () => {
        prefs.showThinking = cb.checked;
        this.savePrefs(prefs);
      },
    });
    body.append(cb);

    openModal({ title: 'Generation settings', body, buttons: [{ label: 'Close', class: 'btn btn-primary' }] });
  }
}

// ---------------- markdown-lite ----------------

const esc = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function renderMarkdown(text) {
  if (!text) return '';
  let out = '';
  const blocks = text.split(/```/);
  for (let i = 0; i < blocks.length; i++) {
    if (i % 2 === 1) {
      // fenced code block
      const [lang, ...rest] = blocks[i].split('\n');
      const code = rest.join('\n').replace(/^\n/, '');
      out += `<pre><code>${esc(lang.startsWith(' ') ? blocks[i] : code)}</code></pre>`;
    } else {
      out += renderInline(blocks[i]);
    }
  }
  return out;
}

function renderInline(block) {
  const lines = block.split('\n');
  const html = [];
  let inList = null;
  let inThink = false;

  const closeList = () => {
    if (inList) { html.push(`</${inList}>`); inList = null; }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Inside an open <think> block: accumulate plain text until </think>.
    if (inThink) {
      const idx = line.indexOf('</think>');
      if (idx === -1) {
        html.push(inline(line));
        continue;
      }
      const before = line.slice(0, idx);
      const after = line.slice(idx + 8);
      html.push(` ${inline(before)}</p></div></details>`);
      inThink = false;
      if (after.trim()) html.push(`<p>${inline(after)}</p>`);
      continue;
    }

    if (!line.trim()) { closeList(); html.push(''); continue; }

    // <think> … </think> blocks (reasoning traces from Qwen3.5)
    const openIdx = line.indexOf('<think>');
    if (openIdx !== -1) {
      closeList();
      const before = line.slice(0, openIdx);
      const rest = line.slice(openIdx + 7);
      if (before.trim()) html.push(`<p>${inline(before)}</p>`);
      const closeIdx = rest.indexOf('</think>');
      if (closeIdx !== -1) {
        const inner = rest.slice(0, closeIdx);
        const after = rest.slice(closeIdx + 8);
        html.push(`<details class="think"><summary>🧠 Thought</summary><div class="think-body"><p>${inline(inner)}</p></div></details>`);
        if (after.trim()) html.push(`<p>${inline(after)}</p>`);
      } else {
        html.push(`<details class="think" open><summary>🧠 Thought</summary><div class="think-body"><p>${inline(rest)}`);
        inThink = true;
      }
      continue;
    }

    if (/^#{1,4}\s/.test(line)) {
      closeList();
      const level = line.match(/^#{1,4}/)[0].length;
      html.push(`<h${level}>${inline(line.replace(/^#{1,4}\s*/, ''))}</h${level}>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (inList !== 'ul') { closeList(); html.push('<ul>'); inList = 'ul'; }
      html.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      if (inList !== 'ol') { closeList(); html.push('<ol>'); inList = 'ol'; }
      html.push(`<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
    } else if (/^\s*>\s?/.test(line)) {
      closeList();
      html.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
    } else if (/^\s*---+$/.test(line)) {
      closeList();
      html.push('<hr>');
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join('');
}

function inline(text) {
  let t = esc(text);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}
