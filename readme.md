# Chrome Extensions

A collection of handy Chrome extensions to boost your daily browsing, including AI-powered tools for summarization, translation, and writing assistance. Each directory is an independent extension.

## Extensions

### translate — Japanese to English Translator

A popup tool that translates Japanese text into English via Google Apps Script.

- **Shortcut**: `Ctrl+Y` / `MacCtrl+Y` to open the popup
- Press `Enter` to translate — spaces are replaced with underscores (useful for identifiers)
- Press `Ctrl+Enter` / `Cmd+Enter` to translate while preserving spaces
- The translated result is automatically copied to the clipboard

---

### new_tab — New Tab Redirect

Redirects new tabs to Google (google.co.jp).

---

### session_limit — Short-form Video Timer

Limits browsing time to 5 minutes on short-form video platforms.

- Starts a 300-second countdown when you visit a target site
- Shows an alert when 30 seconds remain
- Redirects to Google (google.co.jp) when time is up
- A `+10s` button lets you extend the timer

---

### youtube_subtitle_translate — YouTube Subtitle Translator

Translates YouTube subtitles on hover and automatically pauses the video. Powered by the DeepL API.

**Required**: DeepL API key

---

### page_summary — AI Page Summarizer

Summarizes web pages and YouTube videos using Gemini AI.

- Trigger via right-click context menu or a floating button
- Works on both web pages and YouTube videos

**Required**: Gemini API key (set in the extension popup)

---

### gmail_reply — Gmail Reply Assistant

Automatically drafts reply emails based on Gmail thread content using Gemini AI.

**Required**: Gemini API key (set in the extension popup)

---

## Installation

Each extension is installed individually.

1. Open `chrome://extensions/`
2. Enable **Developer mode** in the top right
3. Click **Load unpacked**
4. Select the directory of the extension you want to install (e.g. `translate/`)

## Directory Structure

```
chrome_extention/
├── translate/                  # Japanese to English translator
├── new_tab/                    # New tab redirect
├── session_limit/              # Short-form video timer
├── youtube_subtitle_translate/ # YouTube subtitle translator (DeepL)
├── page_summary/               # AI page summarizer (Gemini)
└── gmail_reply/                # Gmail reply assistant (Gemini)
```
