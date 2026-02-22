import { useState, useEffect } from 'react';

// DB 매핑: maintenance_level/material, color_main/style_tags, footprint, chair_depth/테이블폭
const SLIDER_KEYS = [
  { key: 'maintenance_ease', label: '얼룩/관리 편의성이 얼마나 중요해요?' },
  { key: 'bright_modern', label: '밝고 모던한 느낌이 얼마나 중요해요?' },
  { key: 'space_flow', label: '거실/공간 동선을 넓게 쓰는 게 얼마나 중요해요?' },
  { key: 'seat_comfort', label: '의자 깊이/식사할 때 여유 공간이 얼마나 중요해요?' },
];

const DEFAULT_PREFS = Object.fromEntries(SLIDER_KEYS.map(({ key }) => [key, 3]));

function personLabel(index) {
  return 'Person ' + String.fromCharCode(65 + index);
}

export default function PreferenceInput({ onSubmit, loading }) {
  const [numStakeholders, setNumStakeholders] = useState(2);
  const [stakeholders, setStakeholders] = useState(() =>
    [0, 1].map((i) => ({
      id: String.fromCharCode(65 + i),
      label: personLabel(i),
      preferences: { ...DEFAULT_PREFS },
      notes: '',
    }))
  );
  const [budgetMin, setBudgetMin] = useState(200000);
  const [budgetMax, setBudgetMax] = useState(600000);
  const [seatsNeeded, setSeatsNeeded] = useState(4);
  const [childSafeRequired, setChildSafeRequired] = useState(false);
  const [assemblyHassleSensitive, setAssemblyHassleSensitive] = useState(false);

  // Number of stakeholders 변경 시 Person A, B, C... 박스 개수 맞추기
  useEffect(() => {
    const n = Math.max(1, Math.min(10, numStakeholders));
    setStakeholders((prev) => {
      const next = [];
      for (let i = 0; i < n; i++) {
        const id = String.fromCharCode(65 + i);
        const label = personLabel(i);
        next.push(
          prev[i]
            ? { ...prev[i], id, label, notes: prev[i].notes ?? '' }
            : { id, label, preferences: { ...DEFAULT_PREFS }, notes: '' }
        );
      }
      return next;
    });
  }, [numStakeholders]);

  const updateStakeholderPref = (index, key, value) => {
    setStakeholders((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        preferences: { ...next[index].preferences, [key]: value },
      };
      return next;
    });
  };

  const updateStakeholderNotes = (index, notes) => {
    setStakeholders((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], notes: notes ?? '' };
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      constraints: {
        budget_min: budgetMin,
        budget_max: budgetMax,
        seats_needed: seatsNeeded,
        child_safe_required: childSafeRequired,
        assembly_hassle_sensitive: assemblyHassleSensitive,
      },
      stakeholders,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="card">
      <h2>Preferences</h2>

      <div style={{ marginBottom: '1.5rem' }}>
        <label>Number of stakeholders</label>
        <input
          type="number"
          value={numStakeholders}
          onChange={(e) => setNumStakeholders(Number(e.target.value) || 1)}
          min={1}
          max={10}
          style={{ width: '4rem', marginLeft: '0.5rem' }}
        />
        <span style={{ marginLeft: '0.5rem', color: '#666' }}>(1–10)</span>
      </div>

      {stakeholders.map((s, index) => (
        <div key={s.id} className="participant-block">
          <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>{s.label}</h3>
          {SLIDER_KEYS.map(({ key, label }) => (
            <div key={key} className="slider-row">
              <label>{label}</label>
              <input
                type="range"
                min={1}
                max={5}
                value={s.preferences[key] ?? 3}
                onChange={(e) => updateStakeholderPref(index, key, Number(e.target.value))}
              />
              <span>{s.preferences[key] ?? 3}</span>
            </div>
          ))}
          <div style={{ marginTop: '0.75rem' }}>
            <label>그 외에 중요하게 생각하는 부분들을 자유롭게 적어주세요!</label>
            <textarea
              value={s.notes ?? ''}
              onChange={(e) => updateStakeholderNotes(index, e.target.value)}
              placeholder="e.g. 나는 따뜻한 느낌을 주는 소나무 재질이면 좋겠어, 나는 튼튼한 재질이 좋아, 등"
              rows={3}
              style={{ width: '100%', padding: '0.5rem', fontSize: '1rem', marginTop: '0.25rem', resize: 'vertical' }}
            />
          </div>
        </div>
      ))}

      <div style={{ marginBottom: '1rem' }}>
        <label>Budget (KRW) min</label>
        <input
          type="number"
          value={budgetMin}
          onChange={(e) => setBudgetMin(Number(e.target.value))}
          min={0}
          step={10000}
        />
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label>Budget (KRW) max</label>
        <input
          type="number"
          value={budgetMax}
          onChange={(e) => setBudgetMax(Number(e.target.value))}
          min={0}
          step={10000}
        />
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label>Seats needed</label>
        <input
          type="number"
          value={seatsNeeded}
          onChange={(e) => setSeatsNeeded(Number(e.target.value))}
          min={1}
          max={20}
        />
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={childSafeRequired}
            onChange={(e) => setChildSafeRequired(e.target.checked)}
          />
          아이/안전 고려 제품 선호 (child_safe_required)
        </label>
      </div>
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={assemblyHassleSensitive}
            onChange={(e) => setAssemblyHassleSensitive(e.target.checked)}
          />
          조립 복잡한 제품 피하기 (assembly_hassle_sensitive)
        </label>
      </div>

      <button type="submit" className="primary" disabled={loading}>
        {loading ? 'Getting consensus…' : 'Get Consensus'}
      </button>
    </form>
  );
}
