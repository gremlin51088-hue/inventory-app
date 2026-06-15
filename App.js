import React, { useState, useEffect } from 'react';
import {
  I18nManager, StatusBar, Text, View,
  TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Animated,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { storage, inventoryEvents } from './src/storage';

import ItemsScreen from './src/screens/ItemsScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import LowStockScreen from './src/screens/LowStockScreen';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

const Tab = createBottomTabNavigator();
const ICONS = { 'ניהול מלאי': '📦', 'פרויקטים': '📁', 'חוסרים': '⚠️' };

function RefreshButton({ style }) {
  const spin = React.useRef(new Animated.Value(0)).current;

  const handlePress = () => {
    Animated.timing(spin, {
      toValue: 1, duration: 500, useNativeDriver: true,
    }).start(() => spin.setValue(0));
    inventoryEvents.emit();
  };

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <TouchableOpacity style={[style, s.refreshTab]} onPress={handlePress}>
      <Animated.Text style={[s.refreshIcon, { transform: [{ rotate }] }]}>🔄</Animated.Text>
      <Text style={s.refreshLabel}>רענן</Text>
    </TouchableOpacity>
  );
}

const PASSWORD       = 'volteam';
const SESSION_KEY    = 'auth_session';
const SESSION_HOURS  = 24;

function AuthGate({ children }) {
  const [status, setStatus]   = useState('loading'); // loading | locked | unlocked
  const [input, setInput]     = useState('');
  const [error, setError]     = useState('');

  useEffect(() => {
    (async () => {
      try {
        const saved = await storage.getItem(SESSION_KEY);
        if (saved) {
          const { ts } = JSON.parse(saved);
          const hours = (Date.now() - ts) / 3600000;
          if (hours < SESSION_HOURS) { setStatus('unlocked'); return; }
        }
      } catch {}
      setStatus('locked');
    })();
  }, []);

  const handleLogin = async () => {
    if (input === PASSWORD) {
      await storage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }));
      setInput('');
      setStatus('unlocked');
    } else {
      setError('סיסמא שגויה, נסה שוב');
      setInput('');
    }
  };

  if (status === 'loading') {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  if (status === 'locked') {
    return (
      <View style={s.center}>
        <View style={s.card}>
          <Text style={s.logo}>📦</Text>
          <Text style={s.title}>ניהול מלאי</Text>
          <Text style={s.subtitle}>הכנס סיסמא להמשך</Text>
          <TextInput
            style={[s.input, error ? s.inputError : null]}
            placeholder="סיסמא"
            value={input}
            onChangeText={t => { setInput(t); setError(''); }}
            secureTextEntry
            textAlign="right"
            autoFocus
            onSubmitEditing={handleLogin}
          />
          {error ? <Text style={s.errorText}>{error}</Text> : null}
          <TouchableOpacity style={s.btn} onPress={handleLogin}>
            <Text style={s.btnText}>כניסה</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return children;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#1565C0" />
      <AuthGate>
        <NavigationContainer>
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerStyle: { backgroundColor: '#1565C0' },
              headerTintColor: '#fff',
              headerTitleStyle: { fontWeight: '700', fontSize: 18 },
              tabBarActiveTintColor: '#1565C0',
              tabBarInactiveTintColor: '#999',
              tabBarStyle: { paddingBottom: 5, height: 60 },
              tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
              tabBarIcon: ({ size }) => (
                <Text style={{ fontSize: size - 4 }}>{ICONS[route.name]}</Text>
              ),
            })}
          >
            <Tab.Screen name="ניהול מלאי" component={ItemsScreen} />
            <Tab.Screen name="פרויקטים" component={ProjectsScreen} />
            <Tab.Screen
              name="חוסרים"
              component={LowStockScreen}
              options={{ tabBarActiveTintColor: '#C62828' }}
            />
            <Tab.Screen
              name="רענן"
              component={() => null}
              options={{
                tabBarButton: (props) => <RefreshButton {...props} />,
              }}
            />
          </Tab.Navigator>
        </NavigationContainer>
      </AuthGate>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#1565C0', justifyContent: 'center', alignItems: 'center' },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 32,
    width: '90%', maxWidth: 360, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
  },
  logo:      { fontSize: 52, marginBottom: 8 },
  title:     { fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginBottom: 4 },
  subtitle:  { fontSize: 14, color: '#888', marginBottom: 24 },
  input: {
    width: '100%', borderWidth: 1.5, borderColor: '#DDD',
    borderRadius: 10, padding: 12, fontSize: 16,
    textAlign: 'right', marginBottom: 8,
  },
  inputError: { borderColor: '#C62828' },
  errorText:  { color: '#C62828', fontSize: 13, marginBottom: 8 },
  btn: {
    width: '100%', backgroundColor: '#1565C0',
    padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8,
  },
  btnText:      { color: '#fff', fontWeight: '700', fontSize: 16 },
  refreshTab:   { justifyContent: 'center', alignItems: 'center', flex: 1, paddingBottom: 5 },
  refreshIcon:  { fontSize: 20 },
  refreshLabel: { fontSize: 12, fontWeight: '600', color: '#999', marginTop: 2 },
});
