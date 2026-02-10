const express = require('express');
const path = require('path');
const chokidar = require('chokidar');
const { SiteBuilder } = require('./build');

class DevServer {
  constructor(port = 8080) {
    this.port = port;
    this.app = express();
    this.builder = new SiteBuilder();
    this.isBuilding = false;
    this.buildQueue = false;
  }

  async rebuild(changedFile) {
    if (this.isBuilding) {
      this.buildQueue = true;
      return;
    }

    this.isBuilding = true;
    console.log(`\n📝 File changed: ${changedFile}`);
    console.log('🔄 Rebuilding...\n');

    try {
      await this.builder.build();
      
      if (this.buildQueue) {
        this.buildQueue = false;
        this.isBuilding = false;
        await this.rebuild('queued changes');
      } else {
        this.isBuilding = false;
      }
    } catch (error) {
      console.error('❌ Rebuild failed:', error.message);
      this.isBuilding = false;
    }
  }

  setupWatcher() {
    const watchPaths = [
      path.join(__dirname, '..', 'data'),
      path.join(__dirname, '..', 'templates'),
      path.join(__dirname, '..', 'css'),
      path.join(__dirname, '..', 'js')
    ];

    const watcher = chokidar.watch(watchPaths, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true
    });

    watcher.on('change', (filePath) => {
      this.rebuild(path.relative(process.cwd(), filePath));
    });

    console.log('\n👀 Watching for changes in:');
    watchPaths.forEach(p => console.log(`   - ${path.relative(process.cwd(), p)}/`));
    console.log();
  }

  setupMiddleware() {
    // 静的ファイル配信
    this.app.use(express.static(path.join(__dirname, '..', 'dist')));

    // SPAフォールバック
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
    });
  }

  async start() {
    // 初回ビルド
    await this.builder.build();

    // ミドルウェア設定
    this.setupMiddleware();

    // ファイル監視
    this.setupWatcher();

    // サーバー起動
    this.app.listen(this.port, () => {
      console.log(`\n🚀 Dev server running at http://localhost:${this.port}/`);
      console.log(`   Press Ctrl+C to stop\n`);
    });
  }
}

if (require.main === module) {
  const server = new DevServer(8080);
  server.start().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { DevServer };
