/**
 * FAISS vector index over product index_text using OpenAI text-embedding-3-small.
 * Exposes initVectorIndex(), getAllProducts(), semanticSearch().
 */

import { createRequire } from 'module';
import { loadProducts } from './dataLoader.js';
import OpenAI from 'openai';

const require = createRequire(import.meta.url);

const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 100; // OpenAI allows many inputs per request; batch to be safe

let products = [];
let index = null;
let dimension = 1536; // text-embedding-3-small dimension
let faissIndex = null;
let openaiClient = null;

/** L2-normalize a vector in place; returns the same array. */
function l2Normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vec.length; i++) {
    vec[i] /= norm;
  }
  return vec;
}

/** Get OpenAI client (uses OPENAI_API_KEY from env or GPT-API-Key.txt). */
function getOpenAI() {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

/** Embed texts in batches; returns array of arrays (vectors). */
async function embedTexts(texts) {
  const client = getOpenAI();
  const allVectors = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    const ordered = batch.map((_, idx) => res.data.find((d) => d.index === idx)?.embedding || []);
    for (const vec of ordered) {
      if (vec && vec.length) {
        allVectors.push(l2Normalize([...vec]));
      }
    }
  }
  return allVectors;
}

/** Embed a single query and return normalized vector. */
async function embedQuery(text) {
  const client = getOpenAI();
  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text || ' ',
  });
  const vec = res.data[0]?.embedding;
  if (!vec || !vec.length) throw new Error('Empty embedding for query');
  return l2Normalize([...vec]);
}

/**
 * Initialize the vector index: load CSV, embed all index_text, build FAISS IndexFlatIP.
 * Call once before server accepts requests.
 */
export async function initVectorIndex() {
  products = loadProducts();
  const texts = products.map((p) => String(p.index_text ?? p.product_name ?? '').trim() || ' ');
  console.log(`[vectorIndex] Embedding ${texts.length} products (batches of ${BATCH_SIZE})...`);

  const vectors = await embedTexts(texts);
  if (vectors.length !== products.length) {
    throw new Error(`Embedding count ${vectors.length} !== products ${products.length}`);
  }

  dimension = vectors[0].length;

  try {
    const { IndexFlatIP } = require('faiss-node');
    faissIndex = new IndexFlatIP(dimension);
    for (const v of vectors) {
      faissIndex.add(v);
    }
    index = 'faiss';
    console.log(`[vectorIndex] FAISS IndexFlatIP built: ${faissIndex.ntotal()} vectors, dim ${dimension}`);
  } catch (err) {
    console.warn('[vectorIndex] faiss-node not available, using in-memory fallback:', err.message);
    index = { vectors, products };
    console.log(`[vectorIndex] In-memory index: ${products.length} vectors, dim ${dimension}`);
  }
}

/**
 * Return the full product list (same as dataLoader.getProducts() after init).
 * @returns {Array<Object>}
 */
export function getAllProducts() {
  return products;
}

/**
 * Semantic search over index_text.
 * @param {string} queryText
 * @param {{ k?: number, candidateIds?: string[] }} options - k = number of results (default 10); candidateIds = restrict to these product_ids
 * @returns {Promise<Array<Object>>} Product objects with product_id, product_name, image_url, price_krw, rating, seats_recommended, material, color_main, etc.
 */
export async function semanticSearch(queryText, options = {}) {
  const k = Math.max(1, options.k ?? 10);
  const candidateIdsSet = options.candidateIds?.length ? new Set(options.candidateIds.map((id) => String(id).trim())) : null;

  const queryVec = await embedQuery(queryText);

  let labels;
  let distances;

  if (index === 'faiss') {
    const searchK = candidateIdsSet ? Math.min(100, products.length) : k;
    const result = faissIndex.search(queryVec, searchK);
    labels = Array.from(result.labels);
    distances = Array.from(result.distances);
  } else {
    // In-memory: inner product (vectors already normalized)
    const scores = products.map((_, i) => ({
      index: i,
      score: index.vectors[i].reduce((acc, val, j) => acc + val * queryVec[j], 0),
    }));
    scores.sort((a, b) => b.score - a.score);
    const take = candidateIdsSet ? Math.min(100, products.length) : k;
    labels = scores.slice(0, take).map((s) => s.index);
    distances = scores.slice(0, take).map((s) => s.score);
  }

  const byId = new Map((index === 'faiss' ? products : index.products).map((p, i) => [i, p]));

  let ordered = labels.map((id, idx) => ({ product: byId.get(id), score: distances[idx] }));
  if (candidateIdsSet) {
    ordered = ordered.filter((o) => o.product && candidateIdsSet.has(String(o.product.product_id).trim()));
    ordered = ordered.slice(0, k);
  }

  return ordered.map(({ product }) => pickProductFields(product));
}

function pickProductFields(p) {
  if (!p) return null;
  return {
    product_id: p.product_id,
    product_name: p.product_name,
    product_url: p.product_url,
    image_url: p.image_url,
    price_krw: p.price_krw,
    original_price_krw: p.original_price_krw,
    rating: p.rating,
    review_count: p.review_count,
    description: p.description,
    material: p.material,
    table_length_cm: p.table_length_cm,
    table_width_cm: p.table_width_cm,
    table_height_cm: p.table_height_cm,
    chair_width_cm: p.chair_width_cm,
    chair_depth_cm: p.chair_depth_cm,
    chair_height_cm: p.chair_height_cm,
    seats_recommended: p.seats_recommended,
    category: p.category,
    brand: p.brand,
    color_main: p.color_main,
    style_tags: p.style_tags,
    is_child_safe: p.is_child_safe,
    maintenance_level: p.maintenance_level,
    has_assembly_required: p.has_assembly_required,
    index_text: p.index_text,
  };
}
