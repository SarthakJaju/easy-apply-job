import { pipeline, env, AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers';

/**
 * Configure Hugging Face Transformers Environment for Chrome Extension environment.
 */
env.allowLocalModels = false; // Retrieve pre-trained model files from Hugging Face hub and cache locally
env.backends.onnx.wasm.numThreads = 1; // Thread safety inside extension context
env.backends.onnx.wasm.proxy = false; // Disable proxy workers to prevent dynamic import() on service workers

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('dist/');
}

export class TextSplitter {
  /**
   * @param {Object} [options]
   * @param {number} [options.chunkSize] - Target size of each chunk (in word-tokens)
   * @param {number} [options.chunkOverlap] - Word-token overlap between chunks
   */
  constructor({ chunkSize = 200, chunkOverlap = 30 } = {}) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
    this.separators = ["\n\n", "\n", ". ", " "];

    if (this.chunkOverlap >= this.chunkSize) {
      throw new Error("Overlap must be smaller than chunk size.");
    }
  }

  /**
   * Helper to count words inside a block.
   * @param {string} text - Block of text
   * @returns {number} Word count
   */
  _getWordCount(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Splits a block of text recursively based on hierarchy of separators.
   * @param {string} text - Text content to split
   * @returns {string[]} Chunks
   */
  splitText(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }
    const rawChunks = this._splitText(text, this.separators);
    return rawChunks.map(c => c.trim()).filter(c => c.length > 0);
  }

  /**
   * Internal recursive splitter implementation.
   * @param {string} text 
   * @param {string[]} separators 
   * @returns {string[]}
   */
  _splitText(text, separators) {
    const wordCount = this._getWordCount(text);
    if (wordCount <= this.chunkSize) {
      return [text.trim()];
    }

    // Find the first separator that exists in the text
    let separator = separators[separators.length - 1]; // fallback to last
    let newSeparators = [];
    for (let i = 0; i < separators.length; i++) {
      const sep = separators[i];
      if (sep === "") {
        separator = sep;
        break;
      }
      if (text.includes(sep)) {
        separator = sep;
        newSeparators = separators.slice(i + 1);
        break;
      }
    }

    // Split the text by the separator
    const splits = text.split(separator);

    const finalChunks = [];
    let goodSplits = [];

    for (const s of splits) {
      if (this._getWordCount(s) <= this.chunkSize) {
        goodSplits.push(s);
      } else {
        if (goodSplits.length > 0) {
          const mergedText = this._mergeSplits(goodSplits, separator);
          finalChunks.push(...mergedText);
          goodSplits = [];
        }
        if (!newSeparators.length) {
          // If no more separators, just push the unsplittable chunk
          goodSplits.push(s);
        } else {
          const recursiveSplits = this._splitText(s, newSeparators);
          finalChunks.push(...recursiveSplits);
        }
      }
    }

    if (goodSplits.length > 0) {
      const mergedText = this._mergeSplits(goodSplits, separator);
      finalChunks.push(...mergedText);
    }

    return finalChunks;
  }

  /**
   * Merges list of split parts back with the separator while respecting chunk size and overlap.
   * @param {string[]} splits 
   * @param {string} separator 
   * @returns {string[]}
   */
  _mergeSplits(splits, separator) {
    const docs = [];
    const currentDoc = [];
    let total = 0;

    for (const d of splits) {
      const len = this._getWordCount(d);
      if (len === 0) continue;

      if (total + len > this.chunkSize) {
        if (total > 0) {
          docs.push(currentDoc.join(separator));
        }

        // Slide back for overlap
        while (currentDoc.length > 0 && (total > this.chunkOverlap || (total + len > this.chunkSize && total > 0))) {
          const popped = currentDoc.shift();
          total -= this._getWordCount(popped);
        }
      }

      currentDoc.push(d);
      total += len;
    }

    if (currentDoc.length > 0) {
      docs.push(currentDoc.join(separator));
    }

    return docs;
  }
}

/**
 * EmbeddingEngine manages the MiniLM model lifecycle and embedding extraction.
 * Uses a Singleton pattern to share the pipeline reference.
 */
export class EmbeddingEngine {
  constructor() {
    this.modelName = 'Xenova/bge-small-en-v1.5';
    this.pipelineInstance = null;
  }

  /**
   * Returns/initializes the extractor pipeline (Singleton).
   * @returns {Promise<Function>} The pipeline function
   */
  async getPipeline() {
    if (!this.pipelineInstance) {
      this.pipelineInstance = await pipeline('feature-extraction', this.modelName);
    }
    return this.pipelineInstance;
  }

  /**
   * Generates a 384-dimension vector embedding for a single text chunk.
   * @param {string} text - Text chunk
   * @param {Object} [options]
   * @param {boolean} [options.isQuery] - Whether this text is a query
   * @returns {Promise<number[]>} The dense vector embedding
   */
  async getEmbedding(text, { isQuery = false } = {}) {
    const extractor = await this.getPipeline();
    
    let processedText = text;
    if (isQuery && this.modelName.includes('bge-')) {
      processedText = "Represent this sentence for searching relevant passages: " + text;
    }

    const output = await extractor(processedText, {
      pooling: 'mean',
      normalize: true
    });
    
    // Convert Float32Array back to a plain JavaScript number array
    return Array.from(output.data);
  }

  /**
   * Generates embeddings for multiple chunks sequentially (to manage memory).
   * @param {string[]} chunks - Array of text chunks
   * @param {Function} [onProgress] - Optional progress callback callback(current, total)
   * @returns {Promise<number[][]>} Array of embeddings
   */
  async getEmbeddings(chunks, onProgress = null) {
    const embeddings = [];
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.getEmbedding(chunks[i]);
      embeddings.push(embedding);
      
      if (typeof onProgress === 'function') {
        onProgress(i + 1, chunks.length);
      }
    }
    return embeddings;
  }
}

/**
 * ReRanker wraps cross-encoder text classification models (e.g. ms-marco-MiniLM-L-6-v2)
 * to score query-document pairs using raw logits.
 */
export class ReRanker {
  constructor() {
    this.modelName = 'Xenova/ms-marco-MiniLM-L-6-v2';
    this.tokenizer = null;
    this.model = null;
  }

  async loadModel() {
    if (!this.tokenizer || !this.model) {
      this.tokenizer = await AutoTokenizer.from_pretrained(this.modelName);
      this.model = await AutoModelForSequenceClassification.from_pretrained(this.modelName);
    }
  }

  async rerank(query, documents) {
    if (!documents || documents.length === 0) return [];
    
    await this.loadModel();
    
    try {
      const pairs = documents.map(doc => [query, doc]);
      const inputs = await this.tokenizer(pairs, { padding: true, truncation: true });
      const output = await this.model(inputs);
      return Array.from(output.logits.data);
    } catch (e) {
      console.error("Batch ReRanker error, falling back to dummy scores:", e);
      return new Array(documents.length).fill(-9999);
    }
  }
}
