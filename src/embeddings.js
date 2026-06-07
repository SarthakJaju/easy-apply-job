import { pipeline, env } from '@huggingface/transformers';

/**
 * Configure Hugging Face Transformers Environment for Chrome Extension environment.
 */
env.allowLocalModels = false; // Retrieve pre-trained model files from Hugging Face hub and cache locally
env.backends.onnx.wasm.numThreads = 1; // Thread safety inside extension context
env.backends.onnx.wasm.proxy = false; // Disable proxy workers to prevent dynamic import() on service workers

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('dist/');
}

/**
 * TextSplitter splits large textual blocks into semantic, overlapping chunks.
 * Specifically configured for RAG optimization with 300-400 token chunks and 200 token overlap.
 * 
 * SOLID Principles:
 * - Single Responsibility: Splitting documents and calculating tokens.
 */
export class TextSplitter {
  /**
   * @param {Object} [options]
   * @param {number} [options.chunkSize] - Target size of each chunk (in word-tokens)
   * @param {number} [options.chunkOverlap] - Word-token overlap between chunks
   */
  constructor({ chunkSize = 350, chunkOverlap = 200 } = {}) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;

    if (this.chunkOverlap >= this.chunkSize) {
      throw new Error("Overlap must be smaller than chunk size.");
    }
  }

  /**
   * Splits a block of text by words (representing tokens).
   * @param {string} text - Text content to split
   * @returns {string[]} Chunks
   */
  splitText(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // Clean and split text into whitespace-delimited words
    const words = text.trim().replace(/\s+/g, ' ').split(' ');
    
    if (words.length <= this.chunkSize) {
      return [text.trim()];
    }

    const chunks = [];
    let startIdx = 0;

    while (startIdx < words.length) {
      const endIdx = Math.min(startIdx + this.chunkSize, words.length);
      const chunkWords = words.slice(startIdx, endIdx);
      
      chunks.push(chunkWords.join(' '));
      
      // Stop if we have reached the end of the text
      if (endIdx === words.length) {
        break;
      }
      
      // Slide index forward by (chunkSize - overlap)
      startIdx += (this.chunkSize - this.chunkOverlap);
    }

    return chunks;
  }
}

/**
 * EmbeddingEngine manages the MiniLM model lifecycle and embedding extraction.
 * Uses a Singleton pattern to share the pipeline reference.
 */
export class EmbeddingEngine {
  constructor() {
    this.modelName = 'Xenova/all-MiniLM-L6-v2';
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
   * @returns {Promise<number[]>} The dense vector embedding
   */
  async getEmbedding(text) {
    const extractor = await this.getPipeline();
    const output = await extractor(text, {
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
