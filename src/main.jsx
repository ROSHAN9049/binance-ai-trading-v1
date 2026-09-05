import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = 'https://api.india.delta.exchange/v2/tickers?contract_types=perpetual_futures';
const REFRESH_MS = 5000;

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v) { if (v >= 1e9) return '$' + (v/1e9).toFixed(2) + 'B'; if (v >= 1e6) return '$' + (v/1e6).toFixed(2) + 'M'; if (v >= 1e3) return '$' + (v/1e3).toFixed(1) + 'K'; return '$' + v.toFixed(0); }
function price(v) { return num(v).toLocaleString('en-US', { maximumFractionDigits: 8 }); }
function percentile(values, value) { if (!values.length) return 0; const less = values.filter(x => x <= value).length; return (less / values.length) * 100; }

function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(null);
  const [minChange, setMinChange] = useState(1);
  const [minVolume, setMinVolume] = useState(100000);
  const [side, setSide] = useState('ALL');
  const [sort, setSort] = useState('score');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(API, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Delta API HTTP ${res.status}`);
      const json = await res.json();
      const raw = Array.isArray(json.result) ? json.result : [];
      const volumes = raw.map(x => num(x.turnover_usd)).filter(x => x > 0);
      const mapped = raw.filter(x => x.symbol && x.contract_type === 'perpetual_futures').map(x => {
        const change = num(x.ltp_change_24h);
        const vol = num(x.turnover_usd);
        const changeScore = Math.min(Math.abs(change) / 10, 1) * 50;
        const volumeScore = (percentile(volumes, vol) / 100) * 50;
        const score = Math.round(changeScore + volumeScore);
        const signal = change >= minChange && score >= 55 ? 'BUY' : change <= -minChange && score >= 55 ? 'SELL' : 'WATCH';
        return { ...x, change, vol, score, signal };
      });
      setRows(mapped);
      setUpdated(new Date());
      setError('');
    } catch (e) { setError(e.message || 'Unable to load Delta market data'); }
    finally { setLoading(false); }
  }, [minChange]);

  useEffect(() => { load(); const id = setInterval(load, REFRESH_MS); return () => clearInterval(id); }, [load]);

  const filtered = useMemo(() => {
    let out = rows.filter(r => r.vol >= minVolume && Math.abs(r.change) >= minChange);
    if (side !== 'ALL') out = out.filter(r => r.signal === side);
    if (search) out = out.filter(r => r.symbol.toLowerCase().includes(search.toLowerCase()));
    return [...out].sort((a,b) => sort === 'change' ? Math.abs(b.change)-Math.abs(a.change) : sort === 'volume' ? b.vol-a.vol : b.score-a.score);
  }, [rows, minChange, minVolume, side, search, sort]);

  const stats = useMemo(() => ({
    total: rows.length,
    buy: rows.filter(r => r.signal === 'BUY').length,
    sell: rows.filter(r => r.signal === 'SELL').length,
    active: rows.filter(r => Math.abs(r.change) >= minChange && r.vol >= minVolume).length
  }), [rows, minChange, minVolume]);

  return <div className="app">
    <header><div><div className="brand">⚡ DELTA SCANNER</div><div className="sub">Delta Exchange India • Live perpetual market scanner</div></div><div className="live"><span/> LIVE • 5s</div></header>
    <section className="hero"><div><h1>Volume + 24H Momentum</h1><p>Signals are ranked using 24-hour price change and USD turnover. This version is <b>scanner / paper-signal only</b>; it does not place real orders.</p></div><button onClick={load}>↻ Refresh</button></section>
    <div className="cards"><div><small>MARKETS</small><b>{stats.total}</b></div><div><small>BUY SIGNALS</small><b className="up">{stats.buy}</b></div><div><small>SELL SIGNALS</small><b className="down">{stats.sell}</b></div><div><small>QUALIFIED</small><b>{stats.active}</b></div></div>
    <section className="controls">
      <input placeholder="Search symbol…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <label>Min 24H % <input type="number" step="0.1" value={minChange} onChange={e=>setMinChange(Number(e.target.value)||0)}/></label>
      <label>Min volume $ <input type="number" step="10000" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value)||0)}/></label>
      <select value={side} onChange={e=>setSide(e.target.value)}><option>ALL</option><option>BUY</option><option>SELL</option></select>
      <select value={sort} onChange={e=>setSort(e.target.value)}><option value="score">Score</option><option value="change">24H Change</option><option value="volume">Volume</option></select>
    </section>
    {error && <div className="error">⚠ {error}. Retrying automatically every 5 seconds.</div>}
    <section className="tablewrap"><table><thead><tr><th>RANK</th><th>SYMBOL</th><th>LTP</th><th>24H CHANGE</th><th>24H TURNOVER</th><th>SCORE</th><th>SIGNAL</th></tr></thead><tbody>
      {loading && !rows.length ? <tr><td colSpan="7" className="empty">Connecting to Delta Exchange India…</td></tr> : filtered.slice(0,100).map((r,i)=><tr key={r.symbol}><td>#{i+1}</td><td className="symbol">{r.symbol}</td><td>{price(r.close ?? r.mark_price)}</td><td className={r.change >= 0 ? 'up' : 'down'}>{r.change >= 0 ? '+' : ''}{r.change.toFixed(2)}%</td><td>{money(r.vol)}</td><td><div className="score"><i style={{width:`${r.score}%`}}/><span>{r.score}</span></div></td><td><span className={`pill ${r.signal.toLowerCase()}`}>{r.signal}</span></td></tr>)}
      {!loading && !filtered.length && <tr><td colSpan="7" className="empty">No markets match the current filters.</td></tr>}
    </tbody></table></section>
    <footer>Source: Delta Exchange India public market API • Last update: {updated ? updated.toLocaleTimeString() : '—'} • No API key required for public market data.</footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
