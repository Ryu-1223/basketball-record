import { SheetOutput } from './SheetOutput';
import { DailyResults } from './DailyResults';
import { SheetFields, SheetSettings, ToEditor, RetroPlay } from './ToControls';
import { appendPlay, isToAction, newSheet, sheetFor, sortPlays, type ToAction } from './to';
import { Dialog } from './Dialog';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { registerSW } from 'virtual:pwa-register';
import { createLocalRepository } from './localRepository';
import { createCloudRepository, getServices, hasCloudConfig, accessTeam, logout } from './firebaseRepository';
import { actionLabels, periodLabel, beginPlay, completePlay, elapsed, formatTime, isShot, localDate, playLabel, sortPlayers, transition, validatePlayer, type Action, type Draft, type Game, type Play, type Player, type Shot } from './domain';
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
    if (!import.meta.env.PROD) return;
    let timer: number | undefined;
    updateWorker.current = registerSW({ onNeedRefresh: () => setUpdateAvailable(true), onRegisteredSW: (_url, registration) => { if (registration) timer = window.setInterval(() => { void registration.update().catch(() => {}); }, 60_000); } });
    return () => window.clearInterval(timer);
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
  const [search, setSearch] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [trash, setTrash] = useState<Game[]>([]);
  const [trashLimit, setTrashLimit] = useState(30);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Game | null>(null);
  const [deletedNotice, setDeletedNotice] = useState<Game | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState<'home' | 'players' | 'new' | 'game' | 'team' | 'help' | 'history' | 'historyGame'>(() => localStorage.getItem(viewKey) ? 'game' : 'home');
  const [playerOrigin, setPlayerOrigin] = useState<'home' | 'new' | 'team'>('team');
  const [team, setTeam] = useState<{ name?: string; passphrase?: string }>({});
  const [newVersion, setNewVersion] = useState(0);
  const [newMounted, setNewMounted] = useState(false);
  const [template, setTemplate] = useState<Game | undefined>();
  const [gameId, setGameId] = useState<string | null>(() => localStorage.getItem(viewKey));
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyGame, setHistoryGame] = useState<Game | undefined>();
  const [teamMounted, setTeamMounted] = useState(false);
  const restoringGame = useRef(Boolean(gameId));
  const scrollPositions = useRef<Record<string, number>>({});
  const [openedGame, setOpenedGame] = useState<Game | undefined>();
  const [sync, setSync] = useState<SyncState>({ pending: 0, error: null, fromCache: true });
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const [, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [playerDirty, setPlayerDirty] = useState(false);
  const [teamDirty, setTeamDirty] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const locked = useRef(false);

  useEffect(() => { setHistoryGame(undefined); setHistoryLoaded(false); if (historyId) return repo.watchGame(historyId, value => { setHistoryGame(value); setHistoryLoaded(true); }); }, [repo, historyId]);
  useEffect(() => repo.watchTeam(setTeam), [repo]);
  useEffect(() => repo.watchPlayers(setPlayers), [repo]);
  useEffect(() => repo.watchGames(limit, value => { setGames(value); setLoaded(true); }), [repo, limit]);
  useEffect(() => { if (!showTrash) return; setTrashLoaded(false); return repo.watchTrash(trashLimit, value => { setTrash(value); setTrashLoaded(true); }); }, [repo, showTrash, trashLimit]);
  useEffect(() => repo.watchSync(setSync), [repo]);
  useEffect(() => { setOpenedGame(undefined); if (gameId) return repo.watchGame(gameId, setOpenedGame); }, [repo, gameId]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const connection = () => setOnline(navigator.onLine);
    const id = window.setInterval(tick, 250);
    window.addEventListener('online', connection); window.addEventListener('offline', connection); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (sync.pending || playerDirty || teamDirty || newMounted) { event.preventDefault(); } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [sync.pending, playerDirty, teamDirty, newMounted]);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (err) { setError(readableError(err)); }
    finally { locked.current = false; setBusy(false); }
  }
  function navigate(next: typeof page) {
    scrollPositions.current[page] = window.scrollY;
    if (next === 'history') setShowTrash(false);
    if (next === 'new') setNewMounted(true);
    if (next === 'team') setTeamMounted(true);
    setPage(next); setError('');
    requestAnimationFrame(() => window.scrollTo(0, scrollPositions.current[next] ?? 0));
  }
  function openGame(id: string) {
    setGameId(id); localStorage.setItem(viewKey, id); navigate('game');
  }
  function openHistory(id: string) { setHistoryId(id); navigate('historyGame'); }
  function afterDeletion(id: string, finished: boolean) {
    const target = games.find(g => g.id === id) ?? (historyGame?.id === id ? historyGame : openedGame);
    if (target) setDeletedNotice(target);
    setGames(current => current.filter(value => value.id !== id));
    if (gameId === id) { setGameId(null); localStorage.removeItem(viewKey); }
    if (historyId === id) { setHistoryId(null); setHistoryGame(undefined); }
    navigate(finished ? 'history' : 'home');
  }

  function prepareGame(previous?: Game) {
    if (newMounted && !window.confirm('入力途中の試合準備を取り消して、新しい準備を開きますか？')) return;
    setTemplate(previous); setNewVersion(version => version + 1); navigate('new');
  }

  const game = openedGame?.id === gameId ? openedGame : games.find(g => g.id === gameId);
  useEffect(() => {
    if (!game) return;
    if (restoringGame.current) {
      restoringGame.current = false;
      if (game.status === 'finished') setPage('home');
    }
    if (game.status === 'finished') localStorage.removeItem(viewKey);
  }, [game?.id, game?.status, viewKey]);
  const recording = [...games, ...(game ? [game] : []), ...(historyGame ? [historyGame] : [])].some(g => !g.trashedAt && g.status === 'running');
  const canManage = sync.pending === 0 && !sync.error && (repo.mode === 'local' || (online && !sync.fromCache));
  const listedGames = (page === 'history' && showTrash ? trash : games).filter(g => (showTrash && page === 'history' ? true : page === 'history' ? g.status === 'finished' : g.status !== 'finished') && !!g.trashedAt === (page === 'history' && showTrash) && (page !== 'history' || g.opponent.includes(search) || g.date.includes(search))).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  return <div className={`shell ${page === 'game' && game?.status !== 'finished' ? 'game-active' : ''} ${((page === 'game' && game?.status === 'finished') || page === 'historyGame') ? 'game-finished' : ''}`}>
    <header className="app-header"><span className="brand">{team.name || 'バスケの記録'}</span></header>
    <nav className="main-tabs" aria-label="メイン画面">{([['home', '試合の記録'], ['history', '過去の記録'], ['team', 'チーム情報'], ['help', '使い方']] as const).map(([key, label]) => <button key={key} aria-current={(key === 'home' ? ['home', 'new', 'game'].includes(page) : key === 'team' ? ['team', 'players'].includes(page) : key === 'history' ? ['history', 'historyGame'].includes(page) : page === key) ? 'page' : undefined} onClick={() => navigate(key)}>{label}{key === 'home' && game?.status === 'running' && !game.trashedAt && <small>{game.quarters.at(-1)?.pausedAt != null ? '一時停止中' : '記録中'}</small>}</button>)}</nav>
    <div className={`sync-bar ${sync.error ? 'problem' : ''}`} role="status">
      <span>{repo.mode === 'local' ? (sync.pending ? 'この端末に保存中…' : 'この端末だけに保存') : sync.error ? '保存を確認してください' : sync.pending ? `未送信 ${sync.pending}件${online ? '・送信中' : '・通信なし'}` : !online ? '通信なし・端末の記録を表示' : sync.fromCache ? '保存先を確認中…' : 'すべて保存済み'}</span>
      {repo.mode === 'local' && <span className="tag">試用</span>}
    </div>
    {updateAvailable && <aside className="update panel"><p>新しい版があります。{recording ? '試合を終了してから更新できます。' : sync.pending ? '保存が終わるまでお待ちください。' : '入力途中の内容を保存し、「試合の記録」に戻って更新してください。試合準備中の場合は作成するか準備を取り消してください。'}</p><button disabled={recording || sync.pending > 0 || !!sync.error || busy || newMounted || playerDirty || teamDirty} onClick={applyUpdate}>最新版に更新</button></aside>}
    {sync.error && <div className="error" role="alert">{sync.error}<p className="small">未送信の入力はこの端末に残っています。「認証と保存を再確認」を押してください。参加し直す場合は、未送信が0件になってから「チーム情報」の「退出」を使います。ブラウザのデータは消さないでください。</p>{'retry' in repo && <button onClick={() => void run(async () => { await (repo as Repository & { retry: () => Promise<void> | void }).retry(); })}>認証と保存を再確認</button>}</div>}
    {error && <div className="error" role="alert">{error}<button className="quiet" onClick={() => setError('')}>閉じる</button></div>}
    {deletedNotice && !(showTrash && page === 'history') && <aside className="panel" role="status"><p>{deletedNotice.date} {deletedNotice.opponent} をゴミ箱へ移しました。</p><button disabled={busy || !canManage} onClick={() => void run(async () => { await repo.deleteGame(deletedNotice.id, true); setDeletedNotice(null); })}>元に戻す</button><button className="quiet" onClick={() => setDeletedNotice(null)}>閉じる</button></aside>}
    {deleteTarget && <Dialog title="ゴミ箱へ移しますか？" onClose={() => { if (!busy) setDeleteTarget(null); }}><p>{deleteTarget.date} ／ {deleteTarget.opponent}</p><p>チーム全員の試合一覧から消えます。得点やプレーも含めて30日以内なら元に戻せます。</p>{deleteTarget.status === 'running' && <p>記録中の試合です。時計を止め、記録操作を終了します。</p>}<button disabled={busy || !canManage} onClick={() => void run(async () => { await repo.deleteGame(deleteTarget.id); setDeletedNotice(deleteTarget); setDeleteTarget(null); })}>{busy ? '移動中…' : 'ゴミ箱へ移す'}</button><button disabled={busy} onClick={() => setDeleteTarget(null)}>キャンセル</button></Dialog>}
    <main>
      {(page === 'home' || page === 'history') && <>
        <div className="page-title"><h1>{page === 'history' ? (showTrash ? 'ゴミ箱' : '過去の記録') : '試合の記録'}</h1><p className="muted">{page === 'history' ? (showTrash ? '移動から30日以内なら元に戻せます。期限後に自動削除されます。' : '終了した試合を確認できます。') : '新しい試合を始めるか、続きから記録します。'}</p></div>
        {page === 'home' && newMounted && <button className="full" onClick={() => navigate('new')}>入力途中の試合準備に戻る</button>}
        {page === 'home' && newMounted && <button className="quiet full" onClick={() => { if (window.confirm('入力途中の試合準備を取り消しますか？')) { setNewMounted(false); setTemplate(undefined); } }}>入力途中の試合準備を取り消す</button>}
        {page === 'home' && <div className="home-actions"><button className="primary" onClick={() => prepareGame()}>新しい試合</button><button onClick={() => { setPlayerOrigin('home'); navigate('players'); }}>選手登録</button></div>}
        <h2 className="section-title">{showTrash && page === 'history' ? 'ゴミ箱の試合' : '試合一覧'}</h2>{page === 'history' && <><label>試合を探す<input value={search} onChange={e => setSearch(e.target.value)} placeholder="対戦相手・日付" /></label><button className="quiet small" onClick={() => setShowTrash(!showTrash)}>{showTrash ? '試合一覧に戻る' : 'ゴミ箱を見る'}</button></>}
        {!(showTrash && page === 'history' ? trashLoaded : loaded) ? <p role="status">読み込み中…</p> : !listedGames.length ? <section className="empty"><p>{page === 'history' ? '該当する試合がありません' : '準備中・記録中の試合はありません'}</p></section> : <div className="game-list">{listedGames.map(g => <div key={g.id}><button className="game-card" onClick={() => page === 'history' ? openHistory(g.id) : openGame(g.id)}>
          <span className="row"><span className="muted small">{g.date.replaceAll('-', '/')}</span><span className={`tag ${g.status === 'running' ? 'active' : ''}`}>{g.status === 'running' && g.quarters.at(-1)?.pausedAt != null ? '一時停止中' : statusLabels[g.status]}</span></span>
          <span className="opponent">対 {g.opponent}</span><span className="muted small">{g.roster.length}人登録{g.quarters.length ? ` / ${periodLabel(g, g.quarters.length)}` : ''}　{g.trashedAt ? '記録を見る →' : g.status === 'running' || g.status === 'interval' ? '記録を再開 →' : g.status === 'ready' ? '試合開始の画面へ →' : '結果を見る →'}</span>
        </button>{g.trashedAt ? <><p className="small">{g.expiresAt! <= Date.now() ? '復元期限を過ぎています。自動削除を待っています。' : `${new Date(g.expiresAt!).toLocaleString('ja-JP')}まで戻せます`}</p><button disabled={busy || !canManage || g.expiresAt! <= Date.now()} onClick={() => void run(async () => { await repo.deleteGame(g.id, true); setDeletedNotice(null); })}>元に戻す</button></> : <button className="quiet small" disabled={busy || !canManage} onClick={() => setDeleteTarget(g)}>ゴミ箱へ</button>}</div>)}</div>}
        {showTrash && page === 'history' ? trash.length >= trashLimit && <button className="full" onClick={() => setTrashLimit(n => n + 30)}>ゴミ箱の試合をもっと見る</button> : games.length >= limit && <button className="full" onClick={() => setLimit(value => value + 30)}>前の試合をもっと見る</button>}
      </>}
      <div hidden={page !== 'players'}><Players onDirty={setPlayerDirty} players={players} repo={repo} run={run} busy={busy} back={() => navigate(playerOrigin)} origin={playerOrigin} sync={sync} /></div>
      {newMounted && <div hidden={page !== 'new'}><NewGame key={`${template?.id ?? 'new'}:${newVersion}`} template={template} teamName={team.name ?? ""} players={players} busy={busy} back={() => navigate('home')} register={() => { setPlayerOrigin('new'); navigate('players'); }} create={g => { void run(async () => { await repo.saveGame(g); setNewMounted(false); openGame(g.id); }); }} /></div>}
      <div hidden={page !== 'help'}><Help /></div>
      {teamMounted && <div hidden={page !== 'team'}><button onClick={() => { setPlayerOrigin('team'); navigate('players'); }}>選手登録・変更</button><button className="quiet" onClick={() => setConfirmLogout(true)}>退出</button><TeamInfo onDirty={setTeamDirty} team={team} busy={busy} save={name => { void run(() => repo.saveTeamName(name)); }} /></div>}
      <div hidden={page !== 'game'}>{(game ? <GameScreen key={`${game.id}:${game.generation ?? 0}`} game={game} onDeleted={() => afterDeletion(game.id, game.status === 'finished')} canDelete={sync.pending === 0 && !sync.error && (repo.mode === 'local' || (online && !sync.fromCache))} players={players} games={games} prepareNext={() => prepareGame(game)} teamName={team.name ?? ""} pending={sync.pending > 0} repo={repo} now={Date.now()} busy={busy} run={run} back={() => { if (game.status === 'finished') { localStorage.removeItem(viewKey); } navigate(game.status === 'finished' ? 'history' : 'home'); }} /> : <section className="panel stack"><p>{loaded ? 'この試合は削除されたか、まだ読み込まれていません。試合一覧を確認してください。' : '試合を読み込み中…'}</p><button onClick={() => navigate('home')}>試合一覧へ</button></section>)}</div>
      {page === 'historyGame' && !historyGame && <section className="panel"><p>{historyLoaded ? 'この試合は削除されたか、参照できません。' : '試合を読み込み中…'}</p><button onClick={() => navigate('history')}>過去の記録に戻る</button></section>}
      {historyGame && <div hidden={page !== 'historyGame'}><GameScreen key={`history:${historyGame.id}:${historyGame.generation ?? 0}`} backLabel="過去の記録に戻る" game={historyGame} onDeleted={() => afterDeletion(historyGame.id, historyGame.status === 'finished')} canDelete={sync.pending === 0 && !sync.error && (repo.mode === 'local' || (online && !sync.fromCache))} players={players} games={games} prepareNext={() => prepareGame(historyGame)} teamName={team.name ?? ''} pending={sync.pending > 0} repo={repo} now={Date.now()} busy={busy} run={run} back={() => { setHistoryId(null); navigate('history'); if (historyGame.trashedAt) setShowTrash(true); }} /></div>}
    </main>

    <footer>バスケの記録<span>見る、押す、残す。</span></footer>
    {confirmLogout && <Dialog title="退出しますか？" onClose={() => setConfirmLogout(false)}>
      <p>{sync.pending ? '未送信の記録があります。保存が終わってから退出してください。' : repo.mode === 'local' ? 'この端末に保存した試用データは残ります。' : playerDirty || teamDirty || newMounted ? '入力途中で未保存の内容があります。退出すると入力途中の内容は失われます。登録・作成済みのデータは残ります。' : 'この端末からログアウトします。'}</p>
      <div className="stack"><button disabled={sync.pending > 0 || busy} onClick={() => { void run(onLogout); }}>退出する</button><button className="quiet" onClick={() => setConfirmLogout(false)}>戻る</button></div>
    </Dialog>}
  </div>;
}

type Runner = (action: () => Promise<void>) => Promise<void>;
function Back({ onClick, label = "試合一覧" }: { onClick: () => void; label?: string }) { return <button className="back quiet" onClick={onClick}>← {label}</button>; }

function Players({ players, repo, run, busy, back, origin, sync, onDirty }: { onDirty: (dirty: boolean) => void; players: Player[]; repo: Repository; run: Runner; busy: boolean; back: () => void; origin: 'home' | 'new' | 'team'; sync: SyncState }) {
  const [editing, setEditing] = useState<Player | null>(null);
  const [saved, setSaved] = useState('');
  const [name, setName] = useState(''); const [number, setNumber] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => onDirty(Boolean(name || number)), [name, number, onDirty]);
  function reset() { setEditing(null); setName(''); setNumber(''); }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const player = { id: editing?.id ?? crypto.randomUUID(), name: name.trim(), number: number.trim(), active: true };
      validatePlayer(player, players); await repo.savePlayer(player); setSaved(`${player.number} ${player.name}を登録しました`); reset(); input.current?.focus();
    });
  }
  function finish() { if ((name || number) && !window.confirm('入力中の選手はまだ登録されていません。移動しますか？')) return; back(); }
  return <><Back onClick={finish} label={origin === "new" ? "試合準備" : origin === "team" ? "チーム情報" : "試合一覧"} /><h1>選手登録</h1><p className="muted">次の試合でも、この名簿から選べます。</p>
    <form className="panel stack" onSubmit={submit}>
      <h2>{editing ? '選手を変更' : '選手を追加'}</h2>
      <div className="player-fields"><label>背番号<input ref={input} inputMode="numeric" maxLength={2} value={number} onChange={e => setNumber(e.target.value)} required placeholder="7" /></label><label>名前<input maxLength={40} value={name} onChange={e => setName(e.target.value)} required placeholder="田中" /></label></div>
      <button className="primary" disabled={busy}>{editing ? '変更を保存' : '選手を追加'}</button>{editing && <button type="button" className="quiet" onClick={reset}>変更をやめる</button>}
    </form>
    {saved && <p role="status">{saved} {sync.pending ? '（端末に保存済み・共有待ち）' : '（保存済み）'}</p>}
    <button className="full" type="button" onClick={finish}>{origin === "new" ? "登録を完了して試合準備へ" : (origin === "team" ? "登録を完了してチーム情報へ" : "登録を完了して試合一覧へ")}</button>
    <h2 className="section-title">登録選手（{players.filter(p => p.active).length}人）</h2>
    {!players.length && <p className="empty">背番号と名前を登録してください。</p>}
    <div className="roster-list">{sortPlayers(players).map(p => <div key={p.id} className={`roster-row ${!p.active ? 'inactive' : ''}`}>
      <span className="number">{p.number}</span><span className="player-name">{p.name}{!p.active && <small>非表示</small>}</span>
      {p.active && <button className="small" onClick={() => { setEditing(p); setName(p.name); setNumber(p.number); input.current?.focus(); }}>変更</button>}
      <button className="quiet small" disabled={busy} onClick={() => { void run(async () => { const next = { ...p, active: !p.active }; validatePlayer(next, players); await repo.savePlayer(next); }); }}>{p.active ? '非表示' : '戻す'}</button>
    </div>)}</div>
    <p className="muted small">名簿を変更しても、過去の試合の名前・背番号は変わりません。</p>
  </>;
}

function NewGame({ players, busy, back, register, create, teamName, template }: { template?: Game; teamName: string; players: Player[]; busy: boolean; back: () => void; register: () => void; create: (game: Game) => void }) {
  const active = sortPlayers(players.filter(p => p.active));
  const [selected, setSelected] = useState<string[]>(template ? [...template.roster.map(p => p.id), ...(template.opponentRoster ?? []).map(p => p.memberId)] : active.map(p => p.id));
  const [other, setOther] = useState<string[]>(template?.opponentRoster?.map(p => p.memberId) ?? []);
  const [kind, setKind] = useState<'external' | 'scrimmage'>(template?.kind ?? 'external');
  const [recordMode, setRecordMode] = useState<'scores' | 'own' | 'both'>(template?.recordMode ?? 'both');
  const [sheet, setSheet] = useState(() => newSheet(teamName));
  const [opponent, setOpponent] = useState(template?.kind === 'scrimmage' ? template.opponent : ''); const [date, setDate] = useState(localDate());
  const [validation, setValidation] = useState('');
  const ownGroup = template?.sheet?.own.name || 'チーム１';
  const otherGroup = opponent.trim() || 'チーム２';
  const known = useRef(new Set(active.map(p => p.id)));
  useEffect(() => { const added = active.filter(p => !known.current.has(p.id)); if (added.length) setSelected(current => [...current, ...added.map(p => p.id)]); active.forEach(p => known.current.add(p.id)); }, [players]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const own = active.filter(p => selected.includes(p.id) && (kind !== 'scrimmage' || !other.includes(p.id)));
    const opponents = active.filter(p => selected.includes(p.id) && other.includes(p.id));
    const name = kind === 'scrimmage' ? (opponent.trim() || 'チーム２') : opponent.trim();
    if (!name || !own.length || (kind === 'scrimmage' && !opponents.length)) { setValidation(!own.length ? (kind === 'scrimmage' ? `${ownGroup}に1人以上選んでください。` : 'ベンチ入り選手を1人以上選んでください。') : !opponents.length && kind === 'scrimmage' ? `${otherGroup}に1人以上選んでください。` : '対戦相手を入力してください。'); return; }
    const now = Date.now();
    create({ id: crypto.randomUUID(), opponent: name, date, roster: own.map(({ id, name, number }) => ({ id, name, number })), ...(kind === 'scrimmage' ? { kind, recordMode, sessionId: template?.sessionId ?? crypto.randomUUID(), opponentRoster: opponents.map(p => ({ id: p.number, number: p.number, name: p.name, memberId: p.id })) } : {}), status: 'ready', quarters: [], opponentTracking: true, sheet: { ...sheet, own: { ...sheet.own, name: kind === 'scrimmage' ? (template?.sheet?.own.name || 'チーム１') : sheet.own.name || teamName }, opponent: { ...sheet.opponent, name } }, createdAt: now, updatedAt: now });
  }
  return <><Back onClick={back} label="試合の記録に戻る" /><h1>{template ? "次の試合を準備" : "新しい試合"}</h1>{template && <p>前の試合の選手を引き継いでいます。相手や組分けを確認してから作成してください。</p>}<form onSubmit={submit} onChange={() => setValidation('')} className="stack">
    <div className="result-tabs"><button type="button" aria-pressed={kind === 'external'} onClick={() => setKind('external')}>練習試合・大会</button><button type="button" aria-pressed={kind === 'scrimmage'} onClick={() => setKind('scrimmage')}>部内ゲーム</button></div>
    <section className="panel stack"><label>試合日<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label><label>{kind === 'scrimmage' ? '相手組の名前（空欄ならチーム２）' : '対戦相手'}<input value={opponent} onChange={e => setOpponent(e.target.value)} maxLength={80} required={kind === 'external'} placeholder={kind === 'scrimmage' ? 'チーム２' : '○○中学校'} /></label>{template && kind === 'external' && <button type="button" onClick={() => setOpponent(template.opponent)}>前と同じ相手にする（{template.opponent}）</button>}</section>
    {kind === 'scrimmage' && <label>記録する範囲<select value={recordMode} onChange={e => setRecordMode(e.target.value as typeof recordMode)}><option value="scores">両組の得点のみ</option><option value="own">{ownGroup}の個人成績と両組の得点</option><option value="both">両組の個人成績と得点</option></select></label>}
    <section className="panel"><div className="row"><h2>{kind === 'scrimmage' ? '参加選手と組分け' : 'ベンチ入り選手'}</h2><span className="muted small">{selected.filter(id => active.some(p => p.id === id)).length}人選択</span></div>
      {!active.length ? <div className="stack"><p>先に選手を登録してください。</p><button type="button" onClick={register}>選手登録へ</button></div> : <><div className="row selection-tools"><button type="button" className="quiet small" onClick={() => setSelected(active.map(p => p.id))}>全員選択</button><button type="button" className="quiet small" onClick={() => setSelected([])}>選択を外す</button></div><div className="check-list">{active.map(p => <div className="row" key={p.id}><label className="check-player"><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /><strong>{p.number}</strong><span>{p.name}</span></label>{kind === 'scrimmage' && selected.includes(p.id) && <label className="inline-check"><input type="checkbox" aria-label={`${p.number} ${p.name}を${otherGroup}にする`} checked={other.includes(p.id)} onChange={e => setOther(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} />{otherGroup}</label>}</div>)}</div>{kind === 'scrimmage' && <p className="small muted">{ownGroup} {active.filter(p => selected.includes(p.id) && !other.includes(p.id)).length}人 ／ {otherGroup} {active.filter(p => selected.includes(p.id) && other.includes(p.id)).length}人。参加する選手にチェックし、{otherGroup}に入る選手は「{otherGroup}」にもチェックしてください。両チームに1人以上必要です。</p>}</>}
    </section>
    <details className="panel"><summary>スコアシート情報（後から補足できます）</summary><SheetFields value={sheet} change={setSheet} /></details>
    <button className="primary" disabled={busy}>この内容で試合を作成</button>{validation && <p className="error" role="alert">{validation}</p>}
  </form></>;
}

function readDraft(gameId: string, scope: string): Draft | null {
  try { const value = JSON.parse(sessionStorage.getItem(`${draftKey}:${scope}:${gameId}`) ?? sessionStorage.getItem(`${draftKey}:${scope}`) ?? 'null') as Draft | null; return value?.gameId === gameId ? value : null; } catch { return null; }
}
function GameScreen({ game, players, games, prepareNext, repo, now, busy, run, back, teamName, pending, backLabel, onDeleted, canDelete }: { onDeleted: () => void; canDelete: boolean; backLabel?: string; game: Game; players: Player[]; games: Game[]; prepareNext: () => void; teamName: string; pending: boolean; repo: Repository; now: number; busy: boolean; run: Runner; back: () => void }) {
  const storedGenerationKey = `basketball-draft-generation:${repo.scope}:${game.id}`;
  if (Number(sessionStorage.getItem(storedGenerationKey) ?? 0) !== (game.generation ?? 0)) {
    sessionStorage.removeItem(`${draftKey}:${repo.scope}:${game.id}`);
    sessionStorage.removeItem(`${draftKey}:opponent:${repo.scope}:${game.id}`);
    for (const action of ['foul', 'timeout', 'entry']) sessionStorage.removeItem(`basketball-to-draft:${game.id}:${action}`);
  }
  sessionStorage.setItem(storedGenerationKey, String(game.generation ?? 0));
  const [plays, setPlays] = useState<Play[]>([]);
  const [draft, setDraft] = useState<Draft | null>(() => readDraft(game.id, repo.scope));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [recordSide, setRecordSide] = useState<'own' | 'opponent'>('own');
  const [editing, setEditing] = useState<Play | null>(null);
  const [confirm, setConfirm] = useState<'quarter' | 'finish' | 'undoFinish' | null>(null);
  const opponentKey = `${draftKey}:opponent:${repo.scope}:${game.id}`;
  const restoredOpponent = useRef<null | { draft: Draft; number: string; adding: boolean }>(null);
  if (!restoredOpponent.current) { try { restoredOpponent.current = JSON.parse(sessionStorage.getItem(opponentKey) ?? 'null'); } catch { /* ignore invalid local drafts */ } }
  const [opponentDraft, setOpponentDraft] = useState<Draft | null>(() => restoredOpponent.current?.draft ?? null);
  const [opponentNumber, setOpponentNumber] = useState(() => restoredOpponent.current?.number ?? '');
  const [addingNumber, setAddingNumber] = useState(() => restoredOpponent.current?.adding ?? false);
  useEffect(() => { if (opponentDraft) sessionStorage.setItem(opponentKey, JSON.stringify({ draft: opponentDraft, number: opponentNumber, adding: addingNumber })); else sessionStorage.removeItem(opponentKey); }, [opponentKey, opponentDraft, opponentNumber, addingNumber]);
  useEffect(() => { if (opponentDraft && plays.some(p => p.id === opponentDraft.id)) { setOpponentDraft(null); setOpponentNumber(''); setAddingNumber(false); } }, [plays, opponentDraft]);
  const [showHistory, setShowHistory] = useState(false);
  const [resultTab, setResultTab] = useState<'sheet' | 'stats'>('stats');
  const [previewStats, setPreviewStats] = useState(false);
  const [cancelledOpen, setCancelledOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [toAction, setToAction] = useState<ToAction | null>(() => (['foul', 'timeout', 'entry'] as const).find(a => sessionStorage.getItem(`basketball-to-draft:${game.id}:${a}`)) ?? null);
  const [retro, setRetro] = useState(false);
  const [playsLoaded, setPlaysLoaded] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [wakeError, setWakeError] = useState('');
  useEffect(() => {
    if (!wakeEnabled || game.trashedAt || game.status !== 'running') return;
    let sentinel: WakeLockSentinel | null = null, active = true;
    const request = async () => { if (!active || document.visibilityState !== 'visible') return; try { if (!('wakeLock' in navigator)) throw new Error('この端末では画面の自動消灯を制御できません。'); sentinel = await navigator.wakeLock.request('screen'); if (!active) await sentinel.release(); } catch { if (active) { setWakeError('画面の自動消灯を抑えられませんでした。端末の設定を確認してください。'); setWakeEnabled(false); } } };
    void request(); document.addEventListener('visibilitychange', request);
    return () => { active = false; document.removeEventListener('visibilitychange', request); void sentinel?.release(); };
  }, [wakeEnabled, game.status, game.trashedAt]);
  useEffect(() => {
    if (!toAction || !playsLoaded) return;
    const key = `basketball-to-draft:${game.id}:${toAction}`;
    try { const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null'); if (saved?.value?.id && plays.some(p => p.id === saved.value.id)) { sessionStorage.removeItem(key); setToAction(null); } } catch { /* ignore invalid draft */ }
  }, [plays, playsLoaded, toAction, game.id]);
  const [showAll, setShowAll] = useState(game.status === 'finished');
  const captureLock = useRef(false);
  useEffect(() => repo.watchPlays(game.id, value => { setPlays(value); setPlaysLoaded(true); }), [repo, game.id]);
  useEffect(() => {
    if (draft) sessionStorage.setItem(`${draftKey}:${repo.scope}:${game.id}`, JSON.stringify(draft)); else sessionStorage.removeItem(`${draftKey}:${repo.scope}:${game.id}`);
  }, [draft, repo.scope, game.id]);
  const q = game.quarters.at(-1);
  const visible = sortPlays(plays.filter(p => !p.cancelled));
  const last = [...visible].sort((a, b) => b.createdAt - a.createdAt).at(0);
  const inconsistentClock = !!q && q.endedAt === null && now < q.startedAt;
  const alreadySaved = draft && plays.some(p => p.id === draft.id);
  useEffect(() => { if (alreadySaved) setDraft(null); }, [alreadySaved]);

  function command(action: Parameters<typeof transition>[1]) {
    void run(async () => { if (action === 'finish' && visible.some(p => p.quarter > game.quarters.length)) throw new Error('次のQに記録したファウルがあります。Qを開始するか、記録を訂正・取り消してから終了してください。'); let updated = transition(game, action, Date.now()); if (game.kind === 'scrimmage' && action === 'endQuarter') updated = transition(updated, 'finish', Date.now()); await repo.saveGame(updated); setConfirm(null); });
  }
  function capture(action: Action) {
    if (draft || busy || captureLock.current) return;
    captureLock.current = true;
    void run(async () => { setDraft({ ...beginPlay(game, action, Date.now()), ...(recordSide === 'opponent' ? { side: 'opponent' as const } : {}) }); }).finally(() => { captureLock.current = false; });
  }
  function save(playerId: string, shot: Shot | null) {
    if (!draft) return;
    void run(async () => { await repo.savePlay(appendPlay(plays, completePlay(game, draft, playerId, shot, Date.now()))); setDraft(null); });
  }
  const opponentNumbers = sheetFor(game, plays).opponent.players.map(p => p.number);
  const draftRoster = draft?.side === 'opponent' ? game.opponentRoster ?? [] : game.roster;
  async function movePlay(play: Play, delta: number) {
    const list = visible.filter(p => p.quarter === play.quarter); const i = list.findIndex(p => p.id === play.id);
    if (i + delta < 0 || i + delta >= list.length) return;
    [list[i], list[i + delta]] = [list[i + delta], list[i]];
    await run(async () => { await repo.savePlays(list.map((p, j) => ({ ...p, order: (j + 1) * 1000, updatedAt: Date.now() }))); });
  }
  function saveOpponent(shot: Shot) {
    if (!opponentDraft || !(opponentNumber === '@unknown' || /^(?:[0-9]|[1-9][0-9]|00)$/.test(opponentNumber))) return;
    void run(async () => { await repo.savePlay(appendPlay(plays, { ...opponentDraft, playerId: opponentNumber, side: 'opponent', shot, cancelled: false, updatedAt: Date.now() })); setOpponentDraft(null); setOpponentNumber(''); setAddingNumber(false); });
  }
  const displayPlays = showAll ? visible : visible.slice(-5).reverse();
  if (game.trashedAt) return <><Back onClick={back} label="一覧へ戻る" /><h1>{game.date} 対 {game.opponent}</h1><p role="status">この試合はゴミ箱にあります。編集するには「過去の記録」の「ゴミ箱を見る」から元に戻してください。</p>{game.expiresAt! <= now ? <p>復元期限を過ぎています。自動削除を待っています。</p> : <><p>{new Date(game.expiresAt!).toLocaleString('ja-JP')}まで戻せます。</p>{!playsLoaded ? <p>記録を読み込み中…</p> : <><Results game={game} plays={plays} /><details><summary>スコアシート・印刷を見る</summary><SheetOutput game={game} plays={plays} pending={pending} /></details></>}</>}</>;
  return <><Back onClick={back} label={backLabel ?? (game.status === 'finished' ? '過去の記録に戻る' : '試合の記録に戻る')} />
    <div className="game-heading"><p className="muted small">{game.date.replaceAll('-', '/')} <span className="tag">{statusLabels[game.status]}</span></p><h1>対 {game.opponent}</h1></div>
    <p className="score">{game.kind === 'scrimmage' ? (game.sheet?.own.name || '白組') : '自チーム'} {playsLoaded ? score(visible.filter(p => p.side !== 'opponent')) : '読み込み中'} − {!playsLoaded ? '読み込み中' : game.opponentTracking || plays.some(p => p.side === 'opponent') ? score(visible.filter(p => p.side === 'opponent')) : '未記録'} {game.opponent}</p><p className="small muted center">{game.sheet && (!game.sheet.own.checked.score || !game.sheet.opponent.checked.score) ? '得点は記録分・未確認' : ''}</p>
    {game.status === 'finished' && <section className="finished-actions"><button className="primary full" disabled={busy} onClick={prepareNext}>次の試合を準備</button></section>}
    {game.status !== 'finished' && <button className="quiet full sheet-settings-trigger" onClick={() => setSettings(true)}>スコアシート情報</button>}
    {game.status === 'finished' && <div className="result-tabs"><button aria-pressed={resultTab === 'sheet' && !showHistory} onClick={() => { setResultTab('sheet'); setShowHistory(false); }}>スコアシート・PDF</button><button aria-pressed={resultTab === 'stats' && !showHistory} onClick={() => { setResultTab('stats'); setShowHistory(false); }}>選手別成績</button></div>}
    {game.status === 'finished' && !showHistory && (!playsLoaded ? <p>記録を読み込み中…</p> : resultTab === 'sheet' ? <><button className="full" onClick={() => setSettings(true)}>スコアシートの情報を入力・確認</button><SheetOutput game={game} plays={plays} pending={pending} /></> : <Results game={game} plays={plays} busy={busy} onCheck={recordChecked => { void run(() => repo.saveGame({ ...game, recordChecked, updatedAt: Date.now() })); }} />)}
    {game.status !== 'finished' && <section className={`clock panel ${game.status === 'running' ? 'clock-running' : ''}`} aria-label="クォーターと経過時間">
      <div className="clock-top"><strong>{q ? periodLabel(game, q.number) : '試合開始前'}</strong><span className="muted small">{q?.pausedAt != null && game.status === 'running' ? '一時停止中' : game.status === 'interval' ? (game.kind === 'scrimmage' ? '終了' : 'Q終了') : '開始から'}</span></div>
      <div className="time" role="timer" aria-live="off">{formatTime(elapsed(q, now))}</div>
      {game.status === 'ready' && <button className="primary full" disabled={busy} onClick={() => command('start')}>試合開始</button>}
      {game.status === 'running' && <button className="full" disabled={busy || inconsistentClock} onClick={() => command(q?.pausedAt != null ? 'resume' : 'pause')}>{q?.pausedAt != null ? '再開' : '一時停止'}</button>}
      {game.status === 'interval' && <div className="stack"><button className="primary" disabled={busy} onClick={() => command('next')}>{periodLabel(game, (q?.number ?? 0) + 1)}を開始</button><button disabled={busy} onClick={() => setConfirm('finish')}>試合全体を終了</button><button className="quiet small" disabled={busy} onClick={() => command('undoEnd')}>{game.kind === 'scrimmage' ? 'この区切りの終了を取り消す' : 'Q終了を取り消す'}</button></div>}
    </section>}
    {inconsistentClock && <p className="error" role="alert">端末の時刻がQ開始時刻より前になっています。端末の時刻を確認してください。</p>}
    {game.status !== 'finished' && <>
      {game.kind === 'scrimmage' && <p role="status">記録先：{recordSide === 'own' ? game.sheet?.own.name || 'チーム１' : game.opponent}。{game.recordMode === 'scores' || (game.recordMode === 'own' && recordSide === 'opponent') ? 'このチームは得点だけ記録します。' : ''}</p>}
      {game.kind === 'scrimmage' && <div className="result-tabs"><button aria-pressed={recordSide === 'own'} onClick={() => setRecordSide('own')}>{game.sheet?.own.name || "白組"}を記録</button><button aria-pressed={recordSide === 'opponent'} onClick={() => setRecordSide('opponent')}>{game.opponent}を記録</button></div>}
      <div className="action-grid">{(Object.keys(actionLabels) as Action[]).map(action => <button key={action} className={`action action-${action}`} disabled={game.status !== 'running' || busy || inconsistentClock || (game.kind === 'scrimmage' && action !== 'made' && (game.recordMode === 'scores' || (game.recordMode === 'own' && recordSide === 'opponent')))} onClick={() => capture(action)}>{actionLabels[action]}</button>)}</div>
      {game.kind !== 'scrimmage' && <button className="full opponent-action" disabled={game.status !== 'running' || busy || inconsistentClock} onClick={() => { setOpponentDraft(beginPlay(game, 'made', Date.now())); setOpponentNumber(''); setAddingNumber(false); }}>相手のシュート決</button>}
      <div className="to-actions">{(['foul', 'timeout', 'entry'] as const).map(a => <button key={a} disabled={busy || !playsLoaded || (a !== 'foul' && game.status !== 'running')} onClick={() => setToAction(a)}>{a === 'foul' ? 'ファウル' : a === 'timeout' ? 'タイムアウト' : 'Player in'}</button>)}</div>
      {game.status === 'ready' && <p className="muted small center">試合開始後に記録できます。</p>}
      <section className="last-play panel"><h2>直前の記録</h2>{last ? <><PlayLine play={last} game={game} /><button className="quiet small" disabled={busy} onClick={() => { void run(() => repo.savePlay({ ...last, cancelled: true, updatedAt: Date.now() })); }}>この記録を取り消す</button></> : <p className="muted">まだ記録がありません。</p>}</section>
      <div className="quarter-actions">{game.status === 'running' && <button disabled={busy || !!draft || !!opponentDraft || !!toAction || inconsistentClock} onClick={() => setConfirm('quarter')}>{game.kind === 'scrimmage' ? 'このゲームを終了' : 'このQを終了'}</button>}</div>
    </>}

    {game.kind === 'scrimmage' && game.sessionId && <><button className="quiet full" onClick={() => setDailyOpen(!dailyOpen)}>{dailyOpen ? 'この連続ゲームの合計を閉じる' : 'この連続ゲームの合計を見る'}</button>{dailyOpen && <DailyResults game={game} games={games} repo={repo} />}</>}

    {game.status !== 'finished' && game.quarters.length > 0 && <><button className="full" onClick={() => setPreviewStats(!previewStats)}>{previewStats ? '途中成績を閉じる' : '途中成績を見る'}</button>{previewStats && <Results game={game} plays={plays} />}</>}
    {game.status === 'finished' && <button className="full" onClick={() => setShowHistory(!showHistory)}>{showHistory ? '記録一覧を閉じる' : '記録を確認・訂正する'}</button>}
    {(game.status !== 'finished' || showHistory) && <section className="history"><button className="full" disabled={busy || !game.quarters.length} onClick={() => setRetro(true)}>記録漏れを追加</button><div className="row"><h2>記録一覧 <span className="muted">{visible.length}件・{showAll ? '古い順' : '新しい順'}</span></h2>{visible.length > 5 && <button className="quiet small" onClick={() => setShowAll(!showAll)}>{showAll ? '最近の5件' : 'すべて見る'}</button>}</div>
      {!visible.length ? <p className="empty">プレーを記録すると、ここに表示されます。</p> : <ol className="play-list">{displayPlays.map(play => <li key={play.id}><PlayLine play={play} game={game} /><div className="history-actions"><button className="quiet small" onClick={() => setEditing(play)}>訂正</button>{showHistory && <><button className="quiet small" disabled={busy || visible.filter(p => p.quarter === play.quarter)[0]?.id === play.id} onClick={() => { void movePlay(play, -1); }}>記録順を1つ早く</button><button className="quiet small" disabled={busy || visible.filter(p => p.quarter === play.quarter).at(-1)?.id === play.id} onClick={() => { void movePlay(play, 1); }}>記録順を1つ遅く</button></>}</div></li>)}</ol>}
    </section>}
    {(game.status !== 'finished' || showHistory) && plays.some(p => p.cancelled) && <section className="panel"><button className="quiet" onClick={() => setCancelledOpen(!cancelledOpen)}>{cancelledOpen ? '取消済みを閉じる' : '取消済みを確認・復元'}</button>{cancelledOpen && <ul>{sortPlays(plays.filter(p => p.cancelled)).map(p => <li key={p.id}><PlayLine play={p} game={game} /><button disabled={busy} onClick={() => { void run(() => repo.savePlay({ ...p, cancelled: false, updatedAt: Date.now() })); }}>この記録を元に戻す</button></li>)}</ul>}</section>}
    {game.status === 'finished' && <details className="panel"><summary>その他の操作</summary><button className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>この試合をゴミ箱へ</button><details className="panel"><summary>試合終了を取り消す</summary><p>時計を止めた状態で試合に戻します。得点の訂正は終了したまま行えます。</p><button disabled={busy} onClick={() => setConfirm('undoFinish')}>終了を取り消して試合に戻る</button></details><button onClick={() => setRosterOpen(true)}>この試合の選手を追加・訂正</button></details>}
    {game.status !== 'finished' && <button className="quiet full" onClick={() => setRosterOpen(true)}>この試合の選手を追加・訂正</button>}
    <details className="panel team-details"><summary>この試合の選手（{game.roster.length}人）</summary><button onClick={() => setSettings(true)}>スコアシート情報</button>{game.status === 'running' && <><button onClick={() => { setWakeError(''); setWakeEnabled(!wakeEnabled); }}>{wakeEnabled ? '画面の自動消灯を端末の設定に戻す' : '画面を消えにくくする'}</button>{wakeError && <p role="status">{wakeError}</p>}</>}<p>{sortPlayers(game.roster).map(p => `${p.number} ${p.name}`).join(' / ')}</p></details>
    {game.status !== 'finished' && <details className="panel"><summary>試合の管理</summary><button className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>この試合をゴミ箱へ</button></details>}
    {confirmDelete && <Dialog title="ゴミ箱へ移しますか？" onClose={() => { if (!busy) setConfirmDelete(false); }}>
      <p><strong>{game.date} ／ {game.kind === 'scrimmage' ? `${game.sheet?.own.name || 'チーム１'} 対 ` : ''}{game.opponent}</strong></p>
      <p>この試合を、得点・プレー・成績・スコアシートの記録と一緒にゴミ箱へ移します。チーム全員の一覧から消えます。30日以内ならゴミ箱から戻せます。登録選手の名簿や他の試合は残ります。</p>
      {game.status === 'running' && <p>記録中の試合です。時計を止めます。復元すると停止した状態から再開できます。</p>}
      {!canDelete && <p role="status">通信を確認し、「すべて保存済み」になってから操作してください。</p>}
      <div className="stack"><button className="danger" disabled={busy || !canDelete} onClick={() => { void run(async () => { await repo.deleteGame(game.id); onDeleted(); }); }}>{busy ? '移動中…' : 'ゴミ箱へ移す'}</button><button disabled={busy} onClick={() => setConfirmDelete(false)}>移動せず戻る</button></div>
    </Dialog>}
    {draft && !alreadySaved && <Dialog title={draft.playerId && isShot(draft.action) ? 'シュートの種類' : '選手を選ぶ'} onClose={() => setDraft(null)}>
      <div className="draft-summary"><strong>{actionLabels[draft.action]}</strong><span>{periodLabel(game, draft.quarter)}・{formatTime(draft.elapsedMs)}</span></div>
      <p className="muted small">この時刻で記録します。{game.status === 'running' && `現在 ${formatTime(elapsed(q, now))}`}</p>
      {game.status !== 'running' || draft.quarter !== q?.number ? <div className="error">Qの状態が変わっています。閉じてから記録し直してください。</div> : draft.playerId && isShot(draft.action) ? <div className="stack"><p className="selected-player">{draft.playerId === '@unknown' ? '選手不明' : `${draftRoster.find(p => p.id === draft.playerId)?.number ?? ''} ${draftRoster.find(p => p.id === draft.playerId)?.name ?? ''}`}</p>{(['2', '3', 'ft'] as Shot[]).map(shot => <button key={shot} className="shot-choice" disabled={busy} onClick={() => save(draft.playerId!, shot)}>{shot === 'ft' ? 'フリースロー' : `${shot}点`}</button>)}<button className="quiet" onClick={() => setDraft({ ...draft, playerId: undefined })}>選手を選び直す</button></div> : <div className="player-grid">{sortPlayers(draftRoster).map(p => <button key={p.id} disabled={busy} className="player-choice" onClick={() => { if (isShot(draft.action)) setDraft({ ...draft, playerId: p.id }); else save(p.id, null); }}><strong>{p.number}</strong><span>{p.name}</span></button>)}</div>}
      {!draft.playerId && draft.action === 'made' && game.status === 'running' && draft.quarter === q?.number && <button className="full unknown-player" disabled={busy} onClick={() => setDraft({ ...draft, playerId: '@unknown' })}>選手不明</button>}
      <button className="quiet full cancel" onClick={() => setDraft(null)}>記録せず戻る</button>
    </Dialog>}
    {opponentDraft && <Dialog title="相手のシュート決" onClose={() => { sessionStorage.removeItem(opponentKey); setOpponentDraft(null); }}><div className="stack">{opponentNumber ? <><p className="selected-player">{opponentNumber === '@unknown' ? '背番号不明' : `背番号 ${opponentNumber}`}</p>{(['2', '3', 'ft'] as Shot[]).map(shot => <button key={shot} disabled={busy} onClick={() => saveOpponent(shot)}>{shot === 'ft' ? 'フリースロー' : `${shot}点`}</button>)}<button onClick={() => setOpponentNumber('')}>背番号を選び直す</button></> : <><p>相手の背番号を選んでください。</p><button onClick={() => setOpponentNumber('@unknown')}>背番号不明</button><div className="player-grid">{opponentNumbers.map(n => <button key={n} onClick={() => setOpponentNumber(n)}>{n}</button>)}</div>{addingNumber ? <form onSubmit={e => { e.preventDefault(); const value = (new FormData(e.currentTarget).get('number') as string).trim(); if (/^(?:[0-9]|[1-9][0-9]|00)$/.test(value)) setOpponentNumber(value);  }}><label>背番号<input name="number" inputMode="numeric" pattern="([0-9]|[1-9][0-9]|00)" required maxLength={2} /></label><button>この背番号を使う</button></form> : <button onClick={() => setAddingNumber(true)}>背番号を追加</button>}</>}</div></Dialog>}
    {confirm === 'undoFinish' && <Dialog title="試合終了を取り消しますか？" onClose={() => setConfirm(null)}><p>時計を止めた状態で続きを記録する画面に戻ります。得点の訂正は終了したまま行えます。</p><button disabled={busy} onClick={() => command('undoFinish')}>終了を取り消して戻る</button><button onClick={() => setConfirm(null)}>取り消さず戻る</button></Dialog>}
    {confirm && confirm !== 'undoFinish' && <Dialog title={confirm === 'quarter' ? `${periodLabel(game, q?.number ?? 1)}を終了しますか？` : '試合を終了しますか？'} onClose={() => setConfirm(null)}><p>{confirm === 'quarter' ? (game.kind === 'scrimmage' ? 'このゲームを終了して、結果を表示します。' : '時計を止めて、Q間の休憩に入ります。') : '終了後も記録一覧の確認・訂正ができます。'}</p><div className="stack"><button className="primary" disabled={busy} onClick={() => command(confirm === 'quarter' ? 'endQuarter' : 'finish')}>{confirm === 'quarter' ? (game.kind === 'scrimmage' ? 'このゲームを終了する' : 'このQを終了する') : '試合全体を終了'}</button><button className="quiet" onClick={() => setConfirm(null)}>終了せず戻る</button></div></Dialog>}
    {rosterOpen && <MatchRoster game={game} players={players} busy={busy} close={() => setRosterOpen(false)} save={roster => { void run(async () => { const sheet = game.sheet ? structuredClone(game.sheet) : undefined; if (sheet) sheet.own.players = sheet.own.players.map(p => { const next = roster.find(r => r.id === p.id); return next ? { ...p, name: next.name, number: next.number } : p; }); await repo.saveGame({ ...game, roster, ...(sheet ? { sheet } : {}), updatedAt: Date.now() }); setRosterOpen(false); }); }} />}
    {settings && <SheetSettings game={game} plays={plays} teamName={teamName} busy={busy} close={() => setSettings(false)} save={sheet => { void run(async () => { await repo.saveGame({ ...game, sheet, updatedAt: Date.now() }); setSettings(false); }); }} />}
    {toAction && <ToEditor game={game} plays={plays} action={toAction} busy={busy} close={() => setToAction(null)} save={p => { void run(async () => { await repo.savePlay(appendPlay(plays, p)); sessionStorage.removeItem(`basketball-to-draft:${game.id}:${p.action}`); setToAction(null); }); }} />}
    {retro && <RetroPlay game={game} plays={plays} busy={busy} close={() => setRetro(false)} save={p => { void run(async () => { await repo.savePlays(p); setRetro(false); }); }} />}
    {editing && isToAction(editing.action) && <ToEditor game={game} plays={plays} initial={editing} action={editing.action} busy={busy} close={() => setEditing(null)} save={p => { void run(async () => { await repo.savePlay(p); setEditing(null); }); }} />}
    {editing && !isToAction(editing.action) && <EditPlay play={editing} game={game} busy={busy} close={() => setEditing(null)} save={play => { void run(async () => { await repo.savePlay(play); setEditing(null); }); }} />}
  </>;
}

function MatchRoster({ game, players, busy, close, save }: { game: Game; players: Player[]; busy: boolean; close: () => void; save: (roster: Game['roster']) => void }) {
  const [roster, setRoster] = useState(() => game.roster.map(p => ({ ...p })));
  const [error, setError] = useState('');
  const available = players.filter(p => p.active && !roster.some(r => r.id === p.id) && !game.opponentRoster?.some(r => r.memberId === p.id));
  return <Dialog title="この試合の選手" onClose={close}><form className="stack" onSubmit={e => { e.preventDefault(); if (roster.length > 40 || roster.some(p => !p.name.trim() || !/^(?:[0-9]|[1-9][0-9]|00)$/.test(p.number)) || new Set(roster.map(p => p.number)).size !== roster.length) { setError('名前と背番号（0〜99または00、重複なし）を確認してください。'); return; } save(roster); }}><p className="small muted">この試合だけの名前・背番号を訂正できます。他の試合は変わりません。</p>{roster.map((p, i) => <fieldset key={p.id} className="sheet-player"><legend>{p.name}</legend><label>背番号<input maxLength={2} inputMode="numeric" value={p.number} onChange={e => setRoster(roster.map((x, j) => j === i ? { ...x, number: e.target.value } : x))} /></label><label>名前<input maxLength={40} value={p.name} onChange={e => setRoster(roster.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></label></fieldset>)}{available.length > 0 && <><p>追加する選手</p>{available.map(p => <button type="button" key={p.id} onClick={() => setRoster([...roster, { id: p.id, name: p.name, number: p.number }])}>{p.number} {p.name}を追加</button>)}</>}{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy}>選手を保存</button></form></Dialog>;
}

function PlayLine({ play, game }: { play: Play; game: Game }) {
  const player = game.roster.find(p => p.id === play.playerId);
  return <div className="play-line"><span className="play-time">{periodLabel(game, play.quarter)} <strong>{formatTime(play.elapsedMs)}</strong></span><span><strong>{`${play.side === 'opponent' ? '相手 ' : ''}${play.playerId === '@unknown' ? '選手不明' : play.playerId === '@team' ? 'チーム' : play.playerId === '@coach' ? 'ヘッドコーチ' : play.playerId === '@assistant' ? 'A.コーチ' : play.side === 'opponent' ? (play.playerId === '@unknown' ? '背番号不明' : `${play.playerId}番`) : `${player?.number ?? ''} ${player?.name ?? '選手不明'}`}`}</strong><span className="play-label">{playLabel(play)}</span></span></div>;
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
    save({ ...value, playerId: value.side === 'opponent' && value.playerId === '' ? '@unknown' : value.playerId, elapsedMs, shot: isShot(value.action) ? value.shot ?? '2' : null, updatedAt: Date.now() });
  }
  return <Dialog title="記録を訂正" onClose={close}><form onSubmit={submit} className="stack">
    {value.side === 'opponent' ? <label>相手の背番号<input inputMode="numeric" pattern="([0-9]|[1-9][0-9]|00)" maxLength={2} placeholder="不明なら空欄" required={value.action !== 'made'} value={value.playerId === '@unknown' ? '' : value.playerId} onChange={e => setValue({ ...value, playerId: e.target.value })} /></label> : <label>選手<select value={value.playerId} onChange={e => setValue({ ...value, playerId: e.target.value })}>{value.action === 'made' && <option value="@unknown">選手不明</option>}{sortPlayers(game.roster).map(p => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select></label>}
    {(value.side !== 'opponent' || game.kind === 'scrimmage') && <label>プレー<select value={value.action} onChange={e => setValue({ ...value, action: e.target.value as Action })}>{Object.entries(actionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
    {isShot(value.action) && <label>シュート<select value={value.shot ?? '2'} onChange={e => setValue({ ...value, shot: e.target.value as Shot })}><option value="2">2点</option><option value="3">3点</option><option value="ft">フリースロー</option></select></label>}
    <div className="two-fields"><label>クォーター<select value={value.quarter} onChange={e => setValue({ ...value, quarter: Number(e.target.value) })}>{game.quarters.map(q => <option key={q.number} value={q.number}>{periodLabel(game, q.number)}</option>)}</select></label><label>開始から（順序は記録一覧で変更）<input value={time} onChange={e => setTime(e.target.value)} placeholder="05:32" inputMode="text" required /></label></div>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={busy}>訂正を保存</button><button type="button" className="quiet danger" disabled={busy} onClick={() => save({ ...play, cancelled: true, updatedAt: Date.now() })}>この記録を取り消す</button>
  </form></Dialog>;
}

function TeamInfo({ team, save, busy, onDirty }: { onDirty: (dirty: boolean) => void; team: { name?: string; passphrase?: string }; save: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState(team.name ?? '');
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => onDirty(name !== (team.name ?? '')), [name, team.name, onDirty]);
  return <><h1>チーム情報</h1><form className="panel stack" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; save(name.trim()); setSubmitted(true); }}><label>チーム名<input value={name} maxLength={80} required onChange={e => { setName(e.target.value); setSubmitted(false); }} /></label><button className="primary" disabled={busy}>チーム名を保存</button>{submitted && team.name === name.trim() && <p role="status">チーム名を保存しました。</p>}</form><section className="panel"><h2>合言葉</h2><p>{team.passphrase ?? '確認するには、一度退出して合言葉で参加し直してください。'}</p></section></>;
}

function Help() {
  return <><h1>使い方</h1><p>上のタブで「試合の記録」「過去の記録」「チーム情報」「使い方」を切り替えます。記録中に別のタブを開いても時計はそのままです。「試合の記録」で一覧へ戻り、「記録を再開」から試合を開けます。終了した試合は「過去の記録」で探せます。</p>
    <p>はじめて使うときは、選手を登録し、新しい試合を作って、試合開始を押します。プレーを記録し、試合終了後に結果を見られます。</p>
    <details className="panel"><summary>チームを作る・参加する</summary><p>最初の画面の「チームを作成」でチーム名と合言葉を決めます。すでに使われている合言葉は選べません。「チームに参加」では、教えてもらった合言葉を入力します。</p><p>「チーム情報」ではチーム名の変更と合言葉の確認ができます。「退出」はこの端末からチームを離れる操作です。もう一度入るときは合言葉が必要です。</p></details>
    <details className="panel"><summary>選手を登録する</summary><p>「チーム情報」の「選手登録・変更」で名前と背番号を入力し、「選手を追加」を押します。続けて何人でも登録できます。「変更」で名前や番号を直せます。「非表示」は今後の試合で選ばない選手に使い、「戻す」で再表示します。</p><p>「登録を完了」を押すと前の画面に戻ります。登録選手の変更は過去の試合には反映されません。</p></details>
    <details className="panel"><summary>試合を準備する</summary><p>「新しい試合」で「練習試合・大会」または「部内ゲーム」を選びます。日付と相手を入力し、参加する選手にチェックを付けます。「全員選択」「選択を外す」も使えます。選手が足りないときは「選手登録へ」から追加します。</p><p>部内ゲームは、チーム２に入る選手にもチェックを付けます。それ以外の参加選手はチーム１です。記録する範囲で、得点のみ、チーム１の個人成績、両チームの個人成績を選べます。</p><p>必要に応じて「スコアシート情報」で大会名などを入力し、「この内容で試合を作成」を押します。情報は後から追加できます。</p></details>
    <details className="panel"><summary>試合中に記録する</summary><p>「試合開始」で時計が動きます。「一時停止」で時計を止め、「再開」で続きから動かせます。止めている間も記録できます。会場の競技時計とは連動しません。</p><p>「シュート決」「シュート外」「リバウンド」「パスカット」を押して選手を選びます。シュートは続けて2点、3点、フリースローを選びます。得点した選手が分からない場合は「選手不明」を使えます。「選手を選び直す」「記録せず戻る」も使えます。</p><p>相手の得点は「相手のシュート決」から背番号と種類を選びます。初めての番号は「背番号を追加」から入力します。「背番号不明」も選べます。部内ゲームでは記録するチームを切り替えられます。</p><p>「ファウル」「タイムアウト」「Player in」からも記録できます。Player inは選手が初めて出たときに記録し、先発選手はスコアシート情報で設定します。タイムアウトの残り時間は会場の時計を見て入力します。</p><p>「このQを終了」で時計を止め、次のQを開始します。部内ゲームでは「このゲームを終了」を使います。必要なら「Q終了を取り消す」で戻せます。練習試合・大会では最後に「試合全体を終了」を押します。部内ゲームは「このゲームを終了」で結果画面に進みます。</p><p>「途中成績を見る」で記録中の成績を確認できます。「この試合の選手」を開くと名簿、スコアシート情報、画面を消えにくくする設定があります。端末によっては画面消灯を防げません。</p></details>
    <details className="panel"><summary>記録を直す</summary><p>「直前の記録」の「この記録を取り消す」で直前の入力を取り消せます。記録一覧の「訂正」では選手、種類、時間などを直したり、取り消したりできます。「取消済みを確認・復元」から取り消した記録を戻せます。</p><p>「記録漏れを追加」では、入れ忘れた記録と入れる位置を選びます。試合終了後の「記録を確認・訂正する」では「記録順を1つ早く」「記録順を1つ遅く」で同じQ内の順番も直せます。時刻の数字は変わりません。「その他の操作」から終了取消やこの試合の名簿変更もできます。「この試合の選手を追加・訂正」はその試合の名簿だけを変更します。</p></details>
    <details className="panel"><summary>試合結果・過去の試合</summary><p>試合終了後に成績と得点を確認できます。チーム、Q、シュートの種類を切り替えられます。「—」は記録がなく確認も済んでいない欄です。記録を確認した項目は確認済みにできます。</p><p>「次の試合を準備」で相手・選手・組分けを確認し、「この内容で試合を作成」で新しい試合を作れます。相手が変わる場合は新しい相手を入力してください。「この連続ゲームの合計を見る」は同じ連続ゲームの読み込み済みの試合を集計します。必要に応じて一覧の「前の試合をもっと見る」を押してください。</p><p>試合一覧では相手や日付で検索できます。「ゴミ箱へ」で移した試合は30日以内なら戻せます。「試合終了を取り消す」も使えます。</p></details>
    <details className="panel"><summary>試合を削除する・元に戻す</summary><p>試合一覧の「ゴミ箱へ」で移動します。「過去の記録」の「ゴミ箱を見る」から、30日以内なら「元に戻す」を押せます。移動前の確認画面では日付と相手を確認し、「ゴミ箱へ移す」を押します。やめるときは「キャンセル」です。移動直後に表示される「元に戻す」でも取り消せます。</p><p>ゴミ箱では試合を押して成績やスコアシートを確認できます。編集はできません。「元に戻す」と、終了した試合は「過去の記録」、開始前・記録中の試合は「試合の記録」に戻ります。記録中の時計は停止した状態になるので、続けるときは「再開」を押してください。</p><p>移動と復元は通信があり、すべて保存済みのときに使えます。チーム全員に反映されます。30日後は復元できず、通常はその後1日程度で記録全体が自動削除されます。処理が遅れた場合は復旧後に削除されます。ゴミ箱では復元できる期限を確認できます。</p><p>選手登録や他の試合は消えません。端末に保存したPDFも残ります。以前の「保管」はなくなり、保管していた試合は通常の一覧に表示されます。試用データの期限切れ削除は、この端末でアプリを開いたときに行います。</p></details>
    <details className="panel"><summary>スコアシートと印刷</summary><p>「スコアシート情報」で大会、会場、時間、選手、先発、審判や記録係などを入力して保存します。相手選手は背番号を追加できます。ファウルの種類やフリースローの付記、特殊なケースは記録画面で選びます。</p><p>試合結果のスコアシート画面で未記入・未確認の項目を確認できます。「拡大して見る」で表示を変え、「PDFを保存」でPDFを作ります。「印刷・印刷用画面」は端末の印刷画面を開きます。署名欄は印刷後に記入できます。「スコアシートの情報を入力・確認」で不足情報を補足します。</p></details>
    <details className="panel"><summary>保存と通信</summary><p>画面上部に保存状態が表示されます。通信が切れても入力でき、通信が戻ると送信します。「未送信」があるときは同じ端末で待ち、必要なら「認証と保存を再確認」を押してください。</p><p>1試合は1台で記録し、「すべて保存済み」を確認してから退出や端末の交代をしてください。未送信のままブラウザのデータを消すと、その記録は失われます。</p></details>
    </>;
}
