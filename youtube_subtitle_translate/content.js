class YouTubeSubtitleTranslator {
  constructor() {
    this.isVideoPlaying = false;
    this.pausedByExtension = false;
    this.translationTooltip = null;
    this.currentHoveredElement = null;

    this.settings = {
      deeplApiKey: window.CONFIG?.DEEPL_API_KEY || ''
    };

    if (!this.settings.deeplApiKey) {
      console.warn('[YouTube Translator] API key not configured');
    }

    this.init();
  }

  init() {
    this.waitForYouTubeLoad();
  }

  waitForYouTubeLoad() {
    const observer = new MutationObserver(() => {
      const captionContainer = document.querySelector('.ytp-caption-window-container');
      if (captionContainer) {
        observer.disconnect();
        this.setupSubtitleHover();
        this.detectVideo();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  detectVideo() {
    this.video = document.querySelector('video.html5-main-video');
    if (this.video) {
      this.isVideoPlaying = !this.video.paused;

      this.video.addEventListener('play', () => {
        this.isVideoPlaying = true;
      });

      this.video.addEventListener('pause', () => {
        if (!this.pausedByExtension) {
          this.isVideoPlaying = false;
        }
      });
    } else {
      console.warn('[YouTube Translator] Video element not found');
    }
  }

  setupSubtitleHover() {
    const captionContainer = document.querySelector('.ytp-caption-window-container');
    if (!captionContainer) return;

    const observer = new MutationObserver(() => {
      this.attachHoverEvents();
    });

    observer.observe(captionContainer, {
      childList: true,
      subtree: true,
      characterData: true
    });

    this.attachHoverEvents();
  }

  attachHoverEvents() {
    const captionSegments = document.querySelectorAll('.ytp-caption-segment');

    captionSegments.forEach(segment => {
      if (!segment.hasAttribute('data-translate-enabled')) {
        segment.setAttribute('data-translate-enabled', 'true');

        segment.addEventListener('mouseenter', (e) => {
          this.handleSubtitleHover(e);
        });

        segment.addEventListener('mouseleave', () => {
          this.handleSubtitleLeave();
        });

        segment.style.cursor = 'pointer';
        segment.style.position = 'relative';
      }
    });
  }

  async handleSubtitleHover(event) {
    const segment = event.target;
    this.currentHoveredElement = segment;

    // ホバーした瞬間に動画を一時停止
    if (this.video && this.isVideoPlaying && !this.pausedByExtension) {
      this.video.pause();
      this.pausedByExtension = true;
    }

    const wordAtPosition = this.getWordAtMousePosition(event);

    if (!wordAtPosition) {
      return;
    }

    const sentenceText = this.getFullSentence();

    this.showLoadingTooltip(event);

    try {
      // 並行して辞書情報と文章翻訳を取得
      const [dictionaryInfo, sentenceTranslation] = await Promise.all([
        this.getDictionaryInfo(wordAtPosition),
        this.translateText(sentenceText)
      ]);

      this.showEnhancedTooltip(event, {
        word: wordAtPosition,
        dictionary: dictionaryInfo,
        sentence: sentenceText,
        sentenceTranslation: sentenceTranslation
      });
    } catch (error) {
      console.error('Translation error:', error);
      this.showErrorTooltip(event);
    }
  }

  handleSubtitleLeave() {
    this.hideTooltip();

    setTimeout(() => {
      if (this.pausedByExtension && !this.currentHoveredElement) {
        if (this.video) {
          this.video.play();
        }
        this.pausedByExtension = false;
      }
    }, 100);

    this.currentHoveredElement = null;
  }

  getWordAtMousePosition(event) {
    const x = event.clientX;
    const y = event.clientY;

    let range;
    // eslint-disable-next-line deprecation/deprecation
    if (document.caretRangeFromPoint) {
      // eslint-disable-next-line deprecation/deprecation
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    }

    if (!range) {
      const fullText = event.target.textContent.trim();
      const firstWord = fullText.split(/\s+/)[0].replace(/[^\w\s'-]/g, '').trim();
      return firstWord;
    }

    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) {
      const fullText = event.target.textContent.trim();
      const firstWord = fullText.split(/\s+/)[0].replace(/[^\w\s'-]/g, '').trim();
      return firstWord;
    }

    const text = textNode.textContent;
    const offset = range.startOffset;

    // カーソル位置の前後から単語の境界を見つける
    const beforeCursor = text.substring(0, offset);
    const afterCursor = text.substring(offset);

    // 単語の開始位置を見つける（スペース、改行、タブの直後）
    let wordStart = 0;
    const lastSpace = beforeCursor.lastIndexOf(' ');
    const lastNewline = beforeCursor.lastIndexOf('\n');
    const lastTab = beforeCursor.lastIndexOf('\t');
    wordStart = Math.max(lastSpace, lastNewline, lastTab) + 1;

    // 単語の終了位置を見つける（次のスペース、改行、タブ）
    const nextSpaceMatch = afterCursor.match(/[\s\n\t]/);
    const wordEnd = nextSpaceMatch ? offset + nextSpaceMatch.index : text.length;

    // 単語を抽出
    const rawWord = text.substring(wordStart, wordEnd);
    // 句読点を除去
    const cleanWord = rawWord.replace(/[^\w\s'-]/g, '').trim();

    return cleanWord || text.split(/\s+/)[0].replace(/[^\w\s'-]/g, '').trim();
  }

  getFullSentence() {
    const captionWindow = document.querySelector('.caption-window');
    if (!captionWindow) return '';

    const allSegments = captionWindow.querySelectorAll('.ytp-caption-segment');
    return Array.from(allSegments).map(seg => seg.textContent.trim()).join(' ');
  }


  async getDictionaryInfo(word) {
    try {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: 'dictionary',
            word: word
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('Dictionary runtime error:', chrome.runtime.lastError);
              resolve(null);
              return;
            }

            if (response && response.success) {
              resolve(response.dictionary);
            } else {
              console.log('Dictionary lookup failed:', response?.error);
              resolve(null);
            }
          }
        );
      });
    } catch (error) {
      console.error('Dictionary error:', error);
      return null;
    }
  }

  async translateText(text) {
    if (!this.settings.deeplApiKey) {
      return 'DeepL API キーが設定されていません';
    }

    try {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: 'translate',
            text: text,
            apiKey: this.settings.deeplApiKey
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('Runtime error:', chrome.runtime.lastError);
              resolve('翻訳エラーが発生しました');
              return;
            }

            if (response && response.success) {
              resolve(response.translation);
            } else {
              console.error('Translation failed:', response?.error);
              resolve(response?.error || '翻訳エラーが発生しました');
            }
          }
        );
      });
    } catch (error) {
      console.error('Translation error:', error);
      return 'Translation error occurred';
    }
  }

  showLoadingTooltip(event) {
    this.hideTooltip();

    this.translationTooltip = document.createElement('div');
    this.translationTooltip.className = 'youtube-translation-tooltip loading';
    this.translationTooltip.innerHTML = `
      <div class="translation-loading">
        <div class="spinner"></div>
        <span>翻訳中...</span>
      </div>
    `;

    this.positionTooltip(event);
    document.body.appendChild(this.translationTooltip);
  }

  showEnhancedTooltip(event, data) {
    this.hideTooltip();

    this.translationTooltip = document.createElement('div');
    this.translationTooltip.className = 'youtube-translation-tooltip enhanced';

    let dictionaryHTML = '';
    if (data.dictionary) {
      const dict = data.dictionary;

      // 発音情報
      let phoneticHTML = '';
      if (dict.phonetics && dict.phonetics.length > 0) {
        phoneticHTML = `<div class="phonetic">${dict.phonetics[0].text}</div>`;
      }

      // 意味情報
      let meaningsHTML = '';
      if (dict.meanings && dict.meanings.length > 0) {
        meaningsHTML = dict.meanings.map(meaning => {
          const definitionsHTML = meaning.definitions.map(def => {
            let defHTML = `<div class="definition">${def.definition}</div>`;
            if (def.example) {
              defHTML += `<div class="example">"${def.example}"</div>`;
            }
            return defHTML;
          }).join('');

          return `
            <div class="meaning-group">
              <div class="part-of-speech">${meaning.partOfSpeech}</div>
              ${definitionsHTML}
            </div>
          `;
        }).join('');
      }

      // 類義語情報
      let synonymsHTML = '';
      if (dict.synonyms && dict.synonyms.length > 0) {
        const synonymsList = dict.synonyms.slice(0, 5).join(', '); // 最大5つまで
        synonymsHTML = `
          <div class="synonyms-section">
            <span class="synonyms-label">類義語:</span>
            <span class="synonyms-list">${synonymsList}</span>
          </div>
        `;
      }

      dictionaryHTML = `
        <div class="dictionary-section">
          <div class="word-header">
            <span class="word-text">${dict.word}</span>
            ${phoneticHTML}
          </div>
          ${meaningsHTML}
          ${synonymsHTML}
        </div>
      `;
    }

    this.translationTooltip.innerHTML = `
      <div class="translation-content">
        ${dictionaryHTML}
        <div class="translation-section">
          <div class="sentence-translation">
            <div class="sentence-label">文全体:</div>
            <div class="original-sentence">${data.sentence}</div>
            <div class="translated-sentence">${data.sentenceTranslation}</div>
          </div>
        </div>
      </div>
    `;

    this.positionTooltip(event);
    document.body.appendChild(this.translationTooltip);
  }

  showTranslationTooltip(event, translations) {
    this.hideTooltip();

    this.translationTooltip = document.createElement('div');
    this.translationTooltip.className = 'youtube-translation-tooltip';
    this.translationTooltip.innerHTML = `
      <div class="translation-content">
        <div class="word-translation">
          <div class="original-text">"${translations.word}"</div>
          <div class="translated-text">${translations.wordTranslation}</div>
        </div>
        <div class="sentence-translation">
          <div class="sentence-label">文全体:</div>
          <div class="original-sentence">${translations.sentence}</div>
          <div class="translated-sentence">${translations.sentenceTranslation}</div>
        </div>
      </div>
    `;

    this.positionTooltip(event);
    document.body.appendChild(this.translationTooltip);
  }

  showErrorTooltip(event) {
    this.hideTooltip();

    this.translationTooltip = document.createElement('div');
    this.translationTooltip.className = 'youtube-translation-tooltip error';
    this.translationTooltip.innerHTML = `
      <div class="translation-error">
        <span>翻訳エラーが発生しました</span>
      </div>
    `;

    this.positionTooltip(event);
    document.body.appendChild(this.translationTooltip);
  }

  positionTooltip(event) {
    if (!this.translationTooltip) return;

    const rect = event.target.getBoundingClientRect();
    const tooltipRect = this.translationTooltip.getBoundingClientRect();

    // 字幕エリアと行を検出
    const captionWindow = document.querySelector('.caption-window');
    if (!captionWindow) {
      // フォールバック: 字幕エリアが見つからない場合は上に表示
      const top = rect.top - tooltipRect.height - 15;
      const left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
      this.setTooltipPosition(top, left, tooltipRect);
      return;
    }

    const captionRect = captionWindow.getBoundingClientRect();

    let top, left;
    left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

    // 常に字幕エリア全体の下に表示
    top = captionRect.bottom + 15;

    this.setTooltipPosition(top, left, tooltipRect);
  }

  setTooltipPosition(top, left, tooltipRect) {
    // 画面境界の調整
    if (top < 10) {
      top = 10;
    } else if (top + tooltipRect.height > window.innerHeight - 10) {
      top = window.innerHeight - tooltipRect.height - 10;
    }

    if (left < 10) {
      left = 10;
    } else if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }

    this.translationTooltip.style.position = 'fixed';
    this.translationTooltip.style.top = `${top}px`;
    this.translationTooltip.style.left = `${left}px`;
    this.translationTooltip.style.zIndex = '9999999';
  }

  hideTooltip() {
    if (this.translationTooltip) {
      this.translationTooltip.remove();
      this.translationTooltip = null;
    }
  }
}

if (window.location.hostname === 'www.youtube.com') {
  new YouTubeSubtitleTranslator();
}
