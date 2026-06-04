document.addEventListener('DOMContentLoaded', () => {
    const summaryInput = document.getElementById('summary');
    const jdInput = document.getElementById('jdDescription');
    const statusDiv = document.getElementById('status');
    const saveBtn = document.getElementById('saveSummary');
    const saveJDBtn = document.getElementById('saveJD');
    const scanBtn = document.getElementById('scanJD');

    // Load existing summary and JD from storage
    chrome.storage.local.get(['careerSummary', 'lastScannedJD'], (result) => {
        if (result.careerSummary) {
            summaryInput.value = result.careerSummary;
        }
        if (result.lastScannedJD) {
            jdInput.value = result.lastScannedJD;
        }
    });

    // Save Career Summary to local storage
    saveBtn.addEventListener('click', () => {
        const summaryText = summaryInput.value.trim();
        chrome.storage.local.set({ careerSummary: summaryText }, () => {
            statusDiv.style.color = "#0073b1";
            statusDiv.innerText = "✅ Summary saved successfully!";
            setTimeout(() => { statusDiv.innerText = ""; }, 3000);
        });
    });

    // Save manual Job Description to local storage
    saveJDBtn.addEventListener('click', () => {
        const jdText = jdInput.value.trim();
        chrome.storage.local.set({ lastScannedJD: jdText }, () => {
            statusDiv.style.color = "#0073b1";
            statusDiv.innerText = "✅ Job Description saved!";
            setTimeout(() => { statusDiv.innerText = ""; }, 3000);
        });
    });

    // Trigger JD Scan in the current tab via messaging
    scanBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;

        chrome.tabs.sendMessage(tab.id, { action: "SCAN_JD" }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
                statusDiv.style.color = "red";
                statusDiv.innerText = "❌ JD not found. Ensure you are on a job page.";
            } else {
                statusDiv.style.color = "#28a745";
                statusDiv.innerText = "✅ JD Highlighted & Saved!";
                // Update the text area with the scanned content
                if (response.text) {
                    jdInput.value = response.text;
                }
            }
        });
    });
});