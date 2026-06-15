import { Platform } from 'react-native';

// ---- מערכת אירועים שעובדת גם ב-web וגם ב-native ----
const _listeners = new Set();
export const inventoryEvents = {
  emit: () => _listeners.forEach(fn => { try { fn(); } catch {} }),
  subscribe: (fn) => {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};

// ---- Storage שעובד גם ב-web (localStorage) וגם ב-native (AsyncStorage) ----
export const storage = {
  getItem: async (key) => {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    const AS = require('@react-native-async-storage/async-storage').default;
    return AS.getItem(key);
  },
  setItem: async (key, value) => {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    const AS = require('@react-native-async-storage/async-storage').default;
    return AS.setItem(key, value);
  },
};
