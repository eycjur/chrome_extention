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

// Handle API call requests from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'callGeminiAPI') {
    callGeminiAPI(message)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep channel open for async response
  }
});

async function callGeminiAPI({ text, isYoutube, isSelection, apiKey, model }) {
  const selectedModel = model || 'gemini-2.5-flash-lite';

  let prompt;
  if (isSelection) {
    prompt = `以下の選択されたテキストを「要約」と「学びポイント」の2部構成で日本語で出力してください。\n\n- 要約: 重要なポイントを簡潔にまとめる\n- 学びポイント: 読み手が持ち帰れる示唆・気づきを箇条書きで3〜5個\n\n対象テキスト:\n${text}`;
  } else if (isYoutube) {
    prompt = `以下はYouTube動画の字幕テキストです。「要約」と「学びポイント」の2部構成で日本語で出力してください。\n\n- 要約: 主要なトピック、重要なポイント、結論を簡潔にまとめる\n- 学びポイント: 視聴者が持ち帰れる示唆・気づきを箇条書きで3〜5個\n\n対象テキスト:\n${text}`;
  } else {
    prompt = `以下のウェブページの内容を「要約」と「学びポイント」の2部構成で日本語で出力してください。\n\n- 要約: 主要なトピック、重要な情報、結論を簡潔にまとめる\n- 学びポイント: 読み手が持ち帰れる示唆・気づきを箇条書きで3〜5個\n\n対象テキスト:\n${text}`;
  }

  const url = `${GEMINI_API_URL}/${selectedModel}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2048 }
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const msg = errorData?.error?.message || `HTTP ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();
  const summary = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!summary) throw new Error('レスポンスからテキストを取得できませんでした');
  return { summary };
}
