const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const zip = new AdmZip();

const EXCLUDED_DIRS = ['node_modules', 'dist', '.git', '.npm', 'public'];
const EXCLUDED_FILES = ['zip-project.js', '.DS_Store'];

function addLocalFolderRecursive(localPath, zipPath) {
  const files = fs.readdirSync(localPath);
  for (const file of files) {
    const fullPath = path.join(localPath, file);
    const relativeZipPath = zipPath ? path.join(zipPath, file) : file;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (EXCLUDED_DIRS.includes(file)) {
        continue;
      }
      addLocalFolderRecursive(fullPath, relativeZipPath);
    } else {
      if (EXCLUDED_FILES.includes(file)) {
        continue;
      }
      zip.addLocalFile(fullPath, zipPath);
    }
  }
}

console.log('Zipping project files...');
try {
  // Ensure public directory exists
  if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
  }
  
  addLocalFolderRecursive('.', '');
  zip.writeZip('public/codebase.zip');
  console.log('Successfully created public/codebase.zip');
} catch (err) {
  console.error('Error zipping project:', err);
  process.exit(1);
}
