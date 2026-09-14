# 作品ページの自由配置欄

`data/works.json` の作品に `customContent` を追加すると、通常のメディアの後、作品タイトル・説明の前にHTMLフラグメントを挿入します。指定のない作品には追加の要素やCSS・JSを出力しません。`media` との併用も可能です。

```json
"customContent": {
  "src": "works/2609-1/Splitline.content.html",
  "styles": ["works/2609-1/Splitline.css"],
  "scripts": ["works/2609-1/Splitline.js"],
  "width": "wide"
}
```

- `src`: 必須。リポジトリルートからのパス。同じ作品の `works/<id>/` 内のHTMLを指定します。
- `styles` / `scripts`: 任意の配列。同じ作品フォルダ内のCSS・JSを指定します。CSSは共通CSSの後、JSは配列順の `defer` スクリプトとして読み込みます。
- `width`: `wide`（既定、共通のメディア幅）または `content`（共通の余白を使い、最大52rem）。

フラグメントには作品固有のルート要素を置きます。`html`・`head`・`body`・`main` は含めず、CSS・JSは設定で読み込んでください。フラグメント内の画像URLなどは `/works/<id>/...` のルート相対パスにします。相対URLはフラグメントの保存先ではなく、生成後の `/works/<id>.html` を基準に解決されます。

CSSのセレクターと変数、JSの要素検索とカスタムイベントは作品のルート要素内へ限定します。自由配置欄は同じ文書に展開されるため、iframeのような自動隔離はありません。手元で作成した信頼できるサイトコード専用です。

Splitlineでは `Splitline.content.html` が作品ページの内容です。CSS・JSは既存の単体デモ `Splitline.html` と共有しています。ページ全体のスクロールで16種類の部品を閲覧でき、作品領域の幅に応じて2列から1列に切り替わります。

`npm run validate` は設定とファイルの存在を確認します。`npm run build` でページを生成し、`npm run dev` では作品フォルダの変更も再ビルドします。生成結果の `dist/` は直接編集しません。

自由配置欄の生成と設定チェックのテストは `node scripts/test-custom-content.js` で実行できます。
