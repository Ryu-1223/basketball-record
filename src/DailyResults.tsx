import { useEffect, useState } from 'react';
import type { Game, Play, RosterPlayer } from './domain';
import type { Repository } from './repository';
import { Results, score } from './Results';

// Only games in the same explicitly created session and date are combined.
export function DailyResults({ game, games, repo }: { game: Game; games: Game[]; repo: Repository }) {
  const matches = games.filter(g => g.sessionId && g.sessionId === game.sessionId && g.date === game.date && !g.archived);
  const key = matches.map(g => g.id).sort().join(',');
  const [records, setRecords] = useState<Record<string, Play[]>>({});
  useEffect(() => {
    setRecords({});
    return matches.map(g => repo.watchPlays(g.id, plays => setRecords(current => ({ ...current, [g.id]: plays })))).reduce((stop, next) => () => { stop(); next(); }, () => {});
  }, [key, repo]); // IDs determine the set of subscriptions.
  if (matches.some(g => !records[g.id])) return <p role="status">連続ゲームの記録を読み込み中…</p>;
  const roster = new Map<string, RosterPlayer>();
  const all: Play[] = [];
  for (const match of matches) {
    for (const p of match.roster) roster.set(p.id, p);
    for (const p of match.opponentRoster ?? []) roster.set(p.memberId, { id: p.memberId, number: p.number, name: p.name });
    for (const p of records[match.id] ?? []) {
      const id = p.playerId === '@unknown' ? '@unknown' : p.side === 'opponent' ? match.opponentRoster?.find(x => x.id === p.playerId)?.memberId : p.playerId;
      if (id && (id === '@unknown' || roster.has(id))) { const copy = { ...p, playerId: id }; delete copy.side; all.push(copy); }
    }
  }
  const summary: Game = { ...game, kind: undefined, opponentRoster: undefined, recordChecked: undefined, roster: [...roster.values()], quarters: [] };
  const incomplete = matches.some(g => g.recordMode && g.recordMode !== 'both');
  return <section><p className="small muted">{game.date}の同じ連続ゲームに含まれる{matches.length}ゲームの記録分を合計します。一覧に未読込のゲームは含まれません。{incomplete && '得点のみの組を含むため、今日は得点だけを合計します。'}</p>{incomplete ? <div className="table-wrap"><table><thead><tr><th>選手</th><th>記録された得点</th></tr></thead><tbody>{[...roster.values()].map(p => <tr key={p.id}><th>{p.number} {p.name}</th><td>{score(all.filter(x => x.playerId === p.id))}</td></tr>)}{all.some(p => p.playerId === '@unknown') && <tr><th>選手不明</th><td>{score(all.filter(p => p.playerId === '@unknown'))}</td></tr>}<tr><th>合計</th><td>{score(all)}</td></tr></tbody></table></div> : <Results game={summary} plays={all} />}</section>;
}
