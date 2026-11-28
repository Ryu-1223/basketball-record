import { useState } from 'react';
import { playingTimes, sortPlayers, periodLabel, type Action, type Game, type Play, type RecordCheckedSide, type Shot } from './domain';
import { FoulSummary } from './FoulSummary';

type StatTab = 'シュート' | 'パスカット' | 'リバウンド' | 'アシスト' | 'ターンオーバー' | 'ブロック' | '相手の得点' | '出場時間' | 'ファウル数';
function formatPlayingTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function playingTimeQuarterHeader(game: Game, n: number) {
  if (game.kind === 'scrimmage') return periodLabel(game, n);
  return n <= 4 ? `Q${n}` : `延長${n - 4}`;
}
const countTabAction: Partial<Record<StatTab, Action>> = {
  'パスカット': 'steal',
  'アシスト': 'assist',
  'ターンオーバー': 'turnover',
  'ブロック': 'block',
};
const categoryMap: Partial<Record<StatTab, keyof RecordCheckedSide>> = {
  'シュート': 'shots',
  'リバウンド': 'rebound',
  'パスカット': 'steal',
  'アシスト': 'assist',
  'ターンオーバー': 'turnover',
  'ブロック': 'block',
};

export function score(plays: Play[]) {
  return plays.filter(p => !p.cancelled && p.action === 'made').reduce((n, p) => n + (p.shot === '3' ? 3 : p.shot === '2' ? 2 : p.shot === 'ft' ? 1 : 0), 0);
}
export function Results({ game, plays, onCheck, live, busy = false, now = Date.now() }: {
  game: Game;
  plays: Play[];
  live?: { teamName: string };
  busy?: boolean;
  now?: number;
  onCheck?: (next: NonNullable<Game['recordChecked']>) => void;
}) {
  const [tab, setTab] = useState<StatTab>('シュート');
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
  const opts = game.recordOptions;
  const detailedTabs: StatTab[] = [
    'シュート',
    'パスカット',
    'リバウンド',
    ...(opts?.assist ? ['アシスト' as const] : []),
    ...(opts?.turnover ? ['ターンオーバー' as const] : []),
    ...(opts?.block ? ['ブロック' as const] : []),
    '相手の得点',
    ...(opts?.substitutions && teamSide === 'own' ? ['出場時間' as const] : []),
  ];
  const categories: readonly StatTab[] = detailed ? detailedTabs : ['シュート'];
  const visibleTabs = live ? [...categories, 'ファウル数' as const] : categories;
  const activeTab: StatTab = visibleTabs.includes(tab) ? tab : 'シュート';
  const category = categoryMap[activeTab];
  const checked = !!(category && game.recordChecked?.[teamSide]?.[category]);
  const count = (n: number, evidence = false) => n || evidence || checked ? n : '—';
  const showFouls = live != null && activeTab === 'ファウル数';
  const showPlayingTime = activeTab === '出場時間';
  const times = showPlayingTime ? playingTimes(game, plays, now) : null;
  const startedQuarters = game.quarters
    .filter(q => q && typeof q.startedAt === 'number' && !Number.isNaN(q.startedAt))
    .sort((a, b) => a.number - b.number);
  const countAction = countTabAction[activeTab];
  const reboundRows = (records: Play[]) => {
    const total = records.length;
    const off = records.filter(x => x.reboundKind === 'off').length;
    const def = records.filter(x => x.reboundKind === 'def').length;
    const unspecified = records.filter(x => !x.reboundKind).length;
    const evidence = total > 0;
    return <><td>{count(total)}</td><td>{count(off, evidence)}</td><td>{count(def, evidence)}</td><td>{count(unspecified, evidence)}</td></>;
  };
  const periodFilter = <label>集計するQ<select value={period} onChange={e => setPeriod(e.target.value)}>
    <option value="all">全体</option>
    {game.quarters.map(q => <option key={q.number} value={q.number}>{periodLabel(game, q.number)}</option>)}
  </select></label>;
  return <section className="results panel">
    <h2>{live ? '途中成績' : '試合結果'}</h2>
    {game.kind === 'scrimmage' && <div className="result-tabs">
      <button aria-pressed={!showFouls && teamSide === 'own'} onClick={() => { setTeamSide('own'); if (showFouls) setTab('シュート'); }}>{game.sheet?.own.name || '白組'}の成績</button>
      <button aria-pressed={!showFouls && teamSide === 'opponent'} onClick={() => { setTeamSide('opponent'); if (showFouls) setTab('シュート'); }}>{game.opponent}の成績</button>
    </div>}
    {!live && !showPlayingTime && periodFilter}
    {(detailed || live) && <div className="result-tabs result-categories" role="group" aria-label="成績の種類">
      {visibleTabs.map(t => <button key={t} aria-pressed={t === activeTab || (!detailed && t === 'シュート' && !showFouls)} onClick={() => setTab(t)}>
        {!detailed && t === 'シュート' ? '得点' : t}
      </button>)}
    </div>}
    {showFouls ? <FoulSummary game={game} plays={plays} teamName={live.teamName} /> : <>
    {live && !showPlayingTime && periodFilter}
    {!detailed && <p className="muted">この組は得点のみの記録です。シュート失敗・リバウンド・パスカットは集計できません。</p>}
    {detailed && activeTab === 'シュート' && <><div className="result-tabs shot-filters">{([['all', 'すべて'], ['2', '2点'], ['3', '3点'], ['ft', 'フリースロー']] as const).map(([v, label]) => <button key={v} aria-pressed={shot === v} onClick={() => setShot(v)}>{label}</button>)}</div><div className="table-wrap"><table><thead><tr><th>選手</th><th>打った</th><th>決めた</th><th>成功率</th><th>得点</th></tr></thead><tbody>{sortPlayers(roster).map(p => <tr key={p.id}><th>{p.number} {p.name}</th><td>{count(row(p.id).length)}</td><td>{count(row(p.id).filter(x => x.action === 'made').length, row(p.id).length > 0)}</td><td>{fraction(row(p.id))}</td><td>{count(score(row(p.id)), row(p.id).length > 0)}</td></tr>)}{chosen.some(p => p.playerId === '@unknown') && <tr><th>選手不明</th><td>{row('@unknown').length}</td><td>{row('@unknown').filter(x => x.action === 'made').length}</td><td>{fraction(row('@unknown'))}</td><td>{score(row('@unknown'))}</td></tr>}<tr><th>チーム合計</th><td>{count(chosen.length)}</td><td>{count(chosen.filter(x => x.action === 'made').length, chosen.length > 0)}</td><td>{fraction(chosen)}</td><td>{count(score(chosen), chosen.length > 0)}</td></tr></tbody></table></div></>}
    {detailed && countAction && <div className="table-wrap"><table><thead><tr><th>選手</th><th>回数</th></tr></thead><tbody>{sortPlayers(roster).map(p => <tr key={p.id}><th>{p.number} {p.name}</th><td>{count(own.filter(x => x.playerId === p.id && x.action === countAction).length)}</td></tr>)}<tr><th>チーム合計</th><td>{count(own.filter(x => x.action === countAction).length)}</td></tr></tbody></table></div>}
    {detailed && activeTab === 'リバウンド' && (opts?.reboundSplit
      ? <div className="table-wrap"><table><thead><tr><th>選手</th><th>合計</th><th>攻撃</th><th>守備</th><th>区別なし</th></tr></thead><tbody>{sortPlayers(roster).map(p => <tr key={p.id}><th>{p.number} {p.name}</th>{reboundRows(own.filter(x => x.playerId === p.id && x.action === 'rebound'))}</tr>)}<tr><th>チーム合計</th>{reboundRows(own.filter(x => x.action === 'rebound'))}</tr></tbody></table></div>
      : <div className="table-wrap"><table><thead><tr><th>選手</th><th>回数</th></tr></thead><tbody>{sortPlayers(roster).map(p => <tr key={p.id}><th>{p.number} {p.name}</th><td>{count(own.filter(x => x.playerId === p.id && x.action === 'rebound').length)}</td></tr>)}<tr><th>チーム合計</th><td>{count(own.filter(x => x.action === 'rebound').length)}</td></tr></tbody></table></div>)}
    {!detailed && <div className="table-wrap"><table><thead><tr><th>選手</th><th>記録された得点</th></tr></thead><tbody>{sortPlayers(roster).map(p => <tr key={p.id}><th>{p.number} {p.name}</th><td>{score(own.filter(x => x.playerId === p.id))}</td></tr>)}{own.some(p => p.playerId === '@unknown') && <tr><th>選手不明</th><td>{score(own.filter(x => x.playerId === '@unknown'))}</td></tr>}<tr><th>合計</th><td>{score(own)}</td></tr></tbody></table></div>}
    {detailed && activeTab === '相手の得点' && (game.opponentTracking || plays.some(p => p.side === 'opponent' && p.action === 'made') ? <div className="table-wrap"><table><thead><tr><th>背番号</th><th>2点</th><th>3点</th><th>FT</th><th>得点</th></tr></thead><tbody>{numbers.map(n => <tr key={n}><th>{n === '@unknown' ? '不明' : n}</th>{(['2', '3', 'ft'] as Shot[]).map(v => <td key={v}>{opp.filter(p => p.playerId === n && p.shot === v).length}</td>)}<td>{score(opp.filter(p => p.playerId === n))}</td></tr>)}<tr><th>合計</th>{(['2', '3', 'ft'] as Shot[]).map(v => <td key={v}>{opp.filter(p => p.shot === v).length}</td>)}<td>{score(opp)}</td></tr></tbody></table></div> : <p>相手の得点は未記録です。</p>)}
    {detailed && showPlayingTime && (times === null
      ? <p className="muted">出場時間は、スコアシート情報でスタメン（先発5人）を指定した試合でのみ表示されます。</p>
      : <div className="table-wrap"><table><thead><tr><th>選手</th><th>合計</th>{startedQuarters.map(q => <th key={q.number}>{playingTimeQuarterHeader(game, q.number)}</th>)}</tr></thead><tbody>{sortPlayers(game.roster).map(p => {
        const entry = times.get(p.id);
        return <tr key={p.id}><th>{p.number} {p.name}</th><td>{formatPlayingTime(entry?.totalMs ?? 0)}</td>{startedQuarters.map(q => <td key={q.number}>{formatPlayingTime(entry?.byQuarter.get(q.number) ?? 0)}</td>)}</tr>;
      })}</tbody></table></div>)}
    {!showPlayingTime && <p className="small muted">記録された分の集計です。未確認で記録がない欄は「—」で表示します。{activeTab === 'シュート' && '「すべて」にはフリースローも含みます。'}</p>}
    {detailed && category && onCheck && <label className="inline-check"><input type="checkbox" disabled={busy} checked={checked} onChange={e => onCheck({ ...game.recordChecked, [teamSide]: { ...game.recordChecked?.[teamSide], [category]: e.target.checked } })} />{activeTab}の記録を確認済み</label>}
    {detailed && category && onCheck && <p className="small muted">確認済みは選択中のチームと項目の全Qに適用されます。</p>}
    </>}
  </section>;
}
