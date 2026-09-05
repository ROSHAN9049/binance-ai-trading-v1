import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = 'https://api.india.delta.exchange/v2/tickers?contract_types=perpetual_futures';
const CANDLE_API = 'https://api.india.delta.exchange/v2/history/candles';
const REFRESH_MS = 15000;
const ANALYSE_LIMIT = 30;
const STORAGE_KEY = 'delta-scanner-paper-v1';

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

function initialPaper() {
  return { enabled: false, capital: 10000, balance: 10000, positions: [], trades: [], slPct: 1, tpPct: 2, allocationPct: 10 };
}

function loadPaper() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? { ...initialPaper(), ...saved } : initialPaper();
  } catch { return initialPaper(); }
}

function savePaper(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function openPaperPosition(state, row) {
  if (!state.enabled || !row || !row.close || !['BUY','SELL'].includes(row.signal)) return state;
  if (state.positions.some(p => p.symbol === row.symbol)) return state;
  const notional = Math.min(state.balance, state.capital * (num(state.allocationPct) / 100));
  if (notional <= 0) return state;
  const entry = num(row.close ?? row.mark_price);
  const side = row.signal === 'BUY' ? 'LONG' : 'SHORT';
  const qty = notional / entry;
  const sl = side === 'LONG' ? entry * (1 - state.slPct / 100) : entry * (1 + state.slPct / 100);
  const tp = side === 'LONG' ? entry * (1 + state.tpPct / 100) : entry * (1 - state.tpPct / 100);
  return {
    ...state,
    balance: state.balance - notional,
    positions: [...state.positions, { symbol: row.symbol, side, entry, qty, notional, sl, tp, openedAt: new Date().toISOString(), entryScore: row.score }]
  };
}

function closePaperPosition(state, position, exit, reason) {
  const pnl = position.side === 'LONG' ? (exit - position.entry) * position.qty : (position.entry - exit) * position.qty;
  const returned = position.notional + pnl;
  const trade = { ...position, exit, pnl, reason, closedAt: new Date().toISOString() };
  return { ...state, balance: state.balance + returned, positions: state.positions.filter(p => p.symbol !== position.symbol), trades: [trade, ...state.trades].slice(0, 100) };
}

function markAndManage(state, rows) {
  if (!state.enabled || !state.positions.length) return state;
  let next = state;
  for (const position of state.positions) {
    const row = rows.find(r => r.symbol === position.symbol);
    if (!row) continue;
    const current = num(row.close ?? row.mark_price);
    if (!current) continue;
    const hitSL = position.side === 'LONG' ? current <= position.sl : current >= position.sl;
    const hitTP = position.side === 'LONG' ? current >= position.tp : current <= position.tp;
    if (hitSL) next = closePaperPosition(next, position, current, 'STOP LOSS');
    else if (hitTP) next = closePaperPosition(next, position, current, 'TAKE PROFIT');
  }
  return next;
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
  const [paper, setPaper] = useState(initialPaper);

  useEffect(() => setPaper(loadPaper()), []);
  useEffect(() => { savePaper(paper); }, [paper]);

  const load = useCallback(async () => {
    try {
      setAnalysis(true);
      const res = await fetch(API, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Delta API HTTP ${res.status}`);
      const json = await res.json();
      const raw = Array.isArray(json.result) ? json.result : [];
      const perpetuals = raw.filter(x => x.symbol && x.contract_type === 'perpetual_futures');
      const volumes = perpetuals.map(x => num(x.turnover_usd)).filter(x => x > 0);
      const base = perpetuals.map(x => ({ ...x, trend5:'WAIT', trend15:'WAIT', volumeSpike:0, score:0, signal:'WATCH' }))
        .sort((a,b) => Math.abs(num(b.ltp_change_24h)) - Math.abs(num(a.ltp_change_24h))).slice(0, ANALYSE_LIMIT);
      const details = await Promise.all(base.map(r => enrich(r.symbol)));
      const detailMap = new Map(base.map((r,i) => [r.symbol, details[i]]));
      const mapped = perpetuals.map(x => {
        const change = num(x.ltp_change_24h);
        const vol = num(x.turnover_usd);
        const d = detailMap.get(x.symbol) || { trend5:'WAIT', trend15:'WAIT', volumeSpike:0 };
        const changeScore = Math.min(Math.abs(change) / 10, 1) * 40;
        const volumeScore = (percentile(volumes, vol) / 100) * 20;
        const spikeScore = Math.min(Math.max(d.volumeSpike - 1, 0) / 3, 1) * 20;
        const trendBonus = (d.trend5 === d.trend15 && d.trend5 !== 'WAIT') ? 20 : 0;
        const score = Math.round(changeScore + volumeScore + spikeScore + trendBonus);
        const strongBuy = change >= minChange && score >= 70 && d.trend5 === 'BULLISH' && d.trend15 === 'BULLISH';
        const strongSell = change <= -minChange && score >= 70 && d.trend5 === 'BEARISH' && d.trend15 === 'BEARISH';
        return { ...x, change, vol, ...d, score, signal: strongBuy ? 'BUY' : strongSell ? 'SELL' : 'WATCH' };
      });
      setRows(mapped);
      setPaper(prev => {
        let next = markAndManage(prev, mapped);
        if (next.enabled) {
          for (const row of mapped) next = openPaperPosition(next, row);
        }
        return next;
      });
      setUpdated(new Date());
      setError('');
    } catch (e) { setError(e.message || 'Unable to load Delta market data'); }
    finally { setLoading(false); setAnalysis(false); }
  }, [minChange]);

  useEffect(() => { load(); const id = setInterval(load, REFRESH_MS); return () => clearInterval(id); }, [load]);

  const filtered = useMemo(() => {
    let out = rows.filter(r => r.vol >= minVolume && Math.abs(r.change) >= minChange);
    if (side !== 'ALL') out = out.filter(r => r.signal === side);
    if (search) out = out.filter(r => r.symbol.toLowerCase().includes(search.toLowerCase()));
    return [...out].sort((a,b) => sort === 'change' ? Math.abs(b.change)-Math.abs(a.change) : sort === 'volume' ? b.vol-a.vol : b.score-a.score);
  }, [rows, minChange, minVolume, side, search, sort]);

  const paperStats = useMemo(() => {
    const realised = paper.trades.reduce((s,t) => s + num(t.pnl), 0);
    const unrealised = paper.positions.reduce((s,p) => {
      const r = rows.find(x => x.symbol === p.symbol); if (!r) return s;
      const current = num(r.close ?? r.mark_price);
      return s + (p.side === 'LONG' ? (current-p.entry)*p.qty : (p.entry-current)*p.qty);
    }, 0);
    const wins = paper.trades.filter(t => t.pnl > 0).length;
    return { realised, unrealised, equity: paper.balance + paper.positions.reduce((s,p) => s + p.notional, 0) + unrealised, trades: paper.trades.length, winRate: paper.trades.length ? (wins / paper.trades.length) * 100 : 0 };
  }, [paper, rows]);

  const resetPaper = () => setPaper(initialPaper());

  const togglePaper = () => setPaper(prev => ({ ...prev, enabled: !prev.enabled }));

  const stats = useMemo(() => ({ total: rows.length, buy: rows.filter(r => r.signal === 'BUY').length, sell: rows.filter(r => r.signal === 'SELL').length, active: rows.filter(r => Math.abs(r.change) >= minChange && r.vol >= minVolume).length }), [rows, minChange, minVolume]);

  return <div className="app">
    <header><div><div className="brand">⚡ DELTA SCANNER</div><div className="sub">Delta Exchange India • Live perpetual market scanner</div></div><div className="live"><span/> LIVE • 15s</div></header>
    <section className="hero"><div><h1>Volume + 24H Momentum</h1><p>Live scanner using 24H change, turnover, 5m volume spike and 5m/15m trend confirmation. <b>Paper Trading is virtual only</b> — no real orders.</p></div><button onClick={load} disabled={analysis}>{analysis ? 'Analysing…' : '↻ Refresh'}</button></section>

    <section className="paper-panel">
      <div className="paper-top"><div><div className="paper-title">🧪 PAPER TRADING</div><div className="paper-note">Virtual simulator • Delta API trading keys are never used</div></div><button className={paper.enabled ? 'paper-toggle on' : 'paper-toggle'} onClick={togglePaper}>{paper.enabled ? '🟢 ON' : '⚪ OFF'}</button></div>
      <div className="paper-controls">
        <label>Virtual Capital <input type="number" min="100" value={paper.capital} disabled={paper.trades.length > 0 || paper.positions.length > 0} onChange={e => { const v=Math.max(100,Number(e.target.value)||10000); setPaper(p=>({...p,capital:v,balance:v})); }}/></label>
        <label>Allocation % <input type="number" min="1" max="100" value={paper.allocationPct} onChange={e => setPaper(p=>({...p,allocationPct:Math.min(100,Math.max(1,Number(e.target.value)||10))}))}/></label>
        <label>SL % <input type="number" min="0.1" step="0.1" value={paper.slPct} onChange={e => setPaper(p=>({...p,slPct:Math.max(0.1,Number(e.target.value)||1)}))}/></label>
        <label>TP % <input type="number" min="0.1" step="0.1" value={paper.tpPct} onChange={e => setPaper(p=>({...p,tpPct:Math.max(0.1,Number(e.target.value)||2)}))}/></label>
        <button className="reset" onClick={resetPaper}>Reset Paper Account</button>
      </div>
      <div className="paper-stats"><div><small>EQUITY</small><b>₹{paperStats.equity.toFixed(2)}</b></div><div><small>REALISED P&L</small><b className={paperStats.realised>=0?'up':'down'}>{paperStats.realised>=0?'+':''}₹{paperStats.realised.toFixed(2)}</b></div><div><small>OPEN P&L</small><b className={paperStats.unrealised>=0?'up':'down'}>{paperStats.unrealised>=0?'+':''}₹{paperStats.unrealised.toFixed(2)}</b></div><div><small>TRADES / WIN RATE</small><b>{paperStats.trades} / {paperStats.winRate.toFixed(0)}%</b></div></div>
      {paper.positions.length > 0 && <div className="positions"><strong>Open Positions</strong><div className="position-list">{paper.positions.map(p => { const r=rows.find(x=>x.symbol===p.symbol); const current=r?num(r.close??r.mark_price):p.entry; const pnl=p.side==='LONG'?(current-p.entry)*p.qty:(p.entry-current)*p.qty; return <div className="position" key={p.symbol}><b>{p.symbol}</b><span className={p.side==='LONG'?'up':'down'}>{p.side}</span><span>Entry {price(p.entry)}</span><span>Now {price(current)}</span><span>SL {price(p.sl)}</span><span>TP {price(p.tp)}</span><strong className={pnl>=0?'up':'down'}>{pnl>=0?'+':''}₹{pnl.toFixed(2)}</strong></div>; })}</div></div>}
      {paper.trades.length > 0 && <div className="trade-history"><strong>Recent Paper Trades</strong><div className="history-list">{paper.trades.slice(0,10).map(t=><div className="history" key={t.closedAt+t.symbol}><span>{t.symbol}</span><span>{t.side}</span><span>{t.reason}</span><span className={t.pnl>=0?'up':'down'}>{t.pnl>=0?'+':''}₹{t.pnl.toFixed(2)}</span></div>)}</div></div>}
    </section>

    <div className="cards"><div className="card"><small>MARKETS</small><b>{stats.total}</b></div><div className="card"><small>STRONG BUY</small><b className="up">{stats.buy}</b></div><div className="card"><small>STRONG SELL</small><b className="down">{stats.sell}</b></div><div className="card"><small>QUALIFIED</small><b>{stats.active}</b></div></div>
    <section className="controls">
      <input placeholder="Search symbol…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <label>Min 24H % <input type="number" step="0.1" value={minChange} onChange={e=>setMinChange(Number(e.target.value)||0)}/></label>
      <label>Min volume $ <input type="number" step="10000" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value)||0)}/></label>
      <select value={side} onChange={e=>setSide(e.target.value)}><option>ALL</option><option>BUY</option><option>SELL</option></select>
      <select value={sort} onChange={e=>setSort(e.target.value)}><option value="score">Score</option><option value="change">24H Change</option><option value="volume">Volume</option></select>
    </section>
    {error && <div className="error">⚠ {error}. Retrying automatically every 15 seconds.</div>}
    <section className="panel"><div className="panelhead"><h2>Market Scanner</h2><span>{stats.total} perpetuals · {updated ? updated.toLocaleTimeString() : '—'}</span></div><div className="tablewrap"><table><thead><tr><th>RANK</th><th>SYMBOL</th><th>LTP</th><th>24H CHANGE</th><th>TURNOVER</th><th>VOL SPIKE</th><th>5m</th><th>15m</th><th>SCORE</th><th>SIGNAL</th></tr></thead><tbody>
      {loading && !rows.length ? <tr><td colSpan="10" className="empty">Connecting to Delta Exchange India…</td></tr> : filtered.slice(0,100).map((r,i)=><tr key={r.symbol}><td>#{i+1}</td><td className="symbol">{r.symbol}</td><td>{price(r.close ?? r.mark_price)}</td><td className={r.change >= 0 ? 'up' : 'down'}>{r.change >= 0 ? '+' : ''}{r.change.toFixed(2)}%</td><td>{money(r.vol)}</td><td className={r.volumeSpike >= 1.5 ? 'hot' : ''}>{r.volumeSpike ? r.volumeSpike.toFixed(1) + 'x' : '—'}</td><td><span className={`trend ${r.trend5 === 'BULLISH' ? 'bull' : r.trend5 === 'BEARISH' ? 'bear' : 'wait'}`}>{r.trend5}</span></td><td><span className={`trend ${r.trend15 === 'BULLISH' ? 'bull' : r.trend15 === 'BEARISH' ? 'bear' : 'wait'}`}>{r.trend15}</span></td><td><div className="score"><i style={{width:`${r.score}%`}}/><span>{r.score}</span></div></td><td><span className={`pill ${r.signal.toLowerCase()}`}>{r.signal}</span></td></tr>)}
      {!loading && !filtered.length && <tr><td colSpan="10" className="empty">No markets match the current filters.</td></tr>}
    </tbody></table></div></section>
    <footer>Source: Delta Exchange India public market API • 5m/15m historical candles • Paper trading is local browser simulation only • No real trading API key used.</footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
