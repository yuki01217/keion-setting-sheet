# 軽音セッティングシート

軽音楽部のライブで使う「セッティングシート」を、作成・提出・確認・PDF出力までブラウザ上で行えるWebアプリです。
紙やファイルのやり取りで行っていた提出と確認を、ひとつの画面にまとめました。

## できること

**部員**
- Googleアカウントでログインし、初回だけ部の合言葉を入力して利用開始
- セッティングシートの作成・編集（出演者とパート〈兼任は複数選択〉、使用機材〈その他は自由に追加〉、曲順と演奏時間、PA要望、備考）
- セッティング図の作成（機材や立ち位置をドラッグで配置、回転、使用機材の丸囲み）
- 紙のシートと同じレイアウトのA4 PDFを保存（長いPA要望は行を広げて収める）
- 幹部の確認状況（未確認 / 確認済 / 要修正 / 再提出）とコメントの確認

**幹部**（幹部パスワードで幹部画面へ）
- 全バンドの提出一覧（出演日・出演順で並び替え、検索）
- 表示中のシートを出演順にまとめて1つのPDFにする（当日の印刷用）
- シートの確認・差し戻し（コメント付き）
- ライブ設定：ライブ名・日程（カレンダーから追加）・会場・持ち時間・使用機材リスト・セッティング図の初期配置
- 受付中のライブの切り替え、過去のライブの閲覧
- 部員・幹部の削除

**管理者**（最初に「はじめの設定」をした人）
- 合言葉・幹部パスワードの変更は管理者だけができる

## 構成

| 役割 | 使っているもの |
| --- | --- |
| 画面 | HTML / CSS / JavaScript（ビルド不要、ES Modules） |
| ホスティング | GitHub Pages |
| ログイン | Firebase Authentication（Google） |
| データ | Cloud Firestore |
| PDF | html2canvas + jsPDF |

部員が入力したデータはFirestoreにだけ保存され、このリポジトリには含まれません。

### 権限の仕組み

権限のチェックは、すべて `firestore.rules`（サーバー側）で行っています。

- 合言葉と幹部パスワードは、SHA-256ハッシュをドキュメントIDとして `joinKeys` / `adminKeys` に保存しています。これらは読み取り禁止です。
- 正しい合言葉を知っている人だけが、`members/{自分のuid}` を作成できます（`existsAfter` でキーの存在を確認）。
- 部員は自分のシートだけ読み書きできます。幹部の確認結果（`review`）や持ち主（`owner`）は変更できません。
- 幹部は `admins/{uid}` があるユーザーで、全シートの閲覧・確認とライブ設定ができます。
- 合言葉・幹部パスワードの変更は、`config/setup` に記録された管理者だけに許可しています。

## セットアップ

1. **Firebaseプロジェクトを作る**
   [Firebaseコンソール](https://console.firebase.google.com/)で新しいプロジェクトを作成します（無料のSparkプランで動きます）。
2. **Googleログインを有効にする**
   Authentication → Sign-in method → Google を有効にします。
3. **Firestoreを作る**
   Firestore Database → データベースを作成（本番環境モード）。
4. **セキュリティルールを反映する**
   Firestore → ルール に `firestore.rules` の内容を貼り付けて公開します。
   Firebase CLIを使う場合は `firebase deploy --only firestore:rules` でも反映できます。
5. **設定をSecretsに登録する**
   プロジェクトの設定 → マイアプリ → ウェブアプリを追加し、表示された `firebaseConfig` の `{ ... }` の部分をコピーします。
   GitHubのリポジトリの Settings → Secrets and variables → Actions で、`FIREBASE_CONFIG` という名前のSecretに貼り付けます。
   `firebase-config.js` はリポジトリに入れません（`.gitignore` 済み）。公開するときに GitHub Actions がSecretから作ります。
6. **GitHub Pagesで公開する**
   リポジトリの Settings → Pages の Source を「GitHub Actions」にします。
   `main` にpushすると `.github/workflows/deploy.yml` が動いて公開されます。
7. **公開したドメインを許可する**
   Authentication → 設定 → 承認済みドメイン に `<ユーザー名>.github.io` を追加します。
   Google Cloud コンソールの「APIとサービス → 認証情報」で、Firebaseが作ったブラウザ用APIキーにウェブサイトの制限
   （`<ユーザー名>.github.io/*`、`<プロジェクトID>.firebaseapp.com/*`、`localhost:8000/*`）をかけておくと安全です。
8. **はじめの設定**
   公開したページを開いてGoogleでログインすると「はじめの設定」が表示されます。部の合言葉と幹部パスワードを決めてください。設定した人が最初の幹部になります。
   この画面は誰でも最初の1回だけ開けるので、公開したらすぐに設定してください。

## ローカルで動かす

`firebase-config.example.js` をコピーして `firebase-config.js` を作り、Firebaseの設定を貼り付けます。

```sh
cp firebase-config.example.js firebase-config.js
```

ES Modulesを使っているので、ファイルを直接開くのではなく、簡単なサーバー経由で開いてください。

```sh
python3 -m http.server 8000
# http://localhost:8000 を開く
```

`localhost` はFirebaseの承認済みドメインに最初から入っています。

### 機密情報のチェック

commitのたびに [gitleaks](https://github.com/gitleaks/gitleaks) でAPIキーなどが入っていないか調べます。cloneしたら一度だけ有効にしてください。

```sh
sudo apt install gitleaks pre-commit
pre-commit install
```

## ファイル

```
index.html                  画面の骨組み
style.css                   デザイン（ライト / ダーク両対応）
app.js                      入口（ログイン状態を見て最初の画面を出す）
js/
  firebase.js               Firebaseの初期化
  util.js                   小さな道具（DOM・文字列・時間・日付）
  state.js                  アプリの状態と、ライブ・シートのデータを扱う関数
  session.js                権限チェックとFirestoreの購読
  router.js                 ヘッダーと画面の切り替え
  gate.js                   ログイン・合言葉・はじめの設定・幹部ログイン
  list.js                   マイシート・提出一覧
  form.js                   提出フォーム
  stage.js                  セッティング図
  detail.js                 シートの詳細と確認
  settings.js               ライブ設定・部員の管理
  pdf.js                    PDF出力
guide.html                  使い方ページ
firebase-config.example.js  Firebaseの接続設定の見本（実物の firebase-config.js はgitに入れない）
firestore.rules             セキュリティルール
firebase.json               Firebase CLI用の設定
.github/workflows/deploy.yml  GitHub Pagesへの公開（SecretsからFirebaseの設定を作る）
.pre-commit-config.yaml     commit前のgitleaksチェック
```
