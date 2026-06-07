import { cosineSimilarity } from './chromadb.js';

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
   * @param {string[]} relevantChunks 
   * @returns {Promise<string>} Generated text response
   */
  async generateAnswer(question, relevantChunks) {
    throw new Error("generateAnswer must be implemented by strategy subclasses.");
  }
}

/**
 * Primary Strategy: Uses Chrome's built-in AI (Gemini Nano)
 */
class ChromeBuiltInAIStrategy extends RAGStrategy {
  async getAISession() {
    try {
      const capabilities = await window.ai.languageModel.capabilities();
      if (capabilities.available === 'no') {
        throw new Error("Gemini Nano is not ready on this device.");
      }
      return await window.ai.languageModel.create({
        temperature: 0.3,
        topK: 3
      });
    } catch (e) {
      console.warn("Failed to create built-in AI session:", e);
      return null;
    }
  }

  async generateReport(userChunks, jdChunks, userEmbeddings, jdEmbeddings) {
    const session = await this.getAISession();
    if (!session) {
      // Fallback if session creation fails
      const fallback = new SemanticSynthesisStrategy();
      return fallback.generateReport(userChunks, jdChunks, userEmbeddings, jdEmbeddings);
    }

    const prompt = `You are a professional HR assistant. Compare the candidate's professional resume chunks with the job description (JD) chunks.
Candidate Resume Context:
${userChunks.join("\n---\n")}

Job Description Context:
${jdChunks.join("\n---\n")}

Provide a JSON report. Return ONLY a valid JSON object matching this schema. Do not enclose it in markdown blocks or write conversational text:
{
  "score": <number from 0 to 100 matching how well the candidate fits the JD>,
  "matches": [<array of string sentences highlighting areas of strong alignment>],
  "suggestions": [<array of string sentences detailing what specific skills/experiences the candidate should add or elaborate on to better match the JD>]
}`;

    try {
      const response = await session.prompt(prompt);
      session.destroy();
      
      // Clean potential markdown or helper wraps from the response
      const cleanJson = response.trim().replace(/^```json/, "").replace(/```$/, "").trim();
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error("Gemini Nano report generation error, falling back:", e);
      const fallback = new SemanticSynthesisStrategy();
      return fallback.generateReport(userChunks, jdChunks, userEmbeddings, jdEmbeddings);
    }
  }

  async generateAnswer(question, relevantChunks) {
    const session = await this.getAISession();
    if (!session) {
      const fallback = new SemanticSynthesisStrategy();
      return fallback.generateAnswer(question, relevantChunks);
    }

    const prompt = `You are an expert career assistant. Answer the candidate's application question using the provided context chunks of their professional summary and the job description.
    
Context:
${relevantChunks.join("\n---\n")}

Question: ${question}

Instructions:
1. Provide a professional, clean, and direct answer based ONLY on the context.
2. If the context doesn't contain enough information, state what is missing and suggest how they could answer it based on the JD.
3. Keep the response under 150 words. Do not use conversational introductions.`;

    try {
      const response = await session.prompt(prompt);
      session.destroy();
      return response.trim();
    } catch (e) {
      console.error("Gemini Nano Q&A generation error, falling back:", e);
      const fallback = new SemanticSynthesisStrategy();
      return fallback.generateAnswer(question, relevantChunks);
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
        matches: ["Please save your Career Summary and a valid Job Description to calculate alignment."],
        suggestions: ["Save your profile data and scan a job details page."]
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

    return {
      score: score,
      matches: uniqueMatches,
      suggestions: uniqueSuggestions
    };
  }

  async generateAnswer(question, relevantChunks) {
    if (!relevantChunks || relevantChunks.length === 0) {
      return "I couldn't find any relevant details in your profile or the job description to answer this question. Please make sure your summary is complete and the JD is scanned.";
    }

    // Semantic compilation of chunks: Find sentences in relevant chunks that match the question's keywords
    const questionKeywords = this.extractKeywords(question);
    const sentences = [];
    
    for (const chunk of relevantChunks) {
      const chunkSentences = chunk.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
      for (const sent of chunkSentences) {
        const words = this.extractKeywords(sent);
        const overlapCount = words.filter(w => questionKeywords.includes(w)).length;
        if (overlapCount > 0) {
          sentences.push({ text: sent, score: overlapCount });
        }
      }
    }

    // Sort by overlap keyword matching score
    sentences.sort((a, b) => b.score - a.score);

    if (sentences.length > 0) {
      const topSentences = sentences.slice(0, 3).map(s => s.text);
      return `Based on your profile: ${topSentences.join(". ")}. This directly matches the job requirements context.`;
    }

    // Fallback: simple merge of the most semantically relevant text blocks
    const summaryInfo = relevantChunks[0].split(/[.!?]+/).slice(0, 2).join(". ");
    return `Based on your professional summary: "${summaryInfo}." (No exact match found in your profile for your question, you might want to edit your summary to address this requirement).`;
  }

  /**
   * Helper utility to extract keywords from text.
   * @param {string} text 
   * @returns {string[]}
   */
  extractKeywords(text) {
    const stopwords = new Set([
      'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'with', 'for', 'of', 'in', 'on', 'at', 'to', 'from', 'by', 'about', 'as', 'that', 'this', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'will', 'should', 'would', 'could'
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
    const isBrowserAIAvailable = typeof window !== 'undefined' && window.ai && window.ai.languageModel;
    if (isBrowserAIAvailable) {
      this.strategy = new ChromeBuiltInAIStrategy();
    } else {
      this.strategy = new SemanticSynthesisStrategy();
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
    return this.strategy.generateReport(userChunks, jdChunks, userEmbeddings, jdEmbeddings);
  }

  /**
   * Generates an answer to a question using the retrieved context.
   * @param {string} question 
   * @param {string[]} relevantChunks 
   * @returns {Promise<string>}
   */
  async generateAnswer(question, relevantChunks) {
    if (!this.strategy) {
      await this.initStrategy();
    }
    return this.strategy.generateAnswer(question, relevantChunks);
  }
}
