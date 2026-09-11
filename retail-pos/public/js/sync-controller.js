import { firebaseConfig } from './config/firebase-config.js';
import { SyncEngine } from './sync/SyncEngine.js';

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const syncEngine = new SyncEngine(db);

let currentPreview = null;

document.getElementById('previewSyncBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('syncStatus');
  const resultsEl = document.getElementById('previewResults');
  
  try {
    statusEl.textContent = "Fetching and comparing data... Please wait.";
    currentPreview = await syncEngine.generateDiffPreview();
    
    resultsEl.textContent = `
Changes detected from Google Sheet: ${currentPreview.sheetToFirebase.length}
Changes detected from POS (Firebase): ${currentPreview.firebaseToSheet.length}
Conflicts requiring review: ${currentPreview.conflicts.length}

Sheet -> Firebase Details:
${JSON.stringify(currentPreview.sheetToFirebase.map(i => i.action + ' - ' + (i.productId || i.data['Item Name'])), null, 2)}
    `;
    
    if (currentPreview.sheetToFirebase.length > 0 || currentPreview.firebaseToSheet.length > 0) {
      document.getElementById('executeSyncBtn').style.display = 'inline-block';
    }
    statusEl.textContent = "Preview generated.";
  } catch (error) {
    statusEl.textContent = "Error during preview.";
    resultsEl.textContent = error.message;
  }
});

document.getElementById('executeSyncBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('syncStatus');
  const resultsEl = document.getElementById('previewResults');
  
  try {
    statusEl.textContent = "Executing batch sync... Do not close window.";
    document.getElementById('executeSyncBtn').style.display = 'none';
    
    const summary = await syncEngine.executeSync(currentPreview, 'ADMIN_USER');
    
    statusEl.textContent = "Sync Complete!";
    resultsEl.textContent = `Success!\nProducts Added: ${summary.added}\nProducts Updated: ${summary.updated}\nErrors: ${summary.errors.length}`;
    currentPreview = null;
  } catch (error) {
    statusEl.textContent = "Error executing sync.";
    resultsEl.textContent = error.message;
  }
});
