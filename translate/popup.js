function trans(is_not_replace) {
  let before = document.getElementById("before");
  let text = before.value;
  let request = new XMLHttpRequest();

  request.open('GET', `https://script.google.com/macros/s/AKfycbweRex80LP2Ib9cFIsq5CcfeUyv71ggwwCvZPwqF6ThC9G78w/exec?text=${text}&source=ja&target=en`, true);

  request.onload = function () {
    let data = JSON.parse(this.response);
    let text = data["text"];
    if (!is_not_replace) {
      text = text.replaceAll(" ", "_");
    }
    let after = document.getElementById("after");

    after.value = text;
    navigator.clipboard.writeText(text);
  }
  request.send();
}

//enter時の挙動
document.addEventListener('DOMContentLoaded', function () {
  document.querySelector('#before').addEventListener('keydown', function (event) {
    if (event.key == "Enter") {
      trans(is_not_replace = !event.ctrlKey && !event.metaKey);
    }
  })
});
