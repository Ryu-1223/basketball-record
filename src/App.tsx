import { SheetOutput } from './SheetOutput';
import { SheetFields, SheetSettings, ToEditor, RetroPlay } from './ToControls';
import { appendPlay, isToAction, newSheet, sheetFor, sortPlays, type ToAction } from './to';
import { Dialog } from './Dialog';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { registerSW } from 'virtual:pwa-register';
import { createLocalRepository } from './localRepository';
import { createCloudRepository, getServices, hasCloudConfig, accessTeam, logout } from './firebaseRepository';
import { actionLabels, quarterLabel, beginPlay, completePlay, elapsed, formatTime, isShot, localDate, playLabel, sortPlayers, transition, validatePlayer, type Action, type Draft, type Game, type Play, type Player, type Shot } from './domain';
import { readableError, type Repository, type SyncState } from './repository';
import { Results, score } from './Results';
import { teamIdFromUid, type TeamAction } from './team';

const statusLabels = { ready: '開始前', running: '記録中', interval: 'Q間', finished: '終了' };
const draftKey = 'basketball-play-draft';


export default function App() {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [authReady, setAuthReady] = useState(!hasCloudConfig);
  const [error, setError] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [teamName, setTeamName] = useState('');
  const [entry, setEntry] = useState<TeamAction | null>(null);
  const entryLock = useRef(false);
  const composing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const updateWorker = useRef<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (import.meta.env.PROD) updateWorker.current = registerSW({ onNeedRefresh: () => setUpdateAvailable(true) });
  }, []);
  useEffect(() => () => { if (repo?.mode === 'local') void repo.close(); }, [repo]);
  useEffect(() => {
    if (!hasCloudConfig) return;
    let active = true;
    let owned: Repository | null = null;
    let generation = 0;
    const stop = onAuthStateChanged(getServices().auth, user => {
      const current = ++generation;
      void (async () => {
        if (owned) { await owned.close(); owned = null; }
        if (!active) return;
        setRepo(null);
        if (user) {
          try {
            const next = await createCloudRepository(user.uid, teamIdFromUid(user.uid));
            if (!active || generation !== current) { await next.close(); return; }
            owned = next; setRepo(next);
          } catch (err) { if (active) setError(readableError(err)); }
        }
        if (active) setAuthReady(true);
      })();
    });
    return () => { active = false; stop(); void owned?.close(); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (composing.current || entryLock.current || !entry) return;
    entryLock.current = true;
    setBusy(true); setError('');
    try { await accessTeam(entry, passphrase, entry === 'create' ? teamName : undefined); setPassphrase(''); }
    catch (err) { setError(readableError(err)); }
    finally { entryLock.current = false; setBusy(false); }
  }
  async function startLocal() {
    setBusy(true); setError('');
    try { setRepo(await createLocalRepository()); }
    catch (err) { setError(readableError(err)); }
    finally { setBusy(false); }
  }
  if (!authReady) return <main className="shell"><p role="status">読み込み中…</p></main>;
  if (repo) return <Workspace key={repo.scope} repo={repo} updateAvailable={updateAvailable} applyUpdate={() => { void updateWorker.current?.(true); }} onLogout={async () => {
    if (repo.mode === 'cloud') { await repo.close(); await logout(); }
    else { await repo.close(); setRepo(null); }
  }} />;
  return <main className={`shell ${entry ? 'login' : 'entry'}`}>
    {!entry ? <div className="entry-actions"><button className="primary" onClick={() => { setEntry('create'); setError(''); }}>チームを作成</button><button onClick={() => { setEntry('join'); setError(''); }}>チームに参加</button></div> : <>
      <button className="quiet back" disabled={busy} onClick={() => { setEntry(null); setPassphrase(''); setError(''); }}>← 戻る</button>
      <h1>{entry === 'create' ? 'チームを作成' : 'チームに参加'}</h1>
      <form onSubmit={submit} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} className="panel stack">
        {entry === 'create' && <label>チーム名<input value={teamName} onChange={e => setTeamName(e.target.value)} maxLength={80} required placeholder="さくら中学校" /></label>}
        <label>合言葉<input autoComplete="off" autoCapitalize="none" spellCheck={false} type="text" placeholder="さくらバスケ部" value={passphrase} onChange={event => setPassphrase(event.target.value)} required /></label>
        <p className="muted small">{entry === 'create' ? '4〜64文字で決めて、チームのメンバーに伝えてください。' : 'チームのメンバーから教わった合言葉を入力してください。'}</p>
        <button className="primary" disabled={busy || !hasCloudConfig}>{busy ? '確認中…' : entry === 'create' ? 'この合言葉で作成' : '参加する'}</button>
      </form>
      {!hasCloudConfig && <section className="panel stack"><p>管理者が保存先を準備しています。</p>{import.meta.env.DEV && <><button disabled={busy} onClick={() => { void startLocal(); }}>この端末で試す</button><p className="muted small">試用データはこのブラウザだけに保存されます。</p></>}</section>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </main>;
}

function Workspace({ repo, onLogout, updateAvailable, applyUpdate }: { repo: Repository; onLogout: () => Promise<void>; updateAvailable: boolean; applyUpdate: () => void }) {
  const viewKey = `basketball-current-game:${repo.scope}`;
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [limit, setLimit] = useState(30);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState<'home' | 'players' | 'new' | 'game' | 'team'>(() => localStorage.getItem(viewKey) ? 'game' : 'home');
  const [playerOrigin, setPlayerOrigin] = useState<'home' | 'new'>('home');
  const [team, setTeam] = useState<{ name?: string; passphrase?: string }>({});
  const [newMounted, setNewMounted] = useState(false);
  const [gameId, setGameId] = useState<string | null>(() => localStorage.getItem(viewKey));
  const [sync, setSync] = useState<SyncState>({ pending: 0, error: null, fromCache: true });
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const locked = useRef(false);

  useEffect(() => repo.watchTeam(setTeam), [repo]);
  useEffect(() => repo.watchPlayers(setPlayers), [repo]);
  useEffect(() => repo.watchGames(limit, value => { setGames(value); setLoaded(true); }), [repo, limit]);
  useEffect(() => repo.watchSync(setSync), [repo]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const connection = () => setOnline(navigator.onLine);
    const id = window.setInterval(tick, 250);
    window.addEventListener('online', connection); window.addEventListener('offline', connection); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (sync.pending) { event.preventDefault(); } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [sync.pending]);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (err) { setError(readableError(err)); }
    finally { locked.current = false; setBusy(false); }
  }
  function navigate(next: typeof page) { if (next === 'new') setNewMounted(true); if (next === 'home') setNewMounted(false); setPage(next); setError(''); if (next !== 'game') localStorage.removeItem(viewKey); }
  function openGame(id: string) { setGameId(id); localStorage.setItem(viewKey, id); navigate('game'); }
  const game = games.find(g => g.id === gameId);
  const recording = games.some(g => g.status === 'running');

  return <div className="shell">
    <header className="app-header"><button className="brand" onClick={() => navigate('home')}>{team.name || 'バスケの記録'}</button><button className="quiet small" onClick={() => navigate('team')}>チーム情報</button><button className="quiet small" onClick={() => setConfirmLogout(true)}>退出</button></header>
    <div className={`sync-bar ${sync.error ? 'problem' : ''}`} role="status">
      <span>{repo.mode === 'local' ? (sync.pending ? 'この端末に保存中…' : 'この端末だけに保存') : sync.error ? '保存を確認してください' : sync.pending ? `未送信 ${sync.pending}件${online ? '・送信中' : '・通信なし'}` : !online ? '通信なし・端末の記録を表示' : sync.fromCache ? '保存先を確認中…' : 'すべて保存済み'}</span>
      {repo.mode === 'local' && <span className="tag">試用</span>}
    </div>
    {sync.error && <div className="error" role="alert">{sync.error}<p className="small">未送信の入力は端末に残ります。通信や設定を確認してください。</p>{'retry' in repo && <button onClick={() => (repo as Repository & { retry: () => void }).retry()}>再送する</button>}</div>}
    {error && <div className="error" role="alert">{error}<button className="quiet" onClick={() => setError('')}>閉じる</button></div>}
    <main>
      {page === 'home' && <>
        <div className="page-title"><h1>試合の記録</h1><p className="muted">今日の試合も、これまでの試合も。</p></div>
        <div className="home-actions"><button className="primary" onClick={() => navigate('new')}>新しい試合</button><button onClick={() => { setPlayerOrigin('home'); navigate('players'); }}>選手登録</button></div>
        <h2 className="section-title">試合一覧</h2>
        {!loaded ? <p role="status">読み込み中…</p> : !games.length ? <section className="empty"><p>まだ試合がありません</p><p className="muted">選手を登録して、最初の試合を始めましょう。</p></section> : <div className="game-list">{[...games].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).map(g => <button key={g.id} className="game-card" onClick={() => openGame(g.id)}>
          <span className="row"><span className="muted small">{g.date.replaceAll('-', '/')}</span><span className={`tag ${g.status === 'running' ? 'active' : ''}`}>{statusLabels[g.status]}</span></span>
          <span className="opponent">対 {g.opponent}</span><span className="muted small">{g.roster.length}人登録{g.quarters.length ? ` / ${quarterLabel(g.quarters.length)}` : ''}　記録を見る →</span>
        </button>)}</div>}
        {games.length >= limit && <button className="full" onClick={() => setLimit(value => value + 30)}>前の試合をもっと見る</button>}
      </>}
      {page === 'players' && <Players players={players} repo={repo} run={run} busy={busy} back={() => navigate(playerOrigin)} origin={playerOrigin} sync={sync} />}
      {newMounted && <div hidden={page !== 'new'}><NewGame teamName={team.name ?? ""} players={players} busy={busy} back={() => navigate('home')} register={() => { setPlayerOrigin('new'); navigate('players'); }} create={g => { void run(async () => { await repo.saveGame(g); setNewMounted(false); openGame(g.id); }); }} /></div>}
      {page === 'team' && <TeamInfo team={team} busy={busy} back={() => navigate('home')} save={name => { void run(() => repo.saveTeamName(name)); }} />}
      {page === 'game' && (game ? <GameScreen key={game.id} game={game} teamName={team.name ?? ""} pending={sync.pending > 0} repo={repo} now={Date.now()} busy={busy} run={run} back={() => navigate('home')} /> : <section className="panel stack"><p>{loaded ? 'この試合はまだ読み込まれていません。試合一覧から選び直してください。' : '試合を読み込み中…'}</p><button onClick={() => navigate('home')}>試合一覧へ</button></section>)}
    </main>
    {updateAvailable && !recording && sync.pending === 0 && <aside className="update panel"><p>新しい版があります。</p><button onClick={applyUpdate}>更新する</button></aside>}
    <footer>バスケの記録<span>見る、押す、残す。</span></footer>
    {confirmLogout && <Dialog title="退出しますか？" onClose={() => setConfirmLogout(false)}>
      <p>{sync.pending ? '未送信の記録があります。保存が終わってから退出してください。' : repo.mode === 'local' ? 'この端末に保存した試用データは残ります。' : 'この端末からログアウトします。'}</p>
      <div className="stack"><button disabled={sync.pending > 0 || busy} onClick={() => { void run(onLogout); }}>退出する</button><button className="quiet" onClick={() => setConfirmLogout(false)}>戻る</button></div>
    </Dialog>}
  </div>;
}

type Runner = (action: () => Promise<void>) => Promise<void>;
function Back({ onClick }: { onClick: () => void }) { return <button className="back quiet" onClick={onClick}>← 試合一覧</button>; }

function Players({ players, repo, run, busy, back, origin, sync }: { players: Player[]; repo: Repository; run: Runner; busy: boolean; back: () => void; origin: 'home' | 'new'; sync: SyncState }) {
  const [editing, setEditing] = useState<Player | null>(null);
  const [saved, setSaved] = useState('');
  const [name, setName] = useState(''); const [number, setNumber] = useState('');
  const input = useRef<HTMLInputElement>(null);
  function reset() { setEditing(null); setName(''); setNumber(''); }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const player = { id: editing?.id ?? crypto.randomUUID(), name: name.trim(), number: number.trim(), active: true };
      validatePlayer(player, players); await repo.savePlayer(player); setSaved(`${player.number} ${player.name}を登録しました`); reset(); input.current?.focus();
    });
  }
  function finish() { if ((name || number) && !window.confirm('入力中の選手はまだ登録されていません。移動しますか？')) return; back(); }
  return <><Back onClick={finish} /><h1>選手登録</h1><p className="muted">次の試合でも、この名簿から選べます。</p>
    <form className="panel stack" onSubmit={submit}>
      <h2>{editing ? '選手を変更' : '選手を追加'}</h2>
      <div className="player-fields"><label>背番号<input ref={input} inputMode="numeric" maxLength={2} value={number} onChange={e => setNumber(e.target.value)} required placeholder="7" /></label><label>名前<input maxLength={40} value={name} onChange={e => setName(e.target.value)} required placeholder="田中" /></label></div>
      <button className="primary" disabled={busy}>{editing ? '変更を保存' : '選手を追加'}</button>{editing && <button type="button" className="quiet" onClick={reset}>変更をやめる</button>}
    </form>
    {saved && <p role="status">{saved} {sync.pending ? '（端末に保存済み・共有待ち）' : '（保存済み）'}</p>}
    <h2 className="section-title">登録選手（{players.filter(p => p.active).length}人）</h2>
    {!players.length && <p className="empty">背番号と名前を登録してください。</p>}
    <div className="roster-list">{sortPlayers(players).map(p => <div key={p.id} className={`roster-row ${!p.active ? 'inactive' : ''}`}>
      <span className="number">{p.number}</span><span className="player-name">{p.name}{!p.active && <small>非表示</small>}</span>
      {p.active && <button className="small" onClick={() => { setEditing(p); setName(p.name); setNumber(p.number); input.current?.focus(); }}>変更</button>}
      <button className="quiet small" disabled={busy} onClick={() => { void run(async () => { const next = { ...p, active: !p.active }; validatePlayer(next, players); await repo.savePlayer(next); }); }}>{p.active ? '非表示' : '戻す'}</button>
    </div>)}</div>
    <p className="muted small">名簿を変更しても、過去の試合の名前・背番号は変わりません。</p><button className="primary full" type="button" onClick={finish}>{origin === "new" ? "登録を完了して試合準備へ" : "登録を完了して試合一覧へ"}</button>
  </>;
}

function NewGame({ players, busy, back, register, create, teamName }: { teamName: string; players: Player[]; busy: boolean; back: () => void; register: () => void; create: (game: Game) => void }) {
  const active = sortPlayers(players.filter(p => p.active));
  const [selected, setSelected] = useState<string[]>(active.map(p => p.id));
  const [sheet, setSheet] = useState(() => newSheet(teamName));
  const [opponent, setOpponent] = useState(''); const [date, setDate] = useState(localDate());
  useEffect(() => { setSelected(current => [...new Set([...current, ...active.map(p => p.id)])]); }, [players]); // 名簿の初回取得を反映
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!opponent.trim() || !selected.length) return;
    const now = Date.now();
    create({ id: crypto.randomUUID(), opponent: opponent.trim(), date, roster: active.filter(p => selected.includes(p.id)).map(({ id, name, number }) => ({ id, name, number })), status: 'ready', quarters: [], opponentTracking: true, sheet: { ...sheet, own: { ...sheet.own, name: sheet.own.name || teamName, checked: { ...sheet.own.checked, score: true } }, opponent: { ...sheet.opponent, name: opponent.trim(), checked: { ...sheet.opponent.checked, score: true } } }, createdAt: now, updatedAt: now });
  }
  return <><Back onClick={back} /><h1>新しい試合</h1><form onSubmit={submit} className="stack">
    <section className="panel stack"><label>試合日<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label><label>対戦相手<input value={opponent} onChange={e => setOpponent(e.target.value)} maxLength={80} required placeholder="○○中学校" /></label></section>
    <section className="panel"><div className="row"><h2>ベンチ入り選手</h2><span className="muted small">{selected.filter(id => active.some(p => p.id === id)).length}人選択</span></div>
      {!active.length ? <div className="stack"><p>先に選手を登録してください。</p><button type="button" onClick={register}>選手登録へ</button></div> : <>
        <div className="row selection-tools"><button type="button" className="quiet small" onClick={() => setSelected(active.map(p => p.id))}>全員選択</button><button type="button" className="quiet small" onClick={() => setSelected([])}>選択を外す</button></div>
        <div className="check-list">{active.map(p => <label className="check-player" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /><strong>{p.number}</strong><span>{p.name}</span></label>)}</div>
      </>}
    </section>
    <details className="panel"><summary>スコアシート情報（後から補足できます）</summary><SheetFields value={sheet} change={setSheet} /></details>
    <button className="primary" disabled={busy || !selected.some(id => active.some(p => p.id === id))}>このメンバーで確定</button>
  </form></>;
}

function readDraft(gameId: string, scope: string): Draft | null {
  try { const value = JSON.parse(sessionStorage.getItem(`${draftKey}:${scope}`) ?? 'null') as Draft | null; return value?.gameId === gameId ? value : null; } catch { return null; }
}
function GameScreen({ game, repo, now, busy, run, back, teamName, pending }: { teamName: string; pending: boolean; game: Game; repo: Repository; now: number; busy: boolean; run: Runner; back: () => void }) {
  const [plays, setPlays] = useState<Play[]>([]);
  const [draft, setDraft] = useState<Draft | null>(() => readDraft(game.id, repo.scope));
  const [editing, setEditing] = useState<Play | null>(null);
  const [confirm, setConfirm] = useState<'quarter' | 'finish' | null>(null);
  const [opponentDraft, setOpponentDraft] = useState<Draft | null>(null);
  const [opponentNumber, setOpponentNumber] = useState('');
  const [addingNumber, setAddingNumber] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [resultTab, setResultTab] = useState<'sheet' | 'stats'>('sheet');
  const [settings, setSettings] = useState(false);
  const [toAction, setToAction] = useState<ToAction | null>(null);
  const [retro, setRetro] = useState(false);
  const [playsLoaded, setPlaysLoaded] = useState(false);
  const [showAll, setShowAll] = useState(game.status === 'finished');
  const captureLock = useRef(false);
  useEffect(() => repo.watchPlays(game.id, value => { setPlays(value); setPlaysLoaded(true); }), [repo, game.id]);
  useEffect(() => {
    if (draft) sessionStorage.setItem(`${draftKey}:${repo.scope}`, JSON.stringify(draft)); else sessionStorage.removeItem(`${draftKey}:${repo.scope}`);
  }, [draft, repo.scope]);
  const q = game.quarters.at(-1);
  const visible = sortPlays(plays.filter(p => !p.cancelled));
  const last = [...visible].sort((a, b) => b.createdAt - a.createdAt).at(0);
  const inconsistentClock = !!q && q.endedAt === null && now < q.startedAt;
  const alreadySaved = draft && plays.some(p => p.id === draft.id);
  useEffect(() => { if (alreadySaved) setDraft(null); }, [alreadySaved]);

  function command(action: Parameters<typeof transition>[1]) {
    void run(async () => { if (action === 'finish' && visible.some(p => p.quarter > game.quarters.length)) throw new Error('次のQに記録したファウルがあります。Qを開始するか、記録を訂正・取り消してから終了してください。'); await repo.saveGame(transition(game, action, Date.now())); setConfirm(null); });
  }
  function capture(action: Action) {
    if (draft || busy || captureLock.current) return;
    captureLock.current = true;
    void run(async () => { setDraft(beginPlay(game, action, Date.now())); }).finally(() => { captureLock.current = false; });
  }
  function save(playerId: string, shot: Shot | null) {
    if (!draft) return;
    void run(async () => { await repo.savePlay(appendPlay(plays, completePlay(game, draft, playerId, shot, Date.now()))); setDraft(null); });
  }
  const opponentNumbers = sheetFor(game, plays).opponent.players.map(p => p.number);
  async function movePlay(play: Play, delta: number) {
    const list = visible.filter(p => p.quarter === play.quarter); const i = list.findIndex(p => p.id === play.id);
    if (i + delta < 0 || i + delta >= list.length) return;
    [list[i], list[i + delta]] = [list[i + delta], list[i]];
    await run(async () => { await repo.savePlays(list.map((p, j) => ({ ...p, order: (j + 1) * 1000, updatedAt: Date.now() }))); });
  }
  function saveOpponent(shot: Shot) {
    if (!opponentDraft || !/^(?:[0-9]|[1-9][0-9]|00)$/.test(opponentNumber)) return;
    void run(async () => { await repo.savePlay(appendPlay(plays, { ...opponentDraft, playerId: opponentNumber, side: 'opponent', shot, cancelled: false, updatedAt: Date.now() })); setOpponentDraft(null); setOpponentNumber(''); setAddingNumber(false); });
  }
  const displayPlays = showAll ? visible : visible.slice(-5).reverse();
  return <><Back onClick={back} />
    <div className="game-heading"><p className="muted small">{game.date.replaceAll('-', '/')} <span className="tag">{statusLabels[game.status]}</span></p><h1>対 {game.opponent}</h1></div>
    <p className="score">自チーム {score(visible.filter(p => p.side !== 'opponent'))} − {game.opponentTracking || plays.some(p => p.side === 'opponent') ? score(visible.filter(p => p.side === 'opponent')) : '未記録'} {game.opponent}</p>
    <button className="quiet full" onClick={() => setSettings(true)}>スコアシート情報</button>
    {game.status === 'finished' && <div className="result-tabs"><button aria-pressed={resultTab === 'sheet' && !showHistory} onClick={() => { setResultTab('sheet'); setShowHistory(false); }}>スコアシート</button><button aria-pressed={resultTab === 'stats' && !showHistory} onClick={() => { setResultTab('stats'); setShowHistory(false); }}>選手別成績</button></div>}
    {game.status === 'finished' && !showHistory && (!playsLoaded ? <p>記録を読み込み中…</p> : resultTab === 'sheet' ? <SheetOutput game={game} plays={plays} pending={pending} /> : <Results game={game} plays={plays} />)}
    {game.status !== 'finished' && <section className="clock panel" aria-label="クォーターと経過時間">
      <div className="clock-top"><strong>{q ? quarterLabel(q.number) : '試合開始前'}</strong><span className="muted small">{game.status === 'interval' ? 'Q終了' : '開始から'}</span></div>
      <div className="time" role="timer" aria-live="off">{formatTime(elapsed(q, now))}</div>
      <button className="full opponent-action" disabled={game.status !== 'running' || busy || inconsistentClock} onClick={() => { setOpponentDraft(beginPlay(game, 'made', Date.now())); setOpponentNumber(''); setAddingNumber(false); }}>相手のシュート決</button>
      {game.status === 'ready' && <button className="primary full" disabled={busy} onClick={() => command('start')}>試合開始</button>}
      {game.status === 'running' && <p className="muted small">プレーが止まっても、そのままでOK</p>}
      {game.status === 'interval' && <div className="stack"><button className="primary" disabled={busy} onClick={() => command('next')}>{quarterLabel((q?.number ?? 0) + 1)}を開始</button><button className="quiet small" disabled={busy} onClick={() => command('undoEnd')}>Q終了を取り消す</button></div>}
    </section>}
    {inconsistentClock && <p className="error" role="alert">端末の時刻がQ開始時刻より前になっています。端末の時刻を確認してください。</p>}
    {game.status !== 'finished' && <>
      <div className="action-grid">{(Object.keys(actionLabels) as Action[]).map(action => <button key={action} className={`action action-${action}`} disabled={game.status !== 'running' || busy || inconsistentClock} onClick={() => capture(action)}>{actionLabels[action]}</button>)}</div>
      <div className="to-actions">{(['foul', 'timeout', 'entry'] as const).map(a => <button key={a} disabled={busy || !playsLoaded || (a !== 'foul' && game.status !== 'running')} onClick={() => setToAction(a)}>{a === 'foul' ? 'ファウル' : a === 'timeout' ? 'タイムアウト' : '出場'}</button>)}</div>
      {game.status === 'ready' && <p className="muted small center">試合開始後に記録できます。</p>}
      <section className="last-play panel"><h2>直前の記録</h2>{last ? <><PlayLine play={last} game={game} /><button className="quiet small" disabled={busy} onClick={() => { void run(() => repo.savePlay({ ...last, cancelled: true, updatedAt: Date.now() })); }}>この記録を取り消す</button></> : <p className="muted">まだ記録がありません。</p>}</section>
      <div className="quarter-actions">{game.status === 'running' && <button disabled={busy || !!draft || !!opponentDraft || !!toAction || inconsistentClock} onClick={() => setConfirm('quarter')}>このQを終了</button>}{game.status === 'interval' && <button disabled={busy} onClick={() => setConfirm('finish')}>試合を終了する</button>}</div>
    </>}
    {game.status === 'finished' && <button className="full" onClick={() => setShowHistory(!showHistory)}>{showHistory ? '記録一覧を閉じる' : '記録を確認・訂正する'}</button>}
    {(game.status !== 'finished' || showHistory) && <section className="history"><button className="full" disabled={busy || !game.quarters.length} onClick={() => setRetro(true)}>記録漏れを追加</button><div className="row"><h2>記録一覧 <span className="muted">{visible.length}件</span></h2>{visible.length > 5 && <button className="quiet small" onClick={() => setShowAll(!showAll)}>{showAll ? '最近の5件' : 'すべて見る'}</button>}</div>
      {!visible.length ? <p className="empty">プレーを記録すると、ここに表示されます。</p> : <ol className="play-list">{displayPlays.map(play => <li key={play.id}><PlayLine play={play} game={game} /><div className="history-actions"><button className="quiet small" onClick={() => setEditing(play)}>訂正</button>{showHistory && <><button className="quiet small" disabled={busy || visible.filter(p => p.quarter === play.quarter)[0]?.id === play.id} onClick={() => { void movePlay(play, -1); }}>前へ</button><button className="quiet small" disabled={busy || visible.filter(p => p.quarter === play.quarter).at(-1)?.id === play.id} onClick={() => { void movePlay(play, 1); }}>後へ</button></>}</div></li>)}</ol>}
    </section>}
    <details className="panel team-details"><summary>この試合の選手（{game.roster.length}人）</summary><p>{sortPlayers(game.roster).map(p => `${p.number} ${p.name}`).join(' / ')}</p></details>
    {draft && !alreadySaved && <Dialog title={draft.playerId && isShot(draft.action) ? 'シュートの種類' : '選手を選ぶ'} onClose={() => setDraft(null)}>
      <div className="draft-summary"><strong>{actionLabels[draft.action]}</strong><span>{quarterLabel(draft.quarter)}・{formatTime(draft.elapsedMs)}</span></div>
      <p className="muted small">この時刻で記録します。{game.status === 'running' && `現在 ${formatTime(elapsed(q, now))}`}</p>
      {game.status !== 'running' || draft.quarter !== q?.number ? <div className="error">Qの状態が変わっています。閉じてから記録し直してください。</div> : draft.playerId && isShot(draft.action) ? <div className="stack"><p className="selected-player">{game.roster.find(p => p.id === draft.playerId)?.number} {game.roster.find(p => p.id === draft.playerId)?.name}</p>{(['2', '3', 'ft'] as Shot[]).map(shot => <button key={shot} className="shot-choice" disabled={busy} onClick={() => save(draft.playerId!, shot)}>{shot === 'ft' ? 'フリースロー' : `${shot}点`}</button>)}<button className="quiet" onClick={() => setDraft({ ...draft, playerId: undefined })}>選手を選び直す</button></div> : <div className="player-grid">{sortPlayers(game.roster).map(p => <button key={p.id} disabled={busy} className="player-choice" onClick={() => { if (isShot(draft.action)) setDraft({ ...draft, playerId: p.id }); else save(p.id, null); }}><strong>{p.number}</strong><span>{p.name}</span></button>)}</div>}
      <button className="quiet full cancel" onClick={() => setDraft(null)}>記録せず戻る</button>
    </Dialog>}
    {opponentDraft && <Dialog title="相手のシュート決" onClose={() => setOpponentDraft(null)}><div className="stack">{opponentNumber ? <><p className="selected-player">背番号 {opponentNumber}</p>{(['2', '3', 'ft'] as Shot[]).map(shot => <button key={shot} disabled={busy} onClick={() => saveOpponent(shot)}>{shot === 'ft' ? 'フリースロー' : `${shot}点`}</button>)}<button onClick={() => setOpponentNumber('')}>背番号を選び直す</button></> : <><p>相手の背番号を選んでください。</p><div className="player-grid">{opponentNumbers.map(n => <button key={n} onClick={() => setOpponentNumber(n)}>{n}</button>)}</div>{addingNumber ? <form onSubmit={e => { e.preventDefault(); const value = (new FormData(e.currentTarget).get('number') as string).trim(); if (/^(?:[0-9]|[1-9][0-9]|00)$/.test(value)) setOpponentNumber(value);  }}><label>背番号<input name="number" inputMode="numeric" pattern="([0-9]|[1-9][0-9]|00)" required maxLength={2} /></label><button>この背番号を使う</button></form> : <button onClick={() => setAddingNumber(true)}>背番号を追加</button>}</>}</div></Dialog>}
    {confirm && <Dialog title={confirm === 'quarter' ? `${quarterLabel(q?.number ?? 1)}を終了しますか？` : '試合を終了しますか？'} onClose={() => setConfirm(null)}><p>{confirm === 'quarter' ? '時計を止めて、Q間の休憩に入ります。' : '終了後も記録一覧の確認・訂正ができます。'}</p><div className="stack"><button className="primary" disabled={busy} onClick={() => command(confirm === 'quarter' ? 'endQuarter' : 'finish')}>{confirm === 'quarter' ? 'このQを終了する' : '試合を終了する'}</button><button className="quiet" onClick={() => setConfirm(null)}>戻る</button></div></Dialog>}
    {settings && <SheetSettings game={game} plays={plays} teamName={teamName} busy={busy} close={() => setSettings(false)} save={sheet => { void run(async () => { await repo.saveGame({ ...game, sheet, updatedAt: Date.now() }); setSettings(false); }); }} />}
    {toAction && <ToEditor game={game} plays={plays} action={toAction} busy={busy} close={() => setToAction(null)} save={p => { void run(async () => { await repo.savePlay(appendPlay(plays, p)); setToAction(null); }); }} />}
    {retro && <RetroPlay game={game} plays={plays} busy={busy} close={() => setRetro(false)} save={p => { void run(async () => { await repo.savePlays(p); setRetro(false); }); }} />}
    {editing && isToAction(editing.action) && <ToEditor game={game} plays={plays} initial={editing} action={editing.action} busy={busy} close={() => setEditing(null)} save={p => { void run(async () => { await repo.savePlay(p); setEditing(null); }); }} />}
    {editing && !isToAction(editing.action) && <EditPlay play={editing} game={game} busy={busy} close={() => setEditing(null)} save={play => { void run(async () => { await repo.savePlay(play); setEditing(null); }); }} />}
  </>;
}

function PlayLine({ play, game }: { play: Play; game: Game }) {
  const player = game.roster.find(p => p.id === play.playerId);
  return <div className="play-line"><span className="play-time">{quarterLabel(play.quarter)} <strong>{formatTime(play.elapsedMs)}</strong></span><span><strong>{`${play.side === 'opponent' ? '相手 ' : ''}${play.playerId === '@team' ? 'チーム' : play.playerId === '@coach' ? 'ヘッドコーチ' : play.playerId === '@assistant' ? 'A.コーチ' : play.side === 'opponent' ? `${play.playerId}番` : `${player?.number ?? ''} ${player?.name ?? '選手不明'}`}`}</strong><span className="play-label">{playLabel(play)}</span></span></div>;
}

function EditPlay({ play, game, busy, close, save }: { play: Play; game: Game; busy: boolean; close: () => void; save: (play: Play) => void }) {
  const [value, setValue] = useState(play);
  const [time, setTime] = useState(formatTime(play.elapsedMs));
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{1,4}:[0-5]\d$/.test(time)) { setError('経過時間は「05:32」のように入力してください。'); return; }
    const [minutes, seconds] = time.split(':').map(Number);
    const elapsedMs = (minutes * 60 + seconds) * 1000;
    const quarter = game.quarters.find(q => q.number === value.quarter);
    if (!quarter || elapsedMs > elapsed(quarter, Date.now()) + 999) { setError('そのQの経過時間内で指定してください。'); return; }
    save({ ...value, elapsedMs, shot: isShot(value.action) ? value.shot ?? '2' : null, updatedAt: Date.now() });
  }
  return <Dialog title="記録を訂正" onClose={close}><form onSubmit={submit} className="stack">
    {value.side === 'opponent' ? <label>相手の背番号<input inputMode="numeric" pattern="([0-9]|[1-9][0-9]|00)" maxLength={2} required value={value.playerId} onChange={e => setValue({ ...value, playerId: e.target.value })} /></label> : <label>選手<select value={value.playerId} onChange={e => setValue({ ...value, playerId: e.target.value })}>{sortPlayers(game.roster).map(p => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select></label>}
    {value.side !== 'opponent' && <label>プレー<select value={value.action} onChange={e => setValue({ ...value, action: e.target.value as Action })}>{Object.entries(actionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
    {isShot(value.action) && <label>シュート<select value={value.shot ?? '2'} onChange={e => setValue({ ...value, shot: e.target.value as Shot })}><option value="2">2点</option><option value="3">3点</option><option value="ft">フリースロー</option></select></label>}
    <div className="two-fields"><label>クォーター<select value={value.quarter} onChange={e => setValue({ ...value, quarter: Number(e.target.value) })}>{game.quarters.map(q => <option key={q.number} value={q.number}>{quarterLabel(q.number)}</option>)}</select></label><label>開始から<input value={time} onChange={e => setTime(e.target.value)} placeholder="05:32" inputMode="text" required /></label></div>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={busy}>訂正を保存</button><button type="button" className="quiet danger" disabled={busy} onClick={() => save({ ...play, cancelled: true, updatedAt: Date.now() })}>この記録を取り消す</button>
  </form></Dialog>;
}

function TeamInfo({ team, save, back, busy }: { team: { name?: string; passphrase?: string }; save: (name: string) => void; back: () => void; busy: boolean }) {
  const [name, setName] = useState(team.name ?? '');
  const [submitted, setSubmitted] = useState(false);
  return <><Back onClick={back} /><h1>チーム情報</h1><form className="panel stack" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; save(name.trim()); setSubmitted(true); }}><label>チーム名<input value={name} maxLength={80} required onChange={e => { setName(e.target.value); setSubmitted(false); }} /></label><button className="primary" disabled={busy}>チーム名を保存</button>{submitted && team.name === name.trim() && <p role="status">チーム名を保存しました。</p>}</form><section className="panel"><h2>合言葉</h2><p>{team.passphrase ?? '確認するには、一度退出して合言葉で参加し直してください。'}</p></section></>;
}
