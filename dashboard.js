import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs, query, orderBy, limit, onSnapshot, updateDoc, increment } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// =========================================================
// OFFLINE DATABASE ENGINE
// =========================================================
const DB_NAME = 'medq_offline_db';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve) => {
        if (!window.indexedDB) return resolve(null);
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            const timeout = setTimeout(() => resolve(null), 2000); 
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('questions')) db.createObjectStore('questions', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('metadata')) db.createObjectStore('metadata', { keyPath: 'key' });
                if (!db.objectStoreNames.contains('pendingSync')) db.createObjectStore('pendingSync', { autoIncrement: true });
            };
            request.onsuccess = () => { clearTimeout(timeout); resolve(request.result); };
            request.onerror = () => { clearTimeout(timeout); resolve(null); };
        } catch (err) { resolve(null); }
    });
}

async function saveAllQuestionsOffline(questionsList) {
    const db = await openDB();
    if (!db) return 0;
    return new Promise((resolve) => {
        const tx = db.transaction(['questions', 'metadata'], 'readwrite');
        tx.objectStore('questions').clear();
        questionsList.forEach(q => tx.objectStore('questions').put(q));
        tx.objectStore('metadata').put({ key: 'lastSync', timestamp: Date.now() });
        tx.oncomplete = () => resolve(questionsList.length);
        tx.onerror = () => resolve(0);
    });
}

async function getOfflineQuestionCount() {
    const db = await openDB();
    if (!db) return 0;
    return new Promise((resolve) => {
        const req = db.transaction('questions', 'readonly').objectStore('questions').count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
    });
}

async function setOfflineMeta(key, value) {
    const db = await openDB();
    if (db) db.transaction('metadata', 'readwrite').objectStore('metadata').put({ key, value, timestamp: Date.now() });
}

async function getOfflineMeta(key) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
        const req = db.transaction('metadata', 'readonly').objectStore('metadata').get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
    });
}

async function getPendingSyncResults() {
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
        const req = db.transaction('pendingSync', 'readonly').objectStore('pendingSync').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
    });
}

async function clearPendingSyncResults() {
    const db = await openDB();
    if (db) db.transaction('pendingSync', 'readwrite').objectStore('pendingSync').clear();
}
// =========================================================

const welcomeName = document.getElementById('welcomeName');
const userInitial = document.getElementById('userInitial');
const planBadge = document.getElementById('planBadge');
const planBadgeText = document.getElementById('planBadgeText');
const statSolved = document.getElementById('statSolved');
const statCorrect = document.getElementById('statCorrect');
const statStreak = document.getElementById('statStreak');
const logoutBtn = document.getElementById('logoutBtn');
const subStatusBadge = document.getElementById('subStatusBadge');
const subDaysText = document.getElementById('subDaysText');

let isPremiumUser = false;
let categoryAccessMap = {};
let globalCategories = new Set();
let globalYears = new Set();
let catToSecMap = {}; 
let currentUserId = null;

function generateMediaHTML(url, extraClasses = "w-full h-full border-0", imgFit = "cover", isAnnouncement = false) {
    if (!url) return '';
    url = url.trim();
    const ytRegExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|\/shorts\/)([^#&?]*).*/;
    const ytMatch = url.match(ytRegExp);
    if (ytMatch && ytMatch[2].length === 11) {
        const ytParams = isAnnouncement ? `?autoplay=1&mute=1&loop=1&playlist=${ytMatch[2]}&controls=1` : `?rel=0`;
        return `<iframe class="${extraClasses} pointer-events-auto rounded-2xl shadow-sm" src="https://www.youtube.com/embed/${ytMatch[2]}${ytParams}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
    }
    const imgRegex = /\.(jpeg|jpg|gif|png|webp|svg|bmp)(?:\?.*)?$/i;
    if (imgRegex.test(url)) return `<img src="${url}" class="${extraClasses} object-${imgFit} rounded-2xl shadow-sm">`;
    return `<iframe class="${extraClasses} rounded-2xl shadow-sm bg-slate-50" src="${url}" allowfullscreen></iframe>`;
}

function isInteractiveMedia(url) { return url && /(youtu\.be|youtube\.com|drive\.google\.com|facebook\.com|fb\.watch)/i.test(url); }

window.showPremiumUpsellModal = function() {
    const modalHtml = `
    <div id="upsellModal" class="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 font-sans">
        <div class="absolute inset-0 bg-slate-900/40 backdrop-blur-md transition-opacity duration-300" onclick="document.getElementById('upsellModal').remove()"></div>
        <div class="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden transform scale-95 animate-[modal-pop_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards] border border-slate-100">
            <div class="absolute top-4 right-4 z-20 cursor-pointer bg-white/20 p-2 rounded-full hover:bg-white/40 transition-colors backdrop-blur-md" onclick="document.getElementById('upsellModal').remove()"><i data-lucide="x" class="w-5 h-5 text-slate-800"></i></div>
            <div class="bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 px-8 py-10 text-center relative overflow-hidden">
                <div class="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full blur-2xl"></div>
                <div class="relative z-10 flex justify-center mb-6"><div class="p-4 bg-white/10 rounded-2xl border border-white/20 shadow-lg backdrop-blur-md"><i data-lucide="lock" class="w-10 h-10 text-amber-400"></i></div></div>
                <h2 class="text-3xl font-black text-white mb-2 tracking-tight">Full Access</h2>
                <p class="text-indigo-200 font-medium text-sm">Unlock the definitive clinical experience.</p>
            </div>
            <div class="p-8 text-center bg-slate-50">
                <a href="https://wa.me/+249901879983" target="_blank" class="w-full py-4 bg-slate-900 text-white font-bold rounded-xl shadow-lg hover:bg-primary hover:-translate-y-1 transition-all flex items-center justify-center gap-2">Contact Support <i data-lucide="arrow-right" class="w-5 h-5"></i></a>
            </div>
        </div>
    </div>
    <style>@keyframes modal-pop { 0% { opacity: 0; transform: scale(0.95) translateY(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }</style>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if(typeof lucide !== 'undefined') lucide.createIcons();
}

async function refreshOfflineBadges() {
    const count = await getOfflineQuestionCount();
    const offlineBadgeText = document.getElementById('offlineBadgeText');
    const offlineHeaderStatus = document.getElementById('offlineHeaderStatus');
    const sidebarOfflineCount = document.getElementById('sidebarOfflineCount');

    if (sidebarOfflineCount) sidebarOfflineCount.innerText = `${count} Q`;
    if (offlineBadgeText) {
        offlineBadgeText.innerText = count > 0 ? `${count} Questions Cached Offline` : `No Offline Questions Yet`;
    }
    if (offlineHeaderStatus) {
        offlineHeaderStatus.innerText = count > 0 ? `Offline Ready (${count})` : `Sync Bank`;
    }
}

// =========================================================
// FULL OFFLINE DOWNLOAD PROCEDURE 
// =========================================================
window.downloadCompleteQBank = async function() {
    const modal = document.getElementById('offlineSyncModal');
    const title = document.getElementById('syncModalTitle');
    const desc = document.getElementById('syncModalDesc');
    const bar = document.getElementById('syncProgressBar');
    const progressText = document.getElementById('syncProgressText');
    const closeBtn = document.getElementById('closeSyncModalBtn');

    if (!modal) return;
    modal.classList.remove('hidden');
    bar.style.width = '10%';
    progressText.innerText = 'Initializing full platform cache...';
    closeBtn.classList.add('hidden');

    try {
        progressText.innerText = 'Caching App Interface & Audio Files...';
        bar.style.width = '20%';
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ action: 'cacheAppFiles' });
        }

        progressText.innerText = 'Querying clinical scenarios from database...';
        bar.style.width = '45%';

        const qSnap = await getDocs(collection(db, 'questions'));
        const allQuestions = [];
        qSnap.forEach(docSnap => allQuestions.push({ id: docSnap.id, ...docSnap.data() }));

        bar.style.width = '75%';
        progressText.innerText = `Saving ${allQuestions.length} scenarios locally...`;

        await saveAllQuestionsOffline(allQuestions);

        const [metaSnap, accessSnap] = await Promise.all([
            getDoc(doc(db, "settings", "metadata")),
            getDoc(doc(db, "settings", "categoryAccess"))
        ]);

        if (metaSnap.exists()) await setOfflineMeta('metadata', metaSnap.data());
        if (accessSnap.exists()) await setOfflineMeta('categoryAccess', accessSnap.data());

        bar.style.width = '100%';
        bar.classList.replace('bg-emerald-500', 'bg-emerald-600');
        title.innerText = 'Download Complete!';
        desc.innerText = `Successfully cached ${allQuestions.length} clinical questions. The app will now launch blocks instantaneously.`;
        progressText.innerText = `100% Synced (${allQuestions.length} items)`;
        closeBtn.classList.remove('hidden');

        await refreshOfflineBadges();
        await loadSidebarAndConfig();

    } catch (err) {
        bar.style.width = '100%';
        bar.classList.replace('bg-emerald-500', 'bg-rose-500');
        title.innerText = 'Download Interrupted';
        desc.innerText = 'Error: ' + err.message;
        progressText.innerText = 'Failed';
        closeBtn.classList.remove('hidden');
    }
}

async function syncPendingOfflineResults() {
    if (!navigator.onLine || !currentUserId) return;
    try {
        const pending = await getPendingSyncResults();
        if (pending.length === 0) return;
        for (const item of pending) {
            const p = item.payload;
            const updatePayload = { "stats.questionsSolved": increment(p.total), "stats.correctAnswers": increment(p.correct) };
            for (const [cat, data] of Object.entries(p.categories || {})) {
                updatePayload[`categoryStats.${cat}.total`] = increment(data.total);
                updatePayload[`categoryStats.${cat}.correct`] = increment(data.correct);
            }
            await updateDoc(doc(db, "users", currentUserId), updatePayload);
        }
        await clearPendingSyncResults();
    } catch (e) {}
}

window.addEventListener('online', syncPendingOfflineResults);

refreshOfflineBadges().catch(() => {});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;

        try {
            const userDocRef = doc(db, "users", user.uid);
            if (navigator.onLine) syncPendingOfflineResults();

            const userDocSnap = await getDoc(userDocRef);

            if (userDocSnap.exists()) {
                const userData = userDocSnap.data();
                
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); 
                const lastLogin = userData.lastLoginDate || 0;
                
                let currentStreak = userData.streak || 0;
                let newExpiresAt = userData.accessExpiresAt || null;
                let updateNeeded = false;
                
                if (lastLogin < today && navigator.onLine) {
                    updateNeeded = true;
                    const yesterday = today - (24 * 60 * 60 * 1000);
                    
                    if (lastLogin >= yesterday) {
                        currentStreak += 1;
                    } else {
                        currentStreak = 1; 
                    }
                    
                    if (currentStreak > 0 && currentStreak % 7 === 0) {
                        if (newExpiresAt && userData.role !== 'admin') {
                            newExpiresAt += (24 * 60 * 60 * 1000); 
                            const streakModal = document.getElementById('streakBonusModal');
                            if (streakModal) streakModal.classList.remove('hidden');
                        }
                    }
                }
                
                if (updateNeeded && navigator.onLine) {
                    let updateData = { lastLoginDate: today, streak: currentStreak };
                    if (newExpiresAt) updateData.accessExpiresAt = newExpiresAt; 
                    try { await updateDoc(userDocRef, updateData); } catch(e) {}
                    userData.streak = currentStreak;
                    if(newExpiresAt) userData.accessExpiresAt = newExpiresAt;
                }

                const currentTime = new Date().getTime();
                
                if (userData.role !== 'admin' && userData.accessExpiresAt) {
                    const timeLeft = userData.accessExpiresAt - currentTime;
                    isPremiumUser = timeLeft > 0;
                    const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
                    if (subStatusBadge) subStatusBadge.classList.remove('hidden');
                    
                    if (isPremiumUser) {
                        if (daysLeft <= 3) {
                            subStatusBadge.classList.replace('bg-white/20', 'bg-warning/90');
                            if (subDaysText) subDaysText.innerText = `Evaluation Ends in ${daysLeft} Day(s)`;
                        } else {
                            if (subDaysText) subDaysText.innerText = `${daysLeft} Days Remaining`;
                        }
                    } else {
                        subStatusBadge.classList.replace('bg-white/20', 'bg-error/80');
                        if (subDaysText) subDaysText.innerText = `Access Expired - Restricted Only`;
                    }
                } else if (userData.role === 'admin') {
                    isPremiumUser = true;
                    if (subStatusBadge) {
                        subStatusBadge.classList.remove('hidden');
                        subStatusBadge.classList.replace('bg-white/20', 'bg-accent/80');
                    }
                    if (subDaysText) subDaysText.innerText = `Unlimited Admin Access`;
                }
                
                if (welcomeName) welcomeName.innerText = `Dr. ${userData.displayName || 'Doctor'}`;
                if (userInitial && userData.displayName) userInitial.innerText = userData.displayName.charAt(0).toUpperCase();
                
                if (planBadge && planBadgeText) {
                    planBadge.classList.remove('hidden');
                    if (userData.role === 'admin') {
                        planBadgeText.innerText = 'Admin Panel';
                        planBadge.onclick = (e) => { 
                            e.preventDefault(); e.stopPropagation(); 
                            window.location.assign('./admin.html'); 
                        };
                    } else {
                        planBadgeText.innerText = 'Pro Access';
                        planBadge.onclick = (e) => { 
                            e.preventDefault(); e.stopPropagation(); 
                            window.showPremiumUpsellModal(); 
                        };
                    }
                }

                if (statSolved) statSolved.innerText = userData.stats?.questionsSolved || "0";
                if (statCorrect) statCorrect.innerText = userData.stats?.correctAnswers || "0";
                if (statStreak) statStreak.innerText = (userData.streak || "0");
            }

            await loadSidebarAndConfig();
            await loadAboutUs();
            await loadAnnouncements();

            if (navigator.onLine) {
                fetchLeaderboard();
                listenForLiveExams();
            }
        } catch (error) { 
            console.warn("Operating in pure offline mode.", error); 
        }
    } else {
        window.location.href = "login.html";
    }
});

const resetStatsBtn = document.getElementById('resetStatsBtn');
if (resetStatsBtn) {
    resetStatsBtn.addEventListener('click', async () => {
        if (!currentUserId || !navigator.onLine) return alert("Must be online to reset stats.");
        if (confirm("Are you absolutely sure you want to completely reset your solved and correct answer statistics to zero? This action cannot be undone.")) {
            try {
                resetStatsBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Resetting...';
                await updateDoc(doc(db, "users", currentUserId), {
                    "stats.questionsSolved": 0,
                    "stats.correctAnswers": 0,
                    "categoryStats": {} 
                });
                
                if(statSolved) statSolved.innerText = "0";
                if(statCorrect) statCorrect.innerText = "0";
                alert("Your progress has been successfully reset to zero.");
                
            } catch(e) {
            } finally {
                resetStatsBtn.innerHTML = '<i data-lucide="refresh-cw" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i> <span class="hidden sm:inline">Reset Stats</span><span class="sm:hidden">Reset</span>';
                if(typeof lucide !== 'undefined') lucide.createIcons();
            }
        }
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await signOut(auth);
        window.location.href = "login.html";
    });
}

const configCat = document.getElementById('configCat');
const configSec = document.getElementById('configSec');
if(configCat) {
    configCat.addEventListener('change', () => {
        configSec.innerHTML = '<option value="All">All Sections</option>';
        if(configCat.value !== 'All' && catToSecMap[configCat.value]) {
            catToSecMap[configCat.value].forEach(sec => configSec.add(new Option(sec, sec)));
        } else if (configCat.value === 'All') {
            let allSecs = new Set();
            Object.values(catToSecMap).forEach(secSet => secSet.forEach(s => allSecs.add(s)));
            allSecs.forEach(sec => configSec.add(new Option(sec, sec)));
        }
    });
}

async function loadSidebarAndConfig() {
    const sidebar = document.getElementById('dynamicSidebarCats');
    const catSelect = document.getElementById('configCat');
    const secSelect = document.getElementById('configSec');
    const yearSelect = document.getElementById('configYear');

    try {
        let localMeta = await getOfflineMeta('metadata');
        let localAccess = await getOfflineMeta('categoryAccess');

        if (!localMeta && navigator.onLine) {
            const metaDoc = await getDoc(doc(db, "settings", "metadata"));
            if (metaDoc.exists()) {
                localMeta = metaDoc.data();
                await setOfflineMeta('metadata', localMeta);
            }
        }

        if (!localAccess && navigator.onLine) {
            const accessDoc = await getDoc(doc(db, "settings", "categoryAccess"));
            if (accessDoc.exists()) {
                localAccess = accessDoc.data();
                await setOfflineMeta('categoryAccess', localAccess);
            }
        }

        if (localAccess) categoryAccessMap = localAccess;
        if (localMeta) {
            globalCategories = new Set(localMeta.categories || []);
            globalYears = new Set(localMeta.years || []);
            catToSecMap = localMeta.catToSecMap || {};
        }

        if(catSelect) {
            catSelect.innerHTML = '<option value="All">All Categories</option>';
            globalCategories.forEach(cat => catSelect.add(new Option(cat, cat)));
        }
        if(yearSelect) {
            yearSelect.innerHTML = '<option value="All">All Years</option>';
            globalYears.forEach(yr => yearSelect.add(new Option(yr, yr)));
        }
        if(secSelect) {
            secSelect.innerHTML = '<option value="All">All Sections</option>';
            let allSecs = new Set();
            Object.values(catToSecMap).forEach(secSet => secSet.forEach(s => allSecs.add(s)));
            allSecs.forEach(sec => secSelect.add(new Option(sec, sec)));
        }

        if(!sidebar) return;
        sidebar.innerHTML = '';
        
        globalCategories.forEach(cat => {
            const isLocked = categoryAccessMap[cat] === 'locked';
            const showLock = isLocked && !isPremiumUser;

            const btn = document.createElement('button');
            btn.className = `w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl font-medium transition-all group ${showLock ? 'text-slate-400 hover:bg-slate-50' : 'text-textMuted hover:bg-slate-50 hover:text-textMain'}`;
            
            btn.innerHTML = `
                <div class="flex items-center gap-3">
                    <i data-lucide="book" class="w-4 h-4 ${showLock ? 'text-slate-300' : 'group-hover:text-primary'}"></i> <span class="text-left truncate">${cat}</span>
                </div>
                ${showLock ? '<i data-lucide="lock" class="w-3 h-3 text-error"></i>' : ''}
            `;

            btn.onclick = () => {
                if (showLock) {
                    window.showPremiumUpsellModal();
                } else {
                    if (catSelect) {
                        catSelect.value = cat;
                        catSelect.dispatchEvent(new Event('change'));
                    }
                    if (yearSelect) yearSelect.value = 'All';
                    if (document.getElementById('setupModal')) document.getElementById('setupModal').classList.remove('hidden');
                }
            };
            sidebar.appendChild(btn);
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch(e) {}
}

async function fetchLeaderboard() {
    const list = document.getElementById('leaderboardList');
    if(!list || !navigator.onLine) return;
    try {
        const q = query(collection(db, "users"), orderBy("stats.questionsSolved", "desc"), limit(10));
        const snap = await getDocs(q);
        
        list.innerHTML = '';
        if(snap.empty) {
            list.innerHTML = '<p class="text-slate-500 text-sm text-center py-4">No data yet.</p>';
            return;
        }

        let rank = 1;
        snap.forEach(doc => {
            const u = doc.data();
            if(u.role === 'admin') return; 
            
            const solved = u.stats?.questionsSolved || 0;
            const div = document.createElement('div');
            div.className = "flex justify-between items-center p-3 rounded-xl hover:bg-slate-50 transition-colors group border border-transparent hover:border-slate-100";
            
            let rankElement = '';
            if (rank === 1) rankElement = '<div class="w-8 h-8 rounded-full bg-amber-100 text-amber-600 font-bold flex items-center justify-center text-sm shadow-sm ring-2 ring-amber-400">1</div>';
            else if (rank === 2) rankElement = '<div class="w-8 h-8 rounded-full bg-slate-200 text-slate-500 font-bold flex items-center justify-center text-sm">2</div>';
            else if (rank === 3) rankElement = '<div class="w-8 h-8 rounded-full bg-orange-100 text-orange-600 font-bold flex items-center justify-center text-sm">3</div>';
            else rankElement = `<div class="w-8 h-8 rounded-full text-slate-400 font-bold flex items-center justify-center text-sm">${rank}</div>`;

            div.innerHTML = `
                <div class="flex items-center gap-3">
                    ${rankElement}
                    <div>
                        <p class="font-bold text-textMain text-sm group-hover:text-primary transition-colors truncate w-32">${u.displayName || 'Unknown'}</p>
                    </div>
                </div>
                <div class="text-right">
                    <span class="font-black text-sm text-primary bg-primary/5 px-2 py-1 rounded-lg">${solved}</span>
                </div>
            `;
            list.appendChild(div);
            rank++;
        });
    } catch(e) {}
}

function listenForLiveExams() {
    const banner = document.getElementById('liveExamBanner');
    const titleEl = document.getElementById('liveExamBannerTitle');
    const descEl = document.getElementById('liveExamBannerDesc');
    const btn = document.getElementById('joinLiveExamBtn');
    
    if(!banner || !currentUserId || !navigator.onLine) return;

    const q = collection(db, "liveExams");
    
    onSnapshot(q, async (snapshot) => {
        let latestExam = null;
        snapshot.forEach(d => {
            const data = d.data();
            if(data.status === 'active' || data.status === 'published') {
                if(!latestExam || data.createdAt > latestExam.data().createdAt) {
                    latestExam = d;
                }
            }
        });

        if (latestExam) {
            const examId = latestExam.id;
            const exam = latestExam.data();
            
            try {
                const resultDocRef = doc(db, "liveExams", examId, "results", currentUserId);
                const resultSnap = await getDoc(resultDocRef);
                
                if (exam.status === 'published') {
                    if (resultSnap.exists()) {
                        const res = resultSnap.data();
                        const pct = Math.round((res.score / res.total) * 100);
                        
                        if (localStorage.getItem(`medq_seen_result_${examId}`)) {
                            banner.classList.add('hidden');
                            return;
                        }

                        banner.classList.remove('hidden');
                        
                        banner.classList.replace('to-indigo-900', 'to-teal-900');
                        banner.classList.replace('shadow-indigo-900/20', 'shadow-teal-900/20');
                        
                        btn.classList.remove('bg-rose-600', 'text-white', 'border-rose-500');
                        btn.classList.add('bg-emerald-600', 'text-white', 'border-emerald-500');
                        
                        titleEl.innerText = "EXAM RESULTS PUBLISHED";
                        descEl.innerText = `The administration has published the scores for ${exam.title}.`;
                        btn.innerText = "View My Score";
                        
                        btn.onclick = () => {
                            alert(`Your Official Score for ${exam.title}:\n\nCorrect Answers: ${res.score}\nTotal Questions: ${res.total}\nAccuracy: ${pct}%`);
                            banner.classList.add('hidden');
                            localStorage.setItem(`medq_seen_result_${examId}`, 'true');
                        };
                    } else {
                        banner.classList.add('hidden');
                    }
                } 
                else if (exam.status === 'active') {
                    if (resultSnap.exists()) {
                        banner.classList.add('hidden');
                        localStorage.removeItem('medq_live_exam_id');
                    } else {
                        banner.classList.remove('hidden');
                        
                        banner.classList.replace('to-teal-900', 'to-indigo-900');
                        banner.classList.replace('shadow-teal-900/20', 'shadow-indigo-900/20');
                        
                        btn.classList.remove('bg-emerald-600', 'text-white', 'border-emerald-500', 'hidden');
                        btn.classList.add('bg-rose-600', 'text-white', 'border-rose-500');

                        titleEl.innerText = exam.title.toUpperCase();
                        descEl.innerText = "You have ONE attempt. Mandatory session launched.";
                        btn.innerText = "Start Exam Now";
                        
                        btn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            localStorage.setItem('medq_mode', 'exam');
                            localStorage.setItem('medq_category', exam.category || 'All');
                            localStorage.setItem('medq_section', exam.section || 'All');
                            localStorage.setItem('medq_year', 'All');
                            localStorage.setItem('medq_qcount', exam.qCount);
                            localStorage.setItem('medq_timer', exam.duration);
                            localStorage.setItem('medq_live_exam_id', examId); 
                            window.location.assign('./question.html');
                        };
                    }
                }
            } catch(e) {}
        } else {
            banner.classList.add('hidden');
            localStorage.removeItem('medq_live_exam_id');
        }
    });
}

async function loadAboutUs() {
    const setDefaults = () => {
        if(document.getElementById('aboutName')) document.getElementById('aboutName').innerText = "Dr. Hassan Salah Aldin";
        if(document.getElementById('aboutTitle')) document.getElementById('aboutTitle').innerText = "Clinical Medical Developer";
        if(document.getElementById('aboutBio')) document.getElementById('aboutBio').innerText = "Lead Developer for MEDQ. Ensuring continuous clinical practice improvement for our users.";
        if(document.getElementById('aboutIconPlaceholder')) document.getElementById('aboutIconPlaceholder').classList.remove('hidden');
        if(document.getElementById('aboutMediaContainer')) document.getElementById('aboutMediaContainer').classList.add('hidden');
    };

    try {
        let data = await getOfflineMeta('aboutUs');
        if (!data && navigator.onLine) {
            const snap = await getDoc(doc(db, "settings", "aboutUs"));
            if (snap.exists()) {
                data = snap.data();
                await setOfflineMeta('aboutUs', data);
            }
        }

        if(data) {
            if(document.getElementById('aboutName')) document.getElementById('aboutName').innerText = data.name || "Loading...";
            if(document.getElementById('aboutTitle')) document.getElementById('aboutTitle').innerText = data.title || "";
            if(document.getElementById('aboutBio')) document.getElementById('aboutBio').innerText = data.bio || "";
            
            const mediaCont = document.getElementById('aboutMediaContainer');
            const iconPlaceholder = document.getElementById('aboutIconPlaceholder');
            
            if (data.mediaUrl && mediaCont && iconPlaceholder) {
                iconPlaceholder.classList.add('hidden');
                mediaCont.classList.remove('hidden');
                mediaCont.innerHTML = generateMediaHTML(data.mediaUrl, "w-full h-full border-0", "cover");
            } else if (iconPlaceholder && mediaCont) {
                iconPlaceholder.classList.remove('hidden');
                mediaCont.classList.add('hidden');
                mediaCont.innerHTML = '';
            }
        } else { setDefaults(); }
    } catch(e) { setDefaults(); }
}

async function loadAnnouncements() {
    const adContainer = document.getElementById('dashboardAdContainer');
    if (!adContainer) return;
    
    try {
        let activeAds = [];
        const now = new Date().getTime();

        if (navigator.onLine) {
            const snapshot = await getDocs(collection(db, "announcements"));
            snapshot.forEach(doc => {
                const ad = {id: doc.id, ...doc.data()};
                // SAFELY PARSE TIMESTAMPS FOR 2026 CLOCKS
                let sTime = ad.startTime?.seconds ? ad.startTime.seconds * 1000 : ad.startTime;
                let eTime = ad.endTime?.seconds ? ad.endTime.seconds * 1000 : ad.endTime;
                
                if (sTime && eTime) {
                    if (now >= sTime && now <= eTime) activeAds.push(ad);
                } else activeAds.push(ad);
            });
            await setOfflineMeta('cachedAds', activeAds);
        } else {
            const cachedAds = await getOfflineMeta('cachedAds');
            if (cachedAds) {
                activeAds = cachedAds.filter(ad => {
                    let sTime = ad.startTime?.seconds ? ad.startTime.seconds * 1000 : ad.startTime;
                    let eTime = ad.endTime?.seconds ? ad.endTime.seconds * 1000 : ad.endTime;
                    if (sTime && eTime) return now >= sTime && now <= eTime;
                    return true;
                });
            }
        }
        
        if (activeAds.length > 0) {
            activeAds.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            
            let slidesHtml = activeAds.map((ad, index) => {
                let mediaHtml = generateMediaHTML(ad.mediaUrl, "w-full h-full rounded-xl shadow-sm border-0", "contain", true);
                const isInteractive = isInteractiveMedia(ad.mediaUrl);

                const contentWrapper = !isInteractive
                    ? `<a href="${ad.linkUrl || '#'}" target="${ad.linkUrl ? '_blank' : '_self'}" class="w-full h-full block p-2 z-10">${mediaHtml}</a>`
                    : `<div class="w-full h-full flex items-center justify-center p-2 z-10">${mediaHtml}</div>`;

                return `
                <div class="ad-slide absolute inset-0 transition-opacity duration-1000 ${index === 0 ? 'opacity-100 z-10' : 'opacity-0 z-0'}" data-index="${index}">
                    <div class="bg-black/90 h-full flex flex-col items-center justify-center relative group">
                        <div class="absolute top-4 left-6 z-20 flex items-center gap-2 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full shadow-sm pointer-events-none">
                            <i data-lucide="megaphone" class="w-4 h-4 text-warning"></i>
                            <h3 class="text-sm font-bold text-white">${ad.title}</h3>
                        </div>
                        ${contentWrapper}
                    </div>
                </div>`;
            }).join('');

            adContainer.innerHTML = `
                ${slidesHtml}
                ${activeAds.length > 1 ? `
                <div class="absolute bottom-4 left-0 right-0 flex justify-center gap-3 z-20 pointer-events-none">
                    ${activeAds.map((_, i) => `<div class="ad-dot w-3 h-3 rounded-full ${i === 0 ? 'bg-primary scale-125' : 'bg-slate-400'} transition-all duration-300 shadow-sm border border-white/20"></div>`).join('')}
                </div>` : ''}
            `;
            adContainer.classList.remove('hidden');
            adContainer.classList.add('block');
            if (typeof lucide !== 'undefined') lucide.createIcons();

            if (activeAds.length > 1 && !window.adSliderActive) {
                window.adSliderActive = true; 
                let currentSlide = 0;
                const slides = adContainer.querySelectorAll('.ad-slide');
                const dots = adContainer.querySelectorAll('.ad-dot');

                setInterval(() => {
                    if(slides.length === 0) return;
                    slides[currentSlide].classList.replace('opacity-100', 'opacity-0');
                    slides[currentSlide].classList.replace('z-10', 'z-0');
                    if(dots[currentSlide]){
                        dots[currentSlide].classList.replace('bg-primary', 'bg-slate-400');
                        dots[currentSlide].classList.remove('scale-125');
                    }

                    currentSlide = (currentSlide + 1) % activeAds.length;

                    slides[currentSlide].classList.replace('opacity-0', 'opacity-100');
                    slides[currentSlide].classList.replace('z-0', 'z-10');
                    if(dots[currentSlide]){
                        dots[currentSlide].classList.replace('bg-slate-400', 'bg-primary');
                        dots[currentSlide].classList.add('scale-125');
                    }
                }, 10000); 
            }
        } else {
            adContainer.classList.add('hidden');
            adContainer.classList.remove('block');
        }
    } catch (e) {}
}
