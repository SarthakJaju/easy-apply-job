/**
 * ChromaDB In-Browser Adapter
 * Mimics the Python ChromaDB API in a modular, OOPS-compliant Javascript class
 * using Chrome Storage Local for persistence and Cosine Similarity for vector search.
 * 
 * SOLID Principles:
 * - Single Responsibility: Handles ONLY vector storage, retrieval, and similarity calculations.
 * - Open/Closed: Designed so that alternative storage backends (e.g., IndexedDB) can extend or replace Chrome Storage.
 */

/**
 * Calculates cosine similarity between two vectors.
 * @param {number[]} a 
 * @param {number[]} b 
 * @returns {number} Cosine similarity score between -1 and 1
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Represents a Collection inside our in-browser vector database.
 * Similar to chromadb.Collection
 */
export class Collection {
  /**
   * @param {string} name - Name of the collection
   */
  constructor(name) {
    this.name = name;
    this.storageKey = `chroma_coll_${name}`;
    
    // Internal data structure representing the DB schema
    /** @type {{ ids: string[], embeddings: number[][], documents: string[], metadatas: Record<string, any>[] }} */
    this.data = {
      ids: [],
      embeddings: [],
      documents: [],
      metadatas: []
    };
  }

  /**
   * Loads collection data from local chrome storage.
   * @returns {Promise<Collection>}
   */
  async load() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.storageKey], (result) => {
        if (result[this.storageKey]) {
          this.data = result[this.storageKey];
        } else {
          this.data = { ids: [], embeddings: [], documents: [], metadatas: [] };
        }
        resolve(this);
      });
    });
  }

  /**
   * Saves collection data to local chrome storage.
   * @returns {Promise<void>}
   */
  async save() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.storageKey]: this.data }, () => {
        resolve();
      });
    });
  }

  /**
   * Adds elements to the collection.
   * @param {Object} params
   * @param {string[]} params.ids - Unique IDs for each chunk
   * @param {number[][]} params.embeddings - Extracted embeddings
   * @param {string[]} params.documents - Text representation of chunks
   * @param {Record<string, any>[]} [params.metadatas] - Metadata objects
   */
  async add({ ids, embeddings, documents, metadatas = [] }) {
    if (!ids || !embeddings || !documents) {
      throw new Error("Missing required fields: ids, embeddings, and documents must be provided.");
    }
    if (ids.length !== embeddings.length || ids.length !== documents.length) {
      throw new Error("Arrays ids, embeddings, and documents must be of equal length.");
    }

    await this.load();

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const metadata = metadatas[i] || {};
      
      // Upsert: Remove existing record if ID matches to prevent duplicates
      const existingIdx = this.data.ids.indexOf(id);
      if (existingIdx !== -1) {
        this.data.ids.splice(existingIdx, 1);
        this.data.embeddings.splice(existingIdx, 1);
        this.data.documents.splice(existingIdx, 1);
        this.data.metadatas.splice(existingIdx, 1);
      }

      this.data.ids.push(id);
      this.data.embeddings.push(embeddings[i]);
      this.data.documents.push(documents[i]);
      this.data.metadatas.push(metadata);
    }

    await this.save();
  }

  /**
   * Queries the collection using vector similarity.
   * @param {Object} params
   * @param {number[][]} params.queryEmbeddings - The vectors to search for
   * @param {number} [params.nResults] - Number of top results to return
   * @param {Record<string, any>} [params.where] - Simple dictionary filter on metadata
   * @returns {Promise<Object>} Results structure matching Python ChromaDB queries
   */
  async query({ queryEmbeddings, nResults = 5, where = null }) {
    if (!queryEmbeddings || queryEmbeddings.length === 0) {
      throw new Error("Query embeddings must be provided.");
    }

    await this.load();

    const results = {
      ids: [],
      documents: [],
      metadatas: [],
      distances: [] // Storing cosine similarities (conceptually matching Chroma distances)
    };

    const targetVector = queryEmbeddings[0]; // Supports query by single vector

    // Compute similarities
    const scoredDocs = [];
    for (let i = 0; i < this.data.ids.length; i++) {
      const embedding = this.data.embeddings[i];
      const metadata = this.data.metadatas[i];
      
      // Apply metadata filtering if 'where' parameter is provided
      if (where) {
        let match = true;
        for (const [key, val] of Object.entries(where)) {
          if (metadata[key] !== val) {
            match = false;
            break;
          }
        }
        if (!match) continue;
      }

      const score = cosineSimilarity(targetVector, embedding);
      scoredDocs.push({
        id: this.data.ids[i],
        document: this.data.documents[i],
        metadata: this.data.metadatas[i],
        score: score
      });
    }

    // Sort by cosine similarity in descending order (highest score first)
    scoredDocs.sort((a, b) => b.score - a.score);

    // Slice to get top results
    const topResults = scoredDocs.slice(0, nResults);

    results.ids = topResults.map(r => r.id);
    results.documents = topResults.map(r => r.document);
    results.metadatas = topResults.map(r => r.metadata);
    results.distances = topResults.map(r => r.score); // In Chroma, higher score means more similarity

    return results;
  }

  /**
   * Queries the collection using hybrid search (dense + BM25) and re-ranks the results.
   * @param {Object} params
   * @param {string} params.queryText - The raw query text
   * @param {number[][]} params.queryEmbeddings - The query vector
   * @param {number} [params.nResults] - The final number of results to return
   * @param {Object} [params.rerankerInstance] - Re-ranker class instance
   * @param {number} [params.topK] - Candidate list size for re-ranking
   * @returns {Promise<Object>} Results structure
   */
  async queryHybrid({ queryText, queryEmbeddings, nResults = 3, rerankerInstance = null, topK = 10 }) {
    if (!queryEmbeddings || queryEmbeddings.length === 0) {
      throw new Error("Query embeddings must be provided.");
    }
    if (!queryText) {
      throw new Error("Query text must be provided.");
    }

    await this.load();

    const N = this.data.ids.length;
    if (N === 0) {
      return { ids: [], documents: [], metadatas: [], distances: [] };
    }

    // 1. Calculate dense similarity for all documents in collection
    const targetVector = queryEmbeddings[0];
    const denseScores = [];
    for (let i = 0; i < N; i++) {
      const score = cosineSimilarity(targetVector, this.data.embeddings[i]);
      denseScores.push(score);
    }

    // 2. Calculate BM25 scores for all documents in collection
    const bm25Retriever = new BM25(this.data.documents);
    const bm25Scores = bm25Retriever.score(queryText);

    // 3. Perform Reciprocal Rank Fusion (RRF)
    // Create ranked lists
    const denseDocs = denseScores.map((score, index) => ({ index, score }));
    denseDocs.sort((a, b) => b.score - a.score);
    const denseRanks = {};
    denseDocs.forEach((doc, rank) => {
      denseRanks[doc.index] = rank + 1;
    });

    const bm25Docs = bm25Scores.map((score, index) => ({ index, score }));
    bm25Docs.sort((a, b) => b.score - a.score);
    const bm25Ranks = {};
    bm25Docs.forEach((doc, rank) => {
      bm25Ranks[doc.index] = rank + 1;
    });

    const rrfConstant = 60;
    const rrfScored = [];
    for (let i = 0; i < N; i++) {
      const denseRank = denseRanks[i] || N + 1;
      const bm25Rank = bm25Ranks[i] || N + 1;
      const rrfScore = (1 / (rrfConstant + denseRank)) + (1 / (rrfConstant + bm25Rank));
      rrfScored.push({ index: i, score: rrfScore });
    }

    // Sort by RRF score descending
    rrfScored.sort((a, b) => b.score - a.score);

    // Retrieve top K candidates for re-ranking
    const candidates = rrfScored.slice(0, topK);
    const candidateDocs = candidates.map(c => this.data.documents[c.index]);

    let finalRanked = [];
    if (rerankerInstance && candidateDocs.length > 0) {
      // 4. Run Re-ranker over the top K candidates
      const rerankScores = await rerankerInstance.rerank(queryText, candidateDocs);
      
      // Map candidates to their re-ranker scores
      const rerankedCandidates = candidates.map((c, idx) => ({
        index: c.index,
        score: rerankScores[idx] !== undefined ? rerankScores[idx] : -9999
      }));

      // Sort by re-ranker score descending
      rerankedCandidates.sort((a, b) => b.score - a.score);
      finalRanked = rerankedCandidates.slice(0, nResults);
    } else {
      // If no re-ranker, just use the top results from RRF
      finalRanked = candidates.slice(0, nResults);
    }

    // Format output matching query structure
    const results = {
      ids: finalRanked.map(r => this.data.ids[r.index]),
      documents: finalRanked.map(r => this.data.documents[r.index]),
      metadatas: finalRanked.map(r => this.data.metadatas[r.index]),
      distances: finalRanked.map(r => r.score)
    };

    return results;
  }

  /**
   * Retrieves records from the collection.
   * @param {Object} [params]
   * @param {string[]} [params.ids]
   * @returns {Promise<Object>} List of matches
   */
  async get(params = {}) {
    await this.load();
    const { ids } = params;

    if (!ids) {
      return this.data;
    }

    const results = {
      ids: [],
      documents: [],
      embeddings: [],
      metadatas: []
    };

    for (const id of ids) {
      const idx = this.data.ids.indexOf(id);
      if (idx !== -1) {
        results.ids.push(this.data.ids[idx]);
        results.documents.push(this.data.documents[idx]);
        results.embeddings.push(this.data.embeddings[idx]);
        results.metadatas.push(this.data.metadatas[idx]);
      }
    }

    return results;
  }

  /**
   * Deletes elements by ID.
   * @param {Object} params
   * @param {string[]} params.ids - IDs to delete
   */
  async delete({ ids }) {
    if (!ids || ids.length === 0) return;

    await this.load();

    for (const id of ids) {
      const idx = this.data.ids.indexOf(id);
      if (idx !== -1) {
        this.data.ids.splice(idx, 1);
        this.data.embeddings.splice(idx, 1);
        this.data.documents.splice(idx, 1);
        this.data.metadatas.splice(idx, 1);
      }
    }

    await this.save();
  }
}

/**
 * ChromaClient representing ChromaDB operations.
 */
export class ChromaClient {
  /**
   * Creates or returns a collection.
   * @param {string} name 
   * @returns {Promise<Collection>}
   */
  async createCollection(name) {
    const collection = new Collection(name);
    await collection.load();
    return collection;
  }

  /**
   * Gets a collection.
   * @param {string} name 
   * @returns {Promise<Collection>}
   */
  async getCollection(name) {
    const collection = new Collection(name);
    await collection.load();
    return collection;
  }

  /**
   * Deletes a collection from browser storage.
   * @param {string} name 
   * @returns {Promise<void>}
   */
  async deleteCollection(name) {
    const storageKey = `chroma_coll_${name}`;
    return new Promise((resolve) => {
      chrome.storage.local.remove([storageKey], () => {
        resolve();
      });
    });
  }
}

/**
 * Self-contained BM25 term matching relevance scorer.
 */
class BM25 {
  constructor(documents, k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.documents = documents;
    this.N = documents.length;
    this.docTokens = documents.map(doc => this.tokenize(doc));
    this.docLengths = this.docTokens.map(tokens => tokens.length);
    const totalLength = this.docLengths.reduce((sum, len) => sum + len, 0);
    this.avgdl = this.N > 0 ? totalLength / this.N : 0;

    this.docFreqs = {};
    for (const tokens of this.docTokens) {
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        this.docFreqs[token] = (this.docFreqs[token] || 0) + 1;
      }
    }
  }

  tokenize(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 0);
  }

  idf(term) {
    const df = this.docFreqs[term] || 0;
    return Math.log((this.N - df + 0.5) / (df + 0.5) + 1);
  }

  score(query) {
    const queryTokens = this.tokenize(query);
    const scores = new Array(this.N).fill(0);

    if (this.N === 0) return scores;

    for (const token of queryTokens) {
      const idfVal = this.idf(token);
      
      for (let i = 0; i < this.N; i++) {
        const docTokens = this.docTokens[i];
        const tf = docTokens.filter(t => t === token).length;
        const docLen = this.docLengths[i];

        if (tf > 0) {
          const numerator = tf * (this.k1 + 1);
          const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgdl));
          scores[i] += idfVal * (numerator / denominator);
        }
      }
    }

    return scores;
  }
}
