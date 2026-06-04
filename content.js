// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SCAN_JD") {
    const result = scanAndHighlightJD();
    sendResponse(result);
  }
  return true; 
});

/**
 * Scans the page for Job Description using common selectors, 
 * highlights it with a green border, and saves text to storage.
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
      // Ensure it's likely a JD and not an empty container or hidden snippet
      if (el && el.innerText.trim().length > 200) {
        target = el;
        break;
      }
    }
    if (target) break;
  }

  // Fallback: If no selectors match, find the largest text block containing JD keywords
  if (!target) {
    const containers = document.querySelectorAll('div, section, article');
    let maxLen = 0;
    const keywords = ['qualifications', 'requirements', 'responsibilities', 'about the role'];
    
    containers.forEach(c => {
      const text = c.innerText.toLowerCase();
      const hasKeyword = keywords.some(k => text.includes(k));
      const len = c.innerText.trim().length;
      
      if (hasKeyword && len > maxLen && len < 15000) { // Limit to avoid matching body/html tags
        maxLen = len;
        target = c;
      }
    });
  }

  if (target) {
    // Apply green highlight as requested
    target.style.outline = "4px solid #28a745";
    target.style.outlineOffset = "4px";
    target.style.borderRadius = "4px";
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Store text in chrome storage for the assistant to use later
    const text = target.innerText;
    chrome.storage.local.set({ lastScannedJD: text });
    
    return { success: true, text: text };
  }

  return { success: false };
}