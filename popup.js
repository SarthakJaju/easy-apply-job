import { ChromaClient } from './src/chromadb.js';
import { TextSplitter, EmbeddingEngine } from './src/embeddings.js';

const chromaClient = new ChromaClient();
const splitter = new TextSplitter({ chunkSize: 200, chunkOverlap: 30 });
const embeddingEngine = new EmbeddingEngine();

document.addEventListener('DOMContentLoaded', () => {
  const summaryInput = document.getElementById('summary');
  const jdInput = document.getElementById('jdDescription');
  const statusDiv = document.getElementById('status');
  
  const saveSummaryBtn = document.getElementById('saveSummary');
  const saveJDBtn = document.getElementById('saveJD');
  const scanBtn = document.getElementById('scanJD');
  const openSidebarBtn = document.getElementById('openSidebar');

  // Status badges
  const summaryBadge = document.getElementById('summary-badge');
  const jdBadge = document.getElementById('jd-badge');

  // Load existing values and check vector database status
  chrome.storage.local.get(['careerSummary', 'lastScannedJD'], (result) => {
    if (result.careerSummary) {
      summaryInput.value = result.careerSummary;
    }
    if (result.lastScannedJD) {
      jdInput.value = result.lastScannedJD;
    }
    checkDatabaseStatus();
  });

  /**
   * Checks local vector database status directly.
   */
  async function checkDatabaseStatus() {
    try {
      const summaryColl = await chromaClient.getCollection("candidate_profile");
      const jdColl = await chromaClient.getCollection("job_description");

      if (summaryColl.data && summaryColl.data.embeddings && summaryColl.data.embeddings.length > 0) {
        setSyncStatus('summary', 'synced');
      } else {
        setSyncStatus('summary', 'unsynced');
      }

      if (jdColl.data && jdColl.data.embeddings && jdColl.data.embeddings.length > 0) {
        setSyncStatus('jd', 'synced');
      } else {
        setSyncStatus('jd', 'unsynced');
      }
    } catch (e) {
      console.error("Failed to check database status:", e);
      setSyncStatus('summary', 'unsynced');
      setSyncStatus('jd', 'unsynced');
    }
  }

  /**
   * Helper to set CSS classes and text for vector database status indicator.
   * @param {'summary' | 'jd'} type 
   * @param {'synced' | 'syncing' | 'unsynced'} state 
   */
  function setSyncStatus(type, state) {
    const badge = type === 'summary' ? summaryBadge : jdBadge;
    
    badge.className = "sync-badge";
    badge.classList.add(state);
    
    const icon = badge.querySelector('.badge-icon');
    const text = badge.querySelector('.badge-text');
    
    if (state === 'synced') {
      icon.innerText = "✓";
      text.innerText = "Synced";
    } else if (state === 'syncing') {
      icon.innerText = "🔄";
      text.innerText = "Syncing...";
    } else {
      icon.innerText = "✗";
      text.innerText = "Unsynced";
    }
  }

  /**
   * Helper to show action status alerts.
   * @param {string} msg 
   * @param {'success' | 'error' | 'info'} type 
   */
  function showStatus(msg, type) {
    statusDiv.className = "";
    if (type === 'success') statusDiv.classList.add('text-success');
    if (type === 'error') statusDiv.classList.add('text-error');
    if (type === 'info') statusDiv.classList.add('text-info');
    
    statusDiv.innerText = msg;
    setTimeout(() => {
      statusDiv.innerText = "";
      statusDiv.className = "";
    }, 4500);
  }

  // Save and embed Career Summary
  saveSummaryBtn.addEventListener('click', async () => {
    const summaryText = summaryInput.value.trim();
    if (!summaryText) {
      showStatus("Please enter summary text first.", "error");
      return;
    }

    setSyncStatus('summary', 'syncing');
    showStatus("Processing embeddings. Please wait...", "info");

    chrome.storage.local.set({ careerSummary: summaryText }, async () => {
      try {
        const chunks = splitter.splitText(summaryText);
        const embeddings = await embeddingEngine.getEmbeddings(chunks);
        const collection = await chromaClient.createCollection("candidate_profile");
        
        await collection.delete({ ids: collection.data.ids });
        
        const ids = chunks.map((_, idx) => `summary_chunk_${idx}`);
        const metadatas = chunks.map(() => ({ type: "summary" }));
        
        await collection.add({ ids, embeddings, documents: chunks, metadatas });

        setSyncStatus('summary', 'synced');
        showStatus(`✓ Vector DB synced successfully! (${chunks.length} chunks created)`, "success");
      } catch (err) {
        console.error(err);
        setSyncStatus('summary', 'unsynced');
        showStatus("✗ Vector sync failed: " + err.message, "error");
      }
    });
  });

  // Save and embed manual JD
  saveJDBtn.addEventListener('click', async () => {
    const jdText = jdInput.value.trim();
    if (!jdText) {
      showStatus("Please paste a Job Description first.", "error");
      return;
    }

    setSyncStatus('jd', 'syncing');
    showStatus("Processing embeddings. Please wait...", "info");

    chrome.storage.local.set({ lastScannedJD: jdText }, async () => {
      try {
        const chunks = splitter.splitText(jdText);
        const embeddings = await embeddingEngine.getEmbeddings(chunks);
        const collection = await chromaClient.createCollection("job_description");
        
        await collection.delete({ ids: collection.data.ids });
        
        const ids = chunks.map((_, idx) => `jd_chunk_${idx}`);
        const metadatas = chunks.map(() => ({ type: "jd" }));
        
        await collection.add({ ids, embeddings, documents: chunks, metadatas });

        setSyncStatus('jd', 'synced');
        showStatus(`✓ Vector DB synced successfully! (${chunks.length} chunks created)`, "success");
      } catch (err) {
        console.error(err);
        setSyncStatus('jd', 'unsynced');
        showStatus("✗ Vector sync failed: " + err.message, "error");
      }
    });
  });

  const handleScannedJD = (jdText) => {
    jdInput.value = jdText;
    setSyncStatus('jd', 'syncing');
    showStatus("Vectorizing scanned Job Description...", "info");

    chrome.storage.local.set({ lastScannedJD: jdText }, async () => {
      try {
        const chunks = splitter.splitText(jdText);
        const embeddings = await embeddingEngine.getEmbeddings(chunks);
        const collection = await chromaClient.createCollection("job_description");
        
        await collection.delete({ ids: collection.data.ids });
        
        const ids = chunks.map((_, idx) => `jd_chunk_${idx}`);
        const metadatas = chunks.map(() => ({ type: "jd" }));
        
        await collection.add({ ids, embeddings, documents: chunks, metadatas });

        setSyncStatus('jd', 'synced');
        showStatus("✓ JD Auto-Scanned and stored in ChromaDB!", "success");
      } catch (err) {
        console.error(err);
        setSyncStatus('jd', 'unsynced');
        showStatus("✗ Scanned but vector sync failed: " + err.message, "error");
      }
    });
  };

  // Auto-Scan Job Description from target web page
  scanBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    showStatus("Scanning job web page details...", "info");

    chrome.tabs.sendMessage(tab.id, { action: "SCAN_JD" }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script is not injected, inject it now using activeTab permission
        Promise.all([
          chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] }),
          chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/content.js"] })
        ]).then(() => {
          chrome.tabs.sendMessage(tab.id, { action: "SCAN_JD" }, (retryResponse) => {
            if (chrome.runtime.lastError || !retryResponse || !retryResponse.success) {
              showStatus("✗ JD not found. Ensure you are on a supported job page.", "error");
            } else {
              handleScannedJD(retryResponse.text);
            }
          });
        }).catch((err) => {
          console.error("Injection failed:", err);
          showStatus("✗ Cannot scan on this system page.", "error");
        });
      } else if (!response || !response.success) {
        showStatus("✗ JD not found. Ensure you are on a supported job page.", "error");
      } else {
        handleScannedJD(response.text);
      }
    });
  });

  // Open the slide panel in active tab
  openSidebarBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, { action: "OPEN_SIDEBAR" }, (response) => {
      if (chrome.runtime.lastError) {
        // Fallback: Inject scripts dynamically using activeTab permission
        Promise.all([
          chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] }),
          chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/content.js"] })
        ]).then(() => {
          chrome.tabs.sendMessage(tab.id, { action: "OPEN_SIDEBAR" });
          showStatus("✓ Sidebar opened!", "success");
        }).catch((err) => {
          console.error("Injection failed:", err);
          showStatus("✗ Cannot open assistant on system pages.", "error");
        });
      } else {
        showStatus("✓ Sidebar opened!", "success");
      }
    });
  });
});