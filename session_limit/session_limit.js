// Configuration
const initialTime = 300;

console.log("session_limit.js is loaded");

// Function to create the alert box
function createAlertBox() {
  const alertBox = document.createElement('div');
  alertBox.id = 'customAlert';
  alertBox.className = 'custom-alert';
  alertBox.innerHTML = `
    <p id="alertText"></p>
    <button id="addTimeButton">+10秒</button>
  `;
  document.body.appendChild(alertBox);

  const alertMessage = alertBox.querySelector('#alertText');
  const addTimeButtonElement = alertBox.querySelector('#addTimeButton');
  addTimeButtonElement.addEventListener('click', addTenSeconds);

  return { alertBox, alertMessage, addTimeButtonElement };
}

const { alertBox, alertMessage, addTimeButtonElement } = createAlertBox();

// Function to display the custom alert box
function showCustomAlert(text) {
  alertBox.style.display = 'block';
  alertMessage.innerText = text;
}

// Initial time
let time = initialTime;

// Function to add 10 seconds to the timer
function addTenSeconds() {
  time += 10;
  console.log("Time added. New time:", time);
}

// Main timer logic
setInterval(() => {
  time -= 1;

  console.log("rest time", time);

  if (time <= 0) {
    console.log("time is over");
    window.open("https://www.google.co.jp/webhp", "_self");
    setTimeout(() => {
      try {
        window.close();
      } catch (e) {
        console.log("window.close() failed");
      }
    }, 10);
  } else if (time <= 60 || alertBox.style.display === 'block') {
    showCustomAlert("残り" + time + "秒です");
  }
}, 1000);
