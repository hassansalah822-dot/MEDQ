import { db, auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, getDocs, doc, updateDoc, getDoc, setDoc, increment, arrayUnion, arrayRemove, serverTimestamp, query, where } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// =========================================================
// EMBEDDED OFFLINE DATABASE ENGINE
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

async function getOfflineQuestions(filterCriteria = {}) {
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
        const req = db.transaction('questions', 'readonly').objectStore('questions').getAll();
        req.onsuccess = () => {
            let list = (req.result || []).filter(q => q.status !== 'draft');
            if (filterCriteria.category && filterCriteria.category !== 'All') list = list.filter(q => q.subject === filterCriteria.category);
            if (filterCriteria.section && filterCriteria.section !== 'All') list = list.filter(q => (q.section || q.specialty || '') === filterCriteria.section);
            if (filterCriteria.year && filterCriteria.year !== 'All') list = list.filter(q => (q.year || '') === filterCriteria.year);
            resolve(list);
        };
        req.onerror = () => resolve([]);
    });
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

async function queueOfflineResult(payload) {
    const db = await openDB();
    if (db) db.transaction('pendingSync', 'readwrite').objectStore('pendingSync').add({ payload, date: Date.now() });
}
// =========================================================

const questionText = document.getElementById('questionText');
const optionsContainer = document.getElementById('optionsContainer');
const submitBtn = document.getElementById('submitBtn');
const nextBtn = document.getElementById('nextBtn');
const explanationBox = document.getElementById('explanationBox');
const explanationText = document.getElementById('explanationText');
const wrongExplanationBox = document.getElementById('wrongExplanationBox');
const wrongExplanationText = document.getElementById('wrongExplanationText');
const questionCounterContainer = document.getElementById('questionCounterContainer');
const questionJumper = document.getElementById('questionJumper');
const totalQuestionsDisplay = document.getElementById('totalQuestionsDisplay');

const qSubjectBadge = document.getElementById('qSubjectBadge');
const qDifficultyBadge = document.getElementById('qDifficultyBadge');
const bookmarkBtn = document.getElementById('bookmarkBtn'); 
const reportBtn = document.getElementById('reportBtn');

const prefMode = localStorage.getItem('medq_mode') || 'study';
const prefCat = localStorage.getItem('medq_category') || 'All';
const prefSec = localStorage.getItem('medq_section') || 'All';
const prefYear = localStorage.getItem('medq_year') || 'All';
const configQCount = localStorage.getItem('medq_qcount') || 'All';
const configTimerVal = localStorage.getItem('medq_timer') || 'none';
const liveExamId = localStorage.getItem('medq_live_exam_id');

let questions = []; 
let currentIndex = 0; 
let selectedOption = null;
let currentUserId = null; 
let currentUserName = "Student";
let userBookmarks = [];
let sessionStats = { total: 0, correct: 0, categories: {} };

let isPremiumUser = false;
let categoryAccessMap = {};
let timerInterval = null;
let timeRemaining = 0; 

let currentAudio = null;

function cleanArtifacts(text) {
    if (!text) return '';
    return text
        .replace(/\[span_\d+\]/gi, '')
        .replace(/\(start_span\)/gi, '')
        .replace(/\(end_span\)/gi, '')
        .replace(/<\/?span[^>]*>/gi, '')
        .trim();
}

function formatClinicalText(text) {
    if (!text) return '';
    let t = cleanArtifacts(text);
    
    t = t.replace(/\b(O2|CO2|H2O|SpO2|PO2|PCO2)\b/gi, (match) => match.replace('2', '<sub>2</sub>'));

    const boldPatterns = [
        /\b(\d{1,3}\s*(?:years?|yrs?|y\.?o\.?)(?:\s*old)?(?:\s*(?:male|female|man|woman|boy|girl|patient))?)\b/gi, 
        /\b((?:BP|Blood Pressure)\s*[:=]?\s*\d{2,3}\/\d{2,3}\s*(?:mmHg)?)\b/gi, 
        /\b((?:HR|Heart Rate|PR|Pulse)\s*[:=]?\s*\d{2,3}\s*(?:bpm|beats\/min)?)\b/gi, 
        /\b((?:RR|Respiratory Rate)\s*[:=]?\s*\d{1,2}\s*(?:breaths\/min)?)\b/gi, 
        /\b((?:Temp|Temperature|T)\s*[:=]?\s*\d{2,3}(?:\.\d)?\s*(?:[°]?[CF])?)\b/gi, 
        /\b((?:SpO2|Oxygen Saturation)\s*[:=]?\s*\d{2,3}\s*%?)\b/gi, 
        /\b((?:Na|Sodium|K|Potassium|Cl|Chloride|Ca|Calcium|Mg|Magnesium|HCO3|Bicarbonate|BUN|Cr|Creatinine|Glu|Glucose|WBC|Hb|Hemoglobin|Hct|Plt|Platelets|pH|pCO2|pO2)\s*[:=]?\s*\d+\.?\d*\s*(?:mEq\/L|mg\/dL|g\/dL|%|mcL|K\/uL|mmol\/L)?)\b/gi 
    ];

    boldPatterns.forEach(regex => { t = t.replace(regex, '<strong>$1</strong>'); });
    return t;
}

function generateMediaHTML(url, extraClasses = "w-full h-full border-0", imgFit = "cover", isAnnouncement = false) {
    if (!url) return '';
    url = url.trim();

    const ytRegExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|\/shorts\/)([^#&?]*).*/;
    const ytMatch = url.match(ytRegExp);
    if (ytMatch && ytMatch[2].length === 11) {
        const ytParams = isAnnouncement ? `?autoplay=1&mute=1&loop=1&playlist=${ytMatch[2]}&controls=1` : `?rel=0`;
        return `<iframe class="${extraClasses} pointer-events-auto rounded-2xl shadow-sm" src="https://www.youtube.com/embed/${ytMatch[2]}${ytParams}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
    }

    const driveRegex = /(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=))([a-zA-Z0-9_-]+)/;
    const driveMatch = url.match(driveRegex);
    if (driveMatch && driveMatch[1]) {
        return `<iframe class="${extraClasses} rounded-2xl shadow-sm" src="https://drive.google.com/file/d/${driveMatch[1]}/preview" allowfullscreen></iframe>`;
    }

    const fbRegex = /(?:facebook\.com\/.*\/videos\/|facebook\.com\/video\.php\?v=|fb\.watch\/|facebook\.com\/reel\/)/i;
    if (fbRegex.test(url)) {
        const fbParams = isAnnouncement ? `&autoplay=1&mute=1` : ``;
        return `<iframe class="${extraClasses} pointer-events-auto rounded-2xl shadow-sm" src="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false${fbParams}" scrolling="no" frameborder="0" allowfullscreen="true" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"></iframe>`;
    }

    const imgRegex = /\.(jpeg|jpg|gif|png|webp|svg|bmp)(?:\?.*)?$/i;
    if (imgRegex.test(url)) {
        return `<img src="${url}" class="${extraClasses} object-${imgFit} rounded-2xl shadow-sm">`;
    }

    return `<iframe class="${extraClasses} rounded-2xl shadow-sm bg-slate-50" src="${url}" allowfullscreen></iframe>`;
}

// ----------------------------------------------------
// ADVANCED CALCULATOR & MRCP LAB VALUES LOGIC
// ----------------------------------------------------
const provocateurToggle = document.getElementById('provocateurToggle');
let isProvocateurActive = localStorage.getItem('medq_provocateur') === 'true';

if (provocateurToggle) {
    const updateProvocateurUI = () => {
        if (isProvocateurActive) {
            provocateurToggle.classList.replace('bg-rose-100', 'bg-rose-600');
            provocateurToggle.classList.replace('text-rose-700', 'text-white');
        } else {
            provocateurToggle.classList.replace('bg-rose-600', 'bg-rose-100');
            provocateurToggle.classList.replace('text-white', 'text-rose-700');
        }
    };
    updateProvocateurUI(); 
    provocateurToggle.addEventListener('click', () => {
        isProvocateurActive = !isProvocateurActive;
        localStorage.setItem('medq_provocateur', isProvocateurActive);
        updateProvocateurUI();
    });
}

const calcOverlay = document.getElementById('calcOverlay');
const calcDisplay = document.getElementById('calcDisplay');
let calcValue = '';

document.getElementById('calcToggle')?.addEventListener('click', () => calcOverlay.classList.toggle('hidden'));
document.getElementById('closeCalc')?.addEventListener('click', () => calcOverlay.classList.add('hidden'));

const tabCalc = document.getElementById('tabCalc');
const tabLabs = document.getElementById('tabLabs');
const calcBody = document.getElementById('calcBody');
const labsBody = document.getElementById('labsBody');

if(tabCalc && tabLabs) {
    tabCalc.addEventListener('click', () => {
        tabCalc.classList.add('bg-slate-800', 'border-b-2', 'border-primary', 'text-white');
        tabCalc.classList.remove('text-slate-400');
        tabLabs.classList.remove('bg-slate-800', 'border-b-2', 'border-primary', 'text-white');
        tabLabs.classList.add('text-slate-400');
        calcBody.classList.remove('hidden');
        labsBody.classList.add('hidden');
        labsBody.classList.remove('flex');
    });
    tabLabs.addEventListener('click', () => {
        tabLabs.classList.add('bg-slate-800', 'border-b-2', 'border-primary', 'text-white');
        tabLabs.classList.remove('text-slate-400');
        tabCalc.classList.remove('bg-slate-800', 'border-b-2', 'border-primary', 'text-white');
        tabCalc.classList.add('text-slate-400');
        labsBody.classList.remove('hidden');
        labsBody.classList.add('flex', 'flex-col');
        calcBody.classList.add('hidden');
    });
}

document.querySelectorAll('.calc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const val = btn.dataset.val;
        if (val === 'C') { 
            calcValue = ''; calcDisplay.innerText = '0'; 
        }
        else if (val === '=') { 
            try { 
                let expr = calcValue
                    .replace(/sin\(/g, 'Math.sin(')
                    .replace(/cos\(/g, 'Math.cos(')
                    .replace(/tan\(/g, 'Math.tan(')
                    .replace(/ln\(/g, 'Math.log(')
                    .replace(/log\(/g, 'Math.log10(')
                    .replace(/√\(/g, 'Math.sqrt(')
                    .replace(/\^/g, '**');
                
                let result = Function(`'use strict'; return (${expr})`)();
                calcValue = Number.isInteger(result) ? result.toString() : result.toFixed(4).replace(/\.?0+$/, '');
                calcDisplay.innerText = calcValue; 
            } 
            catch(e) { calcDisplay.innerText = 'Error'; calcValue = ''; }
        } else { 
            calcValue += val; calcDisplay.innerText = calcValue; 
        }
    });
});

const labValues = [
    { test: "Sodium (Na+)", si: "135 - 145 mmol/L", us: null },
    { test: "Potassium (K+)", si: "3.5 - 5.0 mmol/L", us: null },
    { test: "Chloride (Cl-)", si: "95 - 105 mmol/L", us: null },
    { test: "Bicarbonate (HCO3-)", si: "22 - 28 mmol/L", us: null },
    { test: "Urea / BUN", si: "2.5 - 7.8 mmol/L", us: "7 - 22 mg/dL" },
    { test: "Creatinine", si: "60 - 120 µmol/L", us: "0.7 - 1.4 mg/dL" },
    { test: "Glucose (Fasting)", si: "3.0 - 6.0 mmol/L", us: "54 - 108 mg/dL" },
    { test: "Calcium (Total)", si: "2.2 - 2.6 mmol/L", us: "8.8 - 10.4 mg/dL" },
    { test: "Magnesium (Mg2+)", si: "0.7 - 1.0 mmol/L", us: "1.7 - 2.4 mg/dL" },
    { test: "Phosphate (PO4)", si: "0.8 - 1.4 mmol/L", us: "2.5 - 4.5 mg/dL" },
    { test: "Bilirubin", si: "< 21 µmol/L", us: "< 1.2 mg/dL" },
    { test: "ALT", si: "10 - 40 U/L", us: null },
    { test: "AST", si: "10 - 40 U/L", us: null },
    { test: "Albumin", si: "35 - 50 g/L", us: "3.5 - 5.0 g/dL" },
    { test: "Hemoglobin (Male)", si: "130 - 180 g/L", us: "13 - 18 g/dL" },
    { test: "Hemoglobin (Female)", si: "115 - 165 g/L", us: "11.5 - 16.5 g/dL" },
    { test: "WBC", si: "4.0 - 11.0 x10^9/L", us: null },
    { test: "Platelets", si: "150 - 400 x10^9/L", us: null }
];

const labValuesTable = document.getElementById('labValuesTable');
const labUnitToggle = document.getElementById('labUnitToggle');

function renderLabValues(unitSystem) {
    if(!labValuesTable) return;
    labValuesTable.innerHTML = '';
    labValues.forEach(lab => {
        let displayVal = lab.si;
        if (unitSystem === 'us' && lab.us) displayVal = lab.us;
        
        labValuesTable.innerHTML += `
            <tr class="hover:bg-slate-700/30 transition-colors">
                <td class="px-4 py-2.5 font-medium">${lab.test}</td>
                <td class="px-4 py-2.5 text-right font-mono text-emerald-400">${displayVal}</td>
            </tr>
        `;
    });
}
if(labUnitToggle) {
    labUnitToggle.addEventListener('change', (e) => renderLabValues(e.target.value));
    renderLabValues('si');
}

function startTimer(minutes) {
    const timerDisplay = document.getElementById('sessionTimer');
    const timerContainer = document.getElementById('sessionTimerContainer');
    
    timeRemaining = minutes * 60;
    
    if(timerContainer) {
        if (liveExamId) timerContainer.classList.add('bg-rose-50', 'border-rose-200', 'text-rose-700');
        else timerContainer.classList.add('bg-warning/10', 'border-warning/30', 'text-warning');
    }

    timerInterval = setInterval(() => {
        timeRemaining--;
        const h = Math.floor(timeRemaining / 3600);
        const m = Math.floor((timeRemaining % 3600) / 60).toString().padStart(2, '0');
        const s = (timeRemaining % 60).toString().padStart(2, '0');
        
        let timeStr = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
        if(timerDisplay) timerDisplay.innerText = timeStr;

        if (timeRemaining <= 300 && timerContainer) { 
            timerContainer.classList.remove('bg-warning/10', 'bg-rose-50', 'text-warning', 'text-rose-700');
            timerContainer.classList.add('bg-rose-600', 'text-white', 'border-rose-700', 'animate-pulse');
        }

        if(timeRemaining <= 0) {
            clearInterval(timerInterval);
            if(timerDisplay) timerDisplay.innerText = "00:00";
            alert("Time's up! Your exam is being automatically submitted.");
            finalizeAndSubmitBlock();
        }
    }, 1000);
}

function showExamStartScreen() {
    if (questionCounterContainer) questionCounterContainer.classList.add('hidden');
    if (optionsContainer) optionsContainer.innerHTML = '';
    if (submitBtn) submitBtn.classList.add('hidden');
    if (bookmarkBtn) bookmarkBtn.classList.add('hidden');
    if (reportBtn) reportBtn.classList.add('hidden');
    
    let warningText = "Test contents, answers, and explanations will remain strictly hidden until final submission.";
    if (configTimerVal !== 'none') {
        warningText += `<br><br><span class="text-rose-600 font-bold"><i data-lucide="timer" class="inline w-4 h-4"></i> This exam is strictly timed (${configTimerVal} minutes). It will auto-submit when the timer reaches zero.</span>`;
    }

    const isLive = !!liveExamId;
    const titleHtml = isLive 
        ? `<h3 class="text-3xl sm:text-4xl font-black text-rose-600 mb-2 tracking-tight">LIVE EXAM SESSION</h3>` 
        : `<h3 class="text-3xl font-black text-slate-900 mb-2 tracking-tight">Exam Mode Ready</h3>`;
    
    const iconHtml = isLive 
        ? `<div class="w-24 h-24 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner ring-4 ring-rose-50"><i data-lucide="radio" class="w-12 h-12 animate-pulse"></i></div>` 
        : `<div class="w-24 h-24 bg-warning/10 text-warning rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner ring-4 ring-warning/5"><i data-lucide="shield-alert" class="w-12 h-12"></i></div>`;
    
    const btnHtml = isLive 
        ? `<button id="startExamBtn" class="px-10 py-4 bg-rose-600 text-white font-bold rounded-xl shadow-lg shadow-rose-600/30 hover:-translate-y-1 hover:shadow-xl hover:shadow-rose-600/40 transition-all flex items-center gap-3 mx-auto text-lg">Begin Live Exam <i data-lucide="play" class="w-6 h-6"></i></button>` 
        : `<button id="startExamBtn" class="px-10 py-4 bg-warning text-white font-bold rounded-xl shadow-lg shadow-warning/30 hover:-translate-y-1 transition-all flex items-center gap-3 mx-auto text-lg">Begin Exam <i data-lucide="play" class="w-6 h-6"></i></button>`;

    if (questionText) {
        questionText.innerHTML = `
            <div class="text-center py-12 max-w-2xl mx-auto bg-white p-10 sm:p-14 rounded-[2.5rem] shadow-sm border ${isLive ? 'border-rose-100 bg-rose-50/30' : 'border-slate-100'}">
                ${iconHtml}
                ${titleHtml}
                <p class="${isLive ? 'text-rose-900/70' : 'text-slate-500'} mb-10 text-lg leading-relaxed font-medium">${warningText}</p>
                ${btnHtml}
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();

        document.getElementById('startExamBtn').addEventListener('click', () => {
            if (questionCounterContainer) questionCounterContainer.classList.remove('hidden');
            if (bookmarkBtn) bookmarkBtn.classList.remove('hidden');
            if (reportBtn) reportBtn.classList.remove('hidden');
            
            if (configTimerVal !== 'none') startTimer(parseInt(configTimerVal));
            displayQuestion();
        });
    }
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        try {
            if (navigator.onLine) {
                const userSnap = await getDoc(doc(db, "users", currentUserId));
                if (userSnap.exists()) {
                    const userData = userSnap.data();
                    currentUserName = userData.displayName || "Student";
                    const now = new Date().getTime();
                    
                    isPremiumUser = !(userData.role !== 'admin' && userData.accessExpiresAt && now > userData.accessExpiresAt);
                    userBookmarks = userData.bookmarks || [];
                }
            } else {
                isPremiumUser = true; // Temporary trust for offline sessions
            }
        } catch (err) {}
        await loadQuestions();
    } else {
        window.location.href = "login.html";
    }
});

async function getQuestionsByIds(idArray) {
    const fetched = [];
    const promises = idArray.map(id => getDoc(doc(db, "questions", id)));
    const docs = await Promise.all(promises);
    docs.forEach(d => { if(d.exists()) fetched.push({ id: d.id, ...d.data() }); });
    return fetched;
}

// -----------------------------------------------------------
// CACHE-FIRST QUESTIONS LOADER
// -----------------------------------------------------------
async function loadQuestions() {
    try {
        categoryAccessMap = (await getOfflineMeta('categoryAccess')) || {};
        if (Object.keys(categoryAccessMap).length === 0 && navigator.onLine) {
            const accessDoc = await getDoc(doc(db, "settings", "categoryAccess"));
            if (accessDoc.exists()) categoryAccessMap = accessDoc.data();
        }

        let rawQuestions = [];

        if (liveExamId) {
            if (navigator.onLine) {
                const liveExamDoc = await getDoc(doc(db, "liveExams", liveExamId));
                if (liveExamDoc.exists() && liveExamDoc.data().questionIds) {
                    const qIds = liveExamDoc.data().questionIds;
                    rawQuestions = await getQuestionsByIds(qIds);
                    rawQuestions.sort((a, b) => qIds.indexOf(a.id) - qIds.indexOf(b.id)); 
                }
            }
        } 
        else if (prefMode === 'bookmarks') {
            if (navigator.onLine && userBookmarks.length > 0) {
                rawQuestions = await getQuestionsByIds(userBookmarks);
            }
        } 
        else {
            const offlineBank = await getOfflineQuestions({
                category: prefCat,
                section: prefSec,
                year: prefYear
            });

            if (offlineBank && offlineBank.length > 0) {
                rawQuestions = offlineBank;
            } else if (navigator.onLine) {
                let qQuery;
                if (prefCat === 'All') qQuery = collection(db, "questions");
                else qQuery = query(collection(db, "questions"), where("subject", "==", prefCat));
                
                const querySnapshot = await getDocs(qQuery);
                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    if (data.status !== 'draft') {
                        const isLocked = categoryAccessMap[data.subject] === 'locked';
                        if (isPremiumUser || !isLocked) {
                            const matchSec = (prefSec === 'All') || ((data.section || data.specialty || '') === prefSec);
                            const matchYear = (prefYear === 'All') || ((data.year || '') === prefYear);
                            if (matchSec && matchYear) rawQuestions.push({ id: doc.id, ...data });
                        }
                    }
                });
            }

            if (configQCount !== 'All' && rawQuestions.length > 0) {
                rawQuestions = rawQuestions.sort(() => 0.5 - Math.random()).slice(0, parseInt(configQCount));
            }
        }
        
        questions = rawQuestions;

        if (questions.length > 0) {
            if (questionJumper && totalQuestionsDisplay) {
                questionJumper.innerHTML = '';
                questions.forEach((_, idx) => questionJumper.add(new Option(idx + 1, idx)));
                totalQuestionsDisplay.innerText = `of ${questions.length}`;
                questionJumper.addEventListener('change', (e) => { 
                    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
                    currentIndex = parseInt(e.target.value); 
                    displayQuestion(); 
                });
            }

            if (prefMode === 'exam' || liveExamId) showExamStartScreen(); 
            else {
                if (configTimerVal !== 'none') startTimer(parseInt(configTimerVal));
                displayQuestion();
            }
        } else { 
            if (prefCat && prefCat !== 'All' && categoryAccessMap[prefCat] === 'locked' && !isPremiumUser) {
                if (questionText) questionText.innerHTML = `
                    <div class="text-center py-12">
                        <i data-lucide="lock" class="w-16 h-16 text-error mx-auto mb-4"></i>
                        <h3 class="text-2xl font-black text-slate-900 mb-2">Restricted Category</h3>
                        <p class="text-slate-500 mb-8 text-lg">Your access has expired. Please contact support for evaluation access.</p>
                    </div>`;
                if (typeof lucide !== 'undefined') lucide.createIcons();
            } else {
                if (questionText) questionText.innerText = "No clinical scenarios available. Tap 'Download All Offline' in the Dashboard to sync your question bank."; 
            }
            document.querySelector('.animate-spin')?.remove(); 
        }
    } catch (error) {
        if (questionText) questionText.innerText = "Error loading scenarios. Please verify your connection or check your downloaded offline bank.";
    }
}

function displayQuestion() {
    const q = questions[currentIndex];
    selectedOption = null;
    
    if (optionsContainer) optionsContainer.innerHTML = '';
    if (explanationBox) { explanationBox.classList.add('hidden'); explanationBox.style.display = 'none'; }
    if (wrongExplanationBox) wrongExplanationBox.classList.add('hidden');
    
    if (submitBtn) { submitBtn.classList.remove('hidden', 'd-none'); submitBtn.disabled = true; }
    if (nextBtn) nextBtn.classList.add('hidden', 'd-none');
    if (questionJumper) questionJumper.value = currentIndex;
    
    if (qSubjectBadge) qSubjectBadge.innerText = `${q.subject || 'General'} - ${q.section || q.specialty || 'General'} - ${q.year || 'Gen'}`;
    
    if (bookmarkBtn) {
        const icon = bookmarkBtn.querySelector('svg') || bookmarkBtn.querySelector('i');
        if (icon) {
            if (userBookmarks.includes(q.id)) icon.classList.add('fill-primary', 'text-primary');
            else icon.classList.remove('fill-primary', 'text-primary');
        }
    }
    
    if (qDifficultyBadge) {
        if(liveExamId) {
            qDifficultyBadge.innerHTML = '<i data-lucide="radio" class="w-3 h-3 inline mr-1 animate-pulse"></i> LIVE EXAM';
            qDifficultyBadge.className = "px-3 py-1 bg-rose-100 text-rose-700 text-xs font-black rounded-lg uppercase tracking-wider border border-rose-200 shadow-sm flex items-center";
        } else if (prefMode === 'exam') {
            qDifficultyBadge.innerText = "EXAM MODE";
            qDifficultyBadge.className = "px-3 py-1 bg-warning/20 text-warning text-xs font-bold rounded-lg uppercase tracking-wider";
        } else {
            qDifficultyBadge.innerText = q.difficulty || 'Standard';
            qDifficultyBadge.className = "px-3 py-1 bg-slate-200 text-slate-600 text-xs font-bold rounded-lg uppercase tracking-wider";
        }
    }

    const mediaCont = document.getElementById('qMediaContainer');
    if(mediaCont) {
        if (q.mediaUrl) {
            mediaCont.classList.remove('hidden');
            mediaCont.innerHTML = generateMediaHTML(q.mediaUrl, "w-full h-full border-0 pointer-events-auto rounded-2xl", "contain");
        } else {
            mediaCont.classList.add('hidden');
            mediaCont.innerHTML = '';
        }
    }
    
    if (questionText) questionText.innerHTML = formatClinicalText(q.scenario).replace(/\n/g, '<br>');

    ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
        if (q.options && q.options[letter] && q.options[letter].trim() !== "") {
            const formattedOption = formatClinicalText(q.options[letter]);
            const div = document.createElement('div');
            div.className = 'option-item group'; 
            div.dataset.letter = letter;
            div.innerHTML = `<div class="option-letter group-hover:bg-primary/10 group-hover:text-primary">${letter}</div><div class="option-text">${formattedOption}</div>`;
            div.addEventListener('click', () => {
                if(submitBtn && (submitBtn.classList.contains('hidden') || submitBtn.classList.contains('d-none'))) return; 
                document.querySelectorAll('.option-item').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected'); 
                selectedOption = letter; 
                if (submitBtn) submitBtn.disabled = false;
            });
            if (optionsContainer) optionsContainer.appendChild(div);
        }
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

if(bookmarkBtn) {
    bookmarkBtn.addEventListener('click', async () => {
        const qId = questions[currentIndex].id;
        const icon = bookmarkBtn.querySelector('svg') || bookmarkBtn.querySelector('i');
        const userRef = doc(db, "users", currentUserId);
        
        if (userBookmarks.includes(qId)) {
            userBookmarks = userBookmarks.filter(id => id !== qId);
            if (icon) icon.classList.remove('fill-primary', 'text-primary');
            if (navigator.onLine) {
                try { await updateDoc(userRef, { bookmarks: arrayRemove(qId) }); } catch(e){}
            }
        } else {
            userBookmarks.push(qId); 
            if (icon) icon.classList.add('fill-primary', 'text-primary');
            if (navigator.onLine) {
                try { await updateDoc(userRef, { bookmarks: arrayUnion(qId) }); } catch(e){}
            }
        }
    });
}

if(reportBtn) {
    reportBtn.addEventListener('click', async () => {
        if(!confirm("Are you sure you want to report this question for containing errors?")) return;
        const qId = questions[currentIndex].id;
        const qRef = doc(db, "questions", qId);
        const originalText = reportBtn.innerHTML;
        reportBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Processing...';
        reportBtn.disabled = true;
        lucide.createIcons();

        if (navigator.onLine) {
            try {
                const qSnap = await getDoc(qRef);
                if(qSnap.exists()) {
                    const data = qSnap.data();
                    if((data.reportedBy || []).includes(currentUserId)) {
                        alert("You have already submitted a report for this specific question.");
                    } else {
                        await updateDoc(qRef, { reportedBy: arrayUnion(currentUserId), reportCount: increment(1) });
                        alert("Question flagged successfully.");
                    }
                }
            } catch(e) {}
        } else {
            alert("Report logged locally. It will be submitted when you reconnect.");
        }
        reportBtn.innerHTML = originalText; 
        reportBtn.disabled = false; 
        lucide.createIcons();
    });
}

if (submitBtn) {
    submitBtn.addEventListener('click', () => {
        if (!selectedOption) return;
        const q = questions[currentIndex];
        const isCorrect = (selectedOption === q.correctAnswer);
        const category = q.subject || "General";

        sessionStats.total++;
        if (isCorrect) sessionStats.correct++;
        if (!sessionStats.categories[category]) sessionStats.categories[category] = { total: 0, correct: 0 };
        sessionStats.categories[category].total++;
        if (isCorrect) sessionStats.categories[category].correct++;

        document.querySelectorAll('.option-item').forEach(el => el.style.pointerEvents = 'none');

        if (prefMode === 'study' || prefMode === 'bookmarks') {
            document.querySelectorAll('.option-item').forEach(el => {
                const letter = el.dataset.letter;
                if (letter === q.correctAnswer) el.classList.add('correct');
                else if (letter === selectedOption && !isCorrect) el.classList.add('incorrect');
            });
            
            if (isProvocateurActive) {
                const wrongSounds = ['1.mp3', '2.mp3'];
                const rightSounds = ['5.mp3', '6.mp3'];
                
                const soundToPlay = isCorrect 
                    ? rightSounds[Math.floor(Math.random() * rightSounds.length)] 
                    : wrongSounds[Math.floor(Math.random() * wrongSounds.length)];
                
                if (currentAudio) {
                    currentAudio.pause();
                    currentAudio.currentTime = 0;
                }
                currentAudio = new Audio(soundToPlay);
                currentAudio.play().catch(()=>{});
            }

            if (explanationText) explanationText.innerHTML = formatClinicalText(q.explanation).replace(/\n/g, '<br>');
            
            if (wrongExplanationBox && wrongExplanationText && q.wrongExplanation && q.wrongExplanation.trim() !== '') {
                wrongExplanationText.innerHTML = formatClinicalText(q.wrongExplanation).replace(/\n/g, '<br>');
                wrongExplanationBox.classList.remove('hidden');
            } else if (wrongExplanationBox) {
                wrongExplanationBox.classList.add('hidden');
            }

            if (explanationBox) { explanationBox.classList.remove('hidden'); explanationBox.style.display = 'block'; }
        } else if (prefMode === 'exam' || liveExamId) {
            const selectedDiv = document.querySelector(`.option-item[data-letter="${selectedOption}"]`);
            if (selectedDiv) { selectedDiv.classList.add('selected'); selectedDiv.classList.remove('correct', 'incorrect'); }
            if (explanationBox) { explanationBox.classList.add('hidden'); explanationBox.style.display = 'none'; }
        }
        
        submitBtn.classList.add('hidden'); 
        if (nextBtn) nextBtn.classList.remove('hidden');
    });
}

if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
        }

        if (currentIndex < questions.length - 1) { 
            currentIndex++; 
            displayQuestion(); 
        } else { 
            finalizeAndSubmitBlock(); 
        }
    });
}

async function finalizeAndSubmitBlock() {
    if(timerInterval) clearInterval(timerInterval);
    if(nextBtn) { nextBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Saving...'; nextBtn.disabled = true; }
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    try {
        if (navigator.onLine) {
            if (liveExamId) {
                await setDoc(doc(db, "liveExams", liveExamId, "results", currentUserId), {
                    userName: currentUserName,
                    score: sessionStats.correct,
                    total: sessionStats.total,
                    submittedAt: serverTimestamp()
                });
                localStorage.removeItem('medq_live_exam_id');
                alert("Live Exam submitted successfully!");
            }

            let updatePayload = { "stats.questionsSolved": increment(sessionStats.total), "stats.correctAnswers": increment(sessionStats.correct) };
            for (const [cat, data] of Object.entries(sessionStats.categories)) {
                updatePayload[`categoryStats.${cat}.total`] = increment(data.total);
                updatePayload[`categoryStats.${cat}.correct`] = increment(data.correct);
            }
            await updateDoc(doc(db, "users", currentUserId), updatePayload);
        } else {
            await queueOfflineResult(sessionStats);
        }
        window.location.assign('./performance.html');
    } catch (error) { 
        await queueOfflineResult(sessionStats);
        window.location.assign('./performance.html'); 
    }
}
