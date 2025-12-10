const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

console.log('\n🔄 Starting watch mode for NuGet Explorer...\n');
console.log('⚠️  Note: You must manually reload the extension window (Ctrl+R or F5) after changes.\n');

// Copy i18n files initially
const srcDir = path.join(__dirname, '..', 'src', 'Web', 'i18n');
const destDir = path.join(__dirname, '..', 'dist', 'i18n');

console.log('🌍 Copying translation files...');
if (fs.existsSync(srcDir)) {
  fs.cpSync(srcDir, destDir, { recursive: true });
  console.log('✅ Translation files copied\n');
}

// Track build completion
let extensionBuilt = false;
let webviewBuilt = false;
let initialBuildComplete = false;

function checkBuildComplete() {
  if (extensionBuilt && webviewBuilt && !initialBuildComplete) {
    initialBuildComplete = true;
    console.log('\n✅ Initial build complete!\n');
  } else if (extensionBuilt && webviewBuilt && initialBuildComplete) {
    // Both rebuilt - manual reload required
    extensionBuilt = false;
    webviewBuilt = false;
    console.log('\n🔄 Build complete! Press Ctrl+R or F5 in the extension window to reload.\n');
  }
}

// Start Vite watch for extension
console.log('📦 Starting extension watch...');
const extensionWatch = spawn('vite', ['build', '--config', 'vite.config.extension.ts', '--watch'], {
  shell: true,
});

extensionWatch.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(output);
  if (output.includes('built in')) {
    extensionBuilt = true;
    checkBuildComplete();
  }
});

extensionWatch.stderr.on('data', (data) => {
  console.error(data.toString());
});

// Start Vite watch for webview
console.log('🌐 Starting webview watch with HMR...');
const webviewWatch = spawn('vite', ['build', '--config', 'vite.config.webview.ts', '--watch'], {
  shell: true,
});

webviewWatch.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(output);
  if (output.includes('built in')) {
    webviewBuilt = true;
    checkBuildComplete();
  }
});

webviewWatch.stderr.on('data', (data) => {
  console.error(data.toString());
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping watch mode...');
  extensionWatch.kill();
  webviewWatch.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  extensionWatch.kill();
  webviewWatch.kill();
  process.exit(0);
});

extensionWatch.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error('❌ Extension watch process exited with code', code);
  }
});

webviewWatch.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error('❌ Webview watch process exited with code', code);
  }
});

console.log('\n✨ Watch mode started. Press Ctrl+C to stop.\n');
