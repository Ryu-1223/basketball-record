# 接続・公開手順

## 作成済みのFirebase

- プロジェクト: `basketball-record-ryu1223`
- Webアプリ: `1:676249743790:web:040679c6c22249a6f9183f`
- [Firebaseコンソール](https://console.firebase.google.com/project/basketball-record-ryu1223/overview)
- Firestoreとアクセスルールは作成・反映済み。課金アカウントの接続は行っていません。
- FirestoreのリージョンはCLI初期作成の既定値 `nam5`、Standard edition、無料枠対象です。
- 共通アカウントと合言葉の設定は未実施。
- このPCの `.env.local` にはWebアプリの接続情報を設定済みです。残りは共通アカウントの接続です。
- Vercelの `tera-hzs-projects/basketball-record` プロジェクトを作成し、GitHubリポジトリとの接続を完了しています。Firebase接続用の環境変数5つも本番・プレビュー・開発に登録済みです。共通ユーザーの接続と公開デプロイが残っています。

## 1. 合言葉を設定する

1. Firebaseコンソールで **構築 → Authentication → 始める** を開きます。
2. **ログイン方法 → メール／パスワード** を有効化します。メールリンク認証は不要です。
3. **Users → ユーザーを追加** を選び、管理できるメールアドレスと部活の合言葉を入力します。Firebaseの指定に従い、パスワードは6文字以上にします。
4. 作成されたユーザーのUIDを控えます。合言葉はチャットやリポジトリに書かず、部内だけで共有します。
5. 作成したUIDで次のコマンドを実行すると、部活へのアクセス許可とこのPCのメールアドレス設定が完了します。パスワード入力や秘密鍵は不要です。

```sh
npm run setup:team -- --uid=作成したユーザーのUID
```

手動で行う場合は **Firestore Database → データ** で `teams/basketball/members/＜UID＞` というドキュメントを作成し、`enabled` を **boolean型のtrue** にします。中間の `teams/basketball` は空のドキュメントでも構いません。その後 `.env.local` の `VITE_TEAM_EMAIL` を設定します。

このUIDの登録によって、その共通アカウントだけが部活のデータへアクセスできます。Authenticationのアカウント作成だけでは記録にアクセスできません。Security Rulesをテストモードや全員許可へ変更する必要はありません。

## 2. 接続情報を設定する

プロジェクト設定 → 全般 → マイアプリ → Webアプリの構成から設定値を取得します。`.env.example` を `.env.local` にコピーし、次を入力します。

| 環境変数 | 内容 |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Webアプリ構成のapiKey |
| `VITE_FIREBASE_AUTH_DOMAIN` | authDomain |
| `VITE_FIREBASE_PROJECT_ID` | basketball-record-ryu1223 |
| `VITE_FIREBASE_APP_ID` | 1:676249743790:web:040679c6c22249a6f9183f |
| `VITE_TEAM_EMAIL` | 作成した共通アカウントのメールアドレス |
| `VITE_TEAM_ID` | basketball |

これらの `VITE_` 値はブラウザに配信される設定です。合言葉やサービスアカウントの秘密鍵は入力しません。WebアプリのAPIキーだけでデータへアクセスできる設計にはしていません。

開発サーバーを再起動すると、合言葉の入力画面に切り替わります。`.env.local` はGitに含まれません。

## 3. Vercelに接続する

1. Vercelで **Add New → Project** を開き、`Ryu-1223/basketball-record` をImportします。
2. FrameworkはVite、Build Commandは `npm run build`、Output Directoryは `dist`。Node.jsは24系を選びます。
3. Environment Variablesに上記6つの環境変数を登録します。合言葉は登録しません。`VITE_USE_EMULATORS` は本番に設定しません。
4. 開発ブランチ `codex/basketball-app` でプレビューを確認します。初期mainはREADMEのみなので、アプリを本番公開する前に開発ブランチの内容をmainへ反映します。
5. Firebase Authenticationの **設定 → 承認済みドメイン** にVercelの公開ホスト名を追加します。必要ならプレビューで使う固定ホスト名、ローカル用の `localhost`、`127.0.0.1` も追加します。
6. 公開URLでログイン、選手追加、試合開始、記録、Q切替、試合終了、履歴表示を確認します。

Vercelのプレビューと本番で環境変数の適用範囲が異なることに注意してください。Viteはビルド時に設定を埋め込むので、環境変数を変更した後は再デプロイが必要です。

CLIで接続し直す場合は `npx vercel login` で本人がログインし、`npx vercel link` でプロジェクトへ接続します。このPCではFirebase・Vercelともにログイン済みで、Vercelプロジェクトにも接続済みです。

## 4. 公開前の確認

開発時点で、自動テスト11件とFirestoreエミュレーターのテスト6件、ビルド、本番依存パッケージの監査が通っています。390px幅の実ブラウザでは、選手登録、試合準備、3点シュート、リバウンド、Q切替、再読み込み後の経過時間と記録の復元を確認済みです。スマホ実機と本番アカウントでの確認はこれから行います。

- 実際のiPhone Safari／Android Chromeで、押しやすさと長い選手名の表示を確認。
- 合言葉を知らない状態では記録に入れない。
- プレー選択に時間をかけても、最初に押した時刻で保存される。
- 事前に試合を読み込んでから通信を切り、入力して接続復帰後に同期する。
- 再読み込みや画面ロック復帰でQの経過時間が続く。
- 別のスマホから同じ履歴を閲覧できる。
- 「すべて保存済み」を確認してから退出できる。

最初のアクセス・ログインと試合準備はオンラインで行います。未取得の履歴はオフラインで表示できません。アプリの初回キャッシュ完了前に通信を切ると、アプリ本体を再表示できない場合があります。

## 日々の運用

- 1試合1台で入力します。他の人も編集権限がありますが、同時編集の競合を調停する機能は初版に含みません。
- Q間に「すべて保存済み」を確認してから端末を引き継ぎます。
- 保存エラーになった入力も、端末の送信待ちへ保持します。設定や通信を直して「再送する」を押します。
- 合言葉を忘れた場合は管理者がFirebase Authenticationから復旧します。変更時には必要に応じて既存セッションも無効化します。
- 部活アカウントのアクセス停止はmembersドキュメントの `enabled` をfalseにします。端末に既にキャッシュされたデータは遠隔消去されません。
- Firestoreの保存と独立したバックアップは別です。初版では通常操作の物理削除を許可せず、プレー取消はデータを残します。

## 開発とルールの更新

```sh
npm ci
npm test
npm run build
npm run test:rules
npx firebase deploy --only firestore --project basketball-record-ryu1223
```

ルールの反映はVercelの画面デプロイとは別です。テストはdemoプロジェクトで行い、本番にテストデータを追加しません。課金機能や有料プランは自動で有効化しません。
