// ========================================
// IndexedDB Dictionary Manager
// ========================================
class DictionaryDB {
  constructor() {
    this.dbName = 'ejdict';
    this.version = 1;
    this.storeName = 'dictionary';
    this.db = null;
    this.initPromise = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // オブジェクトストアを作成
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'word' });
          // 単語をキーとしたインデックスを作成（検索用）
          store.createIndex('word', 'word', { unique: true });
        }
      };
    });
  }

  async get(word) {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(word.toLowerCase());

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(entry) {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(entry);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async bulkPut(entries) {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let completed = 0;
      const total = entries.length;

      for (const entry of entries) {
        const request = store.put(entry);
        request.onsuccess = () => {
          completed++;
          if (completed === total) {
            resolve(completed);
          }
        };
        request.onerror = () => {
          console.error('Error putting entry:', entry.word, request.error);
        };
      }

      transaction.oncomplete = () => resolve(completed);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async count() {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clear() {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

// グローバルインスタンス
const dictionaryDB = new DictionaryDB();

// ========================================
// EJDict Data Loader
// ========================================
async function loadEJDictData() {
  console.log('[EJDict] Loading dictionary data...');

  const baseUrl = 'https://raw.githubusercontent.com/kujirahand/EJDict/master/src/';
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const allEntries = [];

  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i];
    const url = baseUrl + letter + '.txt';

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[EJDict] Failed to download ${letter}.txt`);
        continue;
      }

      const text = await response.text();
      const entries = parseEJDictText(text);
      allEntries.push(...entries);

    } catch (error) {
      console.error(`[EJDict] Error loading ${letter}.txt:`, error);
    }
  }

  if (allEntries.length === 0) {
    throw new Error('No dictionary entries were loaded. Check network connection and GitHub access.');
  }

  await dictionaryDB.bulkPut(allEntries);
  await chrome.storage.local.set({ dictionaryLoaded: true, dictionaryVersion: 1 });

  const finalCount = await dictionaryDB.count();
  console.log(`[EJDict] Dictionary loaded: ${finalCount} entries`);
}

function parseEJDictText(text) {
  const entries = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    const parts = line.split('\t');
    if (parts.length < 2) continue;

    const words = parts[0].split(',').map(w => w.trim().toLowerCase());
    const meaning = parts[1].trim();

    // 類義語を抽出（"=word" 形式）
    const synonymMatch = meaning.match(/^=\s*(.+)/);
    let synonyms = [];
    if (synonymMatch) {
      // "=them" のような形式の場合、類義語として扱う
      synonyms = [synonymMatch[1].trim()];
    } else {
      // カンマ区切りで複数の単語がある場合、それらは類義語
      if (words.length > 1) {
        synonyms = words.slice(1); // 最初の単語以外を類義語とする
      }
    }

    // 品詞を抽出
    const posMatch = meaning.match(/[〈{]([^〉}]+)[〉}]/);
    const partOfSpeech = posMatch ? posMatch[1] : 'その他';

    // 意味をクリーンアップ
    const cleanMeaning = meaning
      .replace(/^=\s*.+$/, '→ ' + (synonymMatch ? synonymMatch[1] : '')) // "=word" を "→ word" に変換
      .replace(/[〈{][^〉}]+[〉}]/g, '') // 品詞記号を除去
      .replace(/《[^》]+》/g, '') // 地域・使用域を除去
      .trim();

    // 各単語に対してエントリを作成
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word || word.length < 1) continue;

      // 他の単語を類義語として保存（自分自身は除く）
      const wordSynonyms = words.filter((w, idx) => idx !== i && w);

      entries.push({
        word: word,
        meanings: [{
          partOfSpeech: partOfSpeech,
          definitions: [{
            definition: cleanMeaning,
            example: null
          }]
        }],
        phonetics: [],
        synonyms: wordSynonyms.length > 0 ? wordSynonyms : (synonyms.length > 0 ? synonyms : undefined)
      });
    }
  }

  return entries;
}

// 初回起動時に辞書データをロード
chrome.runtime.onInstalled.addListener(async () => {
  const { dictionaryLoaded } = await chrome.storage.local.get('dictionaryLoaded');
  const count = await dictionaryDB.count();

  if (!dictionaryLoaded || count === 0) {
    try {
      await loadEJDictData();
    } catch (error) {
      console.error('[EJDict] Failed to load dictionary:', error);
    }
  }
});

// Service Worker起動時に辞書の状態を確認
(async () => {
  const count = await dictionaryDB.count();
  if (count === 0) {
    console.warn('[EJDict] Dictionary is empty');
  }
})();

// ========================================
// Message Handlers
// ========================================
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'translate') {
    translateText(request.text, request.apiKey)
      .then(result => {
        sendResponse({ success: true, translation: result });
      })
      .catch(error => {
        console.error('Translation error:', error);
        sendResponse({ success: false, error: error.message });
      });

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
    text: text,
    target_lang: targetLang,
    source_lang: sourceLang
  });

  try {
    const response = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
      },
      body: params
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Background] DeepL API error:', errorText);

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

    throw new Error('Translation failed: No translations in response');
  } catch (error) {
    console.error('[Background] Translation error:', error);
    throw new Error(`Translation error: ${error.message}`);
  }
}

async function getDictionaryInfo(word) {
  try {
    const searchWord = word.toLowerCase().trim();
    const count = await dictionaryDB.count();

    if (count === 0) {
      console.error('[Dictionary] Database is empty!');
      throw new Error('辞書データが読み込まれていません。拡張機能のポップアップから「辞書を読み込む」をクリックしてください。');
    }

    const result = await dictionaryDB.get(searchWord);

    if (result) {
      return result;
    }

    throw new Error(`単語「${searchWord}」が見つかりませんでした`);

  } catch (error) {
    console.error('[Dictionary] Error:', error);
    throw new Error(`Dictionary lookup failed: ${error.message}`);
  }
}