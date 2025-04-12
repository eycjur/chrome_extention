const AVAILABLE_TIME = 300;

console.log("test_period.js is loaded");

const customAlertBox = document.createElement('div');
customAlertBox.id = 'customAlert';
customAlertBox.className = 'custom-alert';
document.body.appendChild(customAlertBox);

// カスタムアラートボックスを表示
function showCustomAlert(text) {
  customAlertBox.style.display = 'block';
  customAlertBox.innerText = text;
}

let time = AVAILABLE_TIME;

setInterval(() => {
  time -= 1;

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
  } else if (time <= 60) {
    showCustomAlert("残り" + time + "秒です");
  }
}, 1000);
