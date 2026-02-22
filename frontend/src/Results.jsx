import { useState, useEffect } from 'react';

/**
 * Fetch product details by id from GET /api/products (we have full list in backend).
 * For MVP we get product_id from recommendations and match from a single products fetch.
 */
function productIdLookupKeys(id) {
  const s = String(id || '').trim();
  const keys = [s];
  const noDots = s.replace(/\./g, '');
  if (noDots && noDots !== s) keys.push(noDots);
  const parts = s.split('.').filter(Boolean);
  if (parts.length >= 2 && parts[parts.length - 1].length === 1) {
    keys.push(parts.slice(0, -1).concat(parts[parts.length - 1] + '0').join('.'));
  }
  return keys;
}

async function fetchProductsMap() {
  const res = await fetch('/api/products?limit=5000');
  if (!res.ok) throw new Error('Failed to load products');
  const data = await res.json();
  const map = {};
  for (const p of data.data || []) {
    for (const key of productIdLookupKeys(p.product_id)) {
      if (key && !map[key]) map[key] = p;
    }
  }
  return map;
}

function firstImageUrl(imageUrl) {
  if (!imageUrl) return null;
  const first = String(imageUrl).split(',')[0].trim();
  return first || null;
}

export default function Results({ result }) {
  const [productsMap, setProductsMap] = useState({});
  const [loadErr, setLoadErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchProductsMap()
      .then((map) => { if (!cancelled) setProductsMap(map); })
      .catch((e) => { if (!cancelled) setLoadErr(e.message); });
    return () => { cancelled = true; };
  }, []);

  if (!result) {
    return <div className="card">No results.</div>;
  }

  // New multi-agent response: { stakeholder_opinions, consensus }
  const opinions = result.stakeholder_opinions || [];
  const consensus = result.consensus || result; // fallback for old shape
  const consensusExplanation = consensus.consensus_explanation;
  const recommendations = consensus.recommendations || [];

  const getProduct = (productId) =>
    productsMap[productId] || productsMap[String(productId || '').replace(/\./g, '')];

  return (
    <>
      <h1>Multi-Agent Consensus &amp; Recommendations</h1>

      {opinions.length > 0 && (
        <section className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>👤 이해관계자별 의견 (Person A/B/C…)</h2>
          {opinions.map((op, idx) => {
            const names = op.local_ranking_product_names && op.local_ranking_product_names.length
              ? op.local_ranking_product_names
              : (op.local_ranking || []).map((id) => getProduct(id)?.product_name).filter(Boolean);
            const topId = op.local_ranking && op.local_ranking[0];
            const topProduct = topId ? getProduct(topId) : null;
            return (
              <div key={op.label || idx} className="participant-block" style={{ marginBottom: '1rem' }}>
                <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>{op.label}</h3>
                {names.length > 0 && (
                  <p style={{ margin: '0.25rem 0', fontSize: '0.95rem' }}>
                    <strong>선호 제품:</strong> {names.join(', ')}
                  </p>
                )}
                {(topProduct || names.length > 0) && (
                  <p style={{ margin: '0.25rem 0', fontSize: '0.95rem' }}>
                    <strong>1순위:</strong> {(topProduct && topProduct.product_name) || names[0] || ''}
                    {topProduct && topProduct.price_krw != null && ` · ${Number(topProduct.price_krw).toLocaleString()}원`}
                  </p>
                )}
                {op.reasoning && (
                  <p style={{ margin: 0, color: '#555', whiteSpace: 'pre-wrap' }}>{op.reasoning}</p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {consensusExplanation && (
        <section className="consensus-block">
          <h2 style={{ marginTop: 0 }}>🤝 타협 결과 (Orchestrator)</h2>
          {consensusExplanation}
        </section>
      )}

      {loadErr && <div className="error">{loadErr}</div>}

      <h2>최종 추천 제품 (Top 3)</h2>
      {recommendations.length === 0 ? (
        <p>No recommendations returned.</p>
      ) : (
        recommendations
          .sort((a, b) => (a.rank || 0) - (b.rank || 0))
          .map((rec) => {
            const product = getProduct(rec.product_id);
            const imgUrl = product ? firstImageUrl(product.image_url) : null;
            return (
              <div key={rec.product_id || rec.rank} className="product-card">
                {imgUrl ? (
                  <img src={imgUrl} alt="" />
                ) : (
                  <div style={{ width: 120, height: 120, background: '#eee', borderRadius: 8 }} />
                )}
                <div>
                  <strong>{product ? (product.product_name || rec.product_id) : rec.product_id}</strong>
                  {product && (
                    <div className="meta">
                      {product.price_krw != null && <span>{Number(product.price_krw).toLocaleString()} KRW</span>}
                      {product.rating != null && <span> · Rating: {product.rating}</span>}
                      {product.review_count != null && <span> · {product.review_count} reviews</span>}
                      {product.seats_recommended != null && <span> · {product.seats_recommended} seats</span>}
                      {product.material && <span> · {product.material}</span>}
                      {product.color_main && <span> · {product.color_main}</span>}
                      {product.style_tags && <span> · {product.style_tags}</span>}
                    </div>
                  )}
                  {rec.reason && (
                    <div className="reason"><strong>Why:</strong> {rec.reason}</div>
                  )}
                  {rec.caution && (
                    <div className="caution"><strong>Caution:</strong> {rec.caution}</div>
                  )}
                </div>
              </div>
            );
          })
      )}
    </>
  );
}
