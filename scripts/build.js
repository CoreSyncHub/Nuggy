const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const isProduction = process.env.NODE_ENV === 'production';
const mode = isProduction ? 'production' : 'development';

console.log(`\n🔨 Building Nuggy (${mode.toUpperCase()})\n`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`   Mode: ${mode}\n`);

// Build extension
console.log('📦 Building extension (Node.js)...');
try {
  execSync(`vite build --config vite.config.extension.ts --mode ${mode}`, {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: mode }
  });
  console.log('✅ Extension built successfully\n');
} catch (error) {
  console.error('❌ Extension build failed');
  process.exit(1);
}

// Build webview
console.log('🌐 Building webview (Browser)...');
try {
  execSync(`vite build --config vite.config.webview.ts --mode ${mode}`, {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: mode }
  });
  console.log('✅ Webview built successfully\n');
} catch (error) {
  console.error('❌ Webview build failed');
  process.exit(1);
}

// Copy i18n files
console.log('🌍 Copying translation files...');
try {
  const srcDir = path.join(__dirname, '..', 'src', 'Web', 'i18n');
  const destDir = path.join(__dirname, '..', 'dist', 'i18n');

  if (!fs.existsSync(srcDir)) {
    console.warn(`⚠️  Source i18n directory not found: ${srcDir}`);
  } else {
    fs.cpSync(srcDir, destDir, { recursive: true });
    console.log('✅ Translation files copied successfully\n');
  }
} catch (error) {
  console.error('❌ Failed to copy translation files:', error.message);
  process.exit(1);
}

console.log('✨ Build complete!\n');
