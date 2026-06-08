import { RAGService } from './src/rag.js';
import { ChromaClient } from './src/chromadb.js';
import { EmbeddingEngine, TextSplitter, ReRanker } from './src/embeddings.js';

const ragService = new RAGService();
const chromaClient = new ChromaClient();
const embeddingEngine = new EmbeddingEngine();
const splitter = new TextSplitter({ chunkSize: 200, chunkOverlap: 30 });
const reranker = new ReRanker();

let tabId = null;
let isSyncingProfile = false;
let isSyncingJD = false;

const tabIdPromise = new Promise((resolve) => {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: "GET_TAB_ID" }, (response) => {
      if (response && response.tabId) {
        tabId = response.tabId;
        resolve(response.tabId);
      } else {
        resolve(null);
      }
    });
  } else {
    resolve(null);
  }
});

function isContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function checkAndShowContextInvalid() {
  if (!isContextValid()) {
    const alertDiv = document.getElementById('sb-status-alert');
    if (alertDiv) {
      alertDiv.innerText = "Extension updated. Please refresh the page to continue.";
      alertDiv.className = "error";
      alertDiv.style.display = 'block';
    } else {
      alert("Extension updated. Please refresh the page to continue.");
    }
    return true;
  }
  return false;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SCAN_JD") {
    const result = scanAndHighlightJD();
    sendResponse(result);
  } else if (request.action === "OPEN_SIDEBAR") {
    injectAndOpenSidebar();
    sendResponse({ success: true });
  }
  return true; 
});

/**
 * Injects and opens the sidepanel container inside the active web page context.
 */
async function injectAndOpenSidebar() {
  if (checkAndShowContextInvalid()) return;
  await tabIdPromise;
  // Inject Outfit & Inter fonts from Google Fonts if not present
  if (!document.getElementById('easy-apply-fonts-pre')) {
    const preconnect1 = document.createElement('link');
    preconnect1.rel = 'preconnect';
    preconnect1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(preconnect1);

    const preconnect2 = document.createElement('link');
    preconnect2.rel = 'preconnect';
    preconnect2.href = 'https://fonts.gstatic.com';
    preconnect2.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect2);

    const fontLink = document.createElement('link');
    fontLink.id = 'easy-apply-fonts-pre';
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap';
    document.head.appendChild(fontLink);
  }

  let container = document.getElementById('easy-apply-sidebar-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'easy-apply-sidebar-container';
    container.className = 'easy-apply-minimized dock-right'; // Start minimized and docked right
    
    container.innerHTML = `
      <div id="easy-apply-resize-handle"></div>
      <button id="easy-apply-toggle-btn" title="Open AI Career Assistant">
        <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
        </svg>
      </button>
      <div id="easy-apply-sidebar">
        <div class="easy-apply-header">
          <h4>Easy Job Assistant</h4>
          <button id="easy-apply-minimize-btn" title="Collapse Panel">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="display: block;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="easy-apply-content">
          
          <!-- Vector Sync Status Badges -->
          <div class="sb-status-header">
            <div class="sb-status-badge missing" id="sb-profile-badge">
              <span class="badge-icon">✗</span> Profile
            </div>
            <div class="sb-status-badge missing" id="sb-jd-badge">
              <span class="badge-icon">✗</span> Job Desc
            </div>
          </div>

          <!-- Real-time Status Alert Banner -->
          <div id="sb-status-alert" style="display: none;"></div>

          <!-- Section 1: Candidate Profile -->
          <div class="sb-accordion active" id="acc-profile">
            <div class="sb-accordion-header">
              <span class="sb-accordion-header-title">
                <span>👤</span> Candidate Profile
              </span>
              <span class="sb-accordion-arrow">&#9662;</span>
            </div>
            <div class="sb-accordion-body">
              <textarea id="sb-profile-text" rows="10" placeholder="Paste your resume summary or professional description..."></textarea>
              <button id="sb-profile-save-btn" class="easy-apply-btn">Save & Embed Profile</button>
            </div>
          </div>

          <!-- Section 2: Job Description -->
          <div class="sb-accordion" id="acc-jd">
            <div class="sb-accordion-header">
              <span class="sb-accordion-header-title">
                <span>📄</span> Job Description
              </span>
              <span class="sb-accordion-arrow">&#9662;</span>
            </div>
            <div class="sb-accordion-body">
              <textarea id="sb-jd-text" rows="10" placeholder="Paste target Job Description text..."></textarea>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <button id="sb-jd-scan-btn" class="easy-apply-btn secondary">Auto-Scan JD</button>
                <button id="sb-jd-save-btn" class="easy-apply-btn">Save & Embed JD</button>
              </div>
            </div>
          </div>

          <!-- Section 3: Alignment Analytics -->
          <div class="sb-accordion" id="acc-analytics">
            <div class="sb-accordion-header">
              <span class="sb-accordion-header-title">
                <span>📊</span> Alignment Analytics
              </span>
              <span class="sb-accordion-arrow">&#9662;</span>
            </div>
            <div class="sb-accordion-body">
              <div id="sb-loader" class="sb-loader-container">
                <div class="sb-spinner"></div>
                <span class="sb-loader-text">Analyzing job alignment...</span>
              </div>
              <div id="sb-analysis-section" style="display: none; flex-direction: column; gap: 10px;">
                <div class="score-container">
                  <svg viewBox="0 0 36 36" class="circular-chart">
                    <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path class="circle" id="sb-score-circle" stroke-dasharray="0, 100" stroke="#6366f1" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <text x="18" y="20.3" class="score-text-val" id="sb-score-text">0%</text>
                  </svg>
                  <div class="score-meta">
                    <span class="score-label" id="sb-score-label">Calculating...</span>
                    <span class="score-desc" id="sb-score-desc">Verifying profile matches.</span>
                  </div>
                </div>
                <!-- Sub-accordions in Alignment Analytics -->
                <div class="sub-accordion active" id="sub-acc-summary">
                  <div class="sub-accordion-header">
                    <span>Summary</span>
                    <span class="sub-accordion-arrow">&#9662;</span>
                  </div>
                  <div class="sub-accordion-body" id="sb-summary-text">
                    Loading summary...
                  </div>
                </div>

                <div class="sub-accordion" id="sub-acc-matches">
                  <div class="sub-accordion-header">
                    <span>What Matches</span>
                    <span class="sub-accordion-arrow">&#9662;</span>
                  </div>
                  <div class="sub-accordion-body">
                    <ul class="sb-list matches-list green-text" id="sb-matches-list"></ul>
                  </div>
                </div>

                <div class="sub-accordion" id="sub-acc-gaps">
                  <div class="sub-accordion-header">
                    <span>What Does Not Match</span>
                    <span class="sub-accordion-arrow">&#9662;</span>
                  </div>
                  <div class="sub-accordion-body">
                    <ul class="sb-list non-matches-list red-text" id="sb-non-matches-list"></ul>
                  </div>
                </div>

                <div class="sub-accordion" id="sub-acc-strengths">
                  <div class="sub-accordion-header">
                    <span>Core Strengths</span>
                    <span class="sub-accordion-arrow">&#9662;</span>
                  </div>
                  <div class="sub-accordion-body">
                    <ul class="sb-list strengths-list" id="sb-strengths-list"></ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Section 4: Q&A Assistant -->
          <div class="sb-accordion" id="acc-qa">
            <div class="sb-accordion-header">
              <span class="sb-accordion-header-title">
                <span>💬</span> Q&A Assistant
              </span>
              <span class="sb-accordion-arrow">&#9662;</span>
            </div>
            <div class="sb-accordion-body">
              <input type="text" id="easy-apply-question" placeholder="Ask question based on JD & Resume..." />
              <button id="easy-apply-generate-btn" class="easy-apply-btn">Submit Question</button>
              <textarea id="easy-apply-answer" placeholder="Answers will compile here..." readonly style="margin-top: 4px; min-height: 80px;"></textarea>
            </div>
          </div>
          
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // Event listeners
    document.getElementById('easy-apply-toggle-btn').addEventListener('click', () => {
      container.classList.remove('easy-apply-minimized');
      loadAndRenderReport();
    });

    document.getElementById('easy-apply-minimize-btn').addEventListener('click', () => {
      container.classList.add('easy-apply-minimized');
    });

    // Check Gemini Nano availability on startup
    checkGeminiNano();

    // Dragging logic
    const dragHeader = container.querySelector('.easy-apply-header');
    let isDragging = false;
    let startX, startY, startTop, startLeft;

    dragHeader.addEventListener('mousedown', (e) => {
      if (e.target.id === 'easy-apply-minimize-btn' || e.target.closest('#easy-apply-minimize-btn')) {
        return;
      }
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startTop = container.offsetTop;
      startLeft = container.offsetLeft;
      
      e.preventDefault();

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      container.style.top = `${startTop + deltaY}px`;
      container.style.left = `${startLeft + deltaX}px`;
      container.style.bottom = 'auto';
      container.style.right = 'auto';
    }

    function onMouseUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      // Snap to Left or Right edge of the screen
      const midPoint = container.offsetLeft + (container.offsetWidth / 2);
      const windowMid = window.innerWidth / 2;

      container.style.top = '10px';
      container.style.bottom = '10px';
      container.style.height = 'calc(100vh - 20px)';

      container.classList.remove('dock-left', 'dock-right');
      if (midPoint < windowMid) {
        container.classList.add('dock-left');
        container.style.left = '10px';
        container.style.right = 'auto';
      } else {
        container.classList.add('dock-right');
        container.style.right = '10px';
        container.style.left = 'auto';
      }
    }

    // Resizing logic for Width Shrinkage
    const resizeHandle = container.querySelector('#easy-apply-resize-handle');
    let isResizing = false;
    let resizeStartX, resizeStartWidth;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      resizeStartX = e.clientX;
      resizeStartWidth = container.offsetWidth;
      resizeHandle.classList.add('active');
      
      e.preventDefault();

      document.addEventListener('mousemove', onResizeMove);
      document.addEventListener('mouseup', onResizeUp);
    });

    function onResizeMove(e) {
      if (!isResizing) return;
      const deltaX = e.clientX - resizeStartX;
      const isDockedRight = container.classList.contains('dock-right');
      
      let newWidth;
      if (isDockedRight) {
        newWidth = resizeStartWidth - deltaX;
      } else {
        newWidth = resizeStartWidth + deltaX;
      }

      newWidth = Math.max(280, Math.min(600, newWidth)); // Min 280px, Max 600px width limit
      container.style.width = `${newWidth}px`;
    }

    // Resizing logic completion
    function onResizeUp() {
      isResizing = false;
      resizeHandle.classList.remove('active');
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeUp);
    }

    // Accordions expand/collapse handlers
    const accordions = container.querySelectorAll('.sb-accordion');
    accordions.forEach(acc => {
      const header = acc.querySelector('.sb-accordion-header');
      header.addEventListener('click', () => {
        // Toggle active status
        const isActive = acc.classList.contains('active');
        accordions.forEach(a => a.classList.remove('active')); // Accordion behavior
        if (!isActive) {
          acc.classList.add('active');
        }
      });
    });

    // Sub-accordions expand/collapse handlers
    const subAccordions = container.querySelectorAll('.sub-accordion');
    subAccordions.forEach(subAcc => {
      const subHeader = subAcc.querySelector('.sub-accordion-header');
      subHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = subAcc.classList.contains('active');
        subAccordions.forEach(sa => sa.classList.remove('active'));
        if (!isActive) {
          subAcc.classList.add('active');
        }
      });
    });

    // Submit Question handler
    document.getElementById('easy-apply-generate-btn').addEventListener('click', handleQuestionSubmit);

    const profileText = document.getElementById('sb-profile-text');
    const jdText = document.getElementById('sb-jd-text');

    // Debounced JD updates
    let jdDebounceTimeout = null;
    if (jdText) {
      jdText.addEventListener('input', () => {
        if (jdDebounceTimeout) {
          clearTimeout(jdDebounceTimeout);
        }
        jdDebounceTimeout = setTimeout(async () => {
          const text = jdText.value.trim();
          if (text) {
            handleEmbedJD(text);
          } else {
            const jdStorageKey = `lastScannedJD_tab_${tabId}`;
            const jdCollectionName = `job_description_tab_${tabId}`;
            chrome.storage.local.remove([jdStorageKey]);
            try {
              await chromaClient.deleteCollection(jdCollectionName);
            } catch (err) {
              console.warn("Error deleting collection:", err);
            }
            loadAndRenderReport();
          }
        }, 1500);
      });
    }

    // Load existing summary and JD text from storage
    chrome.storage.local.get(['careerSummary', `lastScannedJD_tab_${tabId}`], (result) => {
      if (result.careerSummary && profileText) {
        profileText.value = result.careerSummary;
      }
      if (result[`lastScannedJD_tab_${tabId}`] && jdText) {
        jdText.value = result[`lastScannedJD_tab_${tabId}`];
      }
    });

    // Save & Embed Candidate Profile
    document.getElementById('sb-profile-save-btn').addEventListener('click', async () => {
      const summaryText = document.getElementById('sb-profile-text').value.trim();
      if (!summaryText) {
        showStatus("Please enter summary text first.", "error");
        return;
      }
      isSyncingProfile = true;
      const btn = document.getElementById('sb-profile-save-btn');
      const originalText = btn.innerText;
      btn.innerText = "Syncing with ChromaDB...";
      btn.disabled = true;

      // Update badge to syncing
      const profileBadge = document.getElementById('sb-profile-badge');
      if (profileBadge) {
        profileBadge.className = "sb-status-badge syncing";
        profileBadge.querySelector('.badge-icon').innerText = "🔄";
      }
      showStatus("Vectorizing profile. Please wait...", "info");

      chrome.storage.local.set({ careerSummary: summaryText }, async () => {
        try {
          const chunks = splitter.splitText(summaryText);
          const embeddings = await embeddingEngine.getEmbeddings(chunks);
          // Delete old collection first to ensure only 1 Profile is stored
          await chromaClient.deleteCollection("candidate_profile");
          const collection = await chromaClient.createCollection("candidate_profile");
          
          const ids = chunks.map((_, idx) => `summary_chunk_${idx}`);
          const metadatas = chunks.map(() => ({ type: "summary" }));
          
          await collection.add({ ids, embeddings, documents: chunks, metadatas });
          
          btn.innerText = originalText;
          btn.disabled = false;
          showStatus(`✓ Profile synced successfully! (${chunks.length} vectors created)`, "success");
          isSyncingProfile = false;
          loadAndRenderReport();
        } catch (err) {
          console.error(err);
          btn.innerText = "Failed to sync profile";
          btn.disabled = false;
          isSyncingProfile = false;
          if (profileBadge) {
            profileBadge.className = "sb-status-badge missing";
            profileBadge.querySelector('.badge-icon').innerText = "✗";
          }
          showStatus("✗ Profile sync failed: " + err.message, "error");
        }
      });
    });

    // Save & Embed Job Description helper
    const handleEmbedJD = async (jdText) => {
      isSyncingJD = true;
      if (jdDebounceTimeout) {
        clearTimeout(jdDebounceTimeout);
        jdDebounceTimeout = null;
      }
      const btn = document.getElementById('sb-jd-save-btn');
      const originalText = btn.innerText;
      btn.innerText = "Syncing...";
      btn.disabled = true;

      // Update badge to syncing
      const jdBadge = document.getElementById('sb-jd-badge');
      if (jdBadge) {
        jdBadge.className = "sb-status-badge syncing";
        jdBadge.querySelector('.badge-icon').innerText = "🔄";
      }
      showStatus("Vectorizing Job Description. Please wait...", "info");

      const jdStorageKey = `lastScannedJD_tab_${tabId}`;
      chrome.storage.local.set({ [jdStorageKey]: jdText }, async () => {
        try {
          const chunks = splitter.splitText(jdText);
          const embeddings = await embeddingEngine.getEmbeddings(chunks);
          
          const jdCollectionName = `job_description_tab_${tabId}`;
          // Delete old collection first to ensure only 1 JD is stored
          await chromaClient.deleteCollection(jdCollectionName);
          const collection = await chromaClient.createCollection(jdCollectionName);
          
          const ids = chunks.map((_, idx) => `jd_chunk_${idx}`);
          const metadatas = chunks.map(() => ({ type: "jd" }));
          
          await collection.add({ ids, embeddings, documents: chunks, metadatas });
          
          btn.innerText = originalText;
          btn.disabled = false;
          showStatus(`✓ JD synced successfully! (${chunks.length} vectors created)`, "success");
          isSyncingJD = false;
          loadAndRenderReport();
        } catch (err) {
          console.error(err);
          btn.innerText = "Failed to sync JD";
          btn.disabled = false;
          isSyncingJD = false;
          if (jdBadge) {
            jdBadge.className = "sb-status-badge missing";
            jdBadge.querySelector('.badge-icon').innerText = "✗";
          }
          showStatus("✗ JD sync failed: " + err.message, "error");
        }
      });
    };

    document.getElementById('sb-jd-save-btn').addEventListener('click', () => {
      const jdText = document.getElementById('sb-jd-text').value.trim();
      if (!jdText) {
        showStatus("Please paste a Job Description first.", "error");
        return;
      }
      handleEmbedJD(jdText);
    });

    // Auto-Scan Job Description
    document.getElementById('sb-jd-scan-btn').addEventListener('click', () => {
      showStatus("Scanning job web page details...", "info");
      const result = scanAndHighlightJD();
      if (result.success) {
        const jdField = document.getElementById('sb-jd-text');
        if (jdField) {
          jdField.value = result.text;
        }
        showStatus("✓ Job description scanned! Vectorizing...", "success");
        handleEmbedJD(result.text); // Automatically save and embed!
      } else {
        showStatus("✗ Job Description could not be scanned. Ensure you are on a supported job page.", "error");
      }
    });
  }

  // Toggle minimized class if container already exists, or open it
  const isMinimized = container.classList.contains('easy-apply-minimized');
  if (isMinimized) {
    container.classList.remove('easy-apply-minimized');
    loadAndRenderReport();
  } else {
    container.classList.add('easy-apply-minimized');
  }
}

/**
 * Loads text chunks from vector DB background context and renders the match report.
 */
async function loadAndRenderReport() {
  if (checkAndShowContextInvalid()) return;
  
  const hasNano = await checkGeminiNano();
  if (!hasNano) {
    showErrorState("Chrome's native Gemini Nano AI is unavailable on this device. Please enable Gemini Nano in chrome://flags.");
    return;
  }

  const loader = document.getElementById('sb-loader');
  const section = document.getElementById('sb-analysis-section');
  
  if (isSyncingProfile || isSyncingJD) {
    if (loader) loader.style.display = 'flex';
    if (section) section.style.display = 'none';
    const loaderText = document.querySelector('.sb-loader-text');
    if (loaderText) {
      loaderText.innerText = isSyncingProfile ? "Vectorizing Candidate Profile. Please wait..." : "Vectorizing Job Description. Please wait...";
      loaderText.style.color = 'var(--sb-text-muted)';
    }
    const spinner = document.querySelector('.sb-spinner');
    if (spinner) {
      spinner.style.display = 'block';
    }
    return;
  }

  // Reset loader/spinner visibility and style states in case of previous errors
  const loaderText = document.querySelector('.sb-loader-text');
  if (loaderText) {
    loaderText.innerText = "Analyzing job alignment...";
    loaderText.style.color = 'var(--sb-text-muted)';
  }
  const spinner = document.querySelector('.sb-spinner');
  if (spinner) {
    spinner.style.display = 'block';
  }
  
  loader.style.display = 'flex';
  section.style.display = 'none';

  try {
    const summaryColl = await chromaClient.getCollection("candidate_profile");
    const jdColl = await chromaClient.getCollection(`job_description_tab_${tabId}`);

    const summary = summaryColl.data || {};
    const jd = jdColl.data || {};

    const profileBadge = document.getElementById('sb-profile-badge');
    const jdBadge = document.getElementById('sb-jd-badge');

    const profileLoaded = !!(summary.embeddings && summary.embeddings.length > 0);
    const jdLoaded = !!(jd.embeddings && jd.embeddings.length > 0);

    if (profileBadge) {
      profileBadge.className = "sb-status-badge " + (profileLoaded ? "ready" : "missing");
      profileBadge.querySelector('.badge-icon').innerText = profileLoaded ? "✓" : "✗";
    }

    if (jdBadge) {
      jdBadge.className = "sb-status-badge " + (jdLoaded ? "ready" : "missing");
      jdBadge.querySelector('.badge-icon').innerText = jdLoaded ? "✓" : "✗";
    }

    if (!profileLoaded || !jdLoaded) {
      showErrorState("Missing profile or job data. Please enter your Candidate Profile and Job Description above to generate analysis.");
      return;
    }

    // Generate match report using local strategy pattern
    const report = await ragService.generateReport(
      summary.documents,
      jd.documents,
      summary.embeddings,
      jd.embeddings
    );

    renderReportData(report);
  } catch (e) {
    console.error(e);
    if (e.message && e.message.includes("context invalidated")) {
      showErrorState("Extension context invalidated. Please refresh this page to reload the assistant.");
    } else {
      showErrorState(e.message || "Failed to compile matching report.");
    }
  }
}

function getLanguageModelAPI() {
  if (typeof window !== 'undefined') {
    if (window.LanguageModel) return window.LanguageModel;
    if (window.ai && window.ai.languageModel) return window.ai.languageModel;
    if (window.ai && window.ai.assistant) return window.ai.assistant;
  }
  if (typeof LanguageModel !== 'undefined') return LanguageModel;
  if (typeof ai !== 'undefined' && ai.languageModel) return ai.languageModel;
  if (typeof ai !== 'undefined' && ai.assistant) return ai.assistant;
  return null;
}

async function checkGeminiNano() {
  const LM = getLanguageModelAPI();
  let ready = false;
  if (LM) {
    try {
      let available = 'no';
      if (typeof LM.availability === 'function') {
        available = await LM.availability();
      } else if (typeof LM.capabilities === 'function') {
        const capabilities = await LM.capabilities();
        available = capabilities.available || 'no';
      } else {
        available = 'available';
      }
      if (available !== 'no' && available !== 'unavailable') {
        ready = true;
      }
    } catch (e) {
      console.warn("Gemini Nano availability check failed, assuming true since API is present:", e);
      ready = true;
    }
  }

  if (!ready) {
    showStatus("Error: Chrome's native Gemini Nano AI is unavailable. Please enable Gemini Nano in chrome://flags to use this extension.", "error", true);
    return false;
  }
  return true;
}

/**
 * Shows visual status messages in the alert container.
 * @param {string} msg 
 * @param {'success' | 'error' | 'info'} [type] 
 * @param {boolean} [persistent]
 */
function showStatus(msg, type, persistent = false) {
  const alertDiv = document.getElementById('sb-status-alert');
  if (!alertDiv) return;
  
  alertDiv.className = "";
  if (type) alertDiv.classList.add(type);
  
  alertDiv.innerText = msg;
  alertDiv.style.display = 'block';
  
  if (alertDiv.timeoutId) {
    clearTimeout(alertDiv.timeoutId);
  }
  
  if (!persistent) {
    alertDiv.timeoutId = setTimeout(() => {
      alertDiv.style.display = 'none';
      alertDiv.innerText = "";
      alertDiv.className = "";
    }, 4500);
  }
}

/**
 * Displays error states in the sidebar.
 * @param {string} msg 
 */
function showErrorState(msg) {
  const loaderText = document.querySelector('.sb-loader-text');
  if (loaderText) {
    loaderText.innerText = msg;
    loaderText.style.color = '#ef4444';
  }
  const spinner = document.querySelector('.sb-spinner');
  if (spinner) {
    spinner.style.display = 'none';
  }
}

/**
 * Renders the compiled report output into HTML components.
 * @param {Object} report 
 */
function renderReportData(report) {
  const loader = document.getElementById('sb-loader');
  const section = document.getElementById('sb-analysis-section');
  
  loader.style.display = 'none';
  section.style.display = 'flex';

  const scoreText = document.getElementById('sb-score-text');
  const scoreCircle = document.getElementById('sb-score-circle');
  const scoreLabel = document.getElementById('sb-score-label');
  const scoreDesc = document.getElementById('sb-score-desc');
  
  const summaryText = document.getElementById('sb-summary-text');
  const matchesList = document.getElementById('sb-matches-list');
  const nonMatchesList = document.getElementById('sb-non-matches-list');
  const strengthsList = document.getElementById('sb-strengths-list');

  const score = report.score || 0;
  scoreText.textContent = `${score}%`;
  
  // Set stroke-dasharray based on score progress (circumference is approx 100)
  scoreCircle.setAttribute('stroke-dasharray', `${score}, 100`);

  // Dynamically color indicators based on fit score
  let color = '#ef4444'; // default red
  let labelText = "Weak Alignment";
  let descText = "Key requirement gaps detected.";

  if (score >= 75) {
    color = '#10b981'; // green
    labelText = "Excellent Match!";
    descText = "Your profile is highly aligned.";
  } else if (score >= 50) {
    color = '#6366f1'; // blue-indigo
    labelText = "Moderate Alignment";
    descText = "Matches several core requirements.";
  }

  scoreCircle.setAttribute('stroke', color);
  scoreLabel.textContent = labelText;
  scoreLabel.style.color = color;
  scoreDesc.textContent = descText;

  // Set summary text
  if (summaryText) {
    summaryText.innerText = report.summary || '';
  }

  // Clear and update lists
  if (matchesList) {
    matchesList.innerHTML = '';
    const matches = report.matches || [];
    matches.forEach(m => {
      const li = document.createElement('li');
      li.innerText = m;
      matchesList.appendChild(li);
    });
  }

  if (nonMatchesList) {
    nonMatchesList.innerHTML = '';
    const nonMatches = report.nonMatches || report.suggestions || [];
    nonMatches.forEach(s => {
      const li = document.createElement('li');
      li.innerText = s;
      nonMatchesList.appendChild(li);
    });
  }

  if (strengthsList) {
    strengthsList.innerHTML = '';
    const strengths = report.strengths || [];
    strengths.forEach(st => {
      const li = document.createElement('li');
      li.innerText = st;
      strengthsList.appendChild(li);
    });
  }
}

/**
 * Handles Q&A question submission.
 */
async function handleQuestionSubmit() {
  const questionInput = document.getElementById('easy-apply-question');
  const answerBox = document.getElementById('easy-apply-answer');
  const question = questionInput.value.trim();

  if (!question) {
    answerBox.value = "Please enter a question first.";
    showStatus("Please enter a question first.", "error");
    return;
  }

  const hasNano = await checkGeminiNano();
  if (!hasNano) {
    answerBox.value = "Error: Chrome's native Gemini Nano AI is unavailable on this device. Please enable Gemini Nano in chrome://flags.";
    showStatus("Gemini Nano AI is unavailable.", "error", true);
    return;
  }

  answerBox.value = "Retrieving context via hybrid search (Dense + BM25)...";
  showStatus("Performing hybrid retrieval...", "info");

  try {
    const queryEmbedding = await embeddingEngine.getEmbedding(question, { isQuery: true });
    
    const summaryColl = await chromaClient.getCollection("candidate_profile");
    const jdColl = await chromaClient.getCollection(`job_description_tab_${tabId}`);

    answerBox.value = "Retrieving & re-ranking context with cross-encoder...";
    showStatus("Retrieving and re-ranking context...", "info");

    const [summaryResults, jdResults] = await Promise.all([
      summaryColl.queryHybrid({
        queryText: question,
        queryEmbeddings: [queryEmbedding],
        rerankerInstance: reranker,
        topK: 5,
        nResults: 3
      }),
      jdColl.queryHybrid({
        queryText: question,
        queryEmbeddings: [queryEmbedding],
        rerankerInstance: reranker,
        topK: 5,
        nResults: 3
      })
    ]);

    const profileChunks = summaryResults.documents || [];
    const jdChunks = jdResults.documents || [];

    answerBox.value = "Generating answer using local RAG...";
    showStatus("Synthesizing answer...", "info");
    
    const answer = await ragService.generateAnswer(question, profileChunks, jdChunks);
    answerBox.value = answer;
    showStatus("Answer compiled!", "success");
  } catch (e) {
    console.error(e);
    answerBox.value = "Error generating answer: " + e.message;
    showStatus("Failed to generate answer: " + e.message, "error");
  }
}

/**
 * Scans the page for Job Description using common selectors, 
 * highlights it with a green outline, and saves text to storage.
 */
function scanAndHighlightJD() {
  const selectors = [
    '[class*="styles_JDC__dang-inner-html"]',    // Naukri Modern (Specific)
    '[class*="styles_job-desc"]',                // Naukri Modern Alt
    '.job-desc',                                 // Naukri Old/Generic
    '.jobs-description-content__text',           // LinkedIn
    '#job-details',                              // LinkedIn Alternative
    '.jobs-description__container',              // LinkedIn Container
    '[data-automation-id="jobPostingDescription"]', // Workday
    '.job-description',                          // Generic
    '#jobDescription',                           // Generic ID
    'section.description'                        // Generic Section
  ];

  let target = null;
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (el && el.innerText.trim().length > 200) {
        target = el;
        break;
      }
    }
    if (target) break;
  }

  if (!target) {
    const containers = document.querySelectorAll('div, section, article');
    let maxLen = 0;
    const keywords = ['qualifications', 'requirements', 'responsibilities', 'about the role'];
    
    containers.forEach(c => {
      const text = c.innerText.toLowerCase();
      const hasKeyword = keywords.some(k => text.includes(k));
      const len = c.innerText.trim().length;
      
      if (hasKeyword && len > maxLen && len < 15000) {
        maxLen = len;
        target = c;
      }
    });
  }

  if (target) {
    // Highlight with 4px outline
    target.style.outline = "4px solid #28a745";
    target.style.outlineOffset = "4px";
    target.style.borderRadius = "4px";
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const text = target.innerText;
    const jdStorageKey = `lastScannedJD_tab_${tabId}`;
    chrome.storage.local.set({ [jdStorageKey]: text });
    
    return { success: true, text: text };
  }

  return { success: false };
}