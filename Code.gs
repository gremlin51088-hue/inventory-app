// ============================================================
// Code.gs — Google Apps Script Backend לניהול מלאי
// הדבק את כל הקוד הזה ב-Apps Script של ה-Google Sheet שלך
// ============================================================

function doGet(e) {
  try {
    const payloadStr = e.parameter.payload;
    if (!payloadStr) return jsonResponse({ error: 'No payload' });
    const payload = JSON.parse(payloadStr);

    // מניעת כתיבות מקבילות
    const lock = LockService.getScriptLock();
    const gotLock = lock.tryLock(8000);
    if (!gotLock) return jsonResponse({ error: 'שרת עמוס, נסה שוב' });

    try {
      initSheets();
      const result = route(payload);
      return jsonResponse(result);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- אתחול גיליונות ----
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  function ensureSheet(name, headers) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(headers);
    } else {
      // הוסף עמודות חסרות אם גיליון קיים עם פחות עמודות
      const lastCol = sh.getLastColumn();
      if (lastCol < headers.length) {
        sh.getRange(1, lastCol + 1, 1, headers.length - lastCol)
          .setValues([headers.slice(lastCol)]);
      }
    }
    return sh;
  }
  ensureSheet('Items',            ['code','name','location','totalQty','available','allocations','supplierCode','supplierName','altNames','minQty']);
  ensureSheet('Projects',         ['name','status','date']);
  ensureSheet('Log',              ['time','action','code','name','amount','totalQty','available','note']);
  ensureSheet('Config',           ['key','value']);
  ensureSheet('SupplierMappings', ['supplierCode','supplierName','itemCode','itemName','addedDate']);
  ensureSheet('MissingItems',     ['project','name','qty']);
  const cfg = ss.getSheetByName('Config');
  if (cfg.getLastRow() <= 1) cfg.appendRow(['nextCode','1']);
}

// ---- Config helpers ----
function getNextCode() {
  const cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');
  const data = cfg.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'nextCode') return parseInt(data[i][1]) || 1;
  }
  return 1;
}
function setNextCode(n) {
  const cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');
  const data = cfg.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'nextCode') { cfg.getRange(i + 1, 2).setValue(n); return; }
  }
  cfg.appendRow(['nextCode', n]);
}

// ---- Items helpers ----
function getAllItems_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Items');
  if (sh.getLastRow() <= 1) return [];
  // קרא כמה עמודות שיש, מינימום 6
  const numCols = Math.max(sh.getLastColumn(), 6);
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, numCols).getValues();
  return data
    .filter(r => r[0] !== '' && r[0] !== null)
    .map(r => ({
      code:         r[0],
      name:         r[1],
      location:     r[2] || '',
      totalQty:     Number(r[3]) || 0,
      available:    Number(r[4]) || 0,
      allocations:  r[5] ? (() => { try { return JSON.parse(r[5]); } catch { return []; } })() : [],
      supplierCode: r[6] || '',
      supplierName: r[7] || '',
      altNames:     r[8] ? (() => { try { return JSON.parse(r[8]); } catch { return []; } })() : [],
      minQty:       Number(r[9]) || 0,
      qty:          Number(r[3]) || 0,
    }));
}
function saveItems_(items) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Items');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  if (items.length === 0) return;
  const rows = items.map(i => [
    i.code, i.name, i.location || '',
    i.totalQty, i.available,
    JSON.stringify(i.allocations || []),
    i.supplierCode || '',
    i.supplierName || '',
    JSON.stringify(i.altNames || []),
    i.minQty || 0,
  ]);
  sh.getRange(2, 1, rows.length, 10).setValues(rows);
}

// ---- Projects helpers ----
function getAllProjects_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Projects');
  if (sh.getLastRow() <= 1) return [];
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  return data
    .filter(r => r[0] !== '')
    .map(r => ({ name: r[0], status: r[1] || 'פעיל', date: r[2] || '' }));
}
function saveProjects_(projects) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Projects');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  if (projects.length === 0) return;
  sh.getRange(2, 1, projects.length, 3).setValues(
    projects.map(p => [p.name, p.status || 'פעיל', p.date || ''])
  );
}

// ---- MissingItems helpers (רשימת ציוד נוסף לפרויקט — משותפת בין מכשירים) ----
function getMissingItems_(projectName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MissingItems');
  if (sh.getLastRow() <= 1) return [];
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === '') continue;
    if (data[i][0] === projectName) {
      result.push({ id: i + 2, name: data[i][1], qty: Number(data[i][2]) || 1 });
    }
  }
  return result;
}
function addMissingItem_(p) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MissingItems');
  sh.appendRow([p.projectName, p.name, Number(p.qty) || 1]);
}
function removeMissingItem_(p) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MissingItems');
  const row = Number(p.id);
  if (row >= 2 && row <= sh.getLastRow()) sh.deleteRow(row);
}
function renameMissingItemsProject_(oldName, newName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MissingItems');
  if (!sh || sh.getLastRow() <= 1) return;
  const range = sh.getRange(2, 1, sh.getLastRow() - 1, 1);
  const vals = range.getValues();
  let changed = false;
  vals.forEach((row, i) => {
    if (row[0] === oldName) { vals[i][0] = newName; changed = true; }
  });
  if (changed) range.setValues(vals);
}

// ---- Log helpers ----
function writeLog_(action, item, amount, note) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Log');
  const tz = Session.getScriptTimeZone();
  const time = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm:ss');
  sh.insertRowBefore(2);
  sh.getRange(2, 1).setNumberFormat('@');  // אלץ טקסט — מונע המרה ל-Date
  sh.getRange(2, 1, 1, 8).setValues([[
    time, action, item.code, item.name,
    amount, item.totalQty, item.available, note || '',
  ]]);
  if (sh.getLastRow() > 501) sh.deleteRows(502, sh.getLastRow() - 501);
}

// ---- Math helper ----
function recalc_(item) {
  item.available = item.totalQty - (item.allocations || []).reduce((s, a) => s + a.qty, 0);
  item.qty = item.totalQty;
}

// ---- Router ----
function route(p) {
  const { action } = p;

  if (action === 'getAllItemsLite') {
    return { items: getAllItems_() };
  }

  if (action === 'getItemByCodeOrName') {
    const item = getAllItems_().find(i => i.code == p.code || i.name === p.name);
    return { item: item || null };
  }

  if (action === 'addOrUpdateItem') {
    const items = getAllItems_();
    if (!items.find(i => i.name === p.name)) {
      const code = getNextCode();
      const newItem = {
        code, name: p.name, location: p.location || '',
        totalQty: Number(p.qty || 0), available: Number(p.qty || 0),
        allocations: [], qty: Number(p.qty || 0),
        supplierCode: p.supplierCode || '',
        supplierName: p.supplierName || '',
        altNames: p.altNames || [],
        minQty: Number(p.minQty || 0),
      };
      items.push(newItem);
      writeLog_('כניסה ראשונית', newItem, newItem.totalQty, 'פריט חדש');
      saveItems_(items);
      setNextCode(code + 1);
    }
    return { success: true };
  }

  if (action === 'deleteItem') {
    const items = getAllItems_();
    const idx = items.findIndex(i => i.code == p.code);
    if (idx === -1) return { error: 'פריט לא נמצא' };
    const item = items[idx];
    writeLog_('מחיקה', item, 0, 'פריט נמחק מהמערכת');
    items.splice(idx, 1);
    saveItems_(items);
    return { success: true };
  }

  if (action === 'editItem') {
    const items = getAllItems_();
    const item = items.find(i => i.code == p.code);
    if (!item) return { error: 'פריט לא נמצא' };
    const oldQty = item.totalQty;
    item.name = p.name;
    item.location = p.location;
    item.totalQty = Number(p.totalQty);
    item.available = Number(p.available);
    item.qty = item.totalQty;
    if (p.minQty !== undefined)       item.minQty       = Number(p.minQty) || 0;
    if (p.supplierCode !== undefined) item.supplierCode = p.supplierCode || '';
    if (p.supplierName !== undefined) item.supplierName = p.supplierName || '';
    if (p.altNames !== undefined)     item.altNames     = p.altNames || [];
    if (oldQty !== item.totalQty)
      writeLog_('עריכה ידנית', item, item.totalQty - oldQty, 'שינוי כמות: ' + oldQty + '→' + item.totalQty);
    saveItems_(items);
    return { success: true };
  }

  if (action === 'moveStock') {
    const items = getAllItems_();
    const item = items.find(i => i.code == p.code);
    if (!item) return { error: 'פריט לא נמצא' };
    const amt = Number(p.amount);
    if (p.stockAction === 'כניסה')       item.totalQty += amt;
    else if (p.stockAction === 'משיכה') {
      if (item.available < amt) return { error: 'אין מספיק זמין. זמין: ' + item.available };
      item.totalQty -= amt;
    } else if (p.stockAction === 'החזרה') item.totalQty += amt;
    recalc_(item);
    writeLog_(p.stockAction, item, amt, p.note);
    saveItems_(items);
    return { success: true };
  }

  if (action === 'withdrawFromProject') {
    const items = getAllItems_();
    const item = items.find(i => i.code == p.code);
    if (!item) return { error: 'פריט לא נמצא' };
    const amt = Number(p.qty);
    if (item.totalQty < amt) return { error: 'אין מספיק במלאי. כולל: ' + item.totalQty };
    item.totalQty -= amt;
    const alloc = item.allocations.find(a => a.project === p.projectName);
    if (alloc) alloc.qty = Math.max(0, alloc.qty - amt);
    item.allocations = item.allocations.filter(a => a.qty > 0);
    recalc_(item);
    writeLog_('משיכה — ' + p.projectName, item, amt, p.note);
    saveItems_(items);
    return { success: true };
  }

  if (action === 'getAllProjects') {
    return { projects: getAllProjects_() };
  }

  if (action === 'addProject') {
    const projects = getAllProjects_();
    if (!projects.find(pr => pr.name === p.name)) {
      projects.push({ name: p.name, status: 'פעיל', date: new Date().toISOString().slice(0, 10) });
      saveProjects_(projects);
    }
    return { success: true };
  }

  if (action === 'allocateToProject') {
    const items = getAllItems_();
    const item = items.find(i => i.code == p.code);
    if (!item) return { error: 'פריט לא נמצא' };
    if (item.available < Number(p.qty)) return { error: 'אין מספיק זמין (' + item.available + ')' };
    const alloc = item.allocations.find(a => a.project === p.projectName);
    if (alloc) alloc.qty += Number(p.qty);
    else item.allocations.push({ project: p.projectName, qty: Number(p.qty) });
    recalc_(item);
    writeLog_('הקצאה — ' + p.projectName, item, Number(p.qty), p.note);
    saveItems_(items);
    return { success: true };
  }

  if (action === 'returnToStock') {
    const items = getAllItems_();
    const item = items.find(i => i.code == p.code);
    if (!item) return { error: 'פריט לא נמצא' };
    item.totalQty += Number(p.qty);
    recalc_(item);
    writeLog_('שחרור — ' + p.projectName, item, Number(p.qty), p.note || '');
    saveItems_(items);
    return { success: true };
  }

  if (action === 'getProjectAllocations') {
    const items = getAllItems_();
    const allocs = items
      .filter(i => i.allocations.some(a => a.project === p.projectName))
      .map(i => ({
        code: i.code, name: i.name,
        qty: i.allocations.find(a => a.project === p.projectName).qty,
      }));
    return { allocations: allocs };
  }

  if (action === 'cancelAllocation') {
    const items = getAllItems_();
    const item = items.find(i => i.code == p.code);
    if (!item) return { error: 'פריט לא נמצא' };
    const alloc = item.allocations.find(a => a.project === p.projectName);
    if (!alloc) return { success: true };
    const qty = Number(p.qty);
    alloc.qty = Math.max(0, alloc.qty - qty);
    item.allocations = item.allocations.filter(a => a.qty > 0);
    recalc_(item);
    writeLog_('ביטול הקצאה — ' + p.projectName, item, qty, '');
    saveItems_(items);
    return { success: true };
  }

  if (action === 'editProject') {
    const projects = getAllProjects_();
    const proj = projects.find(pr => pr.name === p.oldName);
    if (!proj) return { error: 'פרויקט לא נמצא' };
    const oldName = proj.name;
    proj.name = p.newName; proj.status = p.status;
    if (oldName !== p.newName) {
      const items = getAllItems_();
      items.forEach(item => item.allocations.forEach(a => {
        if (a.project === oldName) a.project = p.newName;
      }));
      saveItems_(items);
      renameMissingItemsProject_(oldName, p.newName);
      // עדכון שמות ביומן
      try {
        const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Log');
        if (sh.getLastRow() > 1) {
          const range = sh.getRange(2, 2, sh.getLastRow() - 1, 1);
          const vals = range.getValues();
          vals.forEach((row, i) => {
            if (row[0] && row[0].toString().endsWith('— ' + oldName)) {
              vals[i][0] = row[0].toString().replace('— ' + oldName, '— ' + p.newName);
            }
          });
          range.setValues(vals);
        }
      } catch(e) {}
    }
    saveProjects_(projects);
    return { success: true };
  }

  if (action === 'getLog') {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Log');
    if (sh.getLastRow() <= 1) return { log: [] };
    const rows = sh.getRange(2, 1, Math.min(sh.getLastRow() - 1, 500), 8).getValues();
    const tz = Session.getScriptTimeZone();
    return {
      log: rows.filter(r => r[0] !== '').map(r => ({
        time: r[0] instanceof Date
          ? Utilities.formatDate(r[0], tz, 'dd/MM/yyyy HH:mm:ss')
          : String(r[0]),
        action: r[1], code: r[2], name: r[3],
        amount: r[4], totalQty: r[5], available: r[6], note: r[7],
      }))
    };
  }

  if (action === 'getProjectWithdrawals') {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Log');
    if (sh.getLastRow() <= 1) return { withdrawals: [] };
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().filter(r => r[0] !== '');
    const map = {};
    rows.filter(r => r[1] === 'משיכה — ' + p.projectName).forEach(r => {
      if (!map[r[2]]) map[r[2]] = { code: r[2], name: r[3], totalWithdrawn: 0 };
      map[r[2]].totalWithdrawn += Number(r[4]);
    });
    rows.filter(r => r[1] === 'שחרור — ' + p.projectName).forEach(r => {
      if (map[r[2]]) map[r[2]].totalWithdrawn = Math.max(0, map[r[2]].totalWithdrawn - Number(r[4]));
    });
    return { withdrawals: Object.values(map).filter(w => w.totalWithdrawn > 0) };
  }

  if (action === 'getSupplierMappings') {
    return getSupplierMappings_();
  }

  if (action === 'addSupplierMapping') {
    return addSupplierMapping_(p);
  }

  if (action === 'getSuppliers') {
    return getSuppliers_();
  }

  if (action === 'getMissingItems') {
    return { items: getMissingItems_(p.projectName) };
  }

  if (action === 'addMissingItem') {
    addMissingItem_(p);
    return { success: true };
  }

  if (action === 'removeMissingItem') {
    removeMissingItem_(p);
    return { success: true };
  }

  return {};
}

// ============================================================
// מיפויי ספקים
// ============================================================

function getSupplierMappings_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SupplierMappings');
  if (!sh || sh.getLastRow() <= 1) return { mappings: [] };
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  return {
    mappings: data
      .filter(r => r[0] !== '')
      .map(r => ({
        supplierCode: r[0],
        supplierName: r[1],
        itemCode:     r[2],
        itemName:     r[3],
        addedDate:    r[4] instanceof Date ? Utilities.formatDate(r[4], Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : String(r[4]),
      }))
  };
}

function addSupplierMapping_(p) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SupplierMappings');
  if (!sh) return { error: 'SupplierMappings sheet not found' };
  // בדוק אם קיים (אותו supplierCode + supplierName)
  if (sh.getLastRow() > 1) {
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(p.supplierCode) && String(data[i][1]) === String(p.supplierName)) {
        // עדכן itemCode ו-itemName
        sh.getRange(i + 2, 3).setValue(p.itemCode);
        sh.getRange(i + 2, 4).setValue(p.itemName);
        return { success: true };
      }
    }
  }
  const tz = Session.getScriptTimeZone();
  const date = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm:ss');
  sh.appendRow([p.supplierCode, p.supplierName, p.itemCode, p.itemName, date]);
  return { success: true };
}

// ================================================================
// תיקון באג יבוא — הרץ פעם אחת מה-Apps Script Editor
// ================================================================
function fixImportBug() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName('Log');
  if (!logSh || logSh.getLastRow() <= 1) {
    Browser.msgBox('היומן ריק — אין מה לתקן');
    return;
  }

  const data = logSh.getRange(2, 1, logSh.getLastRow() - 1, 8).getValues();
  // עמודות: 0=time,1=action,2=code,3=name,4=amount,5=totalQty,6=available,7=note

  const corrections = {}; // code → amount to add back

  for (let i = 0; i < data.length - 1; i++) {
    const curr = data[i];
    const next = data[i + 1];
    const currAction = String(curr[1]);
    const nextAction = String(next[1]);
    const currNote   = String(curr[7]);
    const nextNote   = String(next[7]);

    // זיהוי זוג: עריכה ידנית (הבאג) ← מיד אחרי כניסה מיבוא תעודה
    if (
      currAction === 'עריכה ידנית' &&
      nextAction === 'כניסה' &&
      nextNote.startsWith('יבוא תעודה') &&
      String(curr[2]) === String(next[2])  // אותו קוד פריט
    ) {
      const code = String(curr[2]);
      const addedQty = Number(next[4]); // הכמות שיובאה ואיבדנו
      corrections[code] = (corrections[code] || 0) + addedQty;
    }
  }

  if (Object.keys(corrections).length === 0) {
    Browser.msgBox('לא נמצאו פריטים שנפגעו מהבאג ✅');
    return;
  }

  // תיקון בפועל
  const items = getAllItems_();
  let fixedCount = 0;
  for (const [code, addBack] of Object.entries(corrections)) {
    const item = items.find(i => String(i.code) === code);
    if (!item) continue;
    const before = item.totalQty;
    item.totalQty += addBack;
    item.available += addBack;
    item.qty = item.totalQty;
    writeLog_('תיקון באג יבוא', item, addBack,
      `תיקון אוטומטי: ${before}→${item.totalQty}`);
    fixedCount++;
  }
  saveItems_(items);

  // דוח
  const lines = Object.entries(corrections).map(([code, qty]) => {
    const item = items.find(i => String(i.code) === code);
    return `${item ? item.name : code}: +${qty} יח'`;
  }).join('\n');

  Browser.msgBox(`✅ תוקנו ${fixedCount} פריטים:\n\n${lines}`);
}

function getSuppliers_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SupplierMappings');
  if (!sh || sh.getLastRow() <= 1) return { suppliers: [] };
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  const set = new Set();
  data.forEach(r => { if (r[1]) set.add(String(r[1])); });
  return { suppliers: Array.from(set) };
}
