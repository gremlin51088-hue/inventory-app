# מערכת ניהול מלאי – React Native + Expo

## קבצים שנוצרו
```
inventory-app/
├── App.js                        ← ניווט ראשי
├── app.json                      ← הגדרות Expo
├── package.json                  ← תלויות
├── babel.config.js
└── src/
    ├── api.js                    ← כל קריאות ה-API
    └── screens/
        ├── ItemsScreen.js        ← פריטים
        ├── MovementsScreen.js    ← תנועות
        └── ProjectsScreen.js     ← פרויקטים
```

---

## שלב 1 – חיבור ה-Backend (Apps Script)

פתח את `src/api.js` ועדכן את השורה:
```js
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

**איך מקבלים את ה-URL?**
1. פתח את פרויקט Apps Script שלך
2. Deploy → **New deployment** (או Manage deployments)
3. Type: **Web app**
4. Execute as: **Me**
5. Who has access: **Anyone**
6. העתק את ה-URL שמופיע

> **חשוב:** ב-Apps Script, הפונקציה `doPost(e)` חייבת לקבל JSON ולנתב לפי `e.postData.contents`.
> ראה דוגמה בסוף מסמך זה.

---

## שלב 2 – התקנה

### דרישות
- Node.js 18+ ([nodejs.org](https://nodejs.org))
- npm (מגיע עם Node)

### הוראות
```bash
# העתק את כל הקבצים לתיקייה חדשה, אחר כך:
cd inventory-app
npm install
```

---

## שלב 3 – הרצה

### 📱 טלפון (Android / iOS)
```bash
npx expo start
```
1. הורד **Expo Go** מהחנות (App Store / Google Play)
2. סרוק את ה-QR Code שמופיע בטרמינל
3. האפליקציה נפתחת מיד – ללא build!

### 🖥️ Windows Desktop
```bash
npx expo start --web
```
פותח את האפליקציה בדפדפן בכתובת `http://localhost:8081`

> לאפליקציה Windows אמיתית (`.exe`) אפשר להשתמש ב-Electron בשלב מאוחר יותר.

---

## מבנה ה-Apps Script (doPost נדרש)

הוסף לקובץ `Code.gs` שלך את הפונקציה:

```javascript
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    let result;
    if (action === 'getAllItemsLite')   result = getAllItemsLite();
    else if (action === 'getItemByCodeOrName') result = getItemByCodeOrName(payload);
    else if (action === 'addOrUpdateItem')     result = addOrUpdateItem(payload);
    else if (action === 'moveStock')           result = moveStock(payload);
    else if (action === 'getAllProjects')       result = getAllProjects();
    else if (action === 'addProject')          result = addProject(payload);
    else if (action === 'allocateToProject')   result = allocateToProject(payload);
    else if (action === 'releaseFromProject')  result = releaseFromProject(payload);
    else if (action === 'getProjectAllocations') result = getProjectAllocations(payload.projectName);
    else result = { error: 'Unknown action: ' + action };

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

---

## שגיאות נפוצות

| שגיאה | פתרון |
|-------|--------|
| `Network request failed` | בדוק שה-URL נכון + פרסמת כ-"Anyone" |
| `RTL לא עובד` | הפעל מחדש את Expo Go אחרי ההתקנה |
| `CORS error בווב` | הוסף headers ב-doPost ב-Apps Script |
