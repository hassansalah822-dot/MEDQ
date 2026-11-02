// js/offline-db.js
const DB_NAME = 'medq_offline_db';
const DB_VERSION = 1;

export function openDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error("IndexedDB not supported"));
        
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('questions')) {
                const qStore = db.createObjectStore('questions', { keyPath: 'id' });
                qStore.createIndex('subject', 'subject', { unique: false });
                qStore.createIndex('status', 'status', { unique: false });
            }
            if (!db.objectStoreNames.contains('metadata')) {
                db.createObjectStore('metadata', { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains('pendingSync')) {
                db.createObjectStore('pendingSync', { autoIncrement: true });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveAllQuestionsOffline(questionsList) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['questions', 'metadata'], 'readwrite');
            const qStore = tx.objectStore('questions');
            const mStore = tx.objectStore('metadata');

            qStore.clear(); 
            questionsList.forEach(q => qStore.put(q));
            mStore.put({ key: 'lastQuestionSync', timestamp: Date.now(), total: questionsList.length });

            tx.oncomplete = () => resolve(questionsList.length);
            tx.onerror = () => reject(tx.error);
        });
    } catch(e) { console.warn("Offline save disabled", e); return 0; }
}

export async function getOfflineQuestions(filterCriteria = {}) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('questions', 'readonly');
            const store = tx.objectStore('questions');
            const request = store.getAll();

            request.onsuccess = () => {
                let list = request.result || [];
                list = list.filter(q => q.status !== 'draft');

                if (filterCriteria.category && filterCriteria.category !== 'All') list = list.filter(q => q.subject === filterCriteria.category);
                if (filterCriteria.section && filterCriteria.section !== 'All') list = list.filter(q => (q.section || q.specialty || '') === filterCriteria.section);
                if (filterCriteria.year && filterCriteria.year !== 'All') list = list.filter(q => (q.year || '') === filterCriteria.year);

                resolve(list);
            };
            request.onerror = () => resolve([]);
        });
    } catch(e) { return []; }
}

export async function getOfflineQuestionCount() {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction('questions', 'readonly');
            const req = tx.objectStore('questions').count();
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => resolve(0);
        });
    } catch (e) { return 0; }
}

export async function setOfflineMeta(key, value) {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction('metadata', 'readwrite');
            tx.objectStore('metadata').put({ key, value, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch(e) { return null; }
}

export async function getOfflineMeta(key) {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction('metadata', 'readonly');
            const req = tx.objectStore('metadata').get(key);
            req.onsuccess = () => resolve(req.result ? req.result.value : null);
            req.onerror = () => resolve(null);
        });
    } catch(e) { return null; }
}

export async function queueOfflineResult(payload) {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction('pendingSync', 'readwrite');
            tx.objectStore('pendingSync').add({ payload, date: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch(e) {}
}

export async function getPendingSyncResults() {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction('pendingSync', 'readonly');
            const req = tx.objectStore('pendingSync').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    } catch(e) { return []; }
}

export async function clearPendingSyncResults() {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction('pendingSync', 'readwrite');
            tx.objectStore('pendingSync').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch(e) {}
}
