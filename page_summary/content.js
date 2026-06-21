(function () {
  'use strict';

  // Prevent duplicate injection
  if (window.__aiSummarizerLoaded) return;
  window.__aiSummarizerLoaded = true;

  // ─── Floating Button ─────────────────────────────────────────────────
  const fabWrap = document.createElement('div');
  fabWrap.id = 'ai-summarizer-fab-wrap';

  const fabCloseBtn = document.createElement('button');
  fabCloseBtn.id = 'ai-summarizer-fab-close';
  fabCloseBtn.type = 'button';
  fabCloseBtn.title = 'ボタンを非表示';
  fabCloseBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  `;
  fabCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    fabWrap.style.display = 'none';
  });

  const floatBtn = document.createElement('div');
  floatBtn.id = 'ai-summarizer-fab';
  floatBtn.title = 'このページを要約する';
  floatBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
  `;
  floatBtn.addEventListener('click', () => startSummarize(null));

  fabWrap.appendChild(fabCloseBtn);
  fabWrap.appendChild(floatBtn);
  document.body.appendChild(fabWrap);

  // ─── Message Listener (from background.js context menu) ──────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'summarize') {
      startSummarize(message.selectedText || null);
      sendResponse({ ok: true });
    }
  });

  let chatSession = null;
  let followUpInFlight = false;

  // ─── Main Summarize Flow ──────────────────────────────────────────────
  async function startSummarize(selectedText) {
    chatSession = null;
    showPanel();
    setLoadingState();

    try {
      const { apiKey, model } = await chrome.storage.sync.get(['apiKey', 'model']);

      if (!apiKey) {
        showError(
          'APIキーが設定されていません。',
          '拡張機能のアイコンをクリックして設定画面からAPIキーを入力してください。'
        );
        return;
      }

      let text;
      let isYoutube = false;
      const isSelection = !!selectedText;

      if (selectedText) {
        text = selectedText;
      } else if (isYoutubePage()) {
        const subtitles = await getYouTubeSubtitles();
        if (subtitles) {
          text = subtitles;
          isYoutube = true;
        } else {
          text = extractPageText();
        }
      } else {
        text = extractPageText();
      }

      if (!text || text.trim().length < 20) {
        showError('テキストが見つかりませんでした。', 'このページには要約できるコンテンツがありません。');
        return;
      }

      // Truncate if too long (~50,000 chars ≈ ~12,500 tokens)
      const MAX_CHARS = 50000;
      if (text.length > MAX_CHARS) {
        text = text.substring(0, MAX_CHARS) + '\n\n[... テキストが長いため途中で切り捨てられました]';
      }

      showSummaryStreamShell({ isYoutube, isSelection });

      let sessionUserPrompt = '';
      let accumulated = '';
      let streamError = false;
      let streamErrorDetail = '';

      await new Promise(resolve => {
        const port = chrome.runtime.connect({ name: 'gemini-stream' });
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          try {
            port.disconnect();
          } catch (_) { /* ignore */ }
          resolve();
        };

        const summaryEl = panel.querySelector('.ais-summary-text');
        const scrollBody = () => {
          const body = panel.querySelector('.ais-body');
          if (body) body.scrollTop = body.scrollHeight;
        };

        port.onMessage.addListener(msg => {
          if (msg.userPrompt != null && msg.userPrompt !== '') {
            sessionUserPrompt = msg.userPrompt;
            return;
          }
          if (msg.chunk) {
            accumulated += msg.chunk;
            summaryEl.classList.add('ais-summary-text');
            summaryEl.textContent = accumulated;
            scrollBody();
          }
          if (msg.error) {
            streamError = true;
            streamErrorDetail = msg.error;
          }
          if (msg.done) {
            if (accumulated) {
              summaryEl.innerHTML = formatMarkdown(accumulated);
              summaryEl.classList.add('ais-summary-text');
              summaryEl.classList.remove('ais-followup-streaming');
              panel.querySelector('.ais-copy-btn').style.display = 'flex';
            }

            const compose = panel.querySelector('.ais-followup-compose');
            if (!streamError && accumulated) {
              chatSession = {
                initialUserPrompt: sessionUserPrompt,
                firstSummary: accumulated,
                followUps: []
              };
              if (compose) {
                compose.style.display = '';
                attachFollowUpComposeListeners();
              }
            } else if (streamError && accumulated) {
              showFollowUpError(streamErrorDetail || 'エラーで中断しました');
            } else if (streamError && !accumulated) {
              showError('API エラーが発生しました', streamErrorDetail || '不明なエラー');
            } else if (!accumulated) {
              showError(
                'レスポンスからテキストを取得できませんでした',
                'モデルの応答が空でした。しばらくしてから再度お試しください。'
              );
            }
            finish();
          }
        });

        port.onDisconnect.addListener(() => {
          if (!settled) {
            streamError = true;
            streamErrorDetail = '接続が切れました';
            if (!accumulated) {
              showError('エラーが発生しました', streamErrorDetail);
            } else {
              summaryEl.innerHTML = formatMarkdown(accumulated);
              summaryEl.classList.add('ais-summary-text');
              summaryEl.classList.remove('ais-followup-streaming');
              panel.querySelector('.ais-copy-btn').style.display = 'flex';
              showFollowUpError(streamErrorDetail);
            }
            finish();
          }
        });

        port.postMessage({
          action: 'summarize',
          text,
          isYoutube,
          isSelection,
          apiKey,
          model: model || 'gemini-2.5-flash-lite'
        });
      });
    } catch (err) {
      showError('エラーが発生しました', err.message);
    }
  }

  // ─── Page Detection ───────────────────────────────────────────────────
  function isYoutubePage() {
    return (
      window.location.hostname.includes('youtube.com') &&
      window.location.pathname === '/watch'
    );
  }

  // ─── YouTube Subtitle Extraction ──────────────────────────────────────
  async function getYouTubeSubtitles() {
    try {
      // ytInitialPlayerResponse is embedded in a <script> tag on the page
      let playerResponse = null;
      const scripts = document.querySelectorAll('script');

      for (const script of scripts) {
        const src = script.textContent;
        if (!src.includes('ytInitialPlayerResponse')) continue;

        // Try multiple regex patterns for different YouTube versions
        const patterns = [
          /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;?\s*(?:var |if |window\.)/s,
          /var ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s,
          /ytInitialPlayerResponse\s*=\s*(\{.+\})/s
        ];

        for (const pattern of patterns) {
          const match = src.match(pattern);
          if (match) {
            try {
              playerResponse = JSON.parse(match[1]);
              break;
            } catch (_) { /* try next pattern */ }
          }
        }
        if (playerResponse) break;
      }

      if (!playerResponse) return null;

      const tracks =
        playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!tracks || tracks.length === 0) return null;

      // Language priority: ja → en → first available
      const track =
        tracks.find(t => t.languageCode === 'ja') ||
        tracks.find(t => t.languageCode === 'en') ||
        tracks[0];

      const url = `${track.baseUrl}&fmt=json3`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const data = await res.json();
      const text = (data.events || [])
        .filter(e => e.segs)
        .map(e => e.segs.map(s => s.utf8 || '').join(''))
        .filter(t => t.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      return text.length > 20 ? text : null;
    } catch (e) {
      console.warn('[AI Summarizer] YouTube subtitle error:', e);
      return null;
    }
  }

  // ─── Page Text Extraction ─────────────────────────────────────────────
  function extractPageText() {
    const doc = document.cloneNode(true);

    // Remove noise elements
    [
      'script', 'style', 'noscript', 'nav', 'footer', 'header',
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      '.nav', '.navigation', '.menu', '.sidebar', '.footer', '.header',
      '.ads', '.advertisement', '.cookie-notice', '#cookie-banner'
    ].forEach(sel => {
      doc.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Prefer semantic main content
    const main =
      doc.querySelector('main') ||
      doc.querySelector('article') ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector('.content, #content, .post-content, .entry-content') ||
      doc.querySelector('body');

    return (main?.innerText || main?.textContent || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ─── Panel UI ─────────────────────────────────────────────────────────
  let panel = null;

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'ai-summarizer-panel';
    panel.innerHTML = `
      <div class="ais-header">
        <div class="ais-header-left">
          <div class="ais-logo">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span class="ais-title"></span>
        </div>
        <div class="ais-header-actions">
          <button class="ais-icon-btn ais-copy-btn" title="コピー" style="display:none">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="ais-icon-btn ais-close-btn" title="閉じる">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="ais-source">
        <span class="ais-source-icon"></span>
        <span class="ais-source-label"></span>
      </div>
      <div class="ais-body"></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.ais-close-btn').addEventListener('click', () => {
      panel.classList.remove('ais-visible');
    });

    panel.querySelector('.ais-copy-btn').addEventListener('click', () => {
      const text = panel.querySelector('.ais-summary-text')?.innerText;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const btn = panel.querySelector('.ais-copy-btn');
        btn.classList.add('ais-copied');
        setTimeout(() => btn.classList.remove('ais-copied'), 2000);
      });
    });
  }

  function showPanel() {
    if (!panel) buildPanel();
    requestAnimationFrame(() => panel.classList.add('ais-visible'));
  }

  function setLoadingState() {
    if (!panel) return;
    panel.querySelector('.ais-copy-btn').style.display = 'none';

    const sourceIcon = panel.querySelector('.ais-source-icon');
    const sourceLabel = panel.querySelector('.ais-source-label');
    if (isYoutubePage()) {
      sourceIcon.textContent = '▶';
      sourceLabel.textContent = document.title || 'YouTube 動画';
    } else {
      sourceIcon.textContent = '🌐';
      sourceLabel.textContent = document.title || window.location.hostname;
    }

    panel.querySelector('.ais-body').innerHTML = `
      <div class="ais-loading">
        <div class="ais-spinner"></div>
        <p>要約を生成しています...</p>
      </div>
    `;
  }

  function summaryBadgeHtml(isYoutube, isSelection) {
    if (isYoutube) {
      return '<span class="ais-badge ais-badge-youtube">▶ YouTube 字幕から要約</span>';
    }
    if (isSelection) {
      return '<span class="ais-badge ais-badge-selection">✂ 選択テキストを要約</span>';
    }
    return '';
  }

  function showSummaryStreamShell({ isYoutube, isSelection }) {
    if (!panel) return;
    panel.querySelector('.ais-copy-btn').style.display = 'none';

    const badge = summaryBadgeHtml(isYoutube, isSelection);
    panel.querySelector('.ais-body').innerHTML = `
      <div class="ais-summary-layout">
        <div class="ais-summary">
          ${badge}
          <div class="ais-summary-text ais-followup-streaming" aria-live="polite">
            <span class="ais-stream-wait">要約を生成しています…</span>
          </div>
        </div>
        <div class="ais-followup-thread" aria-live="polite"></div>
        <p class="ais-followup-error" role="alert"></p>
        <div class="ais-followup-compose" style="display: none">
          <textarea class="ais-followup-input" rows="2" placeholder="続きの質問を入力（⌘+Enter / Ctrl+Enter で送信）"></textarea>
          <button type="button" class="ais-followup-send">送信</button>
        </div>
      </div>
    `;
  }

  function attachFollowUpComposeListeners() {
    if (!panel) return;
    const sendBtn = panel.querySelector('.ais-followup-send');
    const input = panel.querySelector('.ais-followup-input');
    if (!sendBtn || !input || sendBtn.dataset.aisBound === '1') return;
    sendBtn.dataset.aisBound = '1';
    input.dataset.aisBound = '1';
    sendBtn.addEventListener('click', () => sendFollowUp());
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      sendFollowUp();
    });
  }

  function setFollowUpBusy(busy) {
    if (!panel) return;
    const compose = panel.querySelector('.ais-followup-compose');
    const input = panel.querySelector('.ais-followup-input');
    const sendBtn = panel.querySelector('.ais-followup-send');
    if (compose) compose.classList.toggle('ais-followup-compose-busy', busy);
    if (input) input.disabled = busy;
    if (sendBtn) sendBtn.disabled = busy;
  }

  function showFollowUpError(msg) {
    const el = panel?.querySelector('.ais-followup-error');
    if (el) el.textContent = msg || '';
  }

  async function sendFollowUp() {
    if (!panel || !chatSession || followUpInFlight) return;

    const input = panel.querySelector('.ais-followup-input');
    const q = input?.value?.trim();
    if (!q) return;

    showFollowUpError('');

    const { apiKey, model } = await chrome.storage.sync.get(['apiKey', 'model']);
    if (!apiKey) {
      showFollowUpError('APIキーが設定されていません。拡張機能のポップアップから設定してください。');
      return;
    }

    const contents = [
      { role: 'user', text: chatSession.initialUserPrompt },
      { role: 'model', text: chatSession.firstSummary }
    ];
    for (const ex of chatSession.followUps) {
      contents.push({ role: 'user', text: ex.user });
      contents.push({ role: 'model', text: ex.assistant });
    }
    contents.push({ role: 'user', text: q });

    const thread = panel.querySelector('.ais-followup-thread');
    const pair = document.createElement('div');
    pair.className = 'ais-followup-pair ais-followup-pair-streaming';
    pair.innerHTML = `
      <div class="ais-followup-q-label">あなた</div>
      <div class="ais-followup-q">${escapeHtml(q).replace(/\n/g, '<br>')}</div>
      <div class="ais-followup-a-label">回答</div>
      <div class="ais-followup-a ais-followup-streaming" aria-live="polite">
        <span class="ais-stream-wait">応答を生成しています…</span>
      </div>
    `;
    thread.appendChild(pair);
    const assistantEl = pair.querySelector('.ais-followup-a');
    const scrollFollowup = () => {
      const body = panel.querySelector('.ais-body');
      if (body) body.scrollTop = body.scrollHeight;
    };
    scrollFollowup();

    followUpInFlight = true;
    setFollowUpBusy(true);

    let accumulated = '';
    let streamError = false;

    try {
      await new Promise(resolve => {
        const port = chrome.runtime.connect({ name: 'gemini-stream' });
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          try {
            port.disconnect();
          } catch (_) { /* ignore */ }
          resolve();
        };

        port.onMessage.addListener(msg => {
          if (msg.chunk) {
            accumulated += msg.chunk;
            assistantEl.classList.add('ais-summary-text');
            assistantEl.textContent = accumulated;
            scrollFollowup();
          }
          if (msg.error) {
            streamError = true;
            showFollowUpError(msg.error);
          }
          if (msg.done) {
            if (accumulated) {
              assistantEl.innerHTML = formatMarkdown(accumulated);
              assistantEl.classList.add('ais-summary-text');
              if (!streamError) {
                chatSession.followUps.push({ user: q, assistant: accumulated });
                input.value = '';
              }
            } else {
              pair.remove();
            }
            pair.classList.remove('ais-followup-pair-streaming');
            assistantEl.classList.remove('ais-followup-streaming');
            finish();
          }
        });

        port.onDisconnect.addListener(() => {
          if (!settled) {
            streamError = true;
            showFollowUpError('接続が切れました');
            if (accumulated) {
              assistantEl.innerHTML = formatMarkdown(accumulated);
              assistantEl.classList.add('ais-summary-text');
            } else {
              pair.remove();
            }
            finish();
          }
        });

        port.postMessage({
          action: 'followup',
          contents,
          apiKey,
          model: model || 'gemini-2.5-flash-lite'
        });
      });
    } catch (err) {
      showFollowUpError(err.message || '送信に失敗しました');
      pair.remove();
    } finally {
      followUpInFlight = false;
      setFollowUpBusy(false);
    }
  }

  function showError(title, detail) {
    if (!panel) return;
    panel.querySelector('.ais-copy-btn').style.display = 'none';
    panel.querySelector('.ais-body').innerHTML = `
      <div class="ais-error">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(detail || '')}</p>
      </div>
    `;
  }

  // ─── Markdown Formatting ──────────────────────────────────────────────
  function formatMarkdown(raw) {
    let html = escapeHtml(raw);

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold & Italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Bullet lists
    html = html.replace(/^[\-\*•] (.+)$/gm, '<li>$1</li>');
    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // Wrap li sequences in ul
    html = html.replace(/(<li>[\s\S]+?<\/li>(\n|$))+/g, m => `<ul>${m}</ul>`);

    // Paragraphs: split by double newlines
    const blocks = html.split(/\n{2,}/);
    html = blocks.map(block => {
      if (/^<(h[1-3]|ul|li)/.test(block.trim())) return block;
      const inner = block.replace(/\n/g, '<br>').trim();
      return inner ? `<p>${inner}</p>` : '';
    }).join('');

    return html;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
