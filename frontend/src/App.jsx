import { useState } from 'react';
import PreferenceInput from './PreferenceInput';
import Results from './Results';

const API_BASE = ''; // use relative /api so Vite proxy works

export default function App() {
  const [view, setView] = useState('input');
  const [consensusResult, setConsensusResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGetConsensus = async (payload) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/consensus-and-recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setConsensusResult(data);
      setView('results');
    } catch (err) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  if (view === 'results') {
    return (
      <div className="page-section">
        <a href="#" className="back-link" onClick={(e) => { e.preventDefault(); setView('input'); setConsensusResult(null); setError(null); }}>
          ← Back to preferences
        </a>
        <Results result={consensusResult} />
      </div>
    );
  }

  return (
    <div className="page-section">
      <h1>Dining Table Decision Helper</h1>
      <p>Enter preferences for each person, then get a consensus and top recommendations.</p>
      {error && <div className="error">{error}</div>}
      <PreferenceInput onSubmit={handleGetConsensus} loading={loading} />
    </div>
  );
}
