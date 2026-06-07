(() => {
  // background.js
  chrome.action.onClicked.addListener((tab) => {
    if (!tab || !tab.id) return;
    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("edge://"))) {
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: "OPEN_SIDEBAR" }, (response) => {
      if (chrome.runtime.lastError) {
        chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] }).then(() => {
          return chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/content.js"] });
        }).then(() => {
          chrome.tabs.sendMessage(tab.id, { action: "OPEN_SIDEBAR" });
        }).catch((err) => {
          console.error("Failed to inject sidepanel on click:", err);
        });
      }
    });
  });
})();
