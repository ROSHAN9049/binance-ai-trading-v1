import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = 'https://api.india.delta.exchange/v2/tickers?contract_types=perpetual_futures';
const CANDLE_API = 'https://api.india.delta.exchange/v2/history/candles';
const REFRESH_MS = 15000;
const ANALYSE_LIMIT = 30;

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v) { if (v >= 1e9) return '$' + (v/1e9).toFixed(2) + 'B'; if (v >= 1e6) return '$' + (v/1e6).toFixed(2) + 'M'; if (v >= 1e3) return '$' + (v/1e3).toFixed(1) + 'K'; return '$' + v.toFixed(0); }
function price(v) { return num(v).toLocaleString('en-US', { maximumFractionDigits: 8 }); }
function percentile(values, value) { if (!values.length) return 0; return (values.filter(x => x <= value).length / values.length) * 100; }
function avg(values) { return values.length ? values.reduce((a,b) => a + b, 0) / values.length : 0; }

async function candles(symbol, resolution, count) {
  const end = Math.floor(Date.now() / 1000);
  const seconds = resolution === '5m' ? 300 : 900;
  const start = end - seconds * (count + 3);
  const url = `${CANDLE_API}?resolution=${resolution}&symbol=${encodeURIComponent(symbol)}&start=${start}&end=${end}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Candle HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.result) ? json.result.sort((a,b) => num(a.time) - num(b.time)) : [];
}

function analyseTrend(data) {
  const closes = data.map(x => num(x.close)).filter(x => x > 0);
  if (closes.length < 3) return 'WAIT';
  const last = closes[closes.length - 1];
  const previous = closes[closes.length - 2];
  const emaPeriod = Math.min(5, closes.length);
  const k = 2 / (emaPeriod + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  if (last > previous && last > ema) return 'BULLISH';
  if (last < previous && last < ema) return 'BEARISH';
  return 'WAIT';
}

function volumeSpike(data) {
  const vols = data.map(x => num(x.volume)).filter(x => x >= 0);
  if (vols.length < 5) return 0;
  const latest = vols[vols.length - 1];
  const baseline = avg(vols.slice(Math.max(0, vols.length - 21), -1));
  return baseline > 0 ? latest / baseline : 0;
}

async function enrich(symbol) {
  try {
    const [c5, c15] = await Promise.all([candles(symbol, '5m', 25), candles(symbol, '15m', 12)]);
    return { trend5: analyseTrend(c5), trend15: analyseTrend(c15), volumeSpike: volumeSpike(c5) };
  } catch {
    return { trend5: 'WAIT', trend15: 'WAIT', volumeSpike: 0 };
  }
}

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
  const [analysis, setAnalysis] = useState(false);

  const load = useCallback(async () => {
    try {
      setAnalysis(true);
      const res = await fetch(API, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Delta API HTTP ${res.status}`);
      const json = await res.json();
      const raw = Array.isArray(json.result) ? json.result : [];
      const perpetuals = raw.filter(x => x.symbol && x.contract_type === 'perpetual_futures');
      const volumes = perpetuals.map(x => num(x.turnover_usd)).filter(x => x > 0);

      const base = perpetuals.map(x => {
        const change = num(x.ltp_change_24h);
        const vol = num(x.turnover_usd);
        return { ...x, change, vol, trend5: 'WAIT', trend15: 'WAIT', volumeSpike: 0, score: 0, signal: 'WATCH' };
      }).sort((a,b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, ANALYSE_LIMIT);

      const details = await Promise.all(base.map(r => enrich(r.symbol)));
      const detailMap = new Map(base.map((r,i) => [r.symbol, details[i]]));

      const mapped = perpetuals.map(x => {
        const change = num(x.ltp_change_24h);
        const vol = num(x.turnover_usd);
        const d = detailMap.get(x.symbol) || { trend5: 'WAIT', trend15: 'WAIT', volumeSpike: 0 };
        const changeScore = Math.min(Math.abs(change) / 10, 1) * 40;
        const volumeScore = (percentile(volumes, vol) / 100) * 20;
        const spikeScore = Math.min(Math.max(d.volumeSpike - 1, 0) / 3, 1) * 20;
        const trendBonus = (d.trend5 === d.trend15 && d.trend5 !== 'WAIT') ? 20 : 0;
        const score = Math.round(changeScore + volumeScore + spikeScore + trendBonus);
        const strongBuy = change >= minChange && score >= 70 && d.trend5 === 'BULLISH' && d.trend15 === 'BULLISH';
        const strongSell = change <= -minChange && score >= 70 && d.trend5 === 'BEARISH' && d.trend15 === 'BEARISH';
        const signal = strongBuy ? 'BUY' : strongSell ? 'SELL' : 'WATCH';
        return { ...x, change, vol, ...d, score, signal };
      });

      setRows(mapped);
      setUpdated(new Date());
      setError('');
    } catch (e) {
      setError(e.message || 'Unable to load Delta market data');
    } finally {
      setLoading(false);
      setAnalysis(false);
    }
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
    <header><div><div className="brand">⚡ DELTA SCANNER</div><div className="sub">Delta Exchange India • Live perpetual market scanner</div></div><div className="live"><span/> LIVE • 15s</div></header>
    <section className="hero"><div><h1>Volume + 24H Momentum</h1><p>Live scanner using 24H change, turnover, 5m volume spike and 5m/15m trend confirmation. <b>Paper-signal only</b> — no real orders.</p></div><button onClick={load} disabled={analysis}>{analysis ? 'Analysing…' : '↻ Refresh'}</button></section>
    <div className="cards"><div><small>MARKETS</small><b>{stats.total}</b></div><div><small>STRONG BUY</small><b className="up">{stats.buy}</b></div><div><small>STRONG SELL</small><b className="down">{stats.sell}</b></div><div><small>QUALIFIED</small><b>{stats.active}</b></div></div>
    <section className="controls">
      <input placeholder="Search symbol…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <label>Min 24H % <input type="number" step="0.1" value={minChange} onChange={e=>setMinChange(Number(e.target.value)||0)}/></label>
      <label>Min volume $ <input type="number" step="10000" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value)||0)}/></label>
      <select value={side} onChange={e=>setSide(e.target.value)}><option>ALL</option><option>BUY</option><option>SELL</option></select>
      <select value={sort} onChange={e=>setSort(e.target.value)}><option value="score">Score</option><option value="change">24H Change</option><option value="volume">Volume</option></select>
    </section>
    {error && <div className="error">⚠ {error}. Retrying automatically every 15 seconds.</div>}
    <section className="tablewrap"><table><thead><tr><th>RANK</th><th>SYMBOL</th><th>LTP</th><th>24H CHANGE</th><th>TURNOVER</th><th>VOL SPIKE</th><th>5m</th><th>15m</th><th>SCORE</th><th>SIGNAL</th></tr></thead><tbody>
      {loading && !rows.length ? <tr><td colSpan="10" className="empty">Connecting to Delta Exchange India…</td></tr> : filtered.slice(0,100).map((r,i)=><tr key={r.symbol}><td>#{i+1}</td><td className="symbol">{r.symbol}</td><td>{price(r.close ?? r.mark_price)}</td><td className={r.change >= 0 ? 'up' : 'down'}>{r.change >= 0 ? '+' : ''}{r.change.toFixed(2)}%</td><td>{money(r.vol)}</td><td>{r.volumeSpike ? r.volumeSpike.toFixed(1) + 'x' : '—'}</td><td className={r.trend5 === 'BULLISH' ? 'up' : r.trend5 === 'BEARISH' ? 'down' : ''}>{r.trend5}</td><td className={r.trend15 === 'BULLISH' ? 'up' : r.trend15 === 'BEARISH' ? 'down' : ''}>{r.trend15}</td><td><div className="score"><i style={{width:`${r.score}%`}}/><span>{r.score}</span></div></td><td><span className={`pill ${r.signal.toLowerCase()}`}>{r.signal}</span></td></tr>)}
      {!loading && !filtered.length && <tr><td colSpan="10" className="empty">No markets match the current filters.</td></tr>}
    </tbody></table></section>
    <footer>Source: Delta Exchange India public market API • 5m/15m historical candles • Last update: {updated ? updated.toLocaleTimeString() : '—'} • No trading API key used.</footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
