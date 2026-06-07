// background.js - Minimal service worker for MV3
// Clicking the extension toolbar icon directly toggles the sidebar panel on the page.

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  
  // Exclude chrome:// and edge:// system URLs
  if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("edge://"))) {
    return;
  }

  // Try sending the toggle message, if content script is not loaded, inject it
  chrome.tabs.sendMessage(tab.id, { action: "OPEN_SIDEBAR" }, (response) => {
    if (chrome.runtime.lastError) {
      // Content script is not injected, inject dist/content.js and content.css now
      chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] })
        .then(() => {
          return chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/content.js"] });
        })
        .then(() => {
          chrome.tabs.sendMessage(tab.id, { action: "OPEN_SIDEBAR" });
        })
        .catch((err) => {
          console.error("Failed to inject sidepanel on click:", err);
        });
    }
  });
});