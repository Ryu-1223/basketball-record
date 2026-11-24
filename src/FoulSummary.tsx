import { useId } from 'react';
import { periodLabel, type Game, type Play } from './domain';
import { sheetFor, sideOf, teamFouls } from './to';

export function FoulSummary({ game, plays, teamName }: { game: Game; plays: Play[]; teamName: string }) {
  const titleId = useId();
  const quarter = game.quarters.at(-1)?.number ?? 1;
  const isOvertime = quarter > 4 && game.kind !== 'scrimmage';
  const foulPeriod = isOvertime ? '第4Q・延長' : periodLabel(game, quarter);
  const sheet = sheetFor(game, plays, teamName);
  const playerFouls = plays.filter(play =>
    play.action === 'foul' && !play.cancelled && play.details?.code !== 'GD',
  );
  const teams = (['own', 'opponent'] as const).map(side => ({
    side,
    name: (side === 'own' ? game.sheet?.own.name : sheet.opponent.name)
      || (side === 'own' ? (game.kind === 'scrimmage' ? 'チーム１' : teamName || '自チーム') : game.opponent),
    total: teamFouls(plays, side, isOvertime ? 4 : quarter),
    players: sheet[side].players.map(player => ({
      ...player,
      count: playerFouls.filter(play => sideOf(play) === side && play.playerId === player.id).length,
    })).filter(player => player.count > 0),
  }));

  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId}>ファウル数</h2>
      <p className="small muted">記録した分の集計です。</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">チーム</th><th scope="col">{foulPeriod}のチームファウル</th></tr></thead>
          <tbody>{teams.map(team => (
            <tr key={team.side}><th scope="row">{team.name}</th><td>{team.total}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <h3>選手別ファウル（試合累計）</h3>
      {teams.some(team => team.players.length > 0) ? <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">選手</th><th scope="col">回数</th></tr></thead>
          <tbody>{teams.flatMap(team => team.players.map(player => (
            <tr key={`${team.side}:${player.id}`}>
              <th scope="row">{team.name} / {player.number} {player.name}</th><td>{player.count}</td>
            </tr>
          )))}</tbody>
        </table>
      </div> : <p className="small muted">選手のファウル記録はありません。</p>}
    </section>
  );
}
