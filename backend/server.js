/**
 * Express server for multi-stakeholder furniture decision helper.
 * - GET /api/health
 * - GET /api/products (paginated)
 * - POST /api/consensus-and-recommendations
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load OpenAI API key from backend/GPT-API-Key.txt if OPENAI_API_KEY not set
const __dirname = dirname(fileURLToPath(import.meta.url));
if (!process.env.OPENAI_API_KEY) {
  const keyPath = join(__dirname, 'GPT-API-Key.txt');
  if (existsSync(keyPath)) {
    process.env.OPENAI_API_KEY = readFileSync(keyPath, 'utf-8').trim();
  }
}

import express from 'express';
import cors from 'cors';
import { initVectorIndex, getAllProducts, semanticSearch } from './vectorIndex.js';
import { generateReasoningForStakeholderOpinions, callChatGPTForConsensus } from './openaiClient.js';
import { scoreProduct } from './utils/scoring.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Products loaded after initVectorIndex() in start()
let products = [];

/** Regex-escape special chars for use in RegExp. */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * product_id 여러 형식(095.994.95, 95.994.95, 9599495 등)을 동일 name에 매핑.
 * @param {string} id - product_id
 * @returns {string[]} 치환 시 사용할 id 후보들 (긴 것 우선)
 */
function productIdVariants(id) {
  const raw = String(id || '').trim();
  if (!raw) return [];
  const withDots = raw.replace(/[^\d.]/g, '');
  const parts = withDots.split('.').filter(Boolean);
  const variants = new Set([raw, withDots]);
  if (parts.length >= 2) {
    const normalized = parts.map((p, i) => p.padStart(i === parts.length - 1 ? 2 : 3, '0')).join('.');
    variants.add(normalized);
  }
  const digitsOnly = raw.replace(/\D/g, '');
  if (digitsOnly) {
    variants.add(digitsOnly);
    const padded = digitsOnly.padStart(8, '0').slice(0, 8);
    if (padded.length >= 6) {
      variants.add(padded.slice(0, 3) + '.' + padded.slice(3, 6) + '.' + padded.slice(6, 8));
    }
  }
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (last.length === 1) {
      variants.add(parts.slice(0, -1).concat(last + '0').join('.'));
    }
  }
  return [...variants];
}

/**
 * Frontend 가기 직전: payload 내 모든 string에서 product_id를 product_name으로 치환.
 * @param {Object} payload - res.json에 넣을 객체 (재귀 순회)
 * @param {Array<{ product_id: string, product_name: string }>} productsList
 * @returns {Object} 치환된 복사본 (product_id 필드 값 자체는 유지, 문자열 내용만 치환)
 */
function replaceProductIdsWithNamesInPayload(payload, productsList) {
  if (!payload || !Array.isArray(productsList) || productsList.length === 0) return payload;
  const idToName = new Map();
  for (const p of productsList) {
    const name = String(p.product_name || '').trim();
    if (!name) continue;
    for (const variant of productIdVariants(p.product_id)) {
      if (variant && !idToName.has(variant)) idToName.set(variant, name);
    }
  }
  const sorted = [...idToName.entries()].sort((a, b) => b[0].length - a[0].length);
  const SKIP_KEYS = new Set(['product_id', 'local_ranking']);

  function replaceIn(obj, key) {
    if (SKIP_KEYS.has(key)) return obj;
    if (typeof obj === 'string') {
      let s = obj;
      for (const [id, name] of sorted) {
        s = s.replace(new RegExp(escapeRegex(id), 'g'), name);
      }
      return s;
    }
    if (Array.isArray(obj)) return obj.map((item) => replaceIn(item, key));
    if (obj !== null && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = replaceIn(v, k);
      return out;
    }
    return obj;
  }
  return replaceIn(payload, null);
}

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------------------------------------------------------------------------
// GET /api/products - paginated list
// ---------------------------------------------------------------------------
app.get('/api/products', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const start = (page - 1) * limit;
  const slice = products.slice(start, start + limit);
  res.json({
    data: slice,
    page,
    limit,
    total: products.length,
    totalPages: Math.ceil(products.length / limit),
  });
});

// ---------------------------------------------------------------------------
// POST /api/consensus-and-recommendations
// 새 구조: Multi-agent(각자 맞는 제품) → Orchestrator(CoT + 타협 preference JSON)
//         → DB에서 타협 preference로 10명 후보 → FAISS 시맨틱 랭킹 → 최종 3명
// ---------------------------------------------------------------------------
app.post('/api/consensus-and-recommendations', async (req, res) => {
  try {
    const { constraints, stakeholders } = req.body || {};
    const budget_min = constraints?.budget_min ?? 0;
    const budget_max = constraints?.budget_max ?? Number.MAX_SAFE_INTEGER;
    const seats_needed = constraints?.seats_needed ?? 0;
    const child_safe_required = Boolean(constraints?.child_safe_required);
    const assembly_hassle_sensitive = Boolean(constraints?.assembly_hassle_sensitive);

    // 1) 제약만으로 넓은 후보 풀 (Multi-agent용, 최대 50개)
    const constraintFiltered = products.filter((p) => {
      if (String(p.category).toLowerCase() !== 'dining_table_set') return false;
      const seats = p.seats_recommended != null ? Number(p.seats_recommended) : 0;
      if (seats < seats_needed) return false;
      const price = p.price_krw != null ? Number(p.price_krw) : 0;
      if (price < budget_min || price > budget_max) return false;
      if (child_safe_required && !p.is_child_safe) return false;
      if (assembly_hassle_sensitive && p.has_assembly_required) return false;
      return true;
    });
    const candidatesForAgents = constraintFiltered.slice(0, 50);

    // 2) Stage 1: 인당 슬라이더(58-61)로 1차 필터 → FAISS(notes)로 notes와 가장 가까운 제품 선정 (실제 제품명 사용)
    const stakeholderList = stakeholders || [];
    const opinionsWithProducts = await Promise.all(
      stakeholderList.map(async (s) => {
        const synthetic = [{ id: s.id, label: s.label, preferences: s.preferences || {} }];
        const scored = candidatesForAgents
          .map((p) => ({ ...p, _score: scoreProduct(p, synthetic) }))
          .filter((p) => p._score > 0)
          .sort((a, b) => b._score - a._score);
        const topByScore = scored.length > 0
          ? scored.slice(0, 25).map((p) => String(p.product_id).trim())
          : candidatesForAgents.slice(0, 25).map((p) => String(p.product_id).trim());
        const queryForPerson = (s.notes && String(s.notes).trim()) || '다이닝 테이블 세트 편안한';
        const faissForPerson = await semanticSearch(queryForPerson, { candidateIds: topByScore, k: 5 });
        const ids = faissForPerson.map((p) => p.product_id).filter(Boolean);
        const names = faissForPerson.map((p) => p.product_name).filter(Boolean);
        return {
          label: s.label || 'Person',
          local_ranking: ids,
          local_ranking_product_names: names,
          reasoning: '',
        };
      })
    );
    const stakeholderOpinions = await generateReasoningForStakeholderOpinions(stakeholderList, opinionsWithProducts);

    // 3) Orchestrator: preference + notes 병합 → CoT + 타협된 preference JSON (제품 선정 없음)
    const preferenceSummary = buildPreferenceSummary(constraints, stakeholders || []);
    const orchestratorResult = await callChatGPTForConsensus(preferenceSummary, stakeholderOpinions);

    const consensusExplanation = orchestratorResult.consensus_explanation || '';
    let compromised = orchestratorResult.compromised_preference || {};

    // 4) 타협 preference로 기본값 보정 (요청 constraints + 평균 슬라이더)
    compromised = normalizeCompromisedPreference(compromised, constraints, stakeholders);

    // 5) DB: 비자연어 타협 preference로 필터 + 점수 → 상위 10명 후보
    const filteredByCompromise = products.filter((p) => {
      if (String(p.category).toLowerCase() !== 'dining_table_set') return false;
      const seats = p.seats_recommended != null ? Number(p.seats_recommended) : 0;
      if (seats < compromised.seats_needed) return false;
      const price = p.price_krw != null ? Number(p.price_krw) : 0;
      if (price < compromised.budget_min || price > compromised.budget_max) return false;
      if (compromised.child_safe_required && !p.is_child_safe) return false;
      if (compromised.assembly_hassle_sensitive && p.has_assembly_required) return false;
      return true;
    });

    const syntheticStakeholders = [
      {
        id: 'C',
        label: 'Compromise',
        preferences: {
          maintenance_ease: compromised.maintenance_ease ?? 3,
          bright_modern: compromised.bright_modern ?? 3,
          space_flow: compromised.space_flow ?? 3,
          seat_comfort: compromised.seat_comfort ?? 3,
        },
      },
    ];
    const scored = filteredByCompromise
      .map((p) => ({ ...p, _score: scoreProduct(p, syntheticStakeholders) }))
      .sort((a, b) => b._score - a._score);
    const top10 = scored.slice(0, 10);
    const top10Ids = top10.map((p) => String(p.product_id).trim());

    // 6) FAISS: keywords_or_themes(또는 CoT)로 시맨틱 랭킹 → 최종 3명
    const queryForFaiss = compromised.keywords_or_themes?.trim() || consensusExplanation.slice(0, 500) || '다이닝 테이블 세트';
    const faissTop3 = await semanticSearch(queryForFaiss, { candidateIds: top10Ids, k: 3 });

    // 7) recommendations 배열 (기존 프론트 형식 유지: product_id, rank, reason, caution)
    const recommendations = faissTop3.map((p, i) => ({
      product_id: p.product_id,
      rank: i + 1,
      reason: compromised.keywords_or_themes
        ? `타협 키워드("${String(compromised.keywords_or_themes).slice(0, 50)}…") 기반 시맨틱 랭킹 ${i + 1}위`
        : `타협안 기반 시맨틱 랭킹 ${i + 1}위`,
      caution: p.maintenance_level ? `관리 수준: ${p.maintenance_level}` : '',
    }));

    const payload = {
      stakeholder_opinions: stakeholderOpinions,
      consensus: {
        consensus_explanation: consensusExplanation,
        compromised_preference: compromised,
        recommendations,
      },
    };
    res.json(replaceProductIdsWithNamesInPayload(payload, products));
  } catch (err) {
    console.error('consensus-and-recommendations error:', err);
    res.status(500).json({
      error: 'Failed to get consensus and recommendations',
      message: err.message,
    });
  }
});

/**
 * Orchestrator가 준 compromised_preference를 검증·보정. 누락 시 요청 constraints + 슬라이더 평균 사용.
 */
function normalizeCompromisedPreference(compromised, constraints, stakeholders) {
  const fallback = {
    budget_min: constraints?.budget_min ?? 0,
    budget_max: constraints?.budget_max ?? 999999999,
    seats_needed: constraints?.seats_needed ?? 4,
    child_safe_required: Boolean(constraints?.child_safe_required),
    assembly_hassle_sensitive: Boolean(constraints?.assembly_hassle_sensitive),
    maintenance_ease: 3,
    bright_modern: 3,
    space_flow: 3,
    seat_comfort: 3,
    keywords_or_themes: '다이닝 테이블 세트',
  };
  if (Array.isArray(stakeholders) && stakeholders.length > 0) {
    const avg = stakeholders.reduce(
      (acc, s) => {
        const p = s.preferences || {};
        acc.maintenance_ease += p.maintenance_ease ?? 3;
        acc.bright_modern += p.bright_modern ?? 3;
        acc.space_flow += p.space_flow ?? 3;
        acc.seat_comfort += p.seat_comfort ?? 3;
        return acc;
      },
      { maintenance_ease: 0, bright_modern: 0, space_flow: 0, seat_comfort: 0 }
    );
    const n = stakeholders.length;
    fallback.maintenance_ease = Math.round(avg.maintenance_ease / n) || 3;
    fallback.bright_modern = Math.round(avg.bright_modern / n) || 3;
    fallback.space_flow = Math.round(avg.space_flow / n) || 3;
    fallback.seat_comfort = Math.round(avg.seat_comfort / n) || 3;
  }
  const num = (v, def) => (v != null && !isNaN(Number(v)) ? Number(v) : def);
  return {
    budget_min: num(compromised.budget_min, fallback.budget_min),
    budget_max: num(compromised.budget_max, fallback.budget_max),
    seats_needed: num(compromised.seats_needed, fallback.seats_needed),
    child_safe_required: Boolean(compromised.child_safe_required ?? fallback.child_safe_required),
    assembly_hassle_sensitive: Boolean(compromised.assembly_hassle_sensitive ?? fallback.assembly_hassle_sensitive),
    maintenance_ease: num(compromised.maintenance_ease, fallback.maintenance_ease),
    bright_modern: num(compromised.bright_modern, fallback.bright_modern),
    space_flow: num(compromised.space_flow, fallback.space_flow),
    seat_comfort: num(compromised.seat_comfort, fallback.seat_comfort),
    keywords_or_themes: String(compromised.keywords_or_themes ?? fallback.keywords_or_themes).trim(),
  };
}

/**
 * 한국어 preference summary (ChatGPT CoT용)
 * @param {Object} constraints - budget_min, budget_max, seats_needed, child_safe_required, assembly_hassle_sensitive
 * @param {Array<{ id: string, label: string, preferences: Object }>} stakeholders
 */
function buildPreferenceSummary(constraints, stakeholders) {
  const lines = [];

  if (constraints) {
    const { budget_min, budget_max, seats_needed, child_safe_required, assembly_hassle_sensitive } = constraints;

    lines.push('📌 공통 조건:');
    if (budget_min != null && budget_max != null) {
      lines.push(`- 예산: ${Number(budget_min).toLocaleString()}원 ~ ${Number(budget_max).toLocaleString()}원`);
    }
    if (seats_needed != null) {
      lines.push(`- 최소 좌석 수: ${seats_needed}인용 이상`);
    }
    if (child_safe_required) {
      lines.push('- 아이/안전을 고려한 제품을 선호');
    }
    if (assembly_hassle_sensitive) {
      lines.push('- 조립이 복잡한 제품은 피하고 싶음');
    }
    lines.push('');
  }

  lines.push('👥 이해관계자별 선호도:');

  (stakeholders || []).forEach((s, idx) => {
    const label = s.label || `Person ${String.fromCharCode(65 + idx)}`;
    const p = s.preferences || {};
    lines.push(
      `${label}: ` +
        `얼룩/관리 편의성 중요도=${p.maintenance_ease ?? 0}, ` +
        `밝고 모던한 느낌 중요도=${p.bright_modern ?? 0}, ` +
        `공간 동선 중요도=${p.space_flow ?? 0}, ` +
        `의자 깊이·식사 여유 공간 중요도=${p.seat_comfort ?? 0}`
    );
    if (s.notes && String(s.notes).trim()) {
      lines.push(`  추가 의견: ${String(s.notes).trim()}`);
    }
  });

  return lines.join('\n');
}

// A안: 프론트 빌드 결과 정적 서빙 (배포 시 같은 서버에서 React 제공)
const distPath = join(__dirname, '..', 'frontend', 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(distPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.type('html').send(`
      <h1>프론트 빌드 필요</h1>
      <p><code>frontend/dist</code>가 없습니다. 프로젝트 루트에서:</p>
      <pre>cd frontend && npm run build</pre>
      <p>실행 후 서버를 다시 띄우세요.</p>
      <p>API는 동작 중: <a href="/api/health">/api/health</a></p>
    `);
  });
}

async function start() {
  await initVectorIndex();
  products = getAllProducts();
  console.log(`Products ready: ${products.length}`);

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
