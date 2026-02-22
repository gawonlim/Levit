/**
 * MVP scoring: 4개 슬라이더 선호도 → DB 속성 매핑
 * maintenance_ease, bright_modern, space_flow, seat_comfort
 */

/**
 * @param {Object} product - CSV row (cleaned_data 한 row)
 * @param {Array<{ id: string, label: string, preferences: Object }>} stakeholders
 * @returns {number} score (높을수록 선호에 부합)
 */
export function scoreProduct(product, stakeholders) {
  if (!Array.isArray(stakeholders) || stakeholders.length === 0) {
    return 0;
  }

  // 1) 전역으로 평균 선호도 계산 (간단 버전)
  const avgPref = stakeholders.reduce(
    (acc, s) => {
      const p = s.preferences || {};
      acc.maintenance_ease += p.maintenance_ease ?? 0;
      acc.bright_modern += p.bright_modern ?? 0;
      acc.space_flow += p.space_flow ?? 0;
      acc.seat_comfort += p.seat_comfort ?? 0;
      return acc;
    },
    { maintenance_ease: 0, bright_modern: 0, space_flow: 0, seat_comfort: 0 }
  );

  const n = stakeholders.length;
  Object.keys(avgPref).forEach((k) => (avgPref[k] = avgPref[k] / n));

  let score = 0;

  // (1) maintenance_ease → maintenance_level, material
  if (avgPref.maintenance_ease > 0) {
    let maintenanceScore = 0;
    const level = String(product.maintenance_level || '').toLowerCase();
    if (level === 'low') maintenanceScore = 1;
    else if (level === 'medium') maintenanceScore = 0.5;
    else maintenanceScore = 0.2;

    const material = String(product.material || '');
    if (/유리|대리석|라미네이트|멜라민/.test(material)) {
      maintenanceScore += 0.2;
    }

    score += avgPref.maintenance_ease * maintenanceScore;
  }

  // (2) bright_modern → color_main, style_tags
  if (avgPref.bright_modern > 0) {
    let designScore = 0;
    const color = String(product.color_main || '').toLowerCase();
    if (color === 'white' || color === 'light_wood') {
      designScore += 1;
    } else if (color === 'wood') {
      designScore += 0.7;
    } else {
      designScore += 0.3;
    }

    const styleTags = String(product.style_tags || '');
    if (styleTags.includes('modern')) designScore += 0.3;
    if (styleTags.includes('nordic')) designScore += 0.2;
    if (styleTags.includes('minimal')) designScore += 0.2;

    score += avgPref.bright_modern * designScore;
  }

  // (3) space_flow → footprint 작을수록 좋음
  if (avgPref.space_flow > 0) {
    const length = Number(product.table_length_cm) || 0;
    const width = Number(product.table_width_cm) || 0;
    const footprint = length * width || 1;
    const spaceScore = 1 / Math.log10(footprint + 10);
    score += avgPref.space_flow * spaceScore;
  }

  // (4) seat_comfort → chair_depth + 1인당 테이블 폭
  if (avgPref.seat_comfort > 0) {
    const chairDepth = Number(product.chair_depth_cm) || 0;
    const length = Number(product.table_length_cm) || 0;
    const seats = Number(product.seats_recommended) || 1;
    const perPersonWidth = length / seats;

    let comfortScore = 0;
    if (chairDepth >= 45) comfortScore += 0.5;
    if (chairDepth >= 50) comfortScore += 0.5;
    if (perPersonWidth >= 55) comfortScore += 0.5;
    if (perPersonWidth >= 65) comfortScore += 0.5;

    score += avgPref.seat_comfort * comfortScore;
  }

  // 보너스: 평점·리뷰 수
  const rating = Number(product.rating) || 0;
  const reviewCount = Number(product.review_count) || 0;
  score += rating * Math.log10(reviewCount + 10) * 0.1;

  return score;
}
