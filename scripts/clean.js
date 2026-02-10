const fs = require('fs-extra');
const path = require('path');

async function clean() {
  console.log('\n🧹 Cleaning build artifacts...\n');

  const distDir = path.join(__dirname, '..', 'dist');

  try {
    if (fs.existsSync(distDir)) {
      await fs.remove(distDir);
      console.log('   ✓ Removed dist/');
    } else {
      console.log('   ℹ️  dist/ does not exist');
    }

    console.log('\n✅ Clean complete\n');
  } catch (error) {
    console.error('❌ Clean failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  clean();
}

module.exports = { clean };
