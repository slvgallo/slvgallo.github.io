# slvgallo Portfolio

## 🚀 自動ビルドシステム

このサイトはGitHub Actionsを使用して自動的にビルド・デプロイされます。

### 📁 プロジェクト構成

```
├── data/
│   └── works.json          # 作品データ（編集対象）
├── templates/              # HTMLテンプレート
├── scripts/               # Node.jsビルドスクリプト
├── dist/                  # 生成ファイル（gitignore）
└── .github/workflows/     # GitHub Actions
```

### 🔄 更新フロー

1. **works.jsonを編集**
2. **git push**
3. **GitHub Actionsが自動実行**
4. **Node.jsスクリプトでHTML生成**
5. **GitHub Pagesにデプロイ**

### 🛠️ ローカル開発

```bash
# 依存関係をインストール
npm install

# ビルドテスト
npm run build

# 開発サーバー起動
npm run dev
```

### 📝 URL構造

- トップページ: `https://slvgallo.github.io/`
- 作品ページ: `https://slvgallo.github.io/works/2602-1.html`
- プロフィール: `https://slvgallo.github.io/profile.html`

### 🎨 フィルターカテゴリ

- **image** - 写真・静止画
- **motion** - 動画・モーション
- **sound** - 音声
- **geometry** - 3D・ジオメトリ
- **object** - オブジェクト
- **code** - コード

---

© 2008 slvgallo
