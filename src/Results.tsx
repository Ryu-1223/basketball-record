import { useState } from 'react';
import { sortPlayers, periodLabel, type Game, type Play, type Shot } from './domain';

export function score(plays: Play[]) {
  return plays.filter(p => !p.cancelled && p.action === 'made').reduce((n, p) => n + (p.shot === '3' ? 3 : p.shot === '2' ? 2 : p.shot === 'ft' ? 1 : 0), 0);
}
export function Results({ game, plays, onCheck, busy = false }: { game: Game; plays: Play[]; busy?: boolean; onCheck?: (next: NonNullable<Game['recordChecked']>) => void }) {
  const [tab, setTab] = useState<'シュート' | 'パスカット' | 'リバウンド' | '相手の得点'>('シュート');
  const [shot, setShot] = useState<'all' | Shot>('all');
  const [period, setPeriod] = useState('all');
  const [teamSide, setTeamSide] = useState<'own' | 'opponent'>('own');
  const selected = plays.filter(p => !p.cancelled && (period === 'all' || p.quarter === Number(period)));
  const own = selected.filter(p => (p.side === 'opponent') === (teamSide === 'opponent'));
  const roster = teamSide === 'opponent' ? game.opponentRoster ?? [] : game.roster;
  const opp = selected.filter(p => p.side === 'opponent' && p.action === 'made');
  const numbers = [...new Set(opp.map(p => p.playerId))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const chosen = own.filter(p => (p.action === 'made' || p.action === 'miss') && (shot === 'all' || p.shot === shot));
  const row = (id: string) => chosen.filter(p => p.playerId === id);
  const fraction = (records: Play[]) => records.length ? `${Math.round(records.filter(x => x.action === 'made').length / records.length * 100)}%` : '—';
  const detailed = game.kind !== 'scrimmage' || game.recordMode === undefined || game.recordMode === 'both' || (game.recordMode === 'own' && teamSide === 'own');
  const category = tab === 'シュート' ? 'shots' : tab === 'リバウンド' ? 'rebound' : 'steal';
  const checked = !!game.recordChecked?.[teamSide]?.[category];
  const count = (n: number, evidence = false) => n || evidence || checked ? n : '—';
  const tabnames = ['シュート', 'パスカット', 'リバウンド', '相手の得点'] as const;
  return <section className="results panel"><h2>試合結果</h2>{game.kind === 'scrimmage' && <div className="result-tabs"><button aria-pressed={teamSide === 'own'} onClick={() => setTeamSide('own')}>{game.sheet?.own.name || "白組"}の成績</button><button aria-pressed={teamSide === 'opponent'} onClick={() => setTeamSide('opponent')}>{game.opponent}の成績</button></div>}<label>集計するQ<select value={period} onChange={e => setPeriod(e.target.value)}><option value="all">全体</option>{game.quarters.map(q => <option key={q.number} value={q.number}>{periodLabel(game, q.number)}</option>)}</select></label>{!detailed && <p className="muted">この組は得点のみの記録です。シュート失敗・リバウンド・パスカットは集計できません。</p>}{detailed && <div className="result-tabs result-categories">{tabnames.map(t => <button key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>{t}</button>)}</div>}
    {detailed && tab === 'シュート' && <><div className="result-tabs shot-filters">{([['all', 'すべて'], ['2', '2点'], ['3', '3点'], ['ft', 'フリースロー']] as const).map(([v, label]) => <button key={v} aria-pressed={shot === v} onClick={() => setShot(v)}>{label}</button>)}</div><div className="table-wrap"><table><thead><tr><th>選手</th><th>打った</th><th>決めた</th><th>成功率</th><th>得点</th></tr></thead><tbody>{sortPlayers(roster).map(p => <tr key={p.id}><th>{p.number} {p.name}</th><td>{count(row(p.id).length)}</td><td>{count(row(p.id).filter(x => x.action === 'made').length, row(p.id).length > 0)}</td><td>{fraction(row(p.id))}</td><td>{count(score(row(p.id)), row(p.id).length > 0)}</td></tr>)}{chosen.some(p => p.playerId === '@unknown') && <tr><th>選手不明</th><td>{row('@unknown').length}</td><td>{row('@unknown').filter(x => x.action === 'made').length}</td><td>{fraction(row('@unknown'))}</td><td>{score(row('@unknown'))}</td></tr>}<tr><th>チーム合計</th><td>{count(chosen.length)}</td><td>{count(chosen.filter(p => p.action === 'made').length, chosen.length > 0)}</td><td>{fraction(chosen)}</td><td>{count(score(chosen), chosen.length > 0)}</td></tr></tbody></table></div></>}
    {detailed && (tab === 'パスカット' || tab === 'リバウンド') && <div className="table-wrap"><table><thead><tr><th>選手</th><th>回数</th></tr></thead><tbody>{sortPlayers(roster).map(p => <tr key={p.id}><th>{p.number} {p.name}</th><td>{count(own.filter(x => x.playerId === p.id && x.action === (tab === 'パスカット' ? 'steal' : 'rebound')).length)}</td></tr>)}<tr><th>チーム合計</th><td>{count(own.filter(x => x.action === (tab === 'パスカット' ? 'steal' : 'rebound')).length)}</td></tr></tbody></table></div>}
    {!detailed && <div className="table-wrap"><table><thead><tr><th>選手</th><th>記録された得点</th></tr></thead><tbody>{sortPlayers(roster).map(p => <tr key={p.id}><th>{p.number} {p.name}</th><td>{score(own.filter(x => x.playerId === p.id))}</td></tr>)}{own.some(p => p.playerId === '@unknown') && <tr><th>選手不明</th><td>{score(own.filter(p => p.playerId === '@unknown'))}</td></tr>}<tr><th>合計</th><td>{score(own)}</td></tr></tbody></table></div>}
    {detailed && tab === '相手の得点' && (game.opponentTracking || plays.some(p => p.side === 'opponent' && p.action === 'made') ? <div className="table-wrap"><table><thead><tr><th>背番号</th><th>2点</th><th>3点</th><th>FT</th><th>得点</th></tr></thead><tbody>{numbers.map(n => <tr key={n}><th>{n === '@unknown' ? '不明' : n}</th>{(['2', '3', 'ft'] as Shot[]).map(v => <td key={v}>{opp.filter(p => p.playerId === n && p.shot === v).length}</td>)}<td>{score(opp.filter(p => p.playerId === n))}</td></tr>)}<tr><th>合計</th>{(['2', '3', 'ft'] as Shot[]).map(v => <td key={v}>{opp.filter(p => p.shot === v).length}</td>)}<td>{score(opp)}</td></tr></tbody></table></div> : <p>相手の得点は未記録です。</p>)}
    <p className="small muted">記録された分の集計です。未確認で記録がない欄は「—」で表示します。{tab === 'シュート' && '「すべて」にはフリースローも含みます。'}</p>
    {detailed && tab !== '相手の得点' && onCheck && <label className="inline-check"><input type="checkbox" disabled={busy} checked={checked} onChange={e => onCheck({ ...game.recordChecked, [teamSide]: { ...game.recordChecked?.[teamSide], [category]: e.target.checked } })} />{tab}の記録を確認済み</label>}
    {detailed && tab !== '相手の得点' && onCheck && <p className="small muted">確認済みは選択中のチームと項目の全Qに適用されます。</p>}
  </section>;
}
