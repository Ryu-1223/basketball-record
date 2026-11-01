import { useState } from 'react';
import { sortPlayers, type Game, type Play, type Shot } from './domain';

export function score(plays: Play[]) {
  return plays.filter(p => !p.cancelled && p.action === 'made').reduce((n, p) => n + (p.shot === '3' ? 3 : p.shot === '2' ? 2 : p.shot === 'ft' ? 1 : 0), 0);
}
export function Results({ game, plays }: { game: Game; plays: Play[] }) {
  const [tab, setTab] = useState<'シュート' | 'パスカット' | 'リバウンド' | '相手の得点'>('シュート');
  const [shot, setShot] = useState<'all' | Shot>('all');
  const own = plays.filter(p => !p.cancelled && p.side !== 'opponent');
  const opp = plays.filter(p => !p.cancelled && p.side === 'opponent');
  const numbers = [...new Set(opp.map(p => p.playerId))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const chosen = own.filter(p => (p.action === 'made' || p.action === 'miss') && (shot === 'all' || p.shot === shot));
  const row = (id: string) => chosen.filter(p => p.playerId === id);
  const tabnames = ['シュート', 'パスカット', 'リバウンド', '相手の得点'] as const;
  return <section className="results panel"><h2>試合結果</h2><div className="result-tabs">{tabnames.map(t => <button key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>{t}</button>)}</div>
    {tab === 'シュート' && <><div className="result-tabs">{([['all', 'すべて'], ['2', '2点'], ['3', '3点'], ['ft', 'フリースロー']] as const).map(([v, label]) => <button key={v} aria-pressed={shot === v} onClick={() => setShot(v)}>{label}</button>)}</div><p className="small muted">「すべて」にはフリースローも含みます。</p><div className="table-wrap"><table><thead><tr><th>選手</th><th>打った</th><th>決めた</th><th>得点</th></tr></thead><tbody>{sortPlayers(game.roster).map(p => <tr key={p.id}><th>{p.number} {p.name}</th><td>{row(p.id).length}</td><td>{row(p.id).filter(x => x.action === 'made').length}</td><td>{score(row(p.id))}</td></tr>)}<tr><th>チーム合計</th><td>{chosen.length}</td><td>{chosen.filter(p => p.action === 'made').length}</td><td>{score(chosen)}</td></tr></tbody></table></div></>}
    {(tab === 'パスカット' || tab === 'リバウンド') && <div className="table-wrap"><table><thead><tr><th>選手</th><th>回数</th></tr></thead><tbody>{sortPlayers(game.roster).map(p => <tr key={p.id}><th>{p.number} {p.name}</th><td>{own.filter(x => x.playerId === p.id && x.action === (tab === 'パスカット' ? 'steal' : 'rebound')).length}</td></tr>)}<tr><th>チーム合計</th><td>{own.filter(x => x.action === (tab === 'パスカット' ? 'steal' : 'rebound')).length}</td></tr></tbody></table></div>}
    {tab === '相手の得点' && (game.opponentTracking || plays.some(p => p.side === 'opponent') ? <div className="table-wrap"><table><thead><tr><th>背番号</th><th>2点</th><th>3点</th><th>FT</th><th>得点</th></tr></thead><tbody>{numbers.map(n => <tr key={n}><th>{n}</th>{(['2', '3', 'ft'] as Shot[]).map(v => <td key={v}>{opp.filter(p => p.playerId === n && p.shot === v).length}</td>)}<td>{score(opp.filter(p => p.playerId === n))}</td></tr>)}<tr><th>合計</th>{(['2', '3', 'ft'] as Shot[]).map(v => <td key={v}>{opp.filter(p => p.shot === v).length}</td>)}<td>{score(opp)}</td></tr></tbody></table></div> : <p>相手の得点は未記録です。</p>)}
  </section>;
}
