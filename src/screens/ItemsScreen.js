import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Modal, ScrollView,
  I18nManager, Platform,
} from 'react-native';
import { getAllItems, addOrUpdateItem, editItem, getItem, moveStock, getLog } from '../api';
import { inventoryEvents } from '../storage';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

const EDIT_PASSWORD = '12345';

// ── Document extraction via Claude API ─────────────────────

async function loadPDFJS() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('web only')); return; }
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('לא ניתן לטעון PDF.js'));
    document.head.appendChild(script);
  });
}

// ממיר קובץ (PDF/תמונה) לרשימת דפים base64, שולח ל-Claude, מחזיר [{מקט, תיאור, כמות}]
async function extractWithClaude(file, onProgress) {
  const isPDF = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
  const pages = [];

  if (isPDF) {
    const pdfjs = await loadPDFJS();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const total = pdf.numPages;

    for (let i = 1; i <= total; i++) {
      if (onProgress) onProgress(i, total);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      // base64 JPEG (ללא הקידומת data:...)
      pages.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    }
  } else {
    if (onProgress) onProgress(1, 1);
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    pages.push(base64);
  }

  if (onProgress) onProgress(null, null); // "שולח ל-Claude..."

  const resp = await fetch('/.netlify/functions/claude-ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages }),
  });

  // קרא את גוף התשובה גם אם יש שגיאה — כדי לראות מה בדיוק קרה
  let data;
  try { data = await resp.json(); } catch { data = {}; }
  if (!resp.ok || data.error) throw new Error(data.error || `שגיאת שרת ${resp.status}`);
  return data.items || [];
}

// ── Delivery note parser ────────────────────────────────────
//
// מזהה שורות בפורמט תעודת משלוח ישראלית:
//   מקט | תיאור | כמות.00 | מחיר | סה"כ
//
// דוגמה: "trb38w12  סרט בידוד רחב לבן  10.00  4.5000  45.00"

function parseDeliveryNote(text, items) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 4);
  const results = [];

  // שורת פריט אמיתית בתעודת משלוח חייבת לקיים שני תנאים:
  // 1. קוד מקט — אותיות לועזיות עם מספרים (trb38w12, plst-hc58000004, gw27041...)
  // 2. כמות בפורמט עשרוני NN.00 (1.00, 10.00, 300.00...)
  //    שורות כותרת/כתובת/סיכום אינן מקיימות שני התנאים יחד.

  // מקט: רצף של אות לועזית + לפחות 3 תווים לועזיים/ספרות (לא רווח)
  const MKT_RE = /\b([a-zA-Z][a-zA-Z0-9]{2,}(?:[-_.][a-zA-Z0-9._/-]+)?)\b/;
  // כמות: מספר שלם 1–99999 עם .00 (כמו שמדפיסה מערכת הנהח"ש)
  const QTY_RE = /\b(\d{1,5})\.00\b/;

  for (const line of lines) {
    // חייב מקט לועזי — מסנן כותרות עברית
    const mktMatch = line.match(MKT_RE);
    if (!mktMatch) continue;

    // מקט חייב להכיל לפחות ספרה אחת — מסנן מותגים כמו SYSTEM, SCAME, PVC
    const mkt = mktMatch[1].toLowerCase();
    if (!/\d/.test(mkt)) continue;

    // חייב כמות NN.00 — מסנן שורות פרטי חברה, תאריכים וכו'
    // OCR קורא מימין לשמאל: סה"כ מחיר מגיע לפני כמות בטקסט
    // → מחפשים את כל ה-NN.00 ולוקחים את הקטן ביותר (= כמות, לא מחיר כולל)
    const qtyMatches = [...line.matchAll(/\b(\d{1,5})\.00\b/g)];
    if (qtyMatches.length === 0) continue;
    const qty = Math.min(...qtyMatches.map(m => parseInt(m[1])));
    if (qty <= 0 || qty > 9999) continue;

    // תיאור: מה שנשאר אחרי הסרת המקט, המספרים והסימנים
    let desc = line
      .replace(mktMatch[0], ' ')
      .replace(/\d+(?:[.,]\d+)?/g, ' ')
      .replace(/[|\\/:;"'(){}\[\]]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (desc.length < 2) desc = mkt;

    // זיהוי: קודם מקט ספק מדויק → אחר כך שם/תיאור
    let matchedItem =
      items.find(i => i.supplierCode && i.supplierCode.toLowerCase() === mkt) ||
      matchItemByText(desc, items) ||
      matchItemByText(mkt, items) ||
      null;

    results.push({
      rawLine: line,
      parsedText: desc,
      mkt,
      parsedQty: qty,
      matchedItem,
    });
  }

  // הסר כפילויות לפי מקט
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.mkt)) return false;
    seen.add(r.mkt);
    return true;
  });
}

function matchItemByText(text, items) {
  const t = text.toLowerCase();

  // 1. חיפוש לפי קוד ספק
  for (const item of items) {
    if (item.supplierCode && text.includes(item.supplierCode)) return item;
  }

  // 2. חיפוש לפי שם ספק
  for (const item of items) {
    if (item.supplierName) {
      const sn = item.supplierName.toLowerCase();
      if (t.includes(sn) || sn.includes(t)) return item;
    }
  }

  // 3. חיפוש בשמות חלופיים
  for (const item of items) {
    for (const alt of (item.altNames || [])) {
      const al = alt.toLowerCase();
      if (t.includes(al) || al.includes(t)) return item;
    }
  }

  // 4. חיפוש חלקי בשם הפריט
  for (const item of items) {
    const name = item.name.toLowerCase();
    if (t.includes(name) || (name.length > 3 && name.includes(t))) return item;
  }

  return null;
}

// ── Component ───────────────────────────────────────────────

export default function ItemsScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  // עריכה
  const [passwordModal, setPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [editModal, setEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editAvailable, setEditAvailable] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editMinQty, setEditMinQty] = useState('');
  const [editSupplierCode, setEditSupplierCode] = useState('');
  const [editSupplierName, setEditSupplierName] = useState('');
  const [editAltNames, setEditAltNames] = useState('');
  const [showSupplierSection, setShowSupplierSection] = useState(false);
  const [itemToEdit, setItemToEdit] = useState(null);

  // טופס הוספה
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newQty, setNewQty] = useState('');

  // תנועות מלאי
  const [movModal, setMovModal] = useState(false);
  const [movItem, setMovItem] = useState(null);
  const [movAction, setMovAction] = useState('כניסה');
  const [movAmount, setMovAmount] = useState('');
  const [movNote, setMovNote] = useState('');
  const [movLoading, setMovLoading] = useState(false);
  const [movError, setMovError] = useState('');

  // יומן
  const [logModal, setLogModal] = useState(false);
  const [logData, setLogData] = useState([]);

  // יבוא תעודת משלוח
  const [importModal, setImportModal] = useState(false);
  const [importStatus, setImportStatus] = useState('idle'); // idle | processing | done
  const [importFile, setImportFile] = useState(null);
  const [importFileName, setImportFileName] = useState('');
  const [importLines, setImportLines] = useState([]);
  const [importSaving, setImportSaving] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importError, setImportError] = useState('');

  const MOV_COLORS = { 'כניסה': '#2E7D32', 'משיכה': '#C62828', 'החזרה': '#1565C0' };

  const load = useCallback(async () => {
    try {
      const data = await getAllItems();
      setItems(data.items || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { return inventoryEvents.subscribe(() => load()); }, [load]);

  const filtered = items.filter(i =>
    i.name?.includes(search) || String(i.code)?.includes(search)
  );

  // ── הוספת פריט ──
  const handleAdd = async () => {
    if (!newName.trim()) return Alert.alert('שגיאה', 'שם פריט נדרש');
    if (!newQty || isNaN(newQty) || Number(newQty) < 0)
      return Alert.alert('שגיאה', 'כמות חייבת להיות מספר חיובי');
    try {
      await addOrUpdateItem({ name: newName.trim(), location: newLocation.trim(), qty: Number(newQty) });
      setAddModal(false);
      setNewName(''); setNewLocation(''); setNewQty('');
      load();
    } catch (e) { Alert.alert('שגיאה', e.message); }
  };

  // ── פרטי פריט ──
  const handleItemPress = async (item) => {
    try {
      const data = await getItem({ code: item.code });
      setSelectedItem(data.item || item);
    } catch { setSelectedItem(item); }
    setDetailModal(true);
  };

  // ── תנועת מלאי ──
  const openMovModal = (item) => {
    setMovItem(item); setMovAction('כניסה');
    setMovAmount(''); setMovNote(''); setMovError('');
    setDetailModal(false); setMovModal(true);
  };

  const handleMov = async () => {
    setMovError('');
    if (!movAmount || isNaN(movAmount) || Number(movAmount) <= 0) {
      setMovError('הכנס כמות חיובית'); return;
    }
    setMovLoading(true);
    try {
      await moveStock({ code: movItem.code, action: movAction, amount: Number(movAmount), note: movNote });
      const fresh = await getAllItems();
      setItems(fresh.items || []);
      setMovModal(false); setMovAmount(''); setMovNote('');
    } catch (e) { setMovError(e.message); }
    finally { setMovLoading(false); }
  };

  // ── יומן ──
  const openLog = async () => {
    const data = await getLog();
    setLogData(data.log || []);
    setLogModal(true);
  };

  // ── עריכה ──
  const openPasswordModal = (item) => {
    setItemToEdit(item);
    setPasswordInput(''); setPasswordError('');
    setDetailModal(false); setPasswordModal(true);
  };

  const handlePasswordSubmit = () => {
    if (passwordInput === EDIT_PASSWORD) {
      setPasswordModal(false);
      setEditName(itemToEdit.name);
      setEditQty(String(itemToEdit.totalQty ?? itemToEdit.qty));
      setEditAvailable(String(itemToEdit.available ?? itemToEdit.qty));
      setEditLocation(itemToEdit.location || '');
      setEditMinQty(itemToEdit.minQty ? String(itemToEdit.minQty) : '');
      setEditSupplierCode(itemToEdit.supplierCode || '');
      setEditSupplierName(itemToEdit.supplierName || '');
      setEditAltNames((itemToEdit.altNames || []).join(', '));
      setShowSupplierSection(false);
      setEditModal(true);
    } else {
      setPasswordError('סיסמא שגויה');
    }
  };

  const handleEditSave = async () => {
    if (!editName.trim()) return Alert.alert('שגיאה', 'שם לא יכול להיות ריק');
    const totalQtyNum = Number(editQty);
    const availableNum = Number(editAvailable);
    if (isNaN(totalQtyNum) || totalQtyNum < 0) return Alert.alert('שגיאה', 'כמות כוללת לא תקינה');
    if (isNaN(availableNum) || availableNum < 0) return Alert.alert('שגיאה', 'כמות זמינה לא תקינה');
    if (availableNum > totalQtyNum) return Alert.alert('שגיאה', 'כמות זמינה לא יכולה לעלות על הכוללת');
    const minQtyNum = editMinQty ? Number(editMinQty) : 0;
    if (isNaN(minQtyNum) || minQtyNum < 0) return Alert.alert('שגיאה', 'כמות מינימלית לא תקינה');
    try {
      await editItem({
        code: itemToEdit.code,
        name: editName.trim(),
        location: editLocation.trim(),
        totalQty: totalQtyNum,
        available: availableNum,
        minQty: minQtyNum,
        supplierCode: editSupplierCode.trim(),
        supplierName: editSupplierName.trim(),
        altNames: editAltNames.split(',').map(s => s.trim()).filter(Boolean),
      });
      setEditModal(false);
      Alert.alert('✓', 'הפריט עודכן בהצלחה');
      load();
    } catch (e) { Alert.alert('שגיאה', e.message); }
  };

  // ── יבוא תעודת משלוח ──

  const handlePickFile = () => {
    if (Platform.OS !== 'web') {
      Alert.alert('שים לב', 'יבוא תעודה זמין בגרסת הווב בלבד');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setImportFile(file);
      setImportFileName(file.name);
      setImportStatus('idle');
      setImportLines([]);
    };
    input.click();
  };

  const handleProcessImport = async () => {
    if (!importFile) return;
    setImportStatus('processing');
    setImportProgress('ממיר דפים...');
    setImportError('');
    try {
      const claudeItems = await extractWithClaude(importFile, (page, total) => {
        if (page === null) setImportProgress('שולח ל-Claude לניתוח...');
        else setImportProgress(`ממיר עמוד ${page} מתוך ${total}...`);
      });

      setImportLines(claudeItems.map(p => {
        const mkt = (p['מקט'] || '').toLowerCase().trim();
        const pdfDesc = (p['תיאור'] || '').trim();
        // כמות: Claude עשוי להחזיר מספר או מחרוזת כמו "100 10.00" — קח את הקטן
        const rawQty = p['כמות'];
        let qty = 1;
        if (typeof rawQty === 'number') {
          qty = rawQty;
        } else if (typeof rawQty === 'string') {
          const nums = rawQty.match(/\d+/g);
          qty = nums ? Math.min(...nums.map(Number)) : 1;
        }
        qty = qty > 0 ? qty : 1;

        // מצא פריט לפי מקט ספק קודם, אחר כך לפי תיאור מה-PDF
        const matchedItem =
          (mkt && items.find(i => i.supplierCode && i.supplierCode.toLowerCase() === mkt)) ||
          (mkt && matchItemByText(mkt, items)) ||
          (pdfDesc && matchItemByText(pdfDesc, items)) ||
          null;

        // עדיפות: שם מהמלאי > תיאור מה-PDF > מקט
        const displayText = matchedItem ? matchedItem.name : (pdfDesc || mkt);

        return {
          rawText: displayText,
          mkt,
          parsedQty: qty,
          matchedItemCode: matchedItem?.code ?? null,
          customQty: String(qty),
          included: false,
          autoMatched: matchedItem !== null,
          pickerSearch: '',
        };
      }));
      setImportStatus('done');
    } catch (err) {
      const msg = err.message || 'לא ניתן לעבד את הקובץ';
      setImportError(msg);
      setImportStatus('idle');
    }
  };

  const handleConfirmImport = async () => {
    const toProcess = importLines.filter(l => l.included && l.matchedItemCode && parseInt(l.customQty) > 0);
    if (toProcess.length === 0) {
      Alert.alert('שים לב', 'לא נבחרו שורות לעדכון');
      return;
    }
    setImportSaving(true);
    try {
      for (const line of toProcess) {
        // שמור כניסת מלאי
        await moveStock({
          code: line.matchedItemCode,
          action: 'כניסה',
          amount: parseInt(line.customQty),
          note: `יבוא תעודה: ${line.rawText}`,
        });

        // שמור קישור מקט↔פריט לצמיתות (אם יש מקט ולפריט עדיין אין supplierCode)
        if (line.mkt) {
          const matchedItem = items.find(i => i.code === line.matchedItemCode);
          if (matchedItem && !matchedItem.supplierCode) {
            try {
              await editItem({
                code: matchedItem.code,
                name: matchedItem.name,
                location: matchedItem.location || '',
                totalQty: matchedItem.totalQty,
                available: matchedItem.available,
                minQty: matchedItem.minQty || 0,
                supplierCode: line.mkt,           // שמור מקט לזיהוי אוטומטי בפעם הבאה
                supplierName: matchedItem.supplierName || '',
                altNames: matchedItem.altNames || [],
              });
            } catch {}  // אל תעצור אם שמירת המקט נכשלה
          }
        }
      }
      setImportModal(false);
      setImportStatus('idle');
      setImportLines([]);
      setImportFile(null);
      setImportFileName('');
      load();
      Alert.alert('✓', `עודכנו ${toProcess.length} פריטים מהתעודה`);
    } catch (e) {
      Alert.alert('שגיאה', e.message);
    } finally {
      setImportSaving(false);
    }
  };

  const updateImportLine = (index, changes) => {
    setImportLines(prev => prev.map((l, i) => i === index ? { ...l, ...changes } : l));
  };

  // ── Render ──

  const renderItem = ({ item }) => (
    <TouchableOpacity style={s.card} onPress={() => handleItemPress(item)}>
      <View style={s.cardRow}>
        <Text style={s.itemName}>{item.name}</Text>
        <Text style={s.itemCode}>#{item.code}</Text>
      </View>
      <View style={s.cardRow}>
        <Text style={s.label}>זמין: <Text style={s.val}>{item.available ?? item.qty}</Text></Text>
        <Text style={s.label}>כולל: <Text style={s.val}>{item.totalQty ?? item.qty}</Text></Text>
        <Text style={s.label}>📍 {item.location || '—'}</Text>
      </View>
      {item.minQty > 0 && (item.available ?? item.qty) < item.minQty && (
        <Text style={s.lowStockBadge}>⚠️ מתחת למינימום ({item.minQty})</Text>
      )}
    </TouchableOpacity>
  );

  const confirmedCount = importLines.filter(l => l.included && l.matchedItemCode).length;

  return (
    <View style={s.container}>
      <View style={s.topBar}>
        <TextInput
          style={s.search}
          placeholder="חיפוש לפי שם או קוד..."
          value={search}
          onChangeText={setSearch}
          textAlign="right"
        />
        <TouchableOpacity style={s.logBtn} onPress={openLog}>
          <Text style={s.logBtnText}>📋 יומן</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#1565C0" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => String(i.code)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
          ListEmptyComponent={<Text style={s.empty}>אין פריטים</Text>}
        />
      )}

      {/* כפתורי FAB */}
      <View style={s.fabContainer}>
        <TouchableOpacity style={s.fabSecondary} onPress={() => setImportModal(true)}>
          <Text style={s.fabSecondaryText}>📄 יבוא תעודה</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.fab} onPress={() => setAddModal(true)}>
          <Text style={s.fabText}>+ הוסף פריט</Text>
        </TouchableOpacity>
      </View>

      {/* ── מודאל הוספה ── */}
      <Modal visible={addModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>הוספת פריט חדש</Text>
            <TextInput style={s.input} placeholder="שם פריט *" value={newName}
              onChangeText={setNewName} textAlign="right" />
            <TextInput style={s.input} placeholder="מיקום" value={newLocation}
              onChangeText={setNewLocation} textAlign="right" />
            <TextInput style={s.input} placeholder="כמות ראשונית" value={newQty}
              onChangeText={setNewQty} keyboardType="numeric" textAlign="right" />
            <View style={s.btnRow}>
              <TouchableOpacity style={s.btnSec} onPress={() => setAddModal(false)}>
                <Text style={s.btnSecText}>ביטול</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnPrim} onPress={handleAdd}>
                <Text style={s.btnPrimText}>הוסף</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── מודאל פרטים ── */}
      <Modal visible={detailModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <ScrollView>
            <View style={s.modal}>
              <Text style={s.modalTitle}>{selectedItem?.name}</Text>
              <Text style={s.detailRow}>קוד: #{selectedItem?.code}</Text>
              <Text style={s.detailRow}>מיקום: {selectedItem?.location || '—'}</Text>
              <Text style={s.detailRow}>כמות כוללת: {selectedItem?.totalQty ?? selectedItem?.qty}</Text>
              <Text style={s.detailRow}>כמות זמינה: {selectedItem?.available ?? selectedItem?.qty}</Text>
              {selectedItem?.minQty > 0 && (
                <Text style={s.detailRow}>כמות מינימלית: {selectedItem.minQty}</Text>
              )}
              {selectedItem?.allocations?.length > 0 && (
                <>
                  <Text style={[s.detailRow, { fontWeight: '700', marginTop: 8 }]}>הקצאות פעילות:</Text>
                  {selectedItem.allocations.map((a, i) => (
                    <Text key={i} style={s.detailRow}>  • {a.project}: {a.qty} יח'</Text>
                  ))}
                </>
              )}
              <View style={[s.btnRow, { marginTop: 16 }]}>
                <TouchableOpacity style={s.btnSec} onPress={() => setDetailModal(false)}>
                  <Text style={s.btnSecText}>סגור</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.btnMov} onPress={() => openMovModal(selectedItem)}>
                  <Text style={s.btnPrimText}>🔄 תנועה</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.btnEdit} onPress={() => openPasswordModal(selectedItem)}>
                  <Text style={s.btnPrimText}>✏️ ערוך</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── מודאל סיסמא ── */}
      <Modal visible={passwordModal} animationType="fade" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>🔒 הכנס סיסמא לעריכה</Text>
            <TextInput
              style={[s.input, passwordError ? { borderColor: '#C62828' } : {}]}
              placeholder="סיסמא"
              value={passwordInput}
              onChangeText={t => { setPasswordInput(t); setPasswordError(''); }}
              secureTextEntry textAlign="right" autoFocus
            />
            {passwordError ? <Text style={s.errorText}>{passwordError}</Text> : null}
            <View style={s.btnRow}>
              <TouchableOpacity style={s.btnSec} onPress={() => setPasswordModal(false)}>
                <Text style={s.btnSecText}>ביטול</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnPrim} onPress={handlePasswordSubmit}>
                <Text style={s.btnPrimText}>אישור</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── מודאל עריכה ── */}
      <Modal visible={editModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <ScrollView>
            <View style={s.modal}>
              <Text style={s.modalTitle}>✏️ עריכת פריט</Text>

              <Text style={s.fieldLabel}>שם פריט</Text>
              <TextInput style={s.input} value={editName} onChangeText={setEditName} textAlign="right" />

              <Text style={s.fieldLabel}>כמות כוללת</Text>
              <TextInput style={s.input} value={editQty} onChangeText={setEditQty} keyboardType="numeric" textAlign="right" />

              <Text style={s.fieldLabel}>כמות זמינה</Text>
              <TextInput style={s.input} value={editAvailable} onChangeText={setEditAvailable} keyboardType="numeric" textAlign="right" />

              <Text style={s.fieldLabel}>מיקום</Text>
              <TextInput style={s.input} value={editLocation} onChangeText={setEditLocation} textAlign="right" />

              <Text style={s.fieldLabel}>כמות מינימלית לחוסרים (0 = ללא)</Text>
              <TextInput
                style={s.input}
                value={editMinQty}
                onChangeText={setEditMinQty}
                keyboardType="numeric"
                textAlign="right"
                placeholder="0"
              />

              {/* מידע ספק — ניתן לפריסה */}
              <TouchableOpacity
                style={s.sectionToggle}
                onPress={() => setShowSupplierSection(v => !v)}>
                <Text style={s.sectionToggleText}>
                  {showSupplierSection ? '▲' : '▼'} מידע ספק (לזיהוי תעודות)
                </Text>
              </TouchableOpacity>

              {showSupplierSection && (
                <View style={s.supplierSection}>
                  <Text style={s.fieldLabel}>מקט ספק (קוד בתעודה)</Text>
                  <TextInput
                    style={s.input}
                    value={editSupplierCode}
                    onChangeText={setEditSupplierCode}
                    textAlign="right"
                    placeholder="1234-ABC"
                  />
                  <Text style={s.fieldLabel}>שם ספק (כפי שמופיע בתעודה)</Text>
                  <TextInput
                    style={s.input}
                    value={editSupplierName}
                    onChangeText={setEditSupplierName}
                    textAlign="right"
                    placeholder="ברגים M6 DIN933"
                  />
                  <Text style={s.fieldLabel}>שמות חלופיים (מופרדים בפסיק)</Text>
                  <TextInput
                    style={s.input}
                    value={editAltNames}
                    onChangeText={setEditAltNames}
                    textAlign="right"
                    placeholder="בורג M6, Screw M6"
                  />
                </View>
              )}

              <View style={s.btnRow}>
                <TouchableOpacity style={s.btnSec} onPress={() => setEditModal(false)}>
                  <Text style={s.btnSecText}>ביטול</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.btnPrim} onPress={handleEditSave}>
                  <Text style={s.btnPrimText}>שמור</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── מודאל תנועת מלאי ── */}
      <Modal visible={movModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>🔄 תנועת מלאי — {movItem?.name}</Text>
            <Text style={s.hint}>זמין: {movItem?.available ?? movItem?.qty}  |  כולל: {movItem?.totalQty ?? movItem?.qty}</Text>
            <View style={s.actionRow}>
              {['כניסה','משיכה','החזרה'].map(a => (
                <TouchableOpacity key={a}
                  style={[s.actionBtn, movAction === a && { backgroundColor: MOV_COLORS[a] }]}
                  onPress={() => setMovAction(a)}>
                  <Text style={[s.actionBtnText, movAction === a && { color: '#fff' }]}>{a}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={s.input} placeholder="כמות" value={movAmount}
              onChangeText={v => { setMovAmount(v); setMovError(''); }}
              keyboardType="numeric" textAlign="right" />
            <TextInput style={s.input} placeholder="הערה (אופציונלי)" value={movNote}
              onChangeText={setMovNote} textAlign="right" />
            {movError ? <Text style={s.errorText}>{movError}</Text> : null}
            <View style={s.btnRow}>
              <TouchableOpacity style={s.btnSec} onPress={() => setMovModal(false)}>
                <Text style={s.btnSecText}>ביטול</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btnPrim, { backgroundColor: MOV_COLORS[movAction] }]}
                onPress={handleMov} disabled={movLoading}>
                <Text style={s.btnPrimText}>{movLoading ? '...' : `בצע ${movAction}`}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── מודאל יומן — מסך מלא ── */}
      <Modal visible={logModal} animationType="slide" transparent={false}>
        <View style={s.logFullScreen}>
          <View style={s.logHeader}>
            <Text style={s.logHeaderTitle}>📋 יומן תנועות</Text>
            <TouchableOpacity style={s.logCloseBtn} onPress={() => setLogModal(false)}>
              <Text style={s.logCloseBtnText}>✕ סגור</Text>
            </TouchableOpacity>
          </View>
          {logData.length === 0
            ? <Text style={s.empty}>אין תנועות עדיין</Text>
            : <FlatList
                data={logData}
                keyExtractor={(_, i) => String(i)}
                contentContainerStyle={{ padding: 12 }}
                renderItem={({ item }) => (
                  <View style={s.logRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.logName}>{item.name}</Text>
                      <Text style={s.logSub}>{item.action} · {item.amount} יח' · {item.time}</Text>
                      {item.note ? <Text style={s.logNote}>{item.note}</Text> : null}
                    </View>
                    <View style={s.logQtys}>
                      <Text style={s.logQtyLabel}>כולל</Text>
                      <Text style={s.logQtyVal}>{item.totalQty}</Text>
                      <Text style={s.logQtyLabel}>זמין</Text>
                      <Text style={s.logQtyVal}>{item.available}</Text>
                    </View>
                  </View>
                )}
              />
          }
        </View>
      </Modal>

      {/* ── מודאל יבוא תעודת משלוח ── */}
      <Modal visible={importModal} animationType="slide" transparent={false}>
        <View style={s.logFullScreen}>
          <View style={s.logHeader}>
            <Text style={s.logHeaderTitle}>📄 יבוא תעודת משלוח</Text>
            <TouchableOpacity style={s.logCloseBtn} onPress={() => {
              setImportModal(false);
              setImportStatus('idle');
              setImportLines([]);
              setImportFile(null);
              setImportFileName('');
            }}>
              <Text style={s.logCloseBtnText}>✕ סגור</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>

            {/* שלב 1 — בחירת קובץ */}
            <View style={s.importCard}>
              <Text style={s.importSectionTitle}>שלב 1 — העלאת קובץ</Text>
              <Text style={s.importHint}>תמונה (JPG/PNG) או PDF של תעודת המשלוח</Text>
              <TouchableOpacity style={s.importPickBtn} onPress={handlePickFile}>
                <Text style={s.importPickBtnText}>
                  {importFileName ? `📎 ${importFileName}` : '📂 בחר קובץ'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* שלב 2 — עיבוד OCR */}
            {importFile && importStatus !== 'done' && (
              <View style={s.importCard}>
                <Text style={s.importSectionTitle}>שלב 2 — עיבוד תעודה</Text>
                {importStatus === 'processing' ? (
                  <View style={s.importProcessingRow}>
                    <ActivityIndicator color="#1565C0" />
                    <Text style={s.importProcessingText}>{importProgress || 'מעבד תעודה...'}</Text>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity style={s.btnPrim} onPress={handleProcessImport}>
                      <Text style={s.btnPrimText}>🔍 עבד תעודה</Text>
                    </TouchableOpacity>
                    {importError ? (
                      <Text style={{ color: '#C62828', fontSize: 13, textAlign: 'right', marginTop: 8 }}>
                        ⚠️ {importError}
                      </Text>
                    ) : null}
                  </>
                )}
              </View>
            )}

            {/* שלב 3 — סקירה ואישור */}
            {importStatus === 'done' && (
              <View style={s.importCard}>
                <Text style={s.importSectionTitle}>שלב 3 — אישור כניסות</Text>
                {importLines.length === 0 ? (
                  <Text style={s.importHint}>לא זוהו שורות בתעודה. נסה תמונה ברזולוציה גבוהה יותר.</Text>
                ) : (
                  <>
                    <Text style={s.importHint}>
                      זוהו {importLines.length} שורות · {confirmedCount} אושרו ✓
                    </Text>
                    <Text style={[s.importHint, { color: '#E65100', marginTop: -4 }]}>
                      בדוק כל שורה ולחץ ○ לאישור לפני שמירה
                    </Text>

                    {importLines.map((line, idx) => {
                      const matchedItem = items.find(i => i.code === line.matchedItemCode);
                      return (
                        <View key={idx} style={[
                          s.importLine,
                          line.included ? s.importLineConfirmed : null,
                        ]}>
                          {/* כפתור אישור */}
                          <TouchableOpacity
                            style={[s.importCheckbox, line.included && s.importCheckboxDone]}
                            onPress={() => updateImportLine(idx, { included: !line.included })}>
                            <Text style={[s.importCheckboxText, line.included && { color: '#fff', fontSize: 16 }]}>
                              {line.included ? '✓' : '○'}
                            </Text>
                          </TouchableOpacity>

                          <View style={{ flex: 1 }}>
                            {/* מקט + תיאור מהתעודה */}
                            <View style={s.importRawRow}>
                              {line.mkt ? <Text style={s.importMktBadge}>{line.mkt}</Text> : null}
                              <Text style={s.importRawText} numberOfLines={1}>{line.rawText}</Text>
                            </View>

                            {/* פריט מזוהה / בחירה */}
                            <View style={s.importMatchRow}>
                              <Text style={s.importArrow}>←</Text>
                              {matchedItem ? (
                                <TouchableOpacity
                                  onPress={() => updateImportLine(idx, { matchedItemCode: null, included: false })}
                                  style={s.importMatchedBadge}>
                                  {line.autoMatched && !line.included && (
                                    <Text style={s.importAutoTag}>זוהה אוטומטית · </Text>
                                  )}
                                  <Text style={s.importMatchedText} numberOfLines={1}>
                                    {matchedItem.name}
                                  </Text>
                                  <Text style={s.importClearMatch}> ✕</Text>
                                </TouchableOpacity>
                              ) : (
                                <View style={s.importPickerWrap}>
                                  <TextInput
                                    style={s.importPickerSearch}
                                    placeholder="חפש פריט במלאי..."
                                    value={line.pickerSearch}
                                    onChangeText={v => updateImportLine(idx, { pickerSearch: v })}
                                  />
                                  {(line.pickerSearch
                                    ? items.filter(i =>
                                        i.name.toLowerCase().includes(line.pickerSearch.toLowerCase()) ||
                                        String(i.code).includes(line.pickerSearch)
                                      )
                                    : items
                                  ).slice(0, 5).map(item => (
                                    <TouchableOpacity
                                      key={item.code}
                                      style={s.importPickerOption}
                                      onPress={() => updateImportLine(idx, {
                                        matchedItemCode: item.code,
                                        pickerSearch: '',
                                      })}>
                                      <Text style={s.importPickerOptionText} numberOfLines={1}>
                                        {item.name}
                                      </Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              )}
                            </View>
                          </View>

                          {/* כמות */}
                          <View style={s.importQtyBlock}>
                            <Text style={s.importQtyLabel}>כמות</Text>
                            <TextInput
                              style={[s.importQtyInput, line.included && s.importQtyInputDone]}
                              value={line.customQty}
                              onChangeText={v => updateImportLine(idx, { customQty: v })}
                              keyboardType="numeric"
                              textAlign="center"
                            />
                          </View>
                        </View>
                      );
                    })}

                    <TouchableOpacity
                      style={[s.btnPrim, { marginTop: 16 }, (importSaving || confirmedCount === 0) && { opacity: 0.5 }]}
                      onPress={handleConfirmImport}
                      disabled={importSaving || confirmedCount === 0}>
                      <Text style={s.btnPrimText}>
                        {importSaving ? 'שומר...' : confirmedCount === 0 ? 'אשר שורות כדי להמשיך' : `✓ שמור ${confirmedCount} כניסות`}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  topBar: { flexDirection: 'row-reverse', alignItems: 'center', paddingRight: 12, paddingLeft: 4, paddingTop: 8 },
  search: {
    flex: 1, padding: 10, backgroundColor: '#fff',
    borderRadius: 10, borderWidth: 1, borderColor: '#DDD', fontSize: 15,
    marginLeft: 8,
  },
  logBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  logBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  hint: { textAlign: 'right', color: '#777', fontSize: 13, marginBottom: 10 },
  actionRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 12 },
  actionBtn: { flex: 1, padding: 9, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#CCC' },
  actionBtnText: { fontWeight: '700', color: '#444' },
  logRow: { flexDirection: 'row-reverse', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEE', gap: 8 },
  logName: { fontSize: 14, fontWeight: '600', textAlign: 'right', color: '#1a1a2e' },
  logSub: { fontSize: 12, textAlign: 'right', color: '#555', marginTop: 2 },
  logNote: { fontSize: 11, textAlign: 'right', color: '#888', marginTop: 1 },
  logQtys: { alignItems: 'center', minWidth: 60 },
  logQtyLabel: { fontSize: 10, color: '#999' },
  logQtyVal: { fontSize: 14, fontWeight: '700', color: '#1565C0' },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 10, elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3,
  },
  cardRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 4 },
  itemName: { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  itemCode: { fontSize: 13, color: '#888' },
  label: { fontSize: 13, color: '#555' },
  val: { fontWeight: '600', color: '#1565C0' },
  lowStockBadge: {
    fontSize: 11, color: '#E65100', fontWeight: '600', textAlign: 'right',
    marginTop: 4,
  },
  empty: { textAlign: 'center', marginTop: 40, color: '#999', fontSize: 15 },
  fabContainer: {
    position: 'absolute', bottom: 20, left: 0, right: 0,
    flexDirection: 'row-reverse', justifyContent: 'center', gap: 10,
    paddingHorizontal: 16,
  },
  fab: {
    backgroundColor: '#1565C0', paddingHorizontal: 22, paddingVertical: 14,
    borderRadius: 30, elevation: 4,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  fabSecondary: {
    backgroundColor: '#37474F', paddingHorizontal: 18, paddingVertical: 14,
    borderRadius: 30, elevation: 4,
  },
  fabSecondaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', textAlign: 'right', marginBottom: 16, color: '#1a1a2e' },
  input: {
    borderWidth: 1, borderColor: '#DDD', borderRadius: 8,
    padding: 10, marginBottom: 10, fontSize: 15,
  },
  btnRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 8 },
  btnPrim: { flex: 1, backgroundColor: '#1565C0', padding: 12, borderRadius: 8, alignItems: 'center' },
  btnPrimText: { color: '#fff', fontWeight: '700' },
  btnSec: { flex: 1, backgroundColor: '#EEE', padding: 12, borderRadius: 8, alignItems: 'center' },
  btnSecText: { color: '#333', fontWeight: '700' },
  detailRow: { fontSize: 14, textAlign: 'right', marginBottom: 6, color: '#333' },
  btnEdit: { flex: 1, backgroundColor: '#F57C00', padding: 12, borderRadius: 8, alignItems: 'center' },
  btnMov: { flex: 1, backgroundColor: '#2E7D32', padding: 12, borderRadius: 8, alignItems: 'center' },
  errorText: { color: '#C62828', textAlign: 'right', fontSize: 13, marginBottom: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', textAlign: 'right', color: '#555', marginBottom: 4 },
  sectionToggle: {
    borderWidth: 1, borderColor: '#DDD', borderRadius: 8,
    padding: 10, marginBottom: 10, backgroundColor: '#F5F7FA',
  },
  sectionToggleText: { textAlign: 'right', color: '#1565C0', fontWeight: '600', fontSize: 13 },
  supplierSection: {
    borderWidth: 1, borderColor: '#E3F2FD', borderRadius: 8,
    padding: 12, marginBottom: 10, backgroundColor: '#F8FBFF',
  },
  logFullScreen: { flex: 1, backgroundColor: '#F5F7FA' },
  logHeader: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1565C0', paddingHorizontal: 16, paddingVertical: 14, paddingTop: 44,
  },
  logHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  logCloseBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  logCloseBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Import
  importCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    marginBottom: 12, elevation: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3,
  },
  importSectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', textAlign: 'right', marginBottom: 6 },
  importHint: { fontSize: 13, color: '#777', textAlign: 'right', marginBottom: 10 },
  importPickBtn: {
    borderWidth: 2, borderStyle: 'dashed', borderColor: '#1565C0',
    borderRadius: 10, padding: 14, alignItems: 'center',
  },
  importPickBtnText: { color: '#1565C0', fontWeight: '600', fontSize: 14 },
  importProcessingRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, padding: 8 },
  importProcessingText: { color: '#555', fontSize: 14 },
  importLine: {
    flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#EEE', paddingVertical: 10,
    borderRadius: 8, paddingHorizontal: 4,
  },
  importLineConfirmed: {
    backgroundColor: '#F1FFF4',
    borderBottomColor: '#A5D6A7',
  },
  importCheckbox: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: '#CCC',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  importCheckboxDone: {
    backgroundColor: '#2E7D32', borderColor: '#2E7D32',
  },
  importCheckboxText: { fontSize: 18, color: '#999' },
  importRawRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginBottom: 4 },
  importMktBadge: {
    fontSize: 10, color: '#1565C0', backgroundColor: '#E3F2FD',
    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
  },
  importAutoTag: { fontSize: 11, color: '#888', fontStyle: 'italic' },
  importRawText: { fontSize: 12, color: '#888', textAlign: 'right', flex: 1 },
  importMatchRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  importArrow: { fontSize: 14, color: '#999' },
  importMatchedBadge: {
    flexDirection: 'row-reverse', alignItems: 'center',
    backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, flex: 1,
  },
  importMatchedText: { fontSize: 13, color: '#2E7D32', fontWeight: '600', flex: 1, textAlign: 'right' },
  importClearMatch: { fontSize: 13, color: '#999' },
  importItemPicker: { flexDirection: 'row-reverse', gap: 6 },
  importPickerWrap: { flex: 1 },
  importPickerSearch: {
    borderWidth: 1, borderColor: '#CCC', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    fontSize: 13, textAlign: 'right', marginBottom: 4, backgroundColor: '#FAFAFA',
  },
  importPickerOption: {
    backgroundColor: '#EEF2FF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5,
    marginBottom: 3,
  },
  importPickerOptionText: { fontSize: 13, color: '#1565C0', textAlign: 'right' },
  importQtyBlock: { alignItems: 'center', minWidth: 52 },
  importQtyLabel: { fontSize: 11, color: '#888', marginBottom: 2 },
  importQtyInput: {
    borderWidth: 1, borderColor: '#DDD', borderRadius: 6,
    padding: 6, fontSize: 14, fontWeight: '700', width: 52, textAlign: 'center',
  },
  importQtyInputDone: {
    borderColor: '#2E7D32', color: '#2E7D32',
  },
});
