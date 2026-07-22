// ======================================================
// src/api.js  –  שכבת API מול Google Apps Script
// כדי לחבר ל-backend אמיתי: החלף את APPS_SCRIPT_URL
// ======================================================

import { storage, inventoryEvents } from './storage';

// שנה ל-false לאחר פריסה ל-Netlify עם Apps Script מחובר
export const DEMO_MODE = false;

const STORAGE_ITEMS    = 'inv_items';
const STORAGE_PROJECTS = 'inv_projects';
const STORAGE_CODE     = 'inv_nextCode';

async function loadState() {
  try {
    const [itemsStr, projectsStr, codeStr] = await Promise.all([
      storage.getItem(STORAGE_ITEMS),
      storage.getItem(STORAGE_PROJECTS),
      storage.getItem(STORAGE_CODE),
    ]);
    return {
      items:    JSON.parse(itemsStr    || '[]'),
      projects: JSON.parse(projectsStr || '[]'),
      nextCode: parseInt(codeStr       || '1', 10),
    };
  } catch { return { items: [], projects: [], nextCode: 1 }; }
}

async function saveItems(items) {
  await storage.setItem(STORAGE_ITEMS, JSON.stringify(items));
  inventoryEvents.emit();
}
async function saveProjects(projects) {
  await storage.setItem(STORAGE_PROJECTS, JSON.stringify(projects));
}
async function saveNextCode(n) {
  await storage.setItem(STORAGE_CODE, String(n));
}

async function writeLog(action, item, amount, note = '') {
  try {
    const str = await storage.getItem('inv_log');
    const log = JSON.parse(str || '[]');
    log.unshift({
      time: new Date().toLocaleString('he-IL'),
      action,
      code: item.code,
      name: item.name,
      amount,
      totalQty: item.totalQty,
      available: item.available,
      note,
    });
    await storage.setItem('inv_log', JSON.stringify(log.slice(0, 500)));
  } catch {}
}

// Netlify proxy → Apps Script → Google Sheets
const PROXY_URL = '/api/proxy';

async function call(payload) {
  if (DEMO_MODE) return handleDemo(payload);
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (text.trim().startsWith('<')) throw new Error('שגיאת שרת — בדוק חיבור Apps Script');
    const data = JSON.parse(text);
    if (data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    console.error('API error:', e);
    throw e;
  }
}

async function handleDemo(payload) {
  const { action } = payload;
  const state = await loadState();
  let { items, projects, nextCode } = state;

  const recalcAvailable = (item) => {
    item.available = item.totalQty - item.allocations.reduce((s, a) => s + a.qty, 0);
    item.qty = item.totalQty;
  };

  if (action === 'getAllItemsLite') {
    return { items };
  }
  if (action === 'getItemByCodeOrName') {
    const item = items.find(i => i.code == payload.code || i.name === payload.name);
    return { item };
  }
  if (action === 'addOrUpdateItem') {
    const exists = items.find(i => i.name === payload.name);
    if (!exists) {
      const newItem = {
        code: nextCode++, name: payload.name, location: payload.location || '',
        qty: Number(payload.qty || 0), available: Number(payload.qty || 0),
        totalQty: Number(payload.qty || 0), allocations: [],
        supplierCode: payload.supplierCode || '',
        supplierName: payload.supplierName || '',
        altNames: payload.altNames || [],
        minQty: Number(payload.minQty || 0),
      };
      items.push(newItem);
      await writeLog('כניסה ראשונית', newItem, newItem.totalQty, 'פריט חדש');
      await saveItems(items);
      await saveNextCode(nextCode);
    }
    return { success: true };
  }
  if (action === 'editItem') {
    const item = items.find(i => i.code == payload.code);
    if (!item) throw new Error('פריט לא נמצא');
    const oldQty = item.totalQty;
    item.name = payload.name;
    item.location = payload.location;
    item.totalQty = Number(payload.totalQty);
    item.available = Number(payload.available);
    item.qty = Number(payload.totalQty);
    if (payload.minQty !== undefined)       item.minQty       = Number(payload.minQty) || 0;
    if (payload.supplierCode !== undefined) item.supplierCode = payload.supplierCode || '';
    if (payload.supplierName !== undefined) item.supplierName = payload.supplierName || '';
    if (payload.altNames !== undefined)     item.altNames     = payload.altNames || [];
    if (oldQty !== item.totalQty)
      await writeLog('עריכה ידנית', item, item.totalQty - oldQty, `שינוי כמות: ${oldQty}→${item.totalQty}`);
    await saveItems(items);
    return { success: true };
  }
  if (action === 'moveStock') {
    const item = items.find(i => i.code == payload.code);
    if (!item) throw new Error('פריט לא נמצא');
    const amt = Number(payload.amount);
    if (payload.stockAction === 'כניסה') {
      item.totalQty += amt;
    } else if (payload.stockAction === 'משיכה') {
      if (item.available < amt) throw new Error(`אין מספיק זמין. זמין: ${item.available}`);
      item.totalQty -= amt;
    } else if (payload.stockAction === 'החזרה') {
      item.totalQty += amt;
    }
    recalcAvailable(item);
    await writeLog(payload.stockAction, item, amt, payload.note);
    await saveItems(items);
    return { success: true };
  }
  if (action === 'withdrawFromProject') {
    const item = items.find(i => i.code == payload.code);
    if (!item) throw new Error('פריט לא נמצא');
    const amt = Number(payload.qty);
    if (item.totalQty < amt) throw new Error(`אין מספיק במלאי. כולל: ${item.totalQty}`);
    item.totalQty -= amt;
    const alloc = item.allocations.find(a => a.project === payload.projectName);
    if (alloc) alloc.qty = Math.max(0, alloc.qty - amt);
    item.allocations = item.allocations.filter(a => a.qty > 0);
    recalcAvailable(item);
    await writeLog(`משיכה — ${payload.projectName}`, item, amt, payload.note);
    await saveItems(items);
    return { success: true };
  }
  if (action === 'undoWithdrawal') {
    const item = items.find(i => i.code == payload.code);
    if (!item) throw new Error('פריט לא נמצא');
    const amt = Number(payload.qty);
    item.totalQty += amt;
    const alloc = item.allocations.find(a => a.project === payload.projectName);
    if (alloc) alloc.qty += amt;
    else item.allocations.push({ project: payload.projectName, qty: amt });
    recalcAvailable(item);
    await writeLog(`ביטול משיכה — ${payload.projectName}`, item, amt, payload.note || '');
    await saveItems(items);
    return { success: true };
  }
  if (action === 'getAllProjects') {
    return { projects };
  }
  if (action === 'addProject') {
    if (!projects.find(p => p.name === payload.name)) {
      projects.push({ name: payload.name, status: 'פעיל', date: new Date().toISOString().slice(0, 10) });
      await saveProjects(projects);
    }
    return { success: true };
  }
  if (action === 'allocateToProject') {
    const item = items.find(i => i.code == payload.code);
    if (!item) throw new Error('פריט לא נמצא');
    if (item.available < Number(payload.qty)) throw new Error(`אין מספיק זמין (${item.available})`);
    const alloc = item.allocations.find(a => a.project === payload.projectName);
    if (alloc) alloc.qty += Number(payload.qty);
    else item.allocations.push({ project: payload.projectName, qty: Number(payload.qty) });
    recalcAvailable(item);
    await writeLog(`הקצאה — ${payload.projectName}`, item, Number(payload.qty), payload.note);
    await saveItems(items);
    return { success: true };
  }
  if (action === 'returnToStock') {
    const item = items.find(i => i.code == payload.code);
    if (!item) throw new Error('פריט לא נמצא');
    item.totalQty += Number(payload.qty);
    recalcAvailable(item);
    await writeLog(`שחרור — ${payload.projectName}`, item, Number(payload.qty), payload.note);
    await saveItems(items);
    return { success: true };
  }
  if (action === 'getProjectAllocations') {
    const allocs = items
      .filter(i => i.allocations.some(a => a.project === payload.projectName))
      .map(i => ({
        code: i.code,
        name: i.name,
        qty: i.allocations.find(a => a.project === payload.projectName)?.qty,
      }));
    return { allocations: allocs };
  }
  if (action === 'cancelAllocation') {
    const item = items.find(i => i.code == payload.code);
    if (!item) throw new Error('פריט לא נמצא');
    const alloc = item.allocations.find(a => a.project === payload.projectName);
    if (!alloc) return { success: true };
    const qty = Number(payload.qty);
    alloc.qty = Math.max(0, alloc.qty - qty);
    item.allocations = item.allocations.filter(a => a.qty > 0);
    recalcAvailable(item);
    await writeLog(`ביטול הקצאה — ${payload.projectName}`, item, qty);
    await saveItems(items);
    return { success: true };
  }
  if (action === 'editProject') {
    const proj = projects.find(p => p.name === payload.oldName);
    if (!proj) throw new Error('פרויקט לא נמצא');
    const oldName = proj.name;
    proj.name = payload.newName;
    proj.status = payload.status;
    if (oldName !== payload.newName) {
      items.forEach(item => {
        item.allocations.forEach(a => {
          if (a.project === oldName) a.project = payload.newName;
        });
      });
      await saveItems(items);
      // עדכון יומן — כדי שהיסטוריית משיכות תמשיך לעבוד
      try {
        const str = await storage.getItem('inv_log');
        const log = JSON.parse(str || '[]');
        log.forEach(entry => {
          if (entry.action && entry.action.endsWith(`— ${oldName}`)) {
            entry.action = entry.action.replace(`— ${oldName}`, `— ${payload.newName}`);
          }
        });
        await storage.setItem('inv_log', JSON.stringify(log));
      } catch {}
      // עדכון רשימת ציוד נוסף (demo mode)
      try {
        const str = await storage.getItem(`missing_${oldName}`);
        if (str) {
          await storage.setItem(`missing_${payload.newName}`, str);
        }
      } catch {}
    }
    await saveProjects(projects);
    return { success: true };
  }
  if (action === 'getMissingItems') {
    try {
      const str = await storage.getItem(`missing_${payload.projectName}`);
      const list = JSON.parse(str || '[]');
      return { items: list.map((it, i) => ({ id: i, ...it })) };
    } catch { return { items: [] }; }
  }
  if (action === 'addMissingItem') {
    try {
      const str = await storage.getItem(`missing_${payload.projectName}`);
      const list = JSON.parse(str || '[]');
      list.push({ name: payload.name, qty: Number(payload.qty) || 1 });
      await storage.setItem(`missing_${payload.projectName}`, JSON.stringify(list));
    } catch {}
    return { success: true };
  }
  if (action === 'removeMissingItem') {
    try {
      const str = await storage.getItem(`missing_${payload.projectName}`);
      const list = JSON.parse(str || '[]');
      list.splice(Number(payload.id), 1);
      await storage.setItem(`missing_${payload.projectName}`, JSON.stringify(list));
    } catch {}
    return { success: true };
  }
  return {};
}

export function getAllItems() { return call({ action: 'getAllItemsLite' }); }
export function getItem({ code, name }) { return call({ action: 'getItemByCodeOrName', code, name }); }
export function addOrUpdateItem({ name, location, qty, minQty, supplierCode, supplierName, altNames }) {
  return call({ action: 'addOrUpdateItem', name, location, qty, minQty, supplierCode, supplierName, altNames });
}
export function editItem({ code, name, location, totalQty, available, minQty, supplierCode, supplierName, altNames }) {
  return call({ action: 'editItem', code, name, location, totalQty, available, minQty, supplierCode, supplierName, altNames });
}
export function moveStock({ code, action, amount, note = '' }) { return call({ action: 'moveStock', stockAction: action, code, amount, note }); }
export function withdrawFromProject({ code, projectName, qty, note = '' }) { return call({ action: 'withdrawFromProject', code, projectName, qty, note }); }
export function getAllProjects() { return call({ action: 'getAllProjects' }); }
export function addProject({ name }) { return call({ action: 'addProject', name }); }
export function allocateToProject({ code, projectName, qty, note = '' }) { return call({ action: 'allocateToProject', code, projectName, qty, note }); }
export function getProjectAllocations(projectName) { return call({ action: 'getProjectAllocations', projectName }); }
export function cancelProjectAllocation({ code, projectName, qty }) { return call({ action: 'cancelAllocation', code, projectName, qty }); }
export function updateProject({ oldName, newName, status }) { return call({ action: 'editProject', oldName, newName, status }); }
export function returnToStock({ code, qty, projectName, note = '' }) { return call({ action: 'returnToStock', code, qty, projectName, note }); }
export function undoWithdrawal({ code, qty, projectName, note = '' }) { return call({ action: 'undoWithdrawal', code, qty, projectName, note }); }

export function getMissingItems(projectName) { return call({ action: 'getMissingItems', projectName }); }
export function addMissingItem({ projectName, name, qty }) { return call({ action: 'addMissingItem', projectName, name, qty }); }
export function removeMissingItem({ projectName, id }) { return call({ action: 'removeMissingItem', projectName, id }); }

export async function getLog() {
  if (!DEMO_MODE) return call({ action: 'getLog' });
  try {
    const str = await storage.getItem('inv_log');
    return { log: JSON.parse(str || '[]') };
  } catch { return { log: [] }; }
}

export function deleteItem({ code }) { return call({ action: 'deleteItem', code }); }
export function getSupplierMappings() { return call({ action: 'getSupplierMappings' }); }
export function addSupplierMapping({ supplierCode, supplierName, itemCode, itemName }) {
  return call({ action: 'addSupplierMapping', supplierCode, supplierName, itemCode, itemName });
}
export function getSuppliers() { return call({ action: 'getSuppliers' }); }

export async function getProjectWithdrawals(projectName) {
  if (!DEMO_MODE) return call({ action: 'getProjectWithdrawals', projectName });
  try {
    const str = await storage.getItem('inv_log');
    const log = JSON.parse(str || '[]');
    const map = {};
    log.filter(l => l.action === `משיכה — ${projectName}`).forEach(l => {
      if (!map[l.code]) map[l.code] = { code: l.code, name: l.name, totalWithdrawn: 0 };
      map[l.code].totalWithdrawn += l.amount;
    });
    log.filter(l => l.action === `שחרור — ${projectName}` || l.action === `ביטול משיכה — ${projectName}`).forEach(l => {
      if (map[l.code]) map[l.code].totalWithdrawn = Math.max(0, map[l.code].totalWithdrawn - l.amount);
    });
    return { withdrawals: Object.values(map).filter(w => w.totalWithdrawn > 0) };
  } catch { return { withdrawals: [] }; }
}