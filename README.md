# slvgallo portfolio

Node.js 24で生成し、GitHub Pagesで配信する静的サイトです。

## 開発

```sh
nvm use
npm ci
npm run dev
```

http://127.0.0.1:8080/ で確認できます。data、templates、css、js、worksの変更で再ビルドされます。ブラウザは手動で再読み込みしてください。ビルドスクリプト変更後は開発サーバーを再起動します。

```sh
npm run check    # データ検証・テスト・ビルド
npm run preview  # ビルドして静的配信
npm audit        # 依存パッケージの既知の脆弱性を照会
```

## 構成

- `data/works.json`: 作品情報
- `templates/`: HTMLテンプレート
- `scripts/build.js`: ページ生成とファイルコピー
- `scripts/media.js`: 画像・動画・作品の埋め込みHTML生成
- `scripts/html.js`: テキスト・属性・JSONの安全な埋め込み
- `scripts/shared-utils.js`: 画像配信URLの加工
- `scripts/server.js`: 開発・プレビュー共通の静的サーバー
- `js/renderer.js`: ブラウザでの作品一覧描画
- `js/data.js`: 作品データの読み込み
- `js/youtube.mjs`: Node.js・ブラウザ共通のYouTube ID抽出
- `works/`: 作品本体。公開URLを維持するため不用意に移動しない
- `dist/`: ビルド生成物（Git管理対象外）

説明文のHTMLとcustomContentは管理者が作成する信頼済みコードです。ユーザー投稿のHTMLを安全化するサニタイザーではありません。作品IDは`YYMM-N`形式、URL属性はHTTP(S)または相対URLに制限しています。

## 公開

PRでは`npm ci`と`npm run check`を実行します。mainへのpush後、GitHub Actionsが同じ検証を行い、distをGitHub Pagesへ公開します。ローカルのdistをコミットする必要はありません。

Dependabot設定はnpmとGitHub Actionsを週次確認します。リポジトリ側のセキュリティ更新・ブランチ保護設定は別途管理します。
