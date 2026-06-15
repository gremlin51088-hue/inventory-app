import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, I18nManager, ActivityIndicator,
} from 'react-native';
import { getAllItems } from '../api';
import { inventoryEvents } from '../storage';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

export default function LowStockScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getAllItems();
      const all = data.items || [];
      // הצג רק פריטים שהוגדרה להם כמות מינימלית וכמותם נמוכה ממנה
      const low = all.filter(i => i.minQty > 0 && (i.available ?? i.qty) < i.minQty);
      setItems(low);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return inventoryEvents.subscribe(() => load());
  }, [load]);

  return (
    <View style={s.container}>
      {loading ? (
        <ActivityIndicator size="large" color="#C62828" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => String(i.code)}
          contentContainerStyle={{ padding: 12 }}
          ListHeaderComponent={
            items.length > 0 ? (
              <View style={s.header}>
                <Text style={s.headerText}>⚠️ {items.length} פריטים מתחת לכמות המינימלית</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <Text style={s.emptyIcon}>✅</Text>
              <Text style={s.emptyText}>אין חוסרים במלאי</Text>
              <Text style={s.emptySubText}>כל הפריטים עם מינימום מוגדר מעל הסף</Text>
            </View>
          }
          renderItem={({ item }) => {
            const available = item.available ?? item.qty;
            const shortage = item.minQty - available;
            return (
              <View style={s.card}>
                <View style={s.cardTop}>
                  <Text style={s.itemName}>{item.name}</Text>
                  <Text style={s.itemCode}>#{item.code}</Text>
                </View>
                <View style={s.cardBottom}>
                  <View style={s.qtyBlock}>
                    <Text style={s.qtyLabel}>זמין</Text>
                    <Text style={[s.qtyVal, { color: available === 0 ? '#C62828' : '#E65100' }]}>
                      {available}
                    </Text>
                  </View>
                  <View style={s.qtyBlock}>
                    <Text style={s.qtyLabel}>מינימום</Text>
                    <Text style={[s.qtyVal, { color: '#555' }]}>{item.minQty}</Text>
                  </View>
                  <View style={s.qtyBlock}>
                    <Text style={s.qtyLabel}>חסר</Text>
                    <Text style={[s.qtyVal, { color: '#C62828' }]}>-{shortage}</Text>
                  </View>
                  {item.location ? (
                    <View style={s.qtyBlock}>
                      <Text style={s.qtyLabel}>מיקום</Text>
                      <Text style={s.locationVal}>{item.location}</Text>
                    </View>
                  ) : null}
                </View>
                {item.allocations?.length > 0 && (
                  <Text style={s.allocHint}>
                    📌 מוקצה: {item.allocations.reduce((sum, a) => sum + a.qty, 0)} יח׳ לפרויקטים
                  </Text>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    backgroundColor: '#FFEBEE', borderRadius: 10, padding: 12,
    marginBottom: 8, borderRightWidth: 4, borderRightColor: '#C62828',
  },
  headerText: { fontSize: 14, fontWeight: '700', color: '#C62828', textAlign: 'right' },
  emptyContainer: { alignItems: 'center', marginTop: 80 },
  emptyIcon: { fontSize: 52, marginBottom: 14 },
  emptyText: { fontSize: 18, fontWeight: '700', color: '#2E7D32', marginBottom: 6 },
  emptySubText: { fontSize: 14, color: '#888' },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 10, elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3,
    borderRightWidth: 4, borderRightColor: '#C62828',
  },
  cardTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 12 },
  itemName: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', flex: 1, textAlign: 'right' },
  itemCode: { fontSize: 13, color: '#888' },
  cardBottom: { flexDirection: 'row-reverse', justifyContent: 'flex-start', gap: 28 },
  qtyBlock: { alignItems: 'center' },
  qtyLabel: { fontSize: 11, color: '#888', marginBottom: 3 },
  qtyVal: { fontSize: 22, fontWeight: '800', color: '#1a1a2e' },
  locationVal: { fontSize: 13, fontWeight: '600', color: '#555' },
  allocHint: {
    fontSize: 12, color: '#777', textAlign: 'right',
    marginTop: 10, borderTopWidth: 1, borderTopColor: '#EEE', paddingTop: 8,
  },
});
