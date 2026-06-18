import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Modal, ScrollView,
  I18nManager,
} from 'react-native';
import * as XLSX from 'xlsx';
import { getAllItems, addOrUpdateItem, editItem, deleteItem, getItem, moveStock, getLog } from '../api';
import { inventoryEvents } from '../storage';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

const EDIT_PASSWORD = '12345';

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

  // יבוא אקסל
  const fileInputRef = useRef(null);
  const [xlsxModal, setXlsxModal] = useState(false);
  const [xlsxRows, setXlsxRows] = useState([]);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [xlsxProgress, setXlsxProgress] = useState('');
  const [xlsxDone, setXlsxDone] = useState(false);
  const [xlsxError, setXlsxError] = useState('');

  // קישור ידני לפריט לא מזוהה
  const [linkModal, setLinkModal] = useState(false);
  const [linkRowIdx, setLinkRowIdx] = useState(null);
  const [linkSearch, setLinkSearch] = useState('');

  // הוספת פריט חדש מתעודה
  const [newItemModal, setNewItemModal] = useState(false);
  const [newItemModalIdx, setNewItemModalIdx] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemLocation, setNewItemLocation] = useState('');

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

  // ── יבוא אקסל ──
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setXlsxError('');
    const currentItems = items;
    const reader = new FileReader();
    reader.onerror = () => {
      setXlsxError('לא ניתן לקרוא את הקובץ');
      setXlsxModal(true);
    };
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        if (!wb.SheetNames.length) {
          setXlsxError('הקובץ ריק — אין גיליונות');
          setXlsxModal(true);
          return;
        }
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const parsed = [];
        for (const row of raw) {
          const מקט = String(row[0] || '').trim();
          const תאור = String(row[1] || '').trim();
          const כמות = Number(row[2]);
          if (!מקט || isNaN(כמות) || כמות <= 0) continue;
          // חיפוש התאמה לפי מקט ספק
          let suggestedItem = currentItems.find(i =>
            i.supplierCode && i.supplierCode.toLowerCase() === מקט.toLowerCase()
          ) || null;
          // אם אין התאמת מקט — חפש לפי שם
          if (!suggestedItem && תאור) {
            const desc = תאור.toLowerCase();
            suggestedItem = currentItems.find(i => {
              const name = (i.name || '').toLowerCase();
              const altNames = Array.isArray(i.altNames) ? i.altNames.map(a => String(a).toLowerCase()) : [];
              return name === desc || desc.includes(name) || name.includes(desc) ||
                altNames.some(a => a && (desc.includes(a) || a.includes(desc)));
            }) || null;
          }
          parsed.push({ מקט, תאור, כמות, matchedItem: null, suggestedItem, skip: false });
        }
        if (parsed.length === 0) {
          setXlsxError(`לא נמצאו שורות תקינות (${raw.length} שורות נסרקו — בדוק שעמודה א׳=מקט, ג׳=כמות)`);
          setXlsxModal(true);
          return;
        }
        setXlsxRows(parsed);
        setXlsxProgress('');
        setXlsxDone(false);
        setXlsxModal(true);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (err) {
        setXlsxError('שגיאה בפתיחת הקובץ: ' + (err.message || 'קובץ לא תקין'));
        setXlsxModal(true);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const openLinkModal = (idx) => {
    setLinkRowIdx(idx);
    setLinkSearch('');
    setLinkModal(true);
  };

  const handleLinkItem = (item) => {
    setXlsxRows(prev => prev.map((r, i) =>
      i === linkRowIdx ? { ...r, matchedItem: item } : r
    ));
    setLinkModal(false);
  };

  const toggleSkip = (idx) => {
    setXlsxRows(prev => prev.map((r, i) =>
      i === idx ? { ...r, skip: !r.skip } : r
    ));
  };

  const openNewItemModal = (idx) => {
    setNewItemModalIdx(idx);
    setNewItemName(xlsxRows[idx]?.תאור || '');
    setNewItemLocation('');
    setNewItemModal(true);
  };

  const handleNewItemConfirm = () => {
    if (!newItemName.trim()) return;
    setXlsxRows(prev => prev.map((r, i) =>
      i === newItemModalIdx ? { ...r, newItemName: newItemName.trim(), newItemLocation: newItemLocation.trim() } : r
    ));
    setNewItemModal(false);
  };

  const handleXlsxImport = async () => {
    const matched = xlsxRows.filter(r => !r.skip && r.matchedItem);
    const toAdd = xlsxRows.filter(r => !r.skip && !r.matchedItem && r.newItemName);
    if (matched.length + toAdd.length === 0) {
      Alert.alert('שגיאה', 'אין פריטים לייבוא');
      return;
    }
    setXlsxLoading(true);
    let done = 0;
    const total = matched.length + toAdd.length;

    // עדכון פריטים קיימים
    for (const row of matched) {
      try {
        await moveStock({
          code: row.matchedItem.code,
          action: 'כניסה',
          amount: row.כמות,
          note: `יבוא תעודה — ${row.מקט}`,
        });
        done++;
        setXlsxProgress(`מעדכן... ${done}/${total}`);
      } catch {}
    }

    // הוספת פריטים חדשים
    for (const row of toAdd) {
      try {
        await addOrUpdateItem({
          name: row.newItemName,
          location: row.newItemLocation || '',
          qty: row.כמות,
          supplierCode: row.מקט,
          supplierName: row.תאור,
        });
        done++;
        setXlsxProgress(`מוסיף פריט חדש... ${done}/${total}`);
      } catch {}
    }

    const fresh = await getAllItems();
    setItems(fresh.items || []);
    setXlsxLoading(false);
    setXlsxDone(true);
    setXlsxProgress(`✓ עודכנו ${matched.length} פריטים, נוספו ${toAdd.length} חדשים`);
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
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <TouchableOpacity style={s.fabSecondary} onPress={() => fileInputRef.current?.click()}>
          <Text style={s.fabText}>📥 יבוא תעודה</Text>
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
                  {showSupplierSection ? '▲' : '▼'} מידע ספק
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
                    placeholder="לדוגמה: plst-hc58000004"
                    placeholderTextColor="#BBBBBB"
                  />
                  <Text style={s.fieldLabel}>שם ספק (כפי שמופיע בתעודה)</Text>
                  <TextInput
                    style={s.input}
                    value={editSupplierName}
                    onChangeText={setEditSupplierName}
                    textAlign="right"
                    placeholder="לדוגמה: כבל 3X1.5 חביות"
                    placeholderTextColor="#BBBBBB"
                  />
                  <Text style={s.fieldLabel}>שמות חלופיים (מופרדים בפסיק)</Text>
                  <TextInput
                    style={s.input}
                    value={editAltNames}
                    onChangeText={setEditAltNames}
                    textAlign="right"
                    placeholder="לדוגמה: כבל NYY, כבל שחור"
                    placeholderTextColor="#BBBBBB"
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
              <TouchableOpacity
                style={s.btnDelete}
                onPress={() => Alert.alert(
                  'מחיקת פריט',
                  `למחוק את "${itemToEdit?.name}"?\nפעולה זו אינה ניתנת לביטול.`,
                  [
                    { text: 'ביטול', style: 'cancel' },
                    { text: 'מחק', style: 'destructive', onPress: async () => {
                      try {
                        await deleteItem({ code: itemToEdit.code });
                        setEditModal(false);
                        Alert.alert('✓', 'הפריט נמחק');
                        load();
                      } catch (e) { Alert.alert('שגיאה', e.message); }
                    }},
                  ]
                )}>
                <Text style={s.btnDeleteText}>🗑️ מחק פריט</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── מודאל תנועת מלאי ── */}
      <Modal visible={movModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>🔄 תנועת מלאי — {movItem?.name}</Text>
            <Text style={s.hint}>זמין: {movItem?.available ?? movItem?.qty}  |  כולל: {movItem?.totalQty ?? movItem?.qty}{movItem?.location ? `  |  📍 ${movItem.location}` : ''}</Text>
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

      {/* ── מודאל יבוא אקסל ── */}
      <Modal visible={xlsxModal} animationType="slide" transparent={false}>
        <View style={s.logFullScreen}>
          <View style={s.logHeader}>
            <Text style={s.logHeaderTitle}>📥 יבוא מאקסל</Text>
            <TouchableOpacity style={s.logCloseBtn}
              onPress={() => { if (!xlsxLoading) { setXlsxModal(false); setXlsxError(''); } }}>
              <Text style={s.logCloseBtnText}>✕ סגור</Text>
            </TouchableOpacity>
          </View>

          {/* הצגת שגיאה */}
          {xlsxError ? (
            <View style={s.xlsxErrorBox}>
              <Text style={s.xlsxErrorText}>⚠️ {xlsxError}</Text>
            </View>
          ) : (
            <>
              {/* סטטיסטיקה */}
              <View style={s.xlsxStats}>
                <Text style={s.xlsxStatItem}>✅ {xlsxRows.filter(r => r.matchedItem && !r.skip).length} קיימים</Text>
                <Text style={s.xlsxStatItem}>➕ {xlsxRows.filter(r => !r.matchedItem && r.newItemName && !r.skip).length} חדשים</Text>
                <Text style={s.xlsxStatItem}>❓ {xlsxRows.filter(r => !r.matchedItem && !r.newItemName && !r.skip).length} ממתינים</Text>
                <Text style={s.xlsxStatItem}>⏭ {xlsxRows.filter(r => r.skip).length} מדולגים</Text>
              </View>

              <FlatList
                data={xlsxRows}
                keyExtractor={(_, i) => String(i)}
                contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
                renderItem={({ item: row, index }) => (
                  <View style={[s.xlsxRow, row.skip && s.xlsxRowSkipped]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.xlsxMakat}>{row.מקט}</Text>
                      <Text style={s.xlsxDesc}>{row.תאור}</Text>
                      <Text style={s.xlsxQty}>כמות: {row.כמות}</Text>
                      {row.matchedItem
                        ? <View style={s.xlsxActions}>
                            <Text style={s.xlsxMatched}>✅ {row.matchedItem.name}</Text>
                            <TouchableOpacity onPress={() => setXlsxRows(prev => prev.map((r,i) => i===index ? {...r, matchedItem: null} : r))}>
                              <Text style={s.xlsxCancelLink}>✕ בטל</Text>
                            </TouchableOpacity>
                          </View>
                        : row.newItemName
                          ? <View style={s.xlsxActions}>
                              <Text style={s.xlsxNew}>➕ חדש: {row.newItemName}</Text>
                              <TouchableOpacity onPress={() => setXlsxRows(prev => prev.map((r,i) => i===index ? {...r, newItemName: '', newItemLocation: ''} : r))}>
                                <Text style={s.xlsxCancelLink}>✕ בטל</Text>
                              </TouchableOpacity>
                            </View>
                          : row.suggestedItem
                            ? <View>
                                <Text style={s.xlsxSuggest}>💡 נמצא: {row.suggestedItem.name}</Text>
                                <View style={s.xlsxActions}>
                                  <TouchableOpacity style={s.xlsxBtnYes}
                                    onPress={() => setXlsxRows(prev => prev.map((r,i) => i===index ? {...r, matchedItem: r.suggestedItem, suggestedItem: null} : r))}>
                                    <Text style={s.xlsxBtnYesText}>✓ כן</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity style={s.xlsxBtnNo}
                                    onPress={() => setXlsxRows(prev => prev.map((r,i) => i===index ? {...r, suggestedItem: null} : r))}>
                                    <Text style={s.xlsxBtnNoText}>✕ לא</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            : <View style={s.xlsxActions}>
                                <TouchableOpacity onPress={() => openLinkModal(index)}>
                                  <Text style={s.xlsxLink}>🔗 קשר לפריט קיים</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => openNewItemModal(index)}>
                                  <Text style={s.xlsxLinkNew}>➕ הוסף כפריט חדש</Text>
                                </TouchableOpacity>
                              </View>
                      }
                    </View>
                    <TouchableOpacity style={s.xlsxSkipBtn} onPress={() => toggleSkip(index)}>
                      <Text style={s.xlsxSkipText}>{row.skip ? 'בטל' : 'דלג'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />

              {/* כפתור יבוא */}
              {!xlsxDone ? (
                <View style={s.xlsxFooter}>
                  {xlsxProgress ? <Text style={s.xlsxProgressText}>{xlsxProgress}</Text> : null}
                  <TouchableOpacity
                    style={[s.btnPrim, xlsxLoading && { opacity: 0.6 }]}
                    onPress={handleXlsxImport}
                    disabled={xlsxLoading}>
                    <Text style={s.btnPrimText}>
                      {xlsxLoading ? xlsxProgress || 'מעדכן...' : `בצע יבוא (${xlsxRows.filter(r => !r.skip && r.matchedItem).length} פריטים)`}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={s.xlsxFooter}>
                  <Text style={s.xlsxDoneText}>{xlsxProgress}</Text>
                  <TouchableOpacity style={s.btnPrim} onPress={() => setXlsxModal(false)}>
                    <Text style={s.btnPrimText}>סגור</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>
      </Modal>

      {/* ── מודאל הוספת פריט חדש מתעודה ── */}
      <Modal visible={newItemModal} animationType="fade" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>➕ הוסף פריט חדש</Text>
            {newItemModalIdx !== null && (
              <Text style={s.xlsxMakat}>מקט ספק: {xlsxRows[newItemModalIdx]?.מקט}</Text>
            )}
            <Text style={s.fieldLabel}>שם הפריט (ניתן לשינוי)</Text>
            <TextInput
              style={s.input}
              value={newItemName}
              onChangeText={setNewItemName}
              textAlign="right"
              autoFocus
            />
            <Text style={s.fieldLabel}>מיקום (אופציונלי)</Text>
            <TextInput
              style={s.input}
              value={newItemLocation}
              onChangeText={setNewItemLocation}
              textAlign="right"
              placeholder="מחסן, מדף..."
            />
            <Text style={[s.fieldLabel, { color: '#888', fontSize: 11 }]}>
              המקט של הספק יישמר אוטומטית לזיהוי תעודות עתידיות
            </Text>
            <View style={s.btnRow}>
              <TouchableOpacity style={s.btnSec} onPress={() => setNewItemModal(false)}>
                <Text style={s.btnSecText}>ביטול</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnPrim} onPress={handleNewItemConfirm}>
                <Text style={s.btnPrimText}>אישור</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── מודאל קישור ידני ── */}
      <Modal visible={linkModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={[s.modal, { maxHeight: '80%' }]}>
            <Text style={s.modalTitle}>קשר לפריט במלאי</Text>
            {linkRowIdx !== null && (
              <Text style={s.xlsxMakat}>{xlsxRows[linkRowIdx]?.מקט} — {xlsxRows[linkRowIdx]?.תאור}</Text>
            )}
            <TextInput
              style={[s.input, { marginTop: 10 }]}
              placeholder="חיפוש פריט..."
              value={linkSearch}
              onChangeText={setLinkSearch}
              textAlign="right"
              autoFocus
            />
            <ScrollView style={{ maxHeight: 300 }}>
              {items
                .filter(i => !linkSearch || i.name.includes(linkSearch) || String(i.code).includes(linkSearch))
                .map(i => (
                  <TouchableOpacity key={i.code} style={s.linkItem} onPress={() => handleLinkItem(i)}>
                    <Text style={s.linkItemName}>{i.name}</Text>
                    <Text style={s.linkItemCode}>#{i.code}</Text>
                  </TouchableOpacity>
                ))
              }
            </ScrollView>
            <TouchableOpacity style={[s.btnSec, { marginTop: 10 }]} onPress={() => setLinkModal(false)}>
              <Text style={s.btnSecText}>ביטול</Text>
            </TouchableOpacity>
          </View>
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
  fabSecondary: {
    backgroundColor: '#2E7D32', paddingHorizontal: 22, paddingVertical: 14,
    borderRadius: 30, elevation: 4,
  },
  xlsxStats: {
    flexDirection: 'row-reverse', justifyContent: 'space-around',
    paddingVertical: 10, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#EEE',
  },
  xlsxStatItem: { fontSize: 13, fontWeight: '600', color: '#333' },
  xlsxRow: {
    flexDirection: 'row-reverse', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 10, padding: 12,
    marginBottom: 8, elevation: 1,
    borderRightWidth: 4, borderRightColor: '#1565C0',
  },
  xlsxRowSkipped: { opacity: 0.4, borderRightColor: '#CCC' },
  xlsxMakat: { fontSize: 13, fontWeight: '700', color: '#1565C0', textAlign: 'right' },
  xlsxDesc: { fontSize: 12, color: '#555', textAlign: 'right', marginTop: 2 },
  xlsxQty: { fontSize: 12, color: '#333', textAlign: 'right', marginTop: 2 },
  xlsxMatched: { fontSize: 12, color: '#2E7D32', fontWeight: '600', textAlign: 'right', marginTop: 4 },
  xlsxLink: { fontSize: 12, color: '#F57C00', fontWeight: '600', textAlign: 'right', marginTop: 4 },
  xlsxSkipBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#EEE', borderRadius: 6, marginRight: 8 },
  xlsxSkipText: { fontSize: 12, color: '#555', fontWeight: '600' },
  xlsxFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#EEE',
  },
  xlsxProgressText: { textAlign: 'center', color: '#555', marginBottom: 8, fontSize: 13 },
  xlsxDoneText: { textAlign: 'center', color: '#2E7D32', fontWeight: '700', fontSize: 16, marginBottom: 10 },
  linkItem: {
    flexDirection: 'row-reverse', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEE',
  },
  linkItemName: { fontSize: 14, color: '#1a1a2e', textAlign: 'right' },
  linkItemCode: { fontSize: 12, color: '#888' },
  xlsxNew: { fontSize: 12, color: '#1565C0', fontWeight: '600', textAlign: 'right', marginTop: 4 },
  xlsxActions: { flexDirection: 'row-reverse', gap: 12, marginTop: 4 },
  xlsxLinkNew: { fontSize: 12, color: '#1565C0', fontWeight: '600' },
  xlsxCancelLink: { fontSize: 12, color: '#C62828', fontWeight: '600' },
  xlsxErrorBox: { margin: 16, padding: 16, backgroundColor: '#FFF3E0', borderRadius: 10, borderWidth: 1, borderColor: '#E65100' },
  xlsxErrorText: { color: '#E65100', fontSize: 14, fontWeight: '600', textAlign: 'right' },
  xlsxSuggest: { fontSize: 13, color: '#E65100', fontWeight: '700', textAlign: 'right', marginBottom: 6 },
  xlsxBtnYes: { backgroundColor: '#2E7D32', paddingHorizontal: 18, paddingVertical: 7, borderRadius: 8 },
  xlsxBtnYesText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  xlsxBtnNo: { backgroundColor: '#C62828', paddingHorizontal: 18, paddingVertical: 7, borderRadius: 8 },
  xlsxBtnNoText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnDelete: {
    marginTop: 12, padding: 12, borderRadius: 8, alignItems: 'center',
    borderWidth: 1, borderColor: '#D32F2F', backgroundColor: '#FFF5F5',
  },
  btnDeleteText: { color: '#D32F2F', fontWeight: '700', fontSize: 14 },
});
