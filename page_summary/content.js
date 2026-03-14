(function () {
  'use strict';

  // Prevent duplicate injection
  if (window.__aiSummarizerLoaded) return;
  window.__aiSummarizerLoaded = true;

  // ─── Floating Button ─────────────────────────────────────────────────
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
  document.body.appendChild(floatBtn);
  floatBtn.addEventListener('click', () => startSummarize(null));

  // ─── Message Listener (from background.js context menu) ──────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'summarize') {
      startSummarize(message.selectedText || null);
      sendResponse({ ok: true });
    }
  });

  // ─── Main Summarize Flow ──────────────────────────────────────────────
  async function startSummarize(selectedText) {
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

      const result = await chrome.runtime.sendMessage({
        action: 'callGeminiAPI',
        text,
        isYoutube,
        isSelection,
        apiKey,
        model: model || 'gemini-2.5-flash-lite'
      });

      if (result.error) {
        showError('API エラーが発生しました', result.error);
      } else {
        showSummary(result.summary, { isYoutube, isSelection });
      }
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

  function showSummary(summary, { isYoutube, isSelection }) {
    if (!panel) return;
    panel.querySelector('.ais-copy-btn').style.display = 'flex';

    let badge = '';
    if (isYoutube) {
      badge = '<span class="ais-badge ais-badge-youtube">▶ YouTube 字幕から要約</span>';
    } else if (isSelection) {
      badge = '<span class="ais-badge ais-badge-selection">✂ 選択テキストを要約</span>';
    }

    panel.querySelector('.ais-body').innerHTML = `
      <div class="ais-summary">
        ${badge}
        <div class="ais-summary-text">${formatMarkdown(summary)}</div>
      </div>
    `;
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
