/**
 * openaiClient.js
 * 2-stage multi-agent: (1) stakeholder opinions, (2) orchestrator consensus.
 * OPENAI_API_KEY: from environment or backend/GPT-API-Key.txt.
 */

import OpenAI from 'openai';

/**
 * Build a compact candidate list for prompts.
 */
function buildCandidatesForPrompt(candidates) {
  return candidates.map((p) => ({
    product_id: p.product_id,
    product_name: p.product_name,
    price_krw: p.price_krw,
    rating: p.rating,
    review_count: p.review_count,
    seats_recommended: p.seats_recommended,
    table_width_cm: p.table_width_cm,
    table_length_cm: p.table_length_cm,
    table_height_cm: p.table_height_cm,
    material: p.material,
    color_main: p.color_main,
    style_tags: p.style_tags,
    is_child_safe: p.is_child_safe,
    maintenance_level: p.maintenance_level,
  }));
}

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set. Set it in env or add backend/GPT-API-Key.txt');
  return new OpenAI({ apiKey });
}

// ---------------------------------------------------------------------------
// Stage 1: Per-stakeholder "virtual multi-agent" — each person's ranking + reasoning
// ---------------------------------------------------------------------------

/**
 * @param {Array<{ id: string, label: string, preferences: Object }>} stakeholders
 * @param {Array<Object>} candidates - product objects
 * @returns {Promise<Array<{ label: string, local_ranking: string[], reasoning: string }>>}  local_ranking = product_name 배열
 */
export async function callChatGPTForStakeholderOpinions(stakeholders, candidates) {
  if (!stakeholders?.length || !candidates?.length) {
    return [];
  }

  const compactCandidates = buildCandidatesForPrompt(candidates);
  const candidatesJson = JSON.stringify(compactCandidates, null, 2);

  const stakeholderLines = stakeholders.map((s) => {
    const p = s.preferences || {};
    let line =
      `- ${s.label}: ` +
      `얼룩/관리 편의성 중요도=${p.maintenance_ease ?? 0}, ` +
      `밝고 모던한 느낌 중요도=${p.bright_modern ?? 0}, ` +
      `공간 동선 중요도=${p.space_flow ?? 0}, ` +
      `의자 깊이·식사 여유 공간 중요도=${p.seat_comfort ?? 0}`;
    if (s.notes && String(s.notes).trim()) {
      line += ` | 추가 의견: ${String(s.notes).trim()}`;
    }
    return line;
  }).join('\n');

  const systemMessage = `You are simulating one agent per stakeholder. Each agent MUST rank the candidate products (best match first) and explain why.

CRITICAL: You MUST always select at least 3 products from ALLOWED_PRODUCT_NAMES for each person. Never say "there are no suitable products", "no products match", or "the list does not contain matching products". Always rank the given candidates by how well they fit; if no product is perfect, choose the best available and explain the compromise in reasoning.

Output format (valid JSON only, no markdown):
{
  "stakeholder_opinions": [
    { "label": "Person A", "local_ranking": [ "제품명1", "제품명2", "제품명3", ... ], "reasoning": "..." }
  ]
}

Rules:
- **local_ranking**: Array of 3–5 strings, each copied exactly from ALLOWED_PRODUCT_NAMES. Order: best match first. Use only the short product_name; do NOT use "material". You must always include at least 3 products.
- **reasoning**: 5–8 sentences in Korean. Name the recommended products and explain why each fits (or is the best available): which preference/slider it satisfies (관리 편의성, 밝고 모던한 느낌, 공간 동선, 의자 깊이·식사 여유 등). If the best match is partial, say so (e.g. "완벽한 나무 제품은 없지만, OOO는 ~점에서 가장 가깝습니다").`;

  const allowedNames = (candidates || []).map((p) => String(p.product_name || '').trim()).filter(Boolean);
  const allowedNamesJson = JSON.stringify(allowedNames);
  const userMessage = `STAKEHOLDERS (each with 4 importance sliders 1–5):
${stakeholderLines}

ALLOWED_PRODUCT_NAMES (you MUST use exactly these strings in local_ranking; pick at least 3 per person):
${allowedNamesJson}

CANDIDATE PRODUCTS (rank these by fit; do NOT put "material" into local_ranking):
${candidatesJson}

Respond with JSON only. For each person you MUST fill local_ranking with at least 3 product names from ALLOWED_PRODUCT_NAMES (best match first). Never reply that no products are available. Write reasoning that names those products and explains fit (5–8 sentences).`;

  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI (stakeholder opinions)');
  const parsed = JSON.parse(content);
  const opinions = Array.isArray(parsed.stakeholder_opinions) ? parsed.stakeholder_opinions : [];

  const allowedSet = new Set((candidates || []).map((p) => String(p.product_name || '').trim()));
  const nameToId = new Map(candidates.map((p) => [String(p.product_name || '').trim(), String(p.product_id || '').trim()]));
  const idToName = new Map(candidates.map((p) => [String(p.product_id || '').trim(), String(p.product_name || '').trim()]));
  const allowedList = [...allowedSet];

  return opinions.map((op) => {
    const rawNames = Array.isArray(op.local_ranking) ? op.local_ranking : [];
    const trim = (n) => String(n).trim();
    const resolveToAllowedName = (t) => {
      if (!t || t.length > 120) return null;
      if (allowedSet.has(t)) return t;
      const found = allowedList.find((a) => a === t || a.startsWith(t) || t.startsWith(a));
      return found || null;
    };
    const names = rawNames.map(trim).map(resolveToAllowedName).filter(Boolean);
    const ids = names.map((name) => nameToId.get(name)).filter(Boolean);
    const fallbackNamesFromIds = (ids.length ? ids : rawNames.map((n) => nameToId.get(trim(n))).filter(Boolean))
      .map((id) => idToName.get(id))
      .filter(Boolean);
    const displayNames = names.length ? names : fallbackNamesFromIds;
    return {
      ...op,
      local_ranking: ids.length ? ids : fallbackNamesFromIds.map((name) => nameToId.get(name)).filter(Boolean),
      local_ranking_product_names: displayNames.length ? displayNames : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Stage 1b: 파이프라인으로 이미 선정된 제품에 대해 reasoning만 생성 (제품 선정 없음)
// ---------------------------------------------------------------------------

/**
 * 슬라이더 1차 필터 + FAISS(notes)로 이미 뽑힌 제품이 있음. 이 제품들에 대한 설명(reasoning)만 생성.
 * @param {Array<{ id: string, label: string, preferences: Object, notes?: string }>} stakeholders
 * @param {Array<{ label: string, local_ranking: string[], local_ranking_product_names: string[], reasoning: string }>} opinionsWithProducts
 * @returns {Promise<Array<{ label: string, local_ranking: string[], local_ranking_product_names: string[], reasoning: string }>>}
 */
export async function generateReasoningForStakeholderOpinions(stakeholders, opinionsWithProducts) {
  if (!stakeholders?.length || !opinionsWithProducts?.length) {
    return opinionsWithProducts || [];
  }

  const lines = opinionsWithProducts.map((op, i) => {
    const s = stakeholders[i] || {};
    const prefs = s.preferences || {};
    const names = op.local_ranking_product_names && op.local_ranking_product_names.length ? op.local_ranking_product_names : op.local_ranking || [];
    return (
      `${op.label}: 선호도(관리 편의성=${prefs.maintenance_ease ?? 0}, 밝고 모던=${prefs.bright_modern ?? 0}, 공간 동선=${prefs.space_flow ?? 0}, 의자·식사 여유=${prefs.seat_comfort ?? 0})` +
      (s.notes && String(s.notes).trim() ? ` | 메모: ${String(s.notes).trim()}` : '') +
      ` | 이 사람에게 추천된 제품(실제 제품명): ${names.join(', ')}`
    );
  }).join('\n');

  const systemMessage = `You first sum up what a person's preferences are in detail by looking at all the information provided. Then you write short explanations in Korean for why the given products were recommended to each person. The products are already chosen (by slider + semantic search). Do NOT pick or change products.

For each person, output one "reasoning" (5–8 sentences): name the recommended products by their exact product names (the names provided), and explain why each fits that person's preferences (관리 편의성, 밝고 모던한 느낌, 공간 동선, 의자 깊이·식사 여유 등). Use only the product names you are given—never placeholder like "제품명1".

Output valid JSON only, no markdown:
{ "reasonings": [ { "label": "Person A", "reasoning": "한국어 5–8문장 설명" }, ... ] }`;

  const userMessage = `Each person's preferences and the products already recommended to them (product names are real, use them as-is):

${lines}

Respond with JSON only: key "reasonings", array of { "label", "reasoning" }. Each reasoning must name the products and explain fit (5–8 sentences).`;

  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return opinionsWithProducts;

  try {
    const parsed = JSON.parse(content);
    const reasonings = Array.isArray(parsed.reasonings) ? parsed.reasonings : [];
    const byLabel = new Map(reasonings.map((r) => [r.label, r.reasoning]));
    return opinionsWithProducts.map((op) => ({
      ...op,
      reasoning: byLabel.get(op.label) || op.reasoning || '',
    }));
  } catch {
    return opinionsWithProducts;
  }
}

// ---------------------------------------------------------------------------
// Stage 2: Orchestrator — CoT + 타협된 preference JSON (제품 선정은 하지 않음)
// ---------------------------------------------------------------------------

/**
 * Orchestrator는 타협 설명(CoT)과 타협된 preference JSON만 출력.
 * 제품 추천은 백엔드에서 compromised_preference로 DB 필터 → FAISS 랭킹으로 수행.
 *
 * @returns {Promise<{ consensus_explanation: string, compromised_preference: Object }>}
 */
/**
 * @param {string} preferenceSummary
 * @param {Array<{ label: string, local_ranking: string[], local_ranking_product_names?: string[], reasoning: string }>} stakeholderOpinions
 */
export async function callChatGPTForConsensus(preferenceSummary, stakeholderOpinions) {
  // Orchestrator가 설명에서 실제 제품명을 쓰도록, 프롬프트에는 제품명으로 넘김
  const opinionsForPrompt = (stakeholderOpinions || []).map((op) => ({
    label: op.label,
    local_ranking: (op.local_ranking_product_names && op.local_ranking_product_names.length) ? op.local_ranking_product_names : op.local_ranking,
    reasoning: op.reasoning,
  }));
  const opinionsJson = JSON.stringify(opinionsForPrompt, null, 2);

  const systemMessage = `You are an orchestrator agent. You receive:
1. A summary of global constraints and each stakeholder's preference (sliders + free-text notes).
2. Each stakeholder's **local opinion**: their own product ranking and reasoning (from separate "virtual agents").

Your task (CoT 필수):
- **consensus_explanation**: 한국어로 타협 과정을 자세히 설명 (2–4 paragraphs). 누가 무엇을 중요히 여겼는지, 어떻게 병합했는지, 누가 무엇을 양보했는지, 최종 타협 방향을 명확히 서술. 마치 토론이 있었고, 그걸 정리하는 느낌이여야해. 이해관계자가 선호하는 제품을 언급할 때는 반드시 STAKEHOLDER OPINIONS의 local_ranking에 나온 **실제 제품명**을 그대로 사용하세요 (예: "HÄGERNÄS 테이블", "BESTÅ 벅스타"). "product_name_1", "product_name_4" 같은 placeholder나 가상의 이름을 쓰지 마세요.
- **compromised_preference**: 위 타협을 반영한 "비자연어 구조화 JSON" 하나. 이 JSON은 이후 DB 필터/점수·FAISS 검색에 사용됩니다. 반드시 아래 스키마를 따르세요.

Schema for compromised_preference (all fields required):
{
  "budget_min": number (KRW),
  "budget_max": number (KRW),
  "seats_needed": number,
  "child_safe_required": boolean,
  "assembly_hassle_sensitive": boolean,
  "maintenance_ease": number (1–5),
  "bright_modern": number (1–5),
  "space_flow": number (1–5),
  "seat_comfort": number (1–5),
  "keywords_or_themes": "string (한국어, 타협된 스타일/키워드 요약. 예: 밝고 모던한 느낌, 관리 쉬운 소재, 공간을 많이 차지하지 않는 테이블. FAISS 시맨틱 검색 쿼리로 사용됨)"
}

Do NOT output product_id or recommendations. Output valid JSON only, no markdown. Format:
{
  "consensus_explanation": "한국어 CoT ...",
  "compromised_preference": { ... }
}`;

  const userMessage = `PREFERENCE SUMMARY (constraints + slider values + notes):
${preferenceSummary}

STAKEHOLDER OPINIONS (each agent's local ranking and reasoning):
${opinionsJson}

Respond with the JSON object only (consensus_explanation + compromised_preference).`;

  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI (consensus)');
  return JSON.parse(content);
}
