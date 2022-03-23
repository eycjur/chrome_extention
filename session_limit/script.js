let DEFAULT_TIME = 600;
let time = DEFAULT_TIME;
let cnt = 0;
let interval_timer = null;
let interval_check = null;


function timer() {
  chrome.tabs.query({}, (tab) => {
    url = tab.url;
    if (url.includes("https://www.google.co.jp/webhp")) {
      time = DEFAULT_TIME;
    }
  })
  console.log(time);

  // 残り時間を表示
  minute = Math.floor(time / 60);
  second = time % 60;
  chrome.action.setBadgeText({
    text: `${minute}:${('0' + second).slice(-2)}`
  });

  // 時間切れ
  if (time == 0) {
    time_over(); gi
  }
  time -= 1;
}

// 時間が切れているときの処理
function open_todoist() {
  console.log("now on interval");
  chrome.tabs.query({}, (tab) => {
    url = tab.url;
    if (url.includes("https://www.google.co.jp/webhp")) {
      time = DEFAULT_TIME;
      clearInterval(interval_timer);
      interval_timer = setInterval(timer, 1000);
    } else if (!url.includes("todoist")) {
      chrome.tabs.executeScript({
        code: `
				window.open('about:blank','_self').close();
				`,
      });
    };
  });
}

// 時間が切れたら、インターバルを解除して、切れているときの処理を行う
function time_over() {
  clearInterval(interval_timer);
  clearInterval(interval_check);
  interval_check = setInterval(() => {
    console.log(`cnt:${cnt}`)
    if (time > 0) {  // cnt > 60 * 1000
      clearInterval(interval_check);
    }
    // cnt += 1;
    open_todoist();
  }, 1000);
}

// 時間を数える処理
interval_timer = setInterval(timer, 1000);

// アイコンクリックで10秒追加に設定
chrome.action.onClicked.addListener(() => {
  time = Math.max(time, 50) + 10;
  clearInterval(interval_timer);
  interval_timer = setInterval(timer, 1000);
});
