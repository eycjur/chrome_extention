(function () {
  'use strict';

  // Prevent duplicate injection
  if (window.__gmailReplyAssistLoaded) return;
  window.__gmailReplyAssistLoaded = true;

  let panel = null;
  let currentReply = '';
  let currentThread = null;
  let lastThreadHash = null;

  // ─── Floating Button ──────────────────────────────────────────────────
  const fab = document.createElement('div');
  fab.id = 'gra-fab';
  fab.title = 'Gmail 返信アシスタント';
  fab.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 10h10a8 8 0 0 1 8 8v2M3 10l6 6m-6-6l6-6"/>
    </svg>
  `;
  document.body.appendChild(fab);
  fab.style.display = 'none';
  fab.addEventListener('click', onFabClick);

  // ─── Gmail Navigation Detection ───────────────────────────────────────
  // Gmail uses hash-based SPA routing — hashchange fires immediately on navigation
  window.addEventListener('hashchange', () => {
    // Short delay for Gmail to render the thread DOM after navigation
    setTimeout(updateFabVisibility, 250);
  });

  // Initial check once the content script loads
  setTimeout(updateFabVisibility, 300);

  function isThreadOpen() {
    // Gmail thread URLs: #inbox/<threadId> — threadId is alphanumeric (base64url), not just hex
    const hashMatch = /[/#][A-Za-z0-9_-]{10,}$/.test(location.hash);
    const hasSubject = !!document.querySelector('h2.hP');
    return hashMatch || hasSubject;
  }

  function updateFabVisibility() {
    // Always visible on Gmail — supports both thread reply and new email
    fab.style.display = 'flex';
  }

  // ─── Thread Content Extraction ────────────────────────────────────────
  function extractThreadContent() {
    const subject = document.querySelector('h2.hP')?.textContent?.trim() || '(件名なし)';

    const emails = [];
    // .adn = individual email container in a Gmail thread
    document.querySelectorAll('.adn').forEach(emailEl => {
      const senderEl = emailEl.querySelector('.gD');
      const sender = senderEl?.getAttribute('name') || senderEl?.getAttribute('email') || '不明';

      // .a3s = email body. .aiL excludes quoted/replied content (the unique part only)
      const bodyEl = emailEl.querySelector('.a3s');
      const body = bodyEl?.innerText?.trim() || '';

      if (body.length > 0) {
        emails.push({ sender, body });
      }
    });

    return { subject, emails };
  }

  // ─── Panel DOM ────────────────────────────────────────────────────────
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'gra-panel';
    panel.innerHTML = `
      <div class="gra-header">
        <div class="gra-header-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 10h10a8 8 0 0 1 8 8v2M3 10l6 6m-6-6l6-6"/>
          </svg>
          返信アシスタント
        </div>
        <button class="gra-close-btn" title="閉じる">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="gra-thread-info">
        <span class="gra-thread-label">スレッド:</span>
        <span class="gra-thread-subject"></span>
      </div>

      <div class="gra-body">
        <!-- Step 1: Style Options -->
        <div class="gra-section">
          <label class="gra-label">スタイル設定</label>
          <div class="gra-options">
            <div class="gra-option-row">
              <span class="gra-option-label">文体</span>
              <div class="gra-btn-group" data-option="tone">
                <button class="gra-opt-btn" data-value="formal">丁寧</button>
                <button class="gra-opt-btn" data-value="normal">ちょうど良い</button>
                <button class="gra-opt-btn gra-opt-selected" data-value="casual">カジュアル</button>
                <button class="gra-opt-btn" data-value="friendly">友達</button>
              </div>
            </div>
            <div class="gra-option-row">
              <span class="gra-option-label">長さ</span>
              <div class="gra-btn-group" data-option="length">
                <button class="gra-opt-btn" data-value="short">短め</button>
                <button class="gra-opt-btn gra-opt-selected" data-value="normal">普通</button>
                <button class="gra-opt-btn" data-value="long">長め</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 2: Outline Input -->
        <div class="gra-section">
          <label class="gra-label">返信の概要・ポイント</label>
          <textarea class="gra-outline-input" rows="4"
            placeholder="例: 参加できる旨を伝える。都合のよい日時は来週月曜か火曜の午後。よろしくお願いしますで締める。"></textarea>
          <button class="gra-btn gra-primary gra-generate-btn">返信案を生成</button>
        </div>

        <!-- Loading indicator -->
        <div class="gra-loading" style="display:none">
          <div class="gra-spinner"></div>
          <span>生成中...</span>
        </div>

        <!-- Error message -->
        <div class="gra-error" style="display:none"></div>

        <!-- Step 2: Result Output -->
        <div class="gra-section gra-result-section" style="display:none">
          <div class="gra-result-header">
            <label class="gra-label">生成された返信案</label>
            <button class="gra-copy-btn" title="クリップボードにコピー">コピー</button>
          </div>
          <textarea class="gra-result-output" rows="12"
            placeholder="ここに返信案が表示されます"></textarea>
        </div>

        <!-- Step 3: Brush-up -->
        <div class="gra-section gra-refine-section" style="display:none">
          <label class="gra-label">ブラッシュアップ</label>
          <div class="gra-refine-chips">
            <button class="gra-chip" data-refine="同じ意味でも別の言い回し・表現に言い換える">言い換える</button>
            <button class="gra-chip" data-refine="全体をより自然でこなれた日本語表現に整える">自然に</button>
            <button class="gra-chip" data-refine="もっと短くまとめる">短く</button>
            <button class="gra-chip" data-refine="もっと長く詳しく書く">長く</button>
            <button class="gra-chip" data-refine="もっと丁寧な敬語にする">丁寧に</button>
            <button class="gra-chip" data-refine="もっとカジュアルな文体にする">カジュアルに</button>
          </div>
          <textarea class="gra-refine-input" rows="2"
            placeholder="自由に指示を入力することもできます"></textarea>
          <button class="gra-btn gra-secondary gra-refine-btn">ブラッシュアップ</button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    panel.querySelector('.gra-close-btn').addEventListener('click', hidePanel);
    panel.querySelector('.gra-generate-btn').addEventListener('click', onGenerateClick);
    panel.querySelector('.gra-refine-btn').addEventListener('click', onRefineClick);
    panel.querySelector('.gra-copy-btn').addEventListener('click', onCopyClick);

    // Option button group: single-select toggle
    panel.querySelectorAll('.gra-btn-group').forEach(group => {
      group.addEventListener('click', e => {
        const btn = e.target.closest('.gra-opt-btn');
        if (!btn) return;
        group.querySelectorAll('.gra-opt-btn').forEach(b => b.classList.remove('gra-opt-selected'));
        btn.classList.add('gra-opt-selected');
      });
    });

    // Brush-up chips: fill textarea and immediately run refine
    panel.querySelector('.gra-refine-chips').addEventListener('click', e => {
      const chip = e.target.closest('.gra-chip');
      if (!chip) return;
      panel.querySelector('.gra-refine-input').value = chip.dataset.refine;
      onRefineClick();
    });

    // Cmd/Ctrl+Enter: generate or brush-up depending on focused textarea
    panel.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.stopPropagation(); // Prevent Gmail from sending email
        e.preventDefault();
        const active = document.activeElement;
        if (active === panel.querySelector('.gra-refine-input')) {
          onRefineClick();
        } else {
          onGenerateClick();
        }
      }
    }, true);

    // Click outside panel to close (content is preserved)
    document.addEventListener('click', e => {
      if (!panel.classList.contains('gra-visible')) return;
      if (panel.contains(e.target) || fab.contains(e.target)) return;
      hidePanel();
    }, true);
  }

  function getSelectedOptions() {
    const options = {};
    panel.querySelectorAll('.gra-btn-group').forEach(group => {
      const key = group.dataset.option;
      const selected = group.querySelector('.gra-opt-selected');
      options[key] = selected?.dataset.value || 'normal';
    });
    return options;
  }

  function showPanel() {
    if (!panel) buildPanel();

    currentThread = extractThreadContent();

    if (currentThread.emails.length === 0) {
      // Might be inbox view or thread still rendering — retry once
      setTimeout(() => {
        currentThread = extractThreadContent();
        // Open regardless: no emails = new email mode
        openPanelWithThread();
      }, 500);
      return;
    }

    openPanelWithThread();
  }

  function openPanelWithThread() {
    const isNewEmail = currentThread.emails.length === 0;
    const subjectEl = panel.querySelector('.gra-thread-subject');
    const outlineInput = panel.querySelector('.gra-outline-input');

    if (isNewEmail) {
      subjectEl.textContent = '新規メール作成';
      subjectEl.style.fontStyle = 'italic';
      outlineInput.placeholder = '例: 来週の打ち合わせの日程調整をお願いするメール。候補日は月曜か水曜の午後。';
    } else {
      subjectEl.textContent = currentThread.subject;
      subjectEl.style.fontStyle = '';
      outlineInput.placeholder = '例: 参加できる旨を伝える。都合のよい日時は来週月曜か火曜の午後。よろしくお願いしますで締める。';
    }

    const threadHash = location.hash;
    if (threadHash !== lastThreadHash) {
      // Different context — reset all content
      lastThreadHash = threadHash;
      currentReply = '';
      outlineInput.value = '';
      panel.querySelector('.gra-result-output').value = '';
      panel.querySelector('.gra-refine-input').value = '';
      panel.querySelector('.gra-result-section').style.display = 'none';
      panel.querySelector('.gra-refine-section').style.display = 'none';
    }
    // Same context — content preserved, just reopen
    hidePanelError();
    panel.classList.add('gra-visible');
    // Focus the outline textarea after the slide-in transition starts
    setTimeout(() => panel.querySelector('.gra-outline-input').focus(), 100);
  }

  function hidePanel() {
    panel?.classList.remove('gra-visible');
  }

  function onFabClick() {
    if (panel?.classList.contains('gra-visible')) {
      hidePanel();
    } else {
      showPanel();
    }
  }

  // ─── Generate Reply ────────────────────────────────────────────────────
  async function onGenerateClick() {
    const outline = panel.querySelector('.gra-outline-input').value.trim();
    if (!outline) {
      showPanelError('返信の概要・ポイントを入力してください。');
      return;
    }

    const { apiKey, model } = await chrome.storage.sync.get(['apiKey', 'model']);
    if (!apiKey) {
      showPanelError('APIキーが設定されていません。拡張機能のアイコンをクリックして設定してください。');
      return;
    }

    setLoading(true);
    hidePanelError();

    const result = await chrome.runtime.sendMessage({
      action: 'callGeminiAPI',
      subAction: 'generate',
      thread: currentThread,
      outline,
      options: getSelectedOptions(),
      apiKey,
      model: model || 'gemini-2.5-flash-lite'
    });

    setLoading(false);

    if (result.error) {
      showPanelError('エラーが発生しました: ' + result.error);
    } else {
      currentReply = result.reply;
      showResult(result.reply);
    }
  }

  // ─── Brush-up Reply ────────────────────────────────────────────────────
  async function onRefineClick() {
    const instruction = panel.querySelector('.gra-refine-input').value.trim();
    if (!instruction) {
      showPanelError('ブラッシュアップの指示を入力してください。');
      return;
    }

    const { apiKey, model } = await chrome.storage.sync.get(['apiKey', 'model']);
    if (!apiKey) {
      showPanelError('APIキーが設定されていません。');
      return;
    }

    setLoading(true);
    hidePanelError();

    // Use textarea value so manual edits are reflected in brush-up
    const replyToRefine = panel.querySelector('.gra-result-output').value;

    const result = await chrome.runtime.sendMessage({
      action: 'callGeminiAPI',
      subAction: 'refine',
      thread: currentThread,
      currentReply: replyToRefine,
      instruction,
      apiKey,
      model: model || 'gemini-2.5-flash-lite'
    });

    setLoading(false);

    if (result.error) {
      showPanelError('エラーが発生しました: ' + result.error);
    } else {
      currentReply = result.reply;
      showResult(result.reply);
      panel.querySelector('.gra-refine-input').value = '';
    }
  }

  // ─── Copy to Clipboard ─────────────────────────────────────────────────
  function onCopyClick() {
    const text = panel.querySelector('.gra-result-output').value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const btn = panel.querySelector('.gra-copy-btn');
      const original = btn.textContent;
      btn.textContent = 'コピーしました!';
      btn.classList.add('gra-copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('gra-copied');
      }, 2000);
    }).catch(() => {
      showPanelError('コピーに失敗しました。テキストを手動で選択してコピーしてください。');
    });
  }

  // ─── UI State Helpers ──────────────────────────────────────────────────
  function showResult(reply) {
    panel.querySelector('.gra-result-output').value = reply;
    panel.querySelector('.gra-result-section').style.display = '';
    panel.querySelector('.gra-refine-section').style.display = '';
  }

  function setLoading(loading) {
    panel.querySelector('.gra-loading').style.display = loading ? 'flex' : 'none';
    panel.querySelector('.gra-generate-btn').disabled = loading;
    panel.querySelector('.gra-refine-btn').disabled = loading;
  }

  function showPanelError(msg) {
    const el = panel.querySelector('.gra-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function hidePanelError() {
    const el = panel.querySelector('.gra-error');
    el.style.display = 'none';
  }
})();
