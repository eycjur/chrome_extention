const AVAILABLE_TIME = 300;
const TIME_INTERVAL = 5;

console.log("test_period.js is loaded");

const customAlertBox = document.createElement('div');
customAlertBox.id = 'customAlert';
customAlertBox.className = 'custom-alert';
document.body.appendChild(customAlertBox);

// カスタムアラートボックスを表示して、自動で消す関数
function showCustomAlert(text, timeout) {
  customAlertBox.style.display = 'block';
  customAlertBox.innerText = text;

  setTimeout(function() {
    customAlertBox.style.display = 'block';
  }, timeout);
}

let time = AVAILABLE_TIME;

setInterval(() => {
  time -= TIME_INTERVAL;

  console.log("rest time", time);

  if (time <= 0) {
    console.log("time is over");
    window.open("https://www.google.co.jp/webhp", "_self");
    setTimeout(() => {
      try{
        window.close();
      } catch (e) {
        console.log("window.close() failed");
      }
    }, 10);
  } else if (time <= TIME_INTERVAL * 10) {
    showCustomAlert("残り" + time + "秒です", 1000);
  }
}, 1000 * TIME_INTERVAL);
