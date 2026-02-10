const fs = require('fs-extra');
const path = require('path');

class DataValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  validateWork(work, index) {
    // 必須フィールド
    if (!work.id) {
      this.errors.push(`Work #${index}: Missing required field 'id'`);
    }
    if (!work.title) {
      this.errors.push(`Work #${index}: Missing required field 'title'`);
    }

    // IDフォーマット
    if (work.id && !/^\d{4}-\d+$/.test(work.id)) {
      this.warnings.push(`Work #${index} (${work.id}): ID should be in format YYMM-N`);
    }

    // タグ
    const validTags = ['sound', 'image', 'motion', 'geometry', 'object', 'code'];
    if (work.tags) {
      work.tags.forEach(tag => {
        if (!validTags.includes(tag)) {
          this.warnings.push(`Work #${index} (${work.id}): Unknown tag '${tag}'`);
        }
      });
    } else {
      this.warnings.push(`Work #${index} (${work.id}): No tags defined`);
    }

    // メディア
    if (!work.media || work.media.length === 0) {
      this.warnings.push(`Work #${index} (${work.id}): No media defined`);
    } else {
      work.media.forEach((media, mIndex) => {
        if (!media.type) {
          this.errors.push(`Work #${index} (${work.id}), Media #${mIndex}: Missing type`);
        }
        if (!media.src) {
          this.errors.push(`Work #${index} (${work.id}), Media #${mIndex}: Missing src`);
        }
      });
    }

    // サムネイル
    if (!work.thumb) {
      this.warnings.push(`Work #${index} (${work.id}): No thumbnail defined`);
    }
  }

  async validate() {
    console.log('\n🔍 Validating data...\n');

    try {
      const dataPath = path.join(__dirname, '..', 'data', 'works.json');
      const data = await fs.readFile(dataPath, 'utf8');
      const works = JSON.parse(data);

      // 各作品の検証
      works.forEach((work, index) => {
        this.validateWork(work, index);
      });

      // 重複ID検出
      const ids = works.map(w => w.id);
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      if (duplicates.length > 0) {
        this.errors.push(`Duplicate IDs found: ${duplicates.join(', ')}`);
      }

      // 結果表示
      if (this.errors.length > 0) {
        console.log('❌ Errors:');
        this.errors.forEach(err => console.log(`   ${err}`));
      }

      if (this.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        this.warnings.forEach(warn => console.log(`   ${warn}`));
      }

      if (this.errors.length === 0 && this.warnings.length === 0) {
        console.log('✅ All data is valid!\n');
      } else {
        console.log(`\n📊 Summary: ${this.errors.length} errors, ${this.warnings.length} warnings\n`);
      }

      if (this.errors.length > 0) {
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  const validator = new DataValidator();
  validator.validate();
}

module.exports = { DataValidator };
