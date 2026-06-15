import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, FlatList, Modal, I18nManager,
} from 'react-native';
import { getAllItems, moveStock } from '../api';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

const ACTIONS = ['כניסה', 'משיכה', 'החזרה'];
const ACTION_COLORS = { 'כניסה': '#2E7D32', 'משיכה': '#C62828', 'החזרה': '#1565C0' };

export default function MovementsScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  // טופס תנועה
  const [selectedItem, setSelectedItem] = useState(null);
  const [action, setAction] = useState('כניסה');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [pickModal, setPickModal] = useState(false);
  const [searchPick, setSearchPick] = useState('');

  // היסטוריה מקומית (session בלבד)
  const [history, setHistory] = useState([]);

  const load = useCallback(async () => {
    try {
      const { items: data } = await getAllItems();
      setItems(data || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('inventory-updated', handler);
    return () => window.removeEventListener('inventory-updated', handler);
  }, [load]);

  const handleMove = async () => {
    if (!selectedItem) return Alert.alert('שגיאה', 'בחר פריט');
    if (!amount || isNaN(amount) || Number(amount) <= 0)
      return Alert.alert('שגיאה', 'הכנס כמות חיובית');
    setLoading(true);
    try {
      await moveStock({ code: selectedItem.code, action, amount: Number(amount), note });
      const entry = {
        id: Date.now(),
        item: selectedItem.name,
        code: selectedItem.code,
        action,
        amount: Number(amount),
        note,
        time: new Date().toLocaleTimeString('he-IL'),
      };
      setHistory(h => [entry, ...h]);
      setAmount('');
      setNote('');
      // רענן רשימה ועדכן פריט נבחר
      const refreshed = await getAllItems();
      const updatedItems = refreshed.items || [];
      setItems(updatedItems);
      const updatedSelected = updatedItems.find(i => i.code === selectedItem.code);
      if (updatedSelected) setSelectedItem(updatedSelected);
      Alert.alert('✓ הצלחה', `${action} ${amount} יח' - ${selectedItem.name}`);
    } catch (e) {
      Alert.alert('שגיאה', e.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredPick = items.filter(i =>
    i.name?.includes(searchPick) || String(i.code)?.includes(searchPick)
  );

  return (
    <View style={s.container}>
      {/* כרטיס טופס */}
      <View style={s.form}>
        <Text style={s.formTitle}>תנועת מלאי</Text>

        {/* בחירת פריט */}
        <TouchableOpacity style={s.pickBtn} onPress={() => setPickModal(true)}>
          <Text style={s.pickBtnText}>
            {selectedItem ? `${selectedItem.name} (#${selectedItem.code})` : 'בחר פריט...'}
          </Text>
        </TouchableOpacity>

        {selectedItem && (
          <Text style={s.hint}>זמין: {selectedItem.available ?? selectedItem.qty} יח'</Text>
        )}

        {/* בחירת פעולה */}
        <View style={s.actionRow}>
          {ACTIONS.map(a => (
            <TouchableOpacity
              key={a}
              style={[s.actionBtn, action === a && { backgroundColor: ACTION_COLORS[a] }]}
              onPress={() => setAction(a)}
            >
              <Text style={[s.actionBtnText, action === a && { color: '#fff' }]}>{a}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={s.input}
          placeholder="כמות"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          textAlign="right"
        />
        <TextInput
          style={s.input}
          placeholder="הערה (אופציונלי)"
          value={note}
          onChangeText={setNote}
          textAlign="right"
        />

        <TouchableOpacity
          style={[s.submitBtn, { backgroundColor: ACTION_COLORS[action] }]}
          onPress={handleMove}
          disabled={loading}
        >
          <Text style={s.submitBtnText}>{loading ? 'שולח...' : `בצע ${action}`}</Text>
        </TouchableOpacity>
      </View>

      {/* היסטוריה */}
      {history.length > 0 && (
        <>
          <Text style={s.histTitle}>פעולות אחרונות (סשן זה)</Text>
          <FlatList
            data={history}
            keyExtractor={i => String(i.id)}
            renderItem={({ item }) => (
              <View style={[s.histCard, { borderRightColor: ACTION_COLORS[item.action] }]}>
                <Text style={s.histItem}>{item.item} (#{item.code})</Text>
                <Text style={[s.histAction, { color: ACTION_COLORS[item.action] }]}>
                  {item.action} {item.amount} יח'  ·  {item.time}
                </Text>
                {item.note ? <Text style={s.histNote}>{item.note}</Text> : null}
              </View>
            )}
            contentContainerStyle={{ padding: 12 }}
          />
        </>
      )}

      {/* מודאל בחירת פריט */}
      <Modal visible={pickModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <TextInput
              style={s.search}
              placeholder="חיפוש..."
              value={searchPick}
              onChangeText={setSearchPick}
              textAlign="right"
              autoFocus
            />
            <FlatList
              data={filteredPick}
              keyExtractor={i => String(i.code)}
              style={{ maxHeight: 350 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.pickItem}
                  onPress={() => { setSelectedItem(item); setPickModal(false); setSearchPick(''); }}
                >
                  <Text style={s.pickItemName}>{item.name}</Text>
                  <Text style={s.pickItemSub}>#{item.code}  ·  זמין: {item.available ?? item.qty}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={s.btnSec} onPress={() => setPickModal(false)}>
              <Text style={s.btnSecText}>סגור</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  form: {
    backgroundColor: '#fff', margin: 12, borderRadius: 16,
    padding: 16, elevation: 2,
  },
  formTitle: { fontSize: 17, fontWeight: '700', textAlign: 'right', marginBottom: 12, color: '#1a1a2e' },
  pickBtn: {
    borderWidth: 1, borderColor: '#1565C0', borderRadius: 8,
    padding: 11, marginBottom: 8,
  },
  pickBtnText: { textAlign: 'right', color: '#1565C0', fontSize: 15 },
  hint: { textAlign: 'right', color: '#777', fontSize: 13, marginBottom: 8 },
  actionRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 12 },
  actionBtn: {
    flex: 1, padding: 9, borderRadius: 8, alignItems: 'center',
    borderWidth: 1, borderColor: '#CCC',
  },
  actionBtnText: { fontWeight: '700', color: '#444' },
  input: {
    borderWidth: 1, borderColor: '#DDD', borderRadius: 8,
    padding: 10, marginBottom: 10, fontSize: 15,
  },
  submitBtn: { padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  histTitle: { fontSize: 14, fontWeight: '600', textAlign: 'right', paddingHorizontal: 12, color: '#555' },
  histCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12,
    marginBottom: 8, borderRightWidth: 4, elevation: 1,
  },
  histItem: { fontSize: 14, fontWeight: '600', textAlign: 'right', color: '#1a1a2e' },
  histAction: { fontSize: 13, textAlign: 'right', marginTop: 2 },
  histNote: { fontSize: 12, textAlign: 'right', color: '#777', marginTop: 2 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  search: {
    borderWidth: 1, borderColor: '#DDD', borderRadius: 8,
    padding: 10, marginBottom: 10, fontSize: 15,
  },
  pickItem: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  pickItemName: { fontSize: 15, textAlign: 'right', color: '#1a1a2e' },
  pickItemSub: { fontSize: 12, textAlign: 'right', color: '#888', marginTop: 2 },
  btnSec: { backgroundColor: '#EEE', padding: 11, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  btnSecText: { color: '#333', fontWeight: '700' },
});
