import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, FlatList, Modal, ScrollView, I18nManager,
} from 'react-native';
import {
  getAllProjects, addProject, getAllItems,
  allocateToProject, getProjectAllocations,
  withdrawFromProject, getProjectWithdrawals, returnToStock,
  cancelProjectAllocation, updateProject,
} from '../api';
import { inventoryEvents } from '../storage';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

export default function ProjectsScreen() {
  const [projects, setProjects] = useState([]);
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('allocate');

  // refs לגלילה לסוף
  const projectsListRef = useRef(null);
  const allocPickerRef = useRef(null);
  const noteInputRef = useRef(null);

  // ---- הקצאה ----
  const [selProject, setSelProject] = useState(null);
  const [selProjectAllocs, setSelProjectAllocs] = useState([]);
  const [selItem, setSelItem] = useState(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  // ---- משיכה ----
  const [withdrawProject, setWithdrawProject] = useState(null);
  const [withdrawList, setWithdrawList] = useState([]);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawSuccess, setWithdrawSuccess] = useState('');
  const [pickWithdrawProjectModal, setPickWithdrawProjectModal] = useState(false);
  const [withdrawNote, setWithdrawNote] = useState('');
  const [withdrawNoteError, setWithdrawNoteError] = useState(false);

  // ---- שחרור ----
  const [releaseProject, setReleaseProject] = useState(null);
  const [releaseList, setReleaseList] = useState([]);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [releaseError, setReleaseError] = useState('');
  const [releaseSuccess, setReleaseSuccess] = useState('');
  const [pickReleaseProjectModal, setPickReleaseProjectModal] = useState(false);
  const [allocatedList, setAllocatedList] = useState([]);

  // ---- מודאלים ----
  const [pickProjectModal, setPickProjectModal] = useState(false);
  const [pickItemModal, setPickItemModal] = useState(false);
  const [addProjectModal, setAddProjectModal] = useState(false);
  const [projectDetailModal, setProjectDetailModal] = useState(false);
  const [projectDetail, setProjectDetail] = useState(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [searchPick, setSearchPick] = useState('');

  // ---- עריכת פרויקט ----
  const [editProjectModal, setEditProjectModal] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState(null);
  const [editProjectName, setEditProjectName] = useState('');
  const [editProjectStatus, setEditProjectStatus] = useState('פעיל');

  const load = useCallback(async () => {
    try {
      const [p, i] = await Promise.all([getAllProjects(), getAllItems()]);
      setProjects(p.projects || []);
      setItems(i.items || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return inventoryEvents.subscribe(() => load());
  }, [load]);

  // ---- בחירת פרויקט למשיכה ----
  const handleSelectWithdrawProject = async (project) => {
    setPickWithdrawProjectModal(false);
    setWithdrawProject(project);
    setWithdrawError(''); setWithdrawSuccess('');
    setWithdrawNote(''); setWithdrawNoteError(false);
    try {
      const [allocData, itemsData] = await Promise.all([
        getProjectAllocations(project.name),
        getAllItems(),
      ]);
      const itemsMap = {};
      (itemsData.items || []).forEach(i => { itemsMap[i.code] = i; });
      setWithdrawList((allocData.allocations || []).map(a => ({
        code: a.code, name: a.name,
        allocatedQty: a.qty,
        availableInStock: itemsMap[a.code]?.available ?? itemsMap[a.code]?.qty ?? 0,
        actualQty: String(a.qty), selected: true,
      })));
    } catch { setWithdrawList([]); }
  };

  // ---- בחירת פרויקט לשחרור ----
  const handleSelectReleaseProject = async (project) => {
    setPickReleaseProjectModal(false);
    setReleaseProject(project);
    setReleaseError(''); setReleaseSuccess('');
    setReleaseList([]); setAllocatedList([]);

    if (project.status && project.status !== 'פעיל') {
      setReleaseError(`הפרויקט "${project.name}" אינו פעיל. יש להחזירו למצב פעיל לפני ביצוע שחרור.`);
      return;
    }

    try {
      const withdrawn = await getProjectWithdrawals(project.name);
      setReleaseList((withdrawn.withdrawals || []).map(w => ({
        code: w.code, name: w.name,
        totalWithdrawn: w.totalWithdrawn,
        returnQty: '', selected: false,
      })));
      const allocs = await getProjectAllocations(project.name);
      setAllocatedList(allocs.allocations || []);
    } catch { setReleaseList([]); setAllocatedList([]); }
  };

  // ---- ביטול הקצאה (לא משנה totalQty) ----
  const cancelAllocation = async (item) => {
    setReleaseError(''); setReleaseSuccess('');
    try {
      await cancelProjectAllocation({ code: item.code, projectName: releaseProject.name, qty: item.qty });
      setReleaseSuccess(`✓ ${item.name} — הקצאה בוטלה, ${item.qty} יח' חזרו לזמין`);
      const allocs = await getProjectAllocations(releaseProject.name);
      setAllocatedList(allocs.allocations || []);
      load();
    } catch (e) { setReleaseError(e.message); }
  };

  const toggleReleaseAll = (val) => setReleaseList(l => l.map(i => ({ ...i, selected: val })));
  const updateReturnQty = (code, val) => setReleaseList(l => l.map(i => i.code === code ? { ...i, returnQty: val } : i));
  const toggleReleaseSelected = (code) => setReleaseList(l => l.map(i => i.code === code ? { ...i, selected: !i.selected } : i));

  const handleRelease = async () => {
    setReleaseError(''); setReleaseSuccess('');
    const toReturn = releaseList.filter(i => i.selected && Number(i.returnQty) > 0);
    if (toReturn.length === 0) { setReleaseError('בחר פריטים וציין כמות'); return; }
    for (const i of toReturn) {
      const q = Number(i.returnQty);
      if (isNaN(q) || q <= 0) { setReleaseError(`כמות לא תקינה: ${i.name}`); return; }
    }
    setReleaseLoading(true);
    try {
      for (const i of toReturn) {
        await returnToStock({ code: i.code, qty: Number(i.returnQty), projectName: releaseProject.name });
      }
      setReleaseSuccess(`✓ ${toReturn.length} פריטים הוחזרו למחסן מ"${releaseProject.name}"`);
      setReleaseProject(null); setReleaseList([]);
      load();
    } catch (e) { setReleaseError(e.message); }
    finally { setReleaseLoading(false); }
  };

  const toggleSelectAll = (val) => setWithdrawList(wl => wl.map(i => ({ ...i, selected: val })));
  const updateActualQty = (code, val) => setWithdrawList(wl => wl.map(i => i.code === code ? { ...i, actualQty: val } : i));
  const toggleSelected = (code) => setWithdrawList(wl => wl.map(i => i.code === code ? { ...i, selected: !i.selected } : i));

  const handleWithdraw = async () => {
    setWithdrawError(''); setWithdrawSuccess('');
    if (!withdrawNote.trim()) {
      setWithdrawNoteError(true);
      setWithdrawError('יש להזין שם קבלן מבצע לפני הביצוע');
      return;
    }
    setWithdrawNoteError(false);
    const toWithdraw = withdrawList.filter(i => i.selected);
    if (toWithdraw.length === 0) { setWithdrawError('לא נבחרו פריטים'); return; }
    for (const i of toWithdraw) {
      const q = Number(i.actualQty);
      if (isNaN(q) || q <= 0) { setWithdrawError(`כמות לא תקינה: ${i.name}`); return; }
      const maxWithdraw = i.availableInStock + i.allocatedQty;
      if (q > maxWithdraw) {
        setWithdrawError(`${i.name}: כמות בפועל (${q}) עולה על המקסימום האפשרי (מוקצה ${i.allocatedQty} + זמין ${i.availableInStock} = ${maxWithdraw})`);
        return;
      }
    }
    setWithdrawLoading(true);
    try {
      for (const i of toWithdraw) {
        await withdrawFromProject({ code: i.code, projectName: withdrawProject.name, qty: Number(i.actualQty), note: withdrawNote.trim() });
      }
      setWithdrawSuccess(`✓ בוצעה משיכה של ${toWithdraw.length} פריטים מפרויקט "${withdrawProject.name}" — ${withdrawNote.trim()}`);
      setWithdrawProject(null); setWithdrawList([]); setWithdrawNote('');
      load();
    } catch (e) { setWithdrawError(e.message); }
    finally { setWithdrawLoading(false); }
  };

  // ---- טעינת הקצאות לפרויקט הנבחר ----
  const loadSelProjectAllocs = useCallback(async (project) => {
    if (!project) { setSelProjectAllocs([]); return; }
    try {
      const data = await getProjectAllocations(project.name);
      setSelProjectAllocs(data.allocations || []);
    } catch { setSelProjectAllocs([]); }
  }, []);

  useEffect(() => { loadSelProjectAllocs(selProject); }, [selProject, loadSelProjectAllocs]);

  // ---- הקצאה ----
  const handleAction = async () => {
    if (!selProject) return Alert.alert('שגיאה', 'בחר פרויקט');
    if (!selItem) return Alert.alert('שגיאה', 'בחר פריט');
    if (!qty || isNaN(qty) || Number(qty) <= 0) return Alert.alert('שגיאה', 'הכנס כמות חיובית');
    setLoading(true);
    try {
      await allocateToProject({ code: selItem.code, projectName: selProject.name, qty: Number(qty), note });
      Alert.alert('✓ הצלחה', `הוקצה: ${qty} יח' ${selItem.name} → ${selProject.name}`);
      setQty(''); setNote('');
      const refreshed = await getAllItems();
      const updatedItems = refreshed.items || [];
      setItems(updatedItems);
      if (selItem) {
        const updated = updatedItems.find(i => i.code === selItem.code);
        if (updated) setSelItem(updated);
      }
      await loadSelProjectAllocs(selProject);
    } catch (e) { Alert.alert('שגיאה', e.message); }
    finally { setLoading(false); }
  };

  // ---- פרויקט חדש (משותף לכל הטאבים) ----
  const handleAddProject = async () => {
    if (!newProjectName.trim()) return Alert.alert('שגיאה', 'הכנס שם פרויקט');
    try {
      await addProject({ name: newProjectName.trim() });
      setAddProjectModal(false);
      setNewProjectName('');
      await load();
      // גלול לסוף הרשימות
      setTimeout(() => {
        projectsListRef.current?.scrollToEnd({ animated: true });
        allocPickerRef.current?.scrollToEnd({ animated: true });
      }, 150);
    } catch (e) { Alert.alert('שגיאה', e.message); }
  };

  // ---- פרטי פרויקט ----
  const openProjectDetail = async (p) => {
    try {
      const data = await getProjectAllocations(p.name);
      setProjectDetail({ project: p, allocations: data.allocations || [] });
      setProjectDetailModal(true);
    } catch {}
  };

  // ---- עריכת פרויקט ----
  const openEditProject = (project) => {
    setProjectToEdit(project);
    setEditProjectName(project.name);
    setEditProjectStatus(project.status || 'פעיל');
    setProjectDetailModal(false);
    setEditProjectModal(true);
  };

  const handleEditProject = async () => {
    if (!editProjectName.trim()) return Alert.alert('שגיאה', 'שם לא יכול להיות ריק');
    try {
      await updateProject({ oldName: projectToEdit.name, newName: editProjectName.trim(), status: editProjectStatus });
      setEditProjectModal(false);
      load();
    } catch (e) { Alert.alert('שגיאה', e.message); }
  };

  const filteredItems = items.filter(i =>
    i.name?.includes(searchPick) || String(i.code)?.includes(searchPick)
  );

  // פרויקטים פעילים עם הקצאות — רק אלה שיש מה למשוך
  const projectsWithAllocations = React.useMemo(() => {
    const withAlloc = new Set();
    items.forEach(item => (item.allocations || []).forEach(a => withAlloc.add(a.project)));
    return projects.filter(p => (!p.status || p.status === 'פעיל') && withAlloc.has(p.name));
  }, [projects, items]);

  return (
    <View style={s.container}>
      {/* טאבים */}
      <View style={s.tabs}>
        {[['allocate','הקצאה'],['withdraw','משיכה'],['release','שחרור'],['projects','פרויקטים']].map(([key, label]) => (
          <TouchableOpacity key={key} style={[s.tab, tab === key && s.tabActive]} onPress={() => setTab(key)}>
            <Text style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ===== טאב הקצאה ===== */}
      {tab === 'allocate' && (
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          <View style={s.form}>
            {/* בחירת פרויקט + כפתור חדש */}
            <View style={s.pickRow}>
              <TouchableOpacity style={[s.pickBtn, { flex: 1 }]} onPress={() => setPickProjectModal(true)}>
                <Text style={s.pickBtnText}>{selProject ? `📁 ${selProject.name}` : 'בחר פרויקט...'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.newProjInlineBtn} onPress={() => setAddProjectModal(true)}>
                <Text style={s.newProjInlineBtnText}>+ חדש</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={s.pickBtn} onPress={() => setPickItemModal(true)}>
              <Text style={s.pickBtnText}>
                {selItem ? `${selItem.name} (זמין: ${selItem.available ?? selItem.qty})` : 'בחר פריט...'}
              </Text>
            </TouchableOpacity>
            <TextInput style={s.input} placeholder="כמות להקצאה" value={qty} onChangeText={setQty} keyboardType="numeric" textAlign="right"
              returnKeyType="next" onSubmitEditing={() => noteInputRef.current?.focus()} />
            <TextInput ref={noteInputRef} style={s.input} placeholder="הערה (אופציונלי)" value={note} onChangeText={setNote} textAlign="right"
              returnKeyType="done" onSubmitEditing={handleAction} />
            <TouchableOpacity style={[s.submitBtn, { backgroundColor: '#1565C0' }]} onPress={handleAction} disabled={loading}>
              <Text style={s.submitBtnText}>{loading ? 'שולח...' : 'הקצה לפרויקט'}</Text>
            </TouchableOpacity>
          </View>

          {/* רשימת הקצאות קיימות לפרויקט */}
          {selProject && selProjectAllocs.length > 0 && (
            <View style={s.allocListCard}>
              <Text style={s.allocListTitle}>📋 הקצאות פעילות — {selProject.name}</Text>
              {selProjectAllocs.map((a, i) => (
                <View key={i} style={s.allocListRow}>
                  <Text style={s.allocListName}>{a.name}</Text>
                  <Text style={s.allocListQty}>{a.qty} יח'</Text>
                </View>
              ))}
              <View style={s.allocListTotal}>
                <Text style={s.allocListTotalText}>
                  סה"כ: {selProjectAllocs.reduce((s, a) => s + a.qty, 0)} יח' ב-{selProjectAllocs.length} פריטים
                </Text>
              </View>
            </View>
          )}
          {selProject && selProjectAllocs.length === 0 && (
            <Text style={[s.empty, { marginTop: 16 }]}>אין הקצאות פעילות לפרויקט זה</Text>
          )}
        </ScrollView>
      )}

      {/* ===== טאב משיכה ===== */}
      {tab === 'withdraw' && (
        <View style={{ flex: 1 }}>
          <View style={{ padding: 12, flexDirection: 'row-reverse', gap: 8 }}>
            <TouchableOpacity style={[s.pickBtn, { flex: 1 }]} onPress={() => setPickWithdrawProjectModal(true)}>
              <Text style={s.pickBtnText}>{withdrawProject ? `📁 ${withdrawProject.name}` : 'בחר פרויקט למשיכה...'}</Text>
            </TouchableOpacity>
            {withdrawProject && (
              <TouchableOpacity style={s.clearBtn} onPress={() => {
                setWithdrawProject(null); setWithdrawList([]);
                setWithdrawError(''); setWithdrawSuccess(''); setWithdrawNote('');
              }}>
                <Text style={s.clearBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          {/* שדה הערה חובה — שם קבלן מבצע */}
          <View style={{ paddingHorizontal: 12, paddingBottom: 4 }}>
            <TextInput
              style={[s.noteInput, withdrawNoteError && s.noteInputError]}
              placeholder="* שם קבלן מבצע (חובה)"
              value={withdrawNote}
              onChangeText={v => { setWithdrawNote(v); setWithdrawNoteError(false); setWithdrawError(''); }}
              textAlign="right"
            />
          </View>
          {withdrawError ? <View style={s.errorBanner}><Text style={s.errorBannerText}>⚠️ {withdrawError}</Text></View> : null}
          {withdrawSuccess ? <View style={s.successBanner}><Text style={s.successBannerText}>{withdrawSuccess}</Text></View> : null}
          {withdrawProject && withdrawList.length === 0 && (
            <Text style={s.empty}>אין פריטים מוקצים לפרויקט זה</Text>
          )}
          {withdrawList.length > 0 && (
            <>
              <View style={s.selectRow}>
                <TouchableOpacity style={s.selectBtn} onPress={() => toggleSelectAll(true)}>
                  <Text style={s.selectBtnText}>בחר הכל</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.selectBtn} onPress={() => toggleSelectAll(false)}>
                  <Text style={s.selectBtnText}>בטל הכל</Text>
                </TouchableOpacity>
                <Text style={s.selectedCount}>{withdrawList.filter(i => i.selected).length}/{withdrawList.length} נבחרו</Text>
              </View>
              <FlatList
                data={withdrawList}
                keyExtractor={i => String(i.code)}
                contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
                renderItem={({ item }) => (
                  <View style={[s.withdrawCard, item.selected && s.withdrawCardSelected]}>
                    <TouchableOpacity style={s.withdrawRow} onPress={() => toggleSelected(item.code)}>
                      <View style={[s.checkbox, item.selected && s.checkboxSelected]}>
                        {item.selected && <Text style={s.checkmark}>✓</Text>}
                      </View>
                      <Text style={s.withdrawName}>{item.name}</Text>
                    </TouchableOpacity>
                    <View style={s.withdrawQtyRow}>
                      <View style={s.withdrawQtyBlock}>
                        <Text style={s.withdrawLabel}>מוקצה</Text>
                        <Text style={s.withdrawAllocated}>{item.allocatedQty} יח'</Text>
                      </View>
                      <View style={s.withdrawQtyBlock}>
                        <Text style={s.withdrawLabel}>זמין במלאי</Text>
                        <Text style={[s.withdrawAllocated, { color: item.availableInStock > 0 ? '#2E7D32' : '#C62828' }]}>
                          {item.availableInStock} יח'
                        </Text>
                      </View>
                      <View style={s.withdrawQtyBlock}>
                        <Text style={s.withdrawLabel}>בפועל</Text>
                        <TextInput
                          style={[s.withdrawQtyInput, !item.selected && s.withdrawQtyInputDisabled]}
                          value={item.actualQty}
                          onChangeText={v => updateActualQty(item.code, v)}
                          keyboardType="numeric"
                          textAlign="center"
                          editable={item.selected}
                        />
                      </View>
                    </View>
                  </View>
                )}
              />
              <View style={s.withdrawFooter}>
                <TouchableOpacity
                  style={[s.submitBtn, { backgroundColor: '#C62828', flex: 1 }]}
                  onPress={handleWithdraw}
                  disabled={withdrawLoading}
                >
                  <Text style={s.submitBtnText}>
                    {withdrawLoading ? 'מבצע משיכה...' : `⬇ בצע משיכה (${withdrawList.filter(i => i.selected).length} פריטים)`}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      {/* ===== טאב שחרור ===== */}
      {tab === 'release' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
          <View style={{ padding: 12 }}>
            <TouchableOpacity style={s.pickBtn} onPress={() => setPickReleaseProjectModal(true)}>
              <Text style={s.pickBtnText}>{releaseProject ? `📁 ${releaseProject.name}` : 'בחר פרויקט להחזרה...'}</Text>
            </TouchableOpacity>
          </View>
          {releaseError ? <View style={s.errorBanner}><Text style={s.errorBannerText}>⚠️ {releaseError}</Text></View> : null}
          {releaseSuccess ? <View style={s.successBanner}><Text style={s.successBannerText}>{releaseSuccess}</Text></View> : null}
          {releaseProject && releaseList.length === 0 && allocatedList.length === 0 && (
            <Text style={s.empty}>אין פריטים מוקצים או נמשכים לפרויקט זה</Text>
          )}

          {/* הקצאות פעילות — ביטול */}
          {allocatedList.length > 0 && (
            <>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>🔒 הקצאות פעילות — לחץ ✕ לביטול והחזרה לזמין</Text>
              </View>
              {allocatedList.map(item => (
                <View key={String(item.code)} style={s.allocCancelCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.withdrawName}>{item.name}</Text>
                    <Text style={s.withdrawLabel}>מוקצה: {item.qty} יח'</Text>
                  </View>
                  <TouchableOpacity style={s.cancelAllocBtn} onPress={() => cancelAllocation(item)}>
                    <Text style={s.cancelAllocBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}

          {/* פריטים שנמשכו — החזרה פיזית */}
          {releaseList.length > 0 && (
            <>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>↩ נמשכו — סמן מה חוזר פיזית למחסן</Text>
              </View>
              <FlatList
                data={releaseList}
                keyExtractor={i => String(i.code)}
                scrollEnabled={false}
                contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
                renderItem={({ item }) => (
                  <View style={[s.withdrawCard, item.selected && s.withdrawCardSelected]}>
                    <TouchableOpacity style={s.withdrawRow} onPress={() => toggleReleaseSelected(item.code)}>
                      <View style={[s.checkbox, item.selected && s.checkboxSelected]}>
                        {item.selected && <Text style={s.checkmark}>✓</Text>}
                      </View>
                      <Text style={s.withdrawName}>{item.name}</Text>
                    </TouchableOpacity>
                    <View style={s.withdrawQtyRow}>
                      <View style={s.withdrawQtyBlock}>
                        <Text style={s.withdrawLabel}>סה"כ נמשך</Text>
                        <Text style={s.withdrawAllocated}>{item.totalWithdrawn} יח'</Text>
                      </View>
                      <View style={s.withdrawQtyBlock}>
                        <Text style={s.withdrawLabel}>חוזר למחסן</Text>
                        <TextInput
                          style={[s.withdrawQtyInput, { borderColor: '#2E7D32' }, !item.selected && s.withdrawQtyInputDisabled]}
                          value={item.returnQty}
                          onChangeText={v => updateReturnQty(item.code, v)}
                          keyboardType="numeric"
                          textAlign="center"
                          editable={item.selected}
                          placeholder="0"
                        />
                      </View>
                    </View>
                  </View>
                )}
              />
              <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
                <TouchableOpacity
                  style={[s.submitBtn, { backgroundColor: '#2E7D32' }]}
                  onPress={handleRelease}
                  disabled={releaseLoading}
                >
                  <Text style={s.submitBtnText}>
                    {releaseLoading ? 'מעבד...' : `↩ החזר למחסן (${releaseList.filter(i => i.selected && Number(i.returnQty) > 0).length} פריטים)`}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      )}

      {/* ===== טאב פרויקטים ===== */}
      {tab === 'projects' && (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={projectsListRef}
            data={[...projects].sort((a, b) => {
              const aActive = !a.status || a.status === 'פעיל';
              const bActive = !b.status || b.status === 'פעיל';
              return aActive === bActive ? 0 : aActive ? -1 : 1;
            })}
            keyExtractor={(p, i) => p.name + i}
            contentContainerStyle={{ padding: 12 }}
            ListEmptyComponent={<Text style={s.empty}>אין פרויקטים</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.projCard} onPress={() => openProjectDetail(item)}>
                <View style={s.projHeader}>
                  <Text style={s.projName}>{item.name}</Text>
                  <TouchableOpacity style={s.editProjBtn} onPress={(e) => { e.stopPropagation?.(); openEditProject(item); }}>
                    <Text style={s.editProjBtnText}>✏️</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.projRow}>
                  <Text style={[s.projStatus, item.status === 'פעיל' ? s.statusActive : s.statusInactive]}>
                    {item.status || 'פעיל'}
                  </Text>
                  <Text style={s.projDate}>{item.date || ''}</Text>
                </View>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity style={s.fab} onPress={() => setAddProjectModal(true)}>
            <Text style={s.fabText}>+ פרויקט חדש</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ===== מודאלים ===== */}

      {/* בחירת פרויקט (הקצאה) */}
      <Modal visible={pickProjectModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>בחר פרויקט</Text>
            <FlatList
              ref={allocPickerRef}
              data={projects.filter(p => !p.status || p.status === 'פעיל')}
              keyExtractor={(p, i) => p.name + i}
              style={{ maxHeight: 300 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.pickItem} onPress={() => { setSelProject(item); setPickProjectModal(false); }}>
                  <Text style={s.pickItemName}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={s.empty}>אין פרויקטים פעילים</Text>}
            />
            <View style={s.btnRow}>
              <TouchableOpacity style={s.btnSec} onPress={() => setPickProjectModal(false)}>
                <Text style={s.btnSecText}>סגור</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnPrim, { backgroundColor: '#2E7D32' }]} onPress={() => { setPickProjectModal(false); setAddProjectModal(true); }}>
                <Text style={s.btnPrimText}>+ פרויקט חדש</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* בחירת פרויקט למשיכה */}
      <Modal visible={pickWithdrawProjectModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>בחר פרויקט למשיכה</Text>
            <FlatList
              data={projectsWithAllocations}
              keyExtractor={(p, i) => p.name + i} style={{ maxHeight: 300 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.pickItem} onPress={() => handleSelectWithdrawProject(item)}>
                  <Text style={s.pickItemName}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={s.empty}>אין פרויקטים עם הקצאות פעילות</Text>}
            />
            <TouchableOpacity style={s.btnSec} onPress={() => setPickWithdrawProjectModal(false)}>
              <Text style={s.btnSecText}>סגור</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* בחירת פריט */}
      <Modal visible={pickItemModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <TextInput style={s.search} placeholder="חיפוש פריט..." value={searchPick}
              onChangeText={setSearchPick} textAlign="right" autoFocus />
            <FlatList data={filteredItems} keyExtractor={i => String(i.code)} style={{ maxHeight: 300 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.pickItem} onPress={() => { setSelItem(item); setPickItemModal(false); setSearchPick(''); }}>
                  <Text style={s.pickItemName}>{item.name}</Text>
                  <Text style={s.pickItemSub}>#{item.code} · זמין: {item.available ?? item.qty}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={s.btnSec} onPress={() => { setPickItemModal(false); setSearchPick(''); }}>
              <Text style={s.btnSecText}>סגור</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* בחירת פרויקט לשחרור */}
      <Modal visible={pickReleaseProjectModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>בחר פרויקט להחזרה</Text>
            <FlatList
              data={projects.filter(p => !p.status || p.status === 'פעיל')}
              keyExtractor={(p, i) => p.name + i} style={{ maxHeight: 300 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.pickItem} onPress={() => handleSelectReleaseProject(item)}>
                  <Text style={s.pickItemName}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={s.empty}>אין פרויקטים פעילים</Text>}
            />
            <TouchableOpacity style={s.btnSec} onPress={() => setPickReleaseProjectModal(false)}>
              <Text style={s.btnSecText}>סגור</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* פרויקט חדש */}
      <Modal visible={addProjectModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>פרויקט חדש</Text>
            <TextInput style={s.input} placeholder="שם פרויקט" value={newProjectName}
              onChangeText={setNewProjectName} textAlign="right" autoFocus
              returnKeyType="done" onSubmitEditing={handleAddProject} />
            <View style={s.btnRow}>
              <TouchableOpacity style={s.btnSec} onPress={() => { setAddProjectModal(false); setNewProjectName(''); }}>
                <Text style={s.btnSecText}>ביטול</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnPrim} onPress={handleAddProject}>
                <Text style={s.btnPrimText}>צור</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* פרטי פרויקט */}
      <Modal visible={projectDetailModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <ScrollView>
            <View style={s.modal}>
              <View style={s.projDetailHeader}>
                <Text style={s.modalTitle}>{projectDetail?.project?.name}</Text>
                <Text style={[s.projStatusTag,
                  projectDetail?.project?.status !== 'פעיל' && s.statusInactiveTag
                ]}>
                  {projectDetail?.project?.status || 'פעיל'}
                </Text>
              </View>
              {projectDetail?.allocations?.length === 0
                ? <Text style={s.empty}>אין הקצאות פעילות</Text>
                : projectDetail?.allocations?.map((a, i) => (
                  <View key={i} style={s.allocRow}>
                    <Text style={s.allocName}>{a.name || a.item}</Text>
                    <Text style={s.allocQty}>{a.qty} יח'</Text>
                  </View>
                ))
              }
              <View style={[s.btnRow, { marginTop: 16 }]}>
                <TouchableOpacity style={s.btnSec} onPress={() => setProjectDetailModal(false)}>
                  <Text style={s.btnSecText}>סגור</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btnPrim, { backgroundColor: '#F57C00' }]}
                  onPress={() => openEditProject(projectDetail?.project)}>
                  <Text style={s.btnPrimText}>✏️ ערוך</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* עריכת פרויקט */}
      <Modal visible={editProjectModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>✏️ עריכת פרויקט</Text>
            <Text style={s.fieldLabel}>שם פרויקט</Text>
            <TextInput
              style={s.input}
              value={editProjectName}
              onChangeText={setEditProjectName}
              textAlign="right"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleEditProject}
            />
            <Text style={s.fieldLabel}>סטטוס</Text>
            <View style={s.statusRow}>
              {['פעיל', 'לא פעיל'].map(st => (
                <TouchableOpacity
                  key={st}
                  style={[
                    s.statusBtn,
                    editProjectStatus === st && (st === 'פעיל' ? s.statusBtnActive : s.statusBtnInactive)
                  ]}
                  onPress={() => setEditProjectStatus(st)}
                >
                  <Text style={[s.statusBtnText, editProjectStatus === st && { color: '#fff' }]}>{st}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.btnRow}>
              <TouchableOpacity style={s.btnSec} onPress={() => setEditProjectModal(false)}>
                <Text style={s.btnSecText}>ביטול</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnPrim} onPress={handleEditProject}>
                <Text style={s.btnPrimText}>שמור</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  tabs: { flexDirection: 'row-reverse', backgroundColor: '#fff', elevation: 2 },
  tab: { flex: 1, padding: 12, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#1565C0' },
  tabText: { fontSize: 13, color: '#777', fontWeight: '600' },
  tabTextActive: { color: '#1565C0' },

  form: { backgroundColor: '#fff', borderRadius: 16, padding: 16, elevation: 2 },

  // שורת בחירת פרויקט + כפתור חדש
  pickRow: { flexDirection: 'row-reverse', alignItems: 'stretch', gap: 8, marginBottom: 0 },
  newProjInlineBtn: {
    backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#2E7D32',
    borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center',
    marginBottom: 10,
  },
  newProjInlineBtnText: { color: '#2E7D32', fontWeight: '700', fontSize: 13 },

  pickBtn: { borderWidth: 1, borderColor: '#1565C0', borderRadius: 8, padding: 11, marginBottom: 10 },
  pickBtnText: { textAlign: 'right', color: '#1565C0', fontSize: 15 },
  input: { borderWidth: 1, borderColor: '#DDD', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 15 },
  noteInput: { borderWidth: 1.5, borderColor: '#1565C0', borderRadius: 8, padding: 11, fontSize: 15, backgroundColor: '#fff' },
  noteInputError: { borderColor: '#C62828', backgroundColor: '#FFF8F8' },
  clearBtn: { borderWidth: 1, borderColor: '#CCC', borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center', marginBottom: 10 },
  clearBtnText: { color: '#888', fontSize: 16, fontWeight: '700' },
  submitBtn: { padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // משיכה
  selectRow: { flexDirection: 'row-reverse', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 6, gap: 8 },
  selectBtn: { backgroundColor: '#E3F2FD', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  selectBtnText: { color: '#1565C0', fontWeight: '600', fontSize: 13 },
  selectedCount: { color: '#555', fontSize: 13, flex: 1, textAlign: 'right' },
  withdrawCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, elevation: 1, borderWidth: 1, borderColor: '#EEE' },
  withdrawCardSelected: { borderColor: '#1565C0', borderWidth: 1.5 },
  withdrawRow: { flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: '#CCC', alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  checkboxSelected: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  checkmark: { color: '#fff', fontWeight: '700', fontSize: 13 },
  withdrawName: { fontSize: 15, fontWeight: '600', color: '#1a1a2e', flex: 1, textAlign: 'right' },
  withdrawQtyRow: { flexDirection: 'row-reverse', gap: 12 },
  withdrawQtyBlock: { flex: 1, alignItems: 'center' },
  withdrawLabel: { fontSize: 11, color: '#888', marginBottom: 4 },
  withdrawAllocated: { fontSize: 16, fontWeight: '700', color: '#555' },
  withdrawQtyInput: { borderWidth: 1.5, borderColor: '#1565C0', borderRadius: 8, padding: 6, fontSize: 16, fontWeight: '700', color: '#C62828', width: '80%', textAlign: 'center' },
  withdrawQtyInputDisabled: { borderColor: '#DDD', color: '#BBB' },
  withdrawFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, backgroundColor: '#F5F7FA', borderTopWidth: 1, borderTopColor: '#E0E0E0', flexDirection: 'row' },

  // פרויקטים
  projCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, elevation: 2, borderRightWidth: 4, borderRightColor: '#1565C0' },
  projHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  projName: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', flex: 1, textAlign: 'right' },
  editProjBtn: { padding: 6 },
  editProjBtnText: { fontSize: 16 },
  projRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 4 },
  projStatus: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusActive: { backgroundColor: '#E8F5E9', color: '#2E7D32' },
  statusInactive: { backgroundColor: '#FFF3E0', color: '#E65100' },
  projDate: { fontSize: 12, color: '#AAA' },

  // עריכת סטטוס
  statusRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 14 },
  statusBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#CCC' },
  statusBtnActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  statusBtnInactive: { backgroundColor: '#E65100', borderColor: '#E65100' },
  statusBtnText: { fontWeight: '700', color: '#555' },

  // פרטי פרויקט
  projDetailHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  projStatusTag: { fontSize: 12, backgroundColor: '#E8F5E9', color: '#2E7D32', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  statusInactiveTag: { backgroundColor: '#FFF3E0', color: '#E65100' },

  empty: { textAlign: 'center', color: '#999', marginTop: 30, fontSize: 14 },
  errorBanner: { backgroundColor: '#FFEBEE', borderRadius: 8, padding: 12, marginHorizontal: 12, marginTop: 4 },
  errorBannerText: { color: '#C62828', fontWeight: '600', textAlign: 'right', fontSize: 14 },
  successBanner: { backgroundColor: '#E8F5E9', borderRadius: 8, padding: 12, marginHorizontal: 12, marginTop: 4 },
  successBannerText: { color: '#2E7D32', fontWeight: '600', textAlign: 'right', fontSize: 14 },
  fab: { position: 'absolute', bottom: 20, alignSelf: 'center', backgroundColor: '#1565C0', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 30, elevation: 4 },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  modalTitle: { fontSize: 17, fontWeight: '700', textAlign: 'right', marginBottom: 14, color: '#1a1a2e' },
  search: { borderWidth: 1, borderColor: '#DDD', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 15 },
  pickItem: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  pickItemName: { fontSize: 15, textAlign: 'right', color: '#1a1a2e' },
  pickItemSub: { fontSize: 12, textAlign: 'right', color: '#888', marginTop: 2 },
  btnRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 8 },
  btnPrim: { flex: 1, backgroundColor: '#1565C0', padding: 12, borderRadius: 8, alignItems: 'center' },
  btnPrimText: { color: '#fff', fontWeight: '700' },
  btnSec: { flex: 1, backgroundColor: '#EEE', padding: 11, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  btnSecText: { color: '#333', fontWeight: '700' },
  allocRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  allocName: { fontSize: 14, color: '#333' },
  allocQty: { fontSize: 14, fontWeight: '700', color: '#1565C0' },
  sectionHeader: { backgroundColor: '#EEF4FF', paddingHorizontal: 12, paddingVertical: 8, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#1565C0', textAlign: 'right' },
  allocCancelCard: {
    flexDirection: 'row-reverse', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 10, padding: 12,
    marginHorizontal: 12, marginTop: 8,
    borderWidth: 1, borderColor: '#E0E0E0', elevation: 1,
  },
  cancelAllocBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFEBEE', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  cancelAllocBtnText: { fontSize: 16, fontWeight: '700', color: '#C62828' },
  fieldLabel: { fontSize: 13, fontWeight: '600', textAlign: 'right', color: '#555', marginBottom: 4 },

  allocListCard: {
    backgroundColor: '#fff', borderRadius: 12, marginHorizontal: 0,
    marginTop: 12, padding: 14, elevation: 1,
    borderRightWidth: 4, borderRightColor: '#1565C0',
  },
  allocListTitle: { fontSize: 14, fontWeight: '700', color: '#1565C0', textAlign: 'right', marginBottom: 10 },
  allocListRow: {
    flexDirection: 'row-reverse', justifyContent: 'space-between',
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  allocListName: { fontSize: 14, color: '#1a1a2e', textAlign: 'right', flex: 1 },
  allocListQty: { fontSize: 14, fontWeight: '700', color: '#1565C0', minWidth: 60, textAlign: 'left' },
  allocListTotal: { marginTop: 8, alignItems: 'flex-end' },
  allocListTotalText: { fontSize: 13, color: '#888', fontWeight: '600' },
});
