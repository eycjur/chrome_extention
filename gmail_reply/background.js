const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'callGeminiAPI') {
    callGeminiAPI(message)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep channel open for async response
  }
});

const TONE_MAP = {
  formal:   '丁寧で礼儀正しい文体（敬語を丁寧に使い、フォーマルな印象に）',
  normal:   '堅苦しすぎず失礼のない自然な敬語',
  casual:   'カジュアルで親しみやすいトーン（です・ます調だが軽めに）',
  friendly: '友達に送るような砕けた文体（敬語なし、口語OK）'
};

const LENGTH_MAP = {
  short:  '3〜4文程度の簡潔な内容',
  normal: '適切な長さ',
  long:   'やや詳しく、丁寧に書いた内容'
};

async function callGeminiAPI({ subAction, thread, outline, currentReply, instruction, options = {}, apiKey, model }) {
  const selectedModel = model || 'gemini-2.5-flash-lite';

  // Build thread context string
  const threadText = thread.emails
    .map((e, i) => `【メール ${i + 1}】送信者: ${e.sender}\n${e.body}`)
    .join('\n\n---\n\n');

  // Build style constraints from options
  const styleLines = [
    TONE_MAP[options.tone] && `文体: ${TONE_MAP[options.tone]}`,
    LENGTH_MAP[options.length] && `長さ: ${LENGTH_MAP[options.length]}`
  ].filter(Boolean);
  const styleBlock = styleLines.length > 0
    ? `\nスタイル指定:\n${styleLines.map(l => `- ${l}`).join('\n')}\n`
    : '';

  let prompt;

  const hasThread = thread.emails.length > 0;

  if (subAction === 'generate') {
    if (hasThread) {
      prompt = `以下のメールスレッドに対する返信文を作成してください。

件名: ${thread.subject}

--- メールスレッド ---
${threadText}
--- ここまで ---

返信の概要・ポイント:
${outline}
${styleBlock}
上記の概要・ポイントとスタイル指定をもとに日本語の返信メールを作成してください。
- メール本文のみを出力してください（件名・補足説明・コードブロックは不要）
- 件名（Subject:）は絶対に出力しないでください
- 相手への挨拶から始め、結びの言葉で締めてください
- 署名は「（お名前）」としてください`;
    } else {
      prompt = `以下の概要・ポイントをもとに、新規メールの文面を作成してください。

概要・ポイント:
${outline}
${styleBlock}
上記をもとに日本語のメールを作成してください。
- メール本文のみを出力してください（件名・補足説明・コードブロックは不要）
- 件名（Subject:）は絶対に出力しないでください
- 挨拶から始め、結びの言葉で締めてください
- 署名は「（お名前）」としてください`;
    }

  } else if (subAction === 'refine') {
    const threadContext = hasThread
      ? `\n件名: ${thread.subject}\n\n--- メールスレッド ---\n${threadText}\n--- ここまで ---\n`
      : '';

    prompt = `【タスク】下記の「現在のメール案」を指示に従って書き直してください。新しいメールを作成したり、メール案への返信を書いたりしないでください。

ブラッシュアップの指示:
${instruction}

現在のメール案（これを書き直す）:
${currentReply}
${threadContext}
【出力ルール】
- 書き直した本文のみを出力してください（説明・コメント・件名は不要）
- 件名（Subject:）は絶対に出力しないでください`;
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
    throw new Error(errorData?.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) throw new Error('レスポンスからテキストを取得できませんでした');
  return { reply };
}
