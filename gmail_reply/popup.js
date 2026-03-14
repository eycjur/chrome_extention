document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('api-key-input');
  const modelSelect = document.getElementById('model-select');
  const saveBtn = document.getElementById('save-btn');
  const statusMsg = document.getElementById('status-msg');
  const toggleVisBtn = document.getElementById('toggle-visibility-btn');
  const eyeIcon = document.getElementById('eye-icon');
  const eyeOffIcon = document.getElementById('eye-off-icon');

  // Load saved settings
  const saved = await chrome.storage.sync.get(['apiKey', 'model']);
  if (saved.apiKey) apiKeyInput.value = saved.apiKey;
  if (saved.model) modelSelect.value = saved.model;

  // Toggle API key visibility
  toggleVisBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    eyeIcon.style.display = isPassword ? 'none' : '';
    eyeOffIcon.style.display = isPassword ? '' : 'none';
  });

  // Save settings
  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;

    if (!apiKey) {
      showStatus('APIキーを入力してください', 'error');
      return;
    }

    if (!apiKey.startsWith('AIza')) {
      showStatus('APIキーの形式が正しくありません（AIza... で始まるキーを入力してください）', 'error');
      return;
    }

    await chrome.storage.sync.set({ apiKey, model });
    showStatus('保存しました', 'success');
  });

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status-msg ${type}`;
    statusMsg.style.display = 'block';
    setTimeout(() => { statusMsg.style.display = 'none'; }, 3000);
  }
});
