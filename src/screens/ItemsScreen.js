import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Modal, ScrollView,
  I18nManager,
} from 'react-native';
import { getAllItems, addOrUpdateItem, editItem, getItem, moveStock, getLog } from '../api';
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

      {/* כפתור FAB */}
      <View style={s.fabContainer}>
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
});
