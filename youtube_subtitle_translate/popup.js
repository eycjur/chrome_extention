document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
  setupEventListeners();
});

function loadSettings() {
  chrome.storage.sync.get({
    // cspell:disable-next-line
    deeplApiKey: ''
  }, function(items) {
    // cspell:disable-next-line
    document.getElementById('deeplApiKey').value = items.deeplApiKey;
  });
}

function setupEventListeners() {
  // cspell:disable-next-line
  document.getElementById('deeplApiKey').addEventListener('input', function(e) {
    // cspell:disable-next-line
    chrome.storage.sync.set({
      // cspell:disable-next-line
      deeplApiKey: e.target.value
    });
  });

}