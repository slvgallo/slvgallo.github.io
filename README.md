# slvgallo portfolio

slvgalloの作品とプロフィールを掲載するポートフォリオサイトのソースコードです。

- [作品を見る](https://slvgallo.github.io/)
- [プロフィール](https://slvgallo.github.io/profile.html)

## このリポジトリについて

作品情報、HTMLテンプレート、スタイル、JavaScript、ブラウザで動く作品本体を管理しています。サイトは日本語・英語に対応し、Node.js 24で静的ページを生成してGitHub Pagesで公開しています。

## ローカルで確認する

```sh
nvm use
npm ci
npm run dev
```

開発サーバーは <http://127.0.0.1:8080/> で開きます。

## ドキュメント

- [開発・保守ガイド](docs/development.md)：構成、検証、ビルド、公開手順
- [作品ページの自由配置欄](docs/custom-content.md)：作品固有のHTML・CSS・JavaScriptの追加方法
