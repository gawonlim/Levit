/**
 * dataLoader.js
 * Loads final_data.csv into memory and normalizes numeric fields.
 * CSV path is relative to project root: data/final_data.csv
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const CSV_PATH = join(PROJECT_ROOT, 'data', 'final_data.csv');

const NUMERIC_FIELDS = [
  'price_krw',
  'original_price_krw',
  'rating',
  'review_count',
  'table_width_cm',
  'table_length_cm',
  'table_height_cm',
  'chair_width_cm',
  'chair_depth_cm',
  'chair_height_cm',
  'seats_recommended',
];

/**
 * Parse a value to number; return null if invalid/empty.
 */
function toNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

/**
 * Normalize boolean-like fields for filtering.
 */
function toBool(value) {
  if (value === '' || value === null || value === undefined) return false;
  const s = String(value).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/**
 * Load and parse CSV, return array of product objects with numeric fields converted.
 * @returns {Array<Object>} products
 */
export function loadProducts() {
  let raw = readFileSync(CSV_PATH, 'utf-8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    cast: false,
  });
  // product_id / product_name 은 숫자로 바뀌지 않게 (Python과 동일하게 문자열 유지)

  const products = rows.map((row) => {
    const product = { ...row };
    for (const field of NUMERIC_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(product, field)) {
        product[field] = toNumber(product[field]);
      }
    }
    if (Object.prototype.hasOwnProperty.call(product, 'is_child_safe')) {
      product.is_child_safe = toBool(product.is_child_safe);
    }
    if (Object.prototype.hasOwnProperty.call(product, 'has_assembly_required')) {
      product.has_assembly_required = toBool(product.has_assembly_required);
    }
    if (Object.prototype.hasOwnProperty.call(product, 'product_id')) {
      product.product_id = String(product.product_id ?? '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(product, 'product_name')) {
      product.product_name = product.product_name == null ? '' : String(product.product_name).trim();
    }
    return product;
  });

  return products;
}

/**
 * In-memory products array. Load once at startup.
 * @type {Array<Object>}
 */
let products = null;

/**
 * Get products (load on first access).
 * @returns {Array<Object>}
 */
export function getProducts() {
  if (products === null) {
    products = loadProducts();
  }
  return products;
}

/**
 * Reset cached products (useful for tests or reload).
 */
export function resetProducts() {
  products = null;
}
