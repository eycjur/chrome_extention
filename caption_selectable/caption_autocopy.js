const selectorStr = "div > div[aria-label='Captions']:last-child > div > div:nth-child(2)";

setInterval(
    () => {
        let selector = document.querySelector(selectorStr);
        if (selector) {
            navigator.clipboard.writeText(selector.innerText);
        }
    },
    5000,
);
