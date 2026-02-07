const express = require('express');
const path = require('path');
const { build } = require('./build');

const app = express();
const PORT = process.env.PORT || 3000;

// 静的ファイルを配信
app.use(express.static(path.join(__dirname, '../dist')));

// APIエンドポイント - works.jsonを配信
app.get('/api/works', (req, res) => {
  try {
    const fs = require('fs');
    const worksData = fs.readFileSync(path.join(__dirname, '../data/works.json'), 'utf8');
    res.json(JSON.parse(worksData));
  } catch (error) {
    res.status(500).json({ error: 'Failed to load works data' });
  }
});

// すべてのルートをindex.htmlにリダイレクト（SPA対応）
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ビルドしてサーバーを起動
async function startServer() {
  try {
    console.log('🔧 Building the site...');
    await build();
    console.log('✅ Build completed!');
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
      console.log('📁 Serving files from dist/');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
