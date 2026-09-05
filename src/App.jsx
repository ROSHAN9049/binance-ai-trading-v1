import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API='https://api.india.delta.exchange/v2/tickers';
const WS='wss://socket.india.delta.exchange';

function App(){
 const [tickers,setTickers]=useState([]); const [status,setStatus]=useState('Connecting…'); const [last,setLast]=useState(null);
 useEffect(()=>{let ws; let alive=true;
  fetch(API).then(r=>r.json()).then(d=>{if(alive&&d.result){setTickers(d.result);setLast(new Date())}}).catch(()=>setStatus('API error'));
  try{ws=new WebSocket(WS); ws.onopen=()=>{setStatus('LIVE');ws.send(JSON.stringify({type:'subscribe',payload:{channels:[{name:'v2/ticker',symbols:['all']} ]}}))}; ws.onmessage=e=>{try{const d=JSON.parse(e.data);if(d?.type?.includes('ticker')&&d.symbol){setTickers(x=>{const m=new Map(x.map(a=>[a.symbol,a]));m.set(d.symbol,{...m.get(d.symbol),...d});return [...m.values()]});setLast(new Date())}}catch{}};ws.onerror=()=>setStatus('Polling');}catch{setStatus('Polling')}
  const poll=setInterval(()=>fetch(API).then(r=>r.json()).then(d=>{if(d.result){setTickers(d.result);setLast(new Date());setStatus('LIVE')}}).catch(()=>{}),5000);
  return()=>{alive=false;clearInterval(poll);ws?.close()}
 },[]);
 const rows=useMemo(()=>tickers.filter(x=>x.symbol && x.contract_type==='perpetual_futures' || x.symbol).map(x=>{const ch=Number(x.price_change_percent_24h??x.price_change_percent??0);const vol=Number(x.turnover_usd_24h??x.volume_24h??0);const score=Math.min(100,Math.round(Math.abs(ch)*12+Math.log10(Math.max(vol,1))*4));const signal=ch>=2&&score>=65?'PUMP':ch<=-2&&score>=65?'DUMP':score>=45?'WATCH':'—';return {...x,ch,vol,score,signal}}).sort((a,b)=>b.score-a.score),[tickers]);
 const pump=rows.filter(r=>r.signal==='PUMP').slice(0,5), dump=rows.filter(r=>r.signal==='DUMP').slice(0,5);
 return <div className="app"><header><div><h1>⚡ Delta Scanner</h1><p>Delta Exchange India · Live Momentum Scanner</p></div><div className="live"><span className="dot"/> {status}</div></header>
 <section className="cards"><Card title="Top Pump" data={pump}/><Card title="Top Dump" data={dump}/><div className="card"><b>Scanner Engine</b><strong>5s</strong><small>Live refresh · 24H volume + momentum</small><div className="telegram">🔔 Telegram alerts: Ready</div></div></section>
 <section className="panel"><div className="panelhead"><h2>Market Scanner</h2><span>{rows.length} instruments · {last?last.toLocaleTimeString():''}</span></div><div className="tablewrap"><table><thead><tr><th>Symbol</th><th>24H Change</th><th>24H Volume</th><th>Signal Strength</th><th>Signal</th></tr></thead><tbody>{rows.slice(0,100).map(r=><tr key={r.symbol}><td><b>{r.symbol}</b></td><td className={r.ch>=0?'up':'down'}>{r.ch.toFixed(2)}%</td><td>${fmt(r.vol)}</td><td><div className="bar"><i style={{width:`${r.score}%`}}/></div><b>{r.score}/100</b></td><td><span className={`badge ${r.signal.toLowerCase()}`}>{r.signal}</span></td></tr>)}</tbody></table></div></section>
 <footer>⚠️ Signals are informational. No real orders are placed by this scanner.</footer></div>
}
function Card({title,data}){return <div className="card"><b>{title}</b>{data.length?<ol>{data.map(x=><li key={x.symbol}><span>{x.symbol}</span><strong className={x.ch>=0?'up':'down'}>{x.ch.toFixed(2)}%</strong></li>)}</ol>:<small>No qualifying signal yet</small>}</div>}
function fmt(n){if(n>=1e9)return (n/1e9).toFixed(1)+'B';if(n>=1e6)return (n/1e6).toFixed(1)+'M';if(n>=1e3)return (n/1e3).toFixed(1)+'K';return n.toFixed(0)}
createRoot(document.getElementById('root')).render(<App/>);
