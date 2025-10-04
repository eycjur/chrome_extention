chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    translateText(request.text, request.apiKey)
      .then(result => {
        sendResponse({ success: true, translation: result });
      })
      .catch(error => {
        console.error('Translation error:', error);
        sendResponse({ success: false, error: error.message });
      });

    // 非同期レスポンスを示すためにtrueを返す
    return true;
  } else if (request.action === 'dictionary') {
    getDictionaryInfo(request.word)
      .then(result => {
        sendResponse({ success: true, dictionary: result });
      })
      .catch(error => {
        console.error('Dictionary error:', error);
        sendResponse({ success: false, error: error.message });
      });

    // 非同期レスポンスを示すためにtrueを返す
    return true;
  }
});

async function translateText(text, apiKey) {
  if (!apiKey) {
    throw new Error('DeepL API キーが設定されていません');
  }

  const targetLang = 'JA';
  const sourceLang = 'EN';

  const params = new URLSearchParams({
    auth_key: apiKey,
    text: text,
    target_lang: targetLang,
    source_lang: sourceLang
  });

  try {
    const response = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('DeepL API キーが無効です');
      } else if (response.status === 456) {
        throw new Error('DeepL API クォータを超過しました');
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.translations && data.translations.length > 0) {
      return data.translations[0].text;
    }

    throw new Error('Translation failed');
  } catch (error) {
    throw new Error(`Translation error: ${error.message}`);
  }
}

function parseDictionaryResponse(text, originalWord) {
  if (!text || text.trim() === '') {
    return null;
  }

  try {
    // ExcelAPI.orgからのテキストレスポンスを解析
    const lines = text.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return null;
    }

    const result = {
      word: originalWord || '',  // フォールバックとして元の単語を使用
      phonetics: [],
      meanings: []
    };

    // 最初の行から単語を抽出（可能であれば）
    const firstLine = lines[0].trim();
    const wordMatch = firstLine.match(/^([a-zA-Z\s-]+)/);
    if (wordMatch) {
      result.word = wordMatch[1].trim();
    }

    // 発音記号を抽出（があれば）
    const phoneticMatch = firstLine.match(/\[([^\]]+)\]/);
    if (phoneticMatch) {
      result.phonetics.push({
        text: phoneticMatch[1],
        audio: null
      });
    }

    // 意味を抽出
    const meanings = [];
    let currentPartOfSpeech = 'その他';

    lines.forEach((line, index) => {
      if (index === 0) return; // 最初の行はスキップ

      line = line.trim();

      // 品詞情報を抽出（〈形〉、〈名〉など）
      const posMatch = line.match(/〈([^〉]+)〉/);
      if (posMatch) {
        currentPartOfSpeech = posMatch[1];
        line = line.replace(/〈[^〉]+〉/, '').trim();
      }

      // 意味を抽出 - より柔軟な条件に変更
      if (line && line.length > 2 && !line.match(/^[\s\t]*$/)) {
        // 番号や特殊記号を除去
        const cleanDefinition = line
          .replace(/^\d+[\.\)]\s*/, '') // 行頭の番号を除去
          .replace(/^[\-\•]\s*/, '') // 行頭の記号を除去
          .replace(/『([^』]+)』/g, '$1') // 『』を除去
          .replace(/\([^)]*\)/g, '') // ()内を除去
          .trim();

        if (cleanDefinition && cleanDefinition.length > 1) {
          meanings.push({
            partOfSpeech: currentPartOfSpeech,
            definitions: [{
              definition: cleanDefinition,
              example: null
            }]
          });
        }
      }
    });

    // 品詞ごとにグループ化
    const meaningsByPos = {};
    meanings.forEach(meaning => {
      const pos = meaning.partOfSpeech;
      if (!meaningsByPos[pos]) {
        meaningsByPos[pos] = [];
      }
      meaningsByPos[pos] = meaningsByPos[pos].concat(meaning.definitions);
    });

    // 最大3つの品詞、各品詞から最大3つの定義
    result.meanings = Object.entries(meaningsByPos)
      .slice(0, 3)
      .map(([partOfSpeech, definitions]) => ({
        partOfSpeech: partOfSpeech,
        definitions: definitions.slice(0, 3)
      }));

    // フォールバック: 何も解析できなかった場合、生テキストから簡単な辞書エントリを作成
    if (result.meanings.length === 0 && text && text.trim().length > 0) {
      // 生テキストを使って簡単なエントリを作成
      const cleanText = text
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/〈[^〉]+〉/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/『[^』]*』/g, '')
        .trim();

      if (cleanText && cleanText.length > 3) {
        result.meanings = [{
          partOfSpeech: 'その他',
          definitions: [{
            definition: cleanText.substring(0, 200), // 最初の200文字まで
            example: null
          }]
        }];
      }
    }

    return result;
  } catch (error) {
    console.error('Dictionary parsing error:', error);
    return null;
  }
}

async function getDictionaryInfo(word) {
  try {
    // ExcelAPI.orgの英和辞書APIを使用
    const response = await fetch(`https://api.excelapi.org/dictionary/enja?word=${encodeURIComponent(word)}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('単語が見つかりませんでした');
      }
      throw new Error(`Dictionary API error: ${response.status}`);
    }

    const text = await response.text();
    console.log('Dictionary API response for word "' + word + '":', text);

    // テキストレスポンスを解析
    const result = parseDictionaryResponse(text, word);

    console.log('Parsed dictionary result:', result);

    if (!result || (!result.word && !result.meanings.length)) {
      throw new Error('辞書データが見つかりませんでした');
    }

    return result;
  } catch (error) {
    throw new Error(`Dictionary lookup failed: ${error.message}`);
  }
}