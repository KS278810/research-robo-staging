# ResearchRobo を社内ホストする

`git clone` した内容をそのまま、編集なしで社内ネットワークに配信するための手順です。
3つの方式（Docker/nginx、依存ゼロのPythonスクリプト、GitHub Enterprise Server / GitLab の
Pages機能）のどれを使ってもかまいません。

## 前提

- ページ自体（LP・ビューア・ワークベンチ）はブラウザ内で完結し、社内配信だけなら外部通信は
  不要です。Google Fontsは到達できなくても表示が崩れないよう設計してあります（届けば装飾用
  フォントが当たり、届かなければOS標準の日本語フォントで表示されます）。GA4計測は公開サイトの
  ホスト名でしか発火しないため、社内配信では発火しません。
- **ただし、Deep Researchを実行するAIチャット側には通常どおりWebアクセスが必要です。**
  ResearchRobo自体は調査を代行しません。社内で使うAIチャット（ChatGPT / Claude / Gemini /
  社内AI等）がインターネット上の情報を検索・取得できることが引き続き前提です。
- コピーされるプロンプト中のビューアURL等は、配信元のURL（サブパス配信の場合はそのパスも含む）
  へ自動的に書き換わります。KIT本文ファイル自体は編集不要です。

## 方式1: Docker（推奨）

```bash
cd hosting
docker compose up -d --build
```
既定でポート8080に配信されます。ポートを変える場合:
```bash
RR_PORT=9000 docker compose up -d --build
```
（または `hosting/.env` に `RR_PORT=9000` と書いても同じです。`.env` は`.gitignore`済み）

更新（`git pull`後の反映）:
```bash
git pull
cd hosting && docker compose up -d --build
```
停止: `docker compose down`（`hosting/`ディレクトリで実行）

非root権限が必要な環境向けの差し替え手順は `hosting/Dockerfile` 冒頭のコメントを参照してください。

サブパス配信（例: `https://intra.example.com/tools/rr/`）にしたい場合、このコンテナ自体は
`/`のまま動かし、上位のリバースプロキシ（nginx/Apache等）から転送してください。設定例は
`hosting/nginx.conf` の末尾コメントにあります。

## 方式2: Python標準ライブラリだけのスクリプト

Docker が使えない環境向けです。Python 3.7以上だけが必要です（追加インストール不要）。

```bash
python3 hosting/serve.py 8080
```
LAN内の他端末からも見えるようにする場合:
```bash
python3 hosting/serve.py 8080 --host 0.0.0.0
```
配信されるのはgitで追跡されている公開ファイルだけです（`dev/`・`work2.md`・`CLAUDE.md`（symlink）等の
開発資産は、このディレクトリの中に物理的に存在していても配信されません）。Ctrl+Cで停止します。

Windows でも同じコマンドで動きます（`py -3 hosting\serve.py 8080 --host 0.0.0.0` のように
`py` ランチャーを使ってもかまいません）。systemdサービス化やタスクスケジューラ登録は、この
スクリプトをそのまま起動コマンドに指定するだけで組み込めます。

## 方式3: GitHub Enterprise Server / GitLab の Pages機能

- **GitHub Enterprise Server**: リポジトリの Settings → Pages → Source を
  「Deploy from a branch」→ ブランチ `main` / フォルダ `/ (root)` に設定するだけです。
  `.nojekyll` が既にルートにあるため、Jekyll処理は行われず全ファイルがそのまま配信されます。
  管理者がインスタンス側でPages機能を有効化している必要があります。
- **GitLab**: リポジトリ直下の `.gitlab-ci.yml` がPages公開ジョブを含んでいるので、
  GitLabにプッシュするだけでCI/CDが自動的に `public/` を組み立てて公開します
  （テストは実行しません。参考: 3行目「テストを実行しない」）。公開URLは
  `https://<group>.pages.<gitlab-host>/research-robo/`（または設定によりカスタムドメイン）
  になります。

## 他のWebサーバーで配信する場合のMIME設定

上記以外のサーバー（IIS等）で配信する場合、`.md` と `.webp` の既定MIMEタイプが登録されて
いないことがあります。未登録だとコピー機能・レポートの図表が動かなくなるため、以下を追加して
ください。

**IIS（web.config）:**
```xml
<staticContent>
  <mimeMap fileExtension=".md" mimeType="text/markdown; charset=utf-8" />
  <mimeMap fileExtension=".webp" mimeType="image/webp" />
</staticContent>
```

**Apache（.htaccess や httpd.conf）:**
```
AddType text/markdown .md
AddType image/webp .webp
```

## 社内配信で変わること・変わらないこと

- コピーされるプロンプト内のviewer URL・ダウンロードするKITファイルの中身は、配信元URLに
  自動で書き換わります（CC BYライセンス表記行の公開URLだけは書き換えません——著作権者・
  ライセンスへのリンクとして残す必要があるためです）。
- `llms.txt` / `sitemap.xml` / `robots.txt` / 各ページの `<link rel="canonical">` /
  OGP画像URLは公開サイト（GitHub Pages）向けのSEO専用情報です。社内配信では意味を持たない
  ので、無視しても削除してもかまいません。
- GA4計測は公開サイトのホスト名でしか発火しません。社内配信では常に無効です。

## 動作確認

```bash
bash hosting/check.sh http://<配信ホスト>:<ポート>/
```
主要ファイルの200応答・Content-Type・非公開ファイルの404・KITミラーのバイト一致を
まとめて確認します。公開サイトに対しても使えます:
```bash
bash hosting/check.sh https://ks278810.github.io/research-robo/
```

## ライセンス

配布・改変する場合は [CC BY 4.0](../LICENSE) の著作権表記を保持してください
（KIT本文の `License:` 行、`README.md` を参照）。
