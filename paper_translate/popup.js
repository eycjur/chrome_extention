function changeText(text, is_new_window = false) {
  let deep_url = "https://www.deepl.com/translator#en/ja/";
  text = text.replace(/-\s/g, "")
    .replace(/-\n/g, "")
    .replace(/(?<!\.)\n/g, " ")  // 否定的後読み
    .replace(/%/g, "％")
    .replace(/\//g, "／")
    .replace(/#/g, "＃")
    .replace(/\|/g, "｜")
    .replace(/:/g, ":\n")
    // .replace(/.,/g, ",")
  deep_url += encodeURI(text);

  // 新しいウィンドウで開く
  if (is_new_window) {
    window.open(deep_url);
  }
  // 新しいタブで開く
  else {
    chrome.tabs.create({
      url: deep_url
    })
  }
};

//enter時の挙動
document.addEventListener('DOMContentLoaded', function () {
  let input = document.querySelector('#input');
  input.addEventListener('keydown', function (event) {
    let text = input.value;
    // ctrl + enter or cmd + enter
    if (event.key == "Enter" && (event.ctrlKey || event.metaKey)) {
      changeText(text);
      // shift + enter
    } else if (event.key == "Enter" && event.shiftKey) {
      changeText(text, is_new_window = true);
    }
  })
});
