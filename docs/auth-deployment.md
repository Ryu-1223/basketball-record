# メール不要のチーム認証の公開設定

アプリのコードとローカルの検証は完了。公開側の権限設定は自動承認審査により保留されており、この手順はまだ実行していません。

対象はFirebaseプロジェクト `basketball-record-ryu1223` とVercelプロジェクト `tera-hzs-projects/basketball-record` だけです。

## 利用者の操作

最初の画面には「チームを作成」「チームに参加」の2つのボタンだけを表示します。どちらも合言葉1つで操作します。4〜64文字、前後の空白を除去し、Unicodeの合成表現を統一します。

- 作成時は合言葉の使用状況をFirestoreトランザクションで確認し、同時作成でも1つだけ成功させます。
- 参加時は合言葉に対応するチームの認証トークンを発行します。メールアドレスは入力・登録しません。
- チームのメンバー全員が、そのチームの選手・試合・記録を閲覧・編集できます。
- 合言葉の本文は保存せず、サーバー専用の秘密値を使ったHMACだけを索引として保存します。ブラウザから索引は読み書きできません。
- 合言葉を忘れた場合は他のメンバーに確認してください。メールでの再発行機能はありません。

## 了承が必要なGoogle側の変更

`npm run setup:auth` は次の変更を行います。既存のIAMポリシーを読み、必要なバインディングだけを追加します。OwnerやEditor権限は追加しません。

| 変更 | 対象・範囲 |
| --- | --- |
| APIの有効化 | IAM、IAM Credentials、Security Token Service、Identity Toolkit。課金アカウントの接続はしません |
| サービスアカウント作成 | `basketball-api@basketball-record-ryu1223.iam.gserviceaccount.com`。秘密鍵ファイルは発行しません |
| Firestore用の権限 | このサービスアカウントに、このプロジェクト内の `roles/datastore.user`。アプリの全チームの認証索引・メンバー情報・記録にアクセスできる範囲です |
| OIDC信頼設定 | pool `vercel-basketball`、provider `vercel`。owner ID・project IDが今回のVercelプロジェクトと一致する短期トークンだけを許可 |
| サービスアカウントへの接続 | 上記Vercelプロジェクトだけに `roles/iam.workloadIdentityUser` |
| 認証トークンへの署名 | サービスアカウントが自分自身に署名するための `roles/iam.serviceAccountTokenCreator`。他のサービスアカウントには付与しません |
| Firebase Authの初期化 | 未初期化の場合だけ構成を初期化。メール認証の有効化やメールユーザーの手作業での作成は不要 |

この接続を使うサーバーAPIは認証索引とチームの初期作成を管理します。Vercelのサーバーコードを変更できる管理者には、このアプリのFirestoreデータへアクセスできる権限が生じます。他のFirebaseプロジェクトへの権限は追加しません。

## 了承後の反映手順

1. `npm run setup:auth` で上記のGoogle側設定を行います。
2. `.env.local` に作成される次の4つをVercelのサーバー用環境変数へ登録します。`VITE_` は付けません。
   - `GCP_PROJECT_ID`
   - `GCP_SERVICE_ACCOUNT_EMAIL`
   - `GCP_WORKLOAD_IDENTITY_AUDIENCE`
   - `TEAM_PASSPHRASE_SECRET`（Production・PreviewではSecretとして登録）
3. `npx firebase deploy --only firestore --project basketball-record-ryu1223` でチームIDの認証情報を要求する新しいアクセスルールを反映します。
4. Vercelへ新しい版をデプロイし、作成・参加・重複拒否・別チームのデータ分離を本番でも確認します。
5. 旧設定の `VITE_TEAM_EMAIL` と `VITE_TEAM_ID` は不要です。新しい版では参照しません。

`TEAM_PASSPHRASE_SECRET` を変更すると、既存の合言葉の索引を照合できなくなります。運用中にその場で生成し直さず、同じ値を保持してください。利用者が決めた合言葉を環境変数へ登録する必要はありません。

## 本番に触れないローカル確認

Java 21以上を使い、別々のターミナルで起動します。

```sh
npm run emulators
npm run dev:emulator
```

`demo-basketball-record` のAuth・Firestoreエミュレーターだけに接続します。本番のGoogle権限や秘密鍵は不要です。`.env.emulator` に入っている秘密値はローカル検証専用です。

```sh
npm test
npm run build
npm run test:rules
```

最後のコマンドは自分でエミュレーターを起動するため、上記の常駐エミュレーターを止めてから実行します。
