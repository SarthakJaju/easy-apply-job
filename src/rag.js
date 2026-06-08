import { cosineSimilarity } from './chromadb.js';

/**
 * Resolves the available Prompt API entry class depending on the Chrome version.
 */
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

/**
 * Helper to check if Chrome's built-in Gemini Nano AI is available.
 * Supports both modern availability() and legacy capabilities() APIs.
 * @returns {Promise<boolean>}
 */
async function checkBuiltInAIAvailability() {
  const LM = getLanguageModelAPI();
  if (!LM) {
    return false;
  }
  try {
    let available = 'no';
    if (typeof LM.availability === 'function') {
      available = await LM.availability();
    } else if (typeof LM.capabilities === 'function') {
      const capabilities = await LM.capabilities();
      available = capabilities.available || 'no';
    } else {
      available = 'available'; // Assume available if LM class exists
    }
    return available !== 'no' && available !== 'unavailable';
  } catch (e) {
    console.warn("Checking built-in AI availability failed, assuming true since API is present:", e);
    return true;
  }
}

/**
 * Base strategy for RAG Text Generation.
 * SOLID: Open-Closed Principle (new AI strategies can be plugged in easily).
 */
class RAGStrategy {
  /**
   * Generates a matching report comparing JD vs User data.
   * @param {string[]} userChunks 
   * @param {string[]} jdChunks 
   * @param {number[][]} userEmbeddings 
   * @param {number[][]} jdEmbeddings 
   * @returns {Promise<Object>} Report object containing score, matches, and suggestions
   */
  async generateReport(userChunks, jdChunks, userEmbeddings, jdEmbeddings) {
    throw new Error("generateReport must be implemented by strategy subclasses.");
  }

  /**
   * Generates an answer to a question using the retrieved context.
   * @param {string} question 
   * @param {string[]} profileChunks 
   * @param {string[]} jdChunks 
   * @returns {Promise<string>} Generated text response
   */
  async generateAnswer(question, profileChunks, jdChunks) {
    throw new Error("generateAnswer must be implemented by strategy subclasses.");
  }
}

/**
 * Primary Strategy: Uses Chrome's built-in AI (Gemini Nano)
 */
class ChromeBuiltInAIStrategy extends RAGStrategy {
  async getAISession() {
    const LM = getLanguageModelAPI();
    if (!LM) {
      throw new Error("LanguageModel API is not defined in this browser.");
    }
    try {
      return await LM.create({
        temperature: 0.3,
        topK: 3
      });
    } catch (e) {
      throw new Error("Failed to create built-in AI session: " + e.message);
    }
  }

  async generateReport(userChunks, jdChunks, userEmbeddings, jdEmbeddings) {
    const session = await this.getAISession();
    if (!session) {
      throw new Error("Failed to create Gemini Nano AI session. Please check if Gemini Nano is enabled in chrome://flags.");
    }

    const prompt = `You are a professional HR assistant. Compare the candidate's professional resume chunks with the job description (JD) chunks.
Candidate Resume Context:
${userChunks.join("\n---\n")}

Job Description Context:
${jdChunks.join("\n---\n")}

Provide a JSON report. Return ONLY a valid JSON object matching this schema. Do not enclose it in markdown blocks or write conversational text:
{
  "score": <number from 0 to 100 matching how well the candidate fits the JD>,
  "summary": "<a concise 2-3 sentence paragraph summarizing overall alignment>",
  "matches": [<array of 3-4 concise bullet points of matching skills/experiences>],
  "suggestions": [<array of 3-4 concise bullet points of gaps or improvements needed to align better with the JD>],
  "strengths": [<array of 3-4 concise bullet points highlighting the candidate's core strengths based on their profile>]
}`;

    try {
      const response = await session.prompt(prompt);
      session.destroy();
      
      // Clean potential markdown or helper wraps from the response
      const cleanJson = response.trim().replace(/^```json/, "").replace(/```$/, "").trim();
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error("Gemini Nano report generation error:", e);
      throw new Error("Gemini Nano failed to generate report: " + e.message);
    }
  }

  async generateAnswer(question, profileChunks, jdChunks) {
    const session = await this.getAISession();
    if (!session) {
      throw new Error("Failed to create Gemini Nano AI session. Please check if Gemini Nano is enabled in chrome://flags.");
    }

    const prompt = `You are an expert career assistant. Answer the candidate's question by cross-referencing their profile/resume against the job description.
    
Candidate Profile Context:
${profileChunks.join("\n---\n")}

Job Description Context:
${jdChunks.join("\n---\n")}

Question: ${question}

Instructions:
1. Provide a professional, direct, and accurate answer based on the context.
2. Distinctly separate what is in the candidate's profile versus what is required in the job description. Do not attribute requirements from the JD to the candidate's profile.
3. If the candidate profile does not contain the skill/experience mentioned in the question, clearly state that it is missing from their profile.
4. Keep the response under 150 words. Do not use conversational introductions.`;

    try {
      const response = await session.prompt(prompt);
      session.destroy();
      return response.trim();
    } catch (e) {
      console.error("Gemini Nano Q&A generation error:", e);
      throw new Error("Gemini Nano failed to answer question: " + e.message);
    }
  }
}

/**
 * Fallback Strategy: Performs semantic synthesis in JavaScript
 * using embedding similarities. Extremely fast, robust, and requires zero configuration.
 */
class SemanticSynthesisStrategy extends RAGStrategy {
  async generateReport(userChunks, jdChunks, userEmbeddings, jdEmbeddings) {
    if (!userEmbeddings || !jdEmbeddings || userEmbeddings.length === 0 || jdEmbeddings.length === 0) {
      return {
        score: 0,
        summary: "Please save your Career Summary and a valid Job Description to calculate alignment.",
        matches: ["Save your profile data and scan a job details page."],
        suggestions: ["Save your profile data and scan a job details page."],
        strengths: ["Save your profile data and scan a job details page."]
      };
    }

    const similarities = [];
    const matches = [];
    const suggestions = [];

    // Map each JD chunk to find the closest match in User chunks
    for (let j = 0; j < jdChunks.length; j++) {
      let maxSim = -1;
      let bestMatchIdx = -1;
      
      for (let u = 0; u < userChunks.length; u++) {
        const sim = cosineSimilarity(jdEmbeddings[j], userEmbeddings[u]);
        if (sim > maxSim) {
          maxSim = sim;
          bestMatchIdx = u;
        }
      }

      similarities.push(maxSim);

      // Extract core requirements from JD chunk (heuristic: split by sentences)
      const sentences = jdChunks[j].split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20);
      
      if (maxSim > 0.55) {
        // High similarity: candidate matches this requirement block
        const keywordKeywords = this.extractKeywords(jdChunks[j]);
        const matchedKeywords = this.extractKeywords(userChunks[bestMatchIdx]).filter(w => keywordKeywords.includes(w));
        
        if (matchedKeywords.length > 0 && sentences.length > 0) {
          matches.push(`Strong alignment with: "${sentences[0]}" (Semantic Match: ${Math.round(maxSim * 100)}%, matching skills: ${matchedKeywords.slice(0, 3).join(', ')})`);
        } else if (sentences.length > 0) {
          matches.push(`Matches requirement: "${sentences[0]}"`);
        }
      } else {
        // Low similarity: candidate lacks this requirement block
        if (sentences.length > 0) {
          suggestions.push(`Consider adding details about: "${sentences[0]}"`);
        }
      }
    }

    // Calculate score using average of similarities
    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    // Map cosine similarity range [0.2, 0.75] to percentage [30, 95]
    let score = Math.round(30 + Math.max(0, Math.min(65, (avgSimilarity - 0.2) / 0.55 * 65)));
    
    if (isNaN(score)) score = 50;

    // Deduplicate and limit items to keep UI clean
    const uniqueMatches = Array.from(new Set(matches)).slice(0, 4);
    const uniqueSuggestions = Array.from(new Set(suggestions)).slice(0, 4);

    if (uniqueMatches.length === 0) {
      uniqueMatches.push("Partial matching found. Try adding more detail to your professional summary.");
    }
    if (uniqueSuggestions.length === 0) {
      uniqueSuggestions.push("Your profile matches this job description very well! No major gaps identified.");
    }

    const strengths = uniqueMatches.map(m => m.replace(/Matches requirement: |Strong alignment with: /, "Proficient in "));
    const summary = `Candidate profile shows ${score >= 75 ? 'strong' : score >= 50 ? 'moderate' : 'limited'} semantic alignment with the job description. Core matches were found in ${uniqueMatches.length} areas, with ${uniqueSuggestions.length} recommendation areas for optimization.`;

    return {
      score: score,
      summary: summary,
      matches: uniqueMatches,
      suggestions: uniqueSuggestions,
      strengths: strengths
    };
  }

  async generateAnswer(question, profileChunks, jdChunks) {
    if ((!profileChunks || profileChunks.length === 0) && (!jdChunks || jdChunks.length === 0)) {
      return "I couldn't find any details in your profile or the job description to answer this question. Please make sure your career summary is saved and the JD is scanned.";
    }

    const questionKeywords = this.extractKeywords(question);
    
    // If no meaningful keywords are left, use all words length > 2
    const searchKeywords = questionKeywords.length > 0 ? questionKeywords : 
      question.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);

    const profileSentences = [];
    if (profileChunks) {
      for (const chunk of profileChunks) {
        const chunkSents = chunk.split(/[.!?\n*]+/).map(s => s.trim()).filter(s => s.length > 8);
        for (const sent of chunkSents) {
          const matchedWords = this.extractKeywords(sent).filter(w => searchKeywords.includes(w));
          if (matchedWords.length > 0) {
            profileSentences.push({ text: sent, score: matchedWords.length });
          }
        }
      }
    }

    const jdSentences = [];
    if (jdChunks) {
      for (const chunk of jdChunks) {
        const chunkSents = chunk.split(/[.!?\n*]+/).map(s => s.trim()).filter(s => s.length > 8);
        for (const sent of chunkSents) {
          const matchedWords = this.extractKeywords(sent).filter(w => searchKeywords.includes(w));
          if (matchedWords.length > 0) {
            jdSentences.push({ text: sent, score: matchedWords.length });
          }
        }
      }
    }

    // Sort by match score (descending)
    profileSentences.sort((a, b) => b.score - a.score);
    jdSentences.sort((a, b) => b.score - a.score);

    // Let's analyze matched status
    const hasProfileMatch = profileSentences.length > 0;
    const hasJdMatch = jdSentences.length > 0;

    let response = "";

    // Target specific skills requested
    const targetSkills = searchKeywords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(", ");

    if (hasProfileMatch && hasJdMatch) {
      const pText = profileSentences.slice(0, 2).map(s => s.text).join(". ");
      const jText = jdSentences.slice(0, 2).map(s => s.text).join(". ");
      response = `Yes. Your profile matches the requirement for ${targetSkills}.\n\n` + 
                 `• From your profile: "${pText}"\n` + 
                 `• Job requirement details: "${jText}"`;
    } else if (hasProfileMatch && !hasJdMatch) {
      const pText = profileSentences.slice(0, 2).map(s => s.text).join(". ");
      response = `Yes, your profile mentions experience in ${targetSkills}: "${pText}". However, this skill is not explicitly highlighted as a requirement in the scanned Job Description.`;
    } else if (!hasProfileMatch && hasJdMatch) {
      const jText = jdSentences.slice(0, 2).map(s => s.text).join(". ");
      response = `No, your profile does not explicitly mention experience in ${targetSkills}.\n\n` +
                 `However, this is required by the Job Description:\n` +
                 `• "${jText}"\n\n` +
                 `You might need to update your candidate summary to showcase relevant experience if you have it.`;
    } else {
      // General question fallback when no target keywords match specifically
      const allProfileSents = [];
      if (profileChunks) {
        for (const chunk of profileChunks) {
          allProfileSents.push(...chunk.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 15));
        }
      }
      const allJdSents = [];
      if (jdChunks) {
        for (const chunk of jdChunks) {
          allJdSents.push(...chunk.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 15));
        }
      }

      const topProfile = allProfileSents.slice(0, 2).join(". ");
      const topJd = allJdSents.slice(0, 2).join(". ");

      response = `I couldn't find a direct keyword match for "${searchKeywords.join(', ')}" in either your profile or the job description.\n\n` +
                 `• Summary of your profile: "${topProfile || 'No profile details saved.'}"\n` +
                 `• Scanned Job context: "${topJd || 'No job description details saved.'}"`;
    }

    return response;
  }

  /**
   * Helper utility to extract keywords from text.
   * @param {string} text 
   * @returns {string[]}
   */
  extractKeywords(text) {
    const stopwords = new Set([
      'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'with', 'for', 'of', 'in', 'on', 'at', 'to', 'from', 'by', 'about', 'as', 'that', 'this', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'will', 'should', 'would', 'could',
      'experience', 'project', 'projects', 'skills', 'skill', 'hands-on', 'years', 'role', 'work', 'job', 'candidate', 'profile', 'resume', 'position', 'description', 'details', 'question', 'answer'
    ]);
    return text.toLowerCase()
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopwords.has(w));
  }
}

/**
 * Orchestrates RAG operations and uses the Strategy Pattern for text synthesis.
 */
export class RAGService {
  constructor() {
    this.strategy = null;
  }

  /**
   * Initializes the strategy based on environment capabilities.
   */
  async initStrategy() {
    const isAvailable = await checkBuiltInAIAvailability();
    if (isAvailable) {
      this.strategy = new ChromeBuiltInAIStrategy();
    } else {
      this.strategy = null;
    }
  }

  /**
   * Generates a matching report comparing JD vs User data.
   * @param {string[]} userChunks 
   * @param {string[]} jdChunks 
   * @param {number[][]} userEmbeddings 
   * @param {number[][]} jdEmbeddings 
   * @returns {Promise<Object>}
   */
  async generateReport(userChunks, jdChunks, userEmbeddings, jdEmbeddings) {
    if (!this.strategy) {
      await this.initStrategy();
    }
    if (!this.strategy) {
      throw new Error("Chrome's native Gemini Nano AI is unavailable on this device. Please enable Gemini Nano in chrome://flags.");
    }
    return this.strategy.generateReport(userChunks, jdChunks, userEmbeddings, jdEmbeddings);
  }

  /**
   * Generates an answer to a question using the retrieved context.
   * @param {string} question 
   * @param {string[]} profileChunks 
   * @param {string[]} jdChunks 
   * @returns {Promise<string>}
   */
  async generateAnswer(question, profileChunks, jdChunks) {
    if (!this.strategy) {
      await this.initStrategy();
    }
    if (!this.strategy) {
      throw new Error("Chrome's native Gemini Nano AI is unavailable on this device. Please enable Gemini Nano in chrome://flags.");
    }
    return this.strategy.generateAnswer(question, profileChunks, jdChunks);
  }
}
