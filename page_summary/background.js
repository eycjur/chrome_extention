const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Context menu setup on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'summarize-page',
    title: 'このページを AI で要約する',
    contexts: ['page']
  });
  chrome.contextMenus.create({
    id: 'summarize-selection',
    title: '選択テキストを AI で要約する',
    contexts: ['selection']
  });
});

// Context menu click → forward to content script
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  const selectedText = info.menuItemId === 'summarize-selection'
    ? info.selectionText
    : null;

  chrome.tabs.sendMessage(tab.id, {
    action: 'summarize',
    selectedText
  }).catch(() => {
    // Content script might not be loaded (e.g., chrome:// pages), inject manually
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }).then(() => {
      chrome.tabs.sendMessage(tab.id, { action: 'summarize', selectedText });
    }).catch(console.error);
  });
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'gemini-stream') return;
  port.onMessage.addListener(msg => {
    const run = async fn => {
      try {
        await fn();
      } catch (e) {
        port.postMessage({ error: e.message || String(e) });
      } finally {
        try {
          port.postMessage({ done: true });
        } catch (_) { /* port closed */ }
      }
    };

    if (msg.action === 'summarize') {
      run(() => streamGeminiSummarizeToPort(port, msg));
    } else if (msg.action === 'followup') {
      run(() => streamGeminiFollowupToPort(port, msg));
    }
  });
});

function buildSummarizePrompt(text, isYoutube, isSelection) {
  if (isSelection) {
    return `以下の選択されたテキストを「要約」と「学びポイント」の2部構成で日本語で出力してください。\n\n- 要約: 重要なポイントを簡潔にまとめる\n- 学びポイント: 読み手が持ち帰れる示唆・気づきを箇条書きで3〜5個\n\n対象テキスト:\n${text}`;
  }
  if (isYoutube) {
    return `以下はYouTube動画の字幕テキストです。「要約」と「学びポイント」の2部構成で日本語で出力してください。\n\n- 要約: 主要なトピック、重要なポイント、結論を簡潔にまとめる\n- 学びポイント: 視聴者が持ち帰れる示唆・気づきを箇条書きで3〜5個\n\n対象テキスト:\n${text}`;
  }
  return `以下のウェブページの内容を「要約」と「学びポイント」の2部構成で日本語で出力してください。\n\n- 要約: 主要なトピック、重要な情報、結論を簡潔にまとめる\n- 学びポイント: 読み手が持ち帰れる示唆・気づきを箇条書きで3〜5個\n\n対象テキスト:\n${text}`;
}

function parseSseBuffer(buffer) {
  const events = [];
  const re = /\r?\n\r?\n/g;
  let last = 0;
  let m;
  while ((m = re.exec(buffer)) !== null) {
    const block = buffer.slice(last, m.index);
    last = re.lastIndex;
    const lines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
    }
    if (!lines.length) continue;
    const payload = lines.join('\n').trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      events.push(JSON.parse(payload));
    } catch (_) { /* incomplete JSON in block */ }
  }
  return { events, rest: buffer.slice(last) };
}

async function streamGenerateToPort(port, { apiKey, model, contents }) {
  const selectedModel = model || 'gemini-2.5-flash-lite';
  const url = `${GEMINI_API_URL}/${selectedModel}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: 2048 }
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${response.status}`;
    port.postMessage({ error: msg });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emitEvents = events => {
    for (const obj of events) {
      if (obj.error) {
        port.postMessage({
          error: obj.error.message || JSON.stringify(obj.error)
        });
        return false;
      }
      const piece = obj?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (piece) port.postMessage({ chunk: piece });
      const fr = obj?.candidates?.[0]?.finishReason;
      if (fr === 'SAFETY' || fr === 'RECITATION') {
        port.postMessage({ error: '生成がブロックされました' });
        return false;
      }
    }
    return true;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buffer);
    buffer = rest;
    if (!emitEvents(events)) return;
  }

  const { events } = parseSseBuffer(buffer + '\n\n');
  emitEvents(events);
}

async function streamGeminiSummarizeToPort(port, { text, isYoutube, isSelection, apiKey, model }) {
  const userPrompt = buildSummarizePrompt(text, isYoutube, isSelection);
  port.postMessage({ userPrompt });
  await streamGenerateToPort(port, {
    apiKey,
    model,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
  });
}

async function streamGeminiFollowupToPort(port, { contents, apiKey, model }) {
  const bodyContents = contents.map(({ role, text }) => ({
    role,
    parts: [{ text }]
  }));
  await streamGenerateToPort(port, { apiKey, model, contents: bodyContents });
}

