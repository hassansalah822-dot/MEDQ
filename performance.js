import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const accuracyText = document.getElementById('accuracyText');
const logoutBtn = document.getElementById('logoutBtn');
const subjectContainer = document.getElementById('subjectMasteryContainer');
const setupModal = document.getElementById('setupModal');
const cancelSetupBtn = document.getElementById('cancelSetupBtn');
const launchQuizBtn = document.getElementById('launchQuizBtn');

let isPremiumUser = false;
let categoryAccessMap = {};
let globalCategories = new Set();
let globalSections = new Set();
let globalYears = new Set();
let catToSecMap = {};

function generateMediaHTML(url, extraClasses = "w-full h-full border-0", imgFit = "cover") {
    if (!url) return '';
    url = url.trim();

    const ytRegExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|\/shorts\/)([^#&?]*).*/;
    const ytMatch = url.match(ytRegExp);
    if (ytMatch && ytMatch[2].length === 11) {
        return `<iframe class="${extraClasses} pointer-events-auto rounded-2xl shadow-sm" src="https://www.youtube.com/embed/${ytMatch[2]}?rel=0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
    }

    const driveRegex = /(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=))([a-zA-Z0-9_-]+)/;
    const driveMatch = url.match(driveRegex);
    if (driveMatch && driveMatch[1]) {
        return `<iframe class="${extraClasses} rounded-2xl shadow-sm" src="https://drive.google.com/file/d/${driveMatch[1]}/preview" allowfullscreen></iframe>`;
    }

    const fbRegex = /(?:facebook\.com\/.*\/videos\/|facebook\.com\/video\.php\?v=|fb\.watch\/|facebook\.com\/reel\/)/i;
    if (fbRegex.test(url)) {
        return `<iframe class="${extraClasses} pointer-events-auto rounded-2xl shadow-sm" src="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false" scrolling="no" frameborder="0" allowfullscreen="true" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"></iframe>`;
    }

    const imgRegex = /\.(jpeg|jpg|gif|png|webp|svg|bmp)(?:\?.*)?$/i;
    if (imgRegex.test(url)) {
        return `<img src="${url}" class="${extraClasses} object-${imgFit} rounded-2xl shadow-sm">`;
    }

    return `<iframe class="${extraClasses} rounded-2xl shadow-sm bg-slate-50" src="${url}" allowfullscreen></iframe>`;
}

export function showPremiumUpsellModal() {
    const modalHtml = `
    <div id="upsellModal" class="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 font-sans">
        <div class="absolute inset-0 bg-slate-900/40 backdrop-blur-md transition-opacity duration-300" onclick="document.getElementById('upsellModal').remove()"></div>
        <div class="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden transform scale-95 animate-[modal-pop_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards] border border-slate-100">
            <div class="absolute top-4 right-4 z-20 cursor-pointer bg-white/20 p-2 rounded-full hover:bg-white/40 transition-colors backdrop-blur-md" onclick="document.getElementById('upsellModal').remove()">
                <i data-lucide="x" class="w-5 h-5 text-slate-800"></i>
            </div>
            
            <div class="bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 px-8 py-10 text-center relative overflow-hidden">
                <div class="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full blur-2xl"></div>
                <div class="relative z-10 flex justify-center mb-6">
                    <div class="p-4 bg-white/10 rounded-2xl border border-white/20 shadow-lg backdrop-blur-md">
                        <i data-lucide="lock" class="w-10 h-10 text-amber-400"></i>
                    </div>
                </div>
                <h2 class="text-3xl font-black text-white mb-2 tracking-tight">Full Access</h2>
                <p class="text-indigo-200 font-medium text-sm">Unlock the definitive clinical experience.</p>
            </div>
            
            <div class="p-8 text-center bg-slate-50">
                <div class="space-y-4 mb-8 text-left">
                    <div class="flex items-center gap-3 text-slate-700 font-medium"><i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-500"></i> Over 10,000+ Clinical Scenarios</div>
                    <div class="flex items-center gap-3 text-slate-700 font-medium"><i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-500"></i> Deep Performance Analytics</div>
                    <div class="flex items-center gap-3 text-slate-700 font-medium"><i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-500"></i> Exclusive Category Access</div>
                </div>
                <a href="https://wa.me/+249901879983" target="_blank" class="w-full py-4 bg-slate-900 text-white font-bold rounded-xl shadow-lg hover:bg-primary hover:-translate-y-1 hover:shadow-primary/30 transition-all flex items-center justify-center gap-2">
                    Contact Support <i data-lucide="arrow-right" class="w-5 h-5"></i>
                </a>
            </div>
        </div>
    </div>
    <style>@keyframes modal-pop { 0% { opacity: 0; transform: scale(0.95) translateY(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }</style>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if(typeof lucide !== 'undefined') lucide.createIcons();
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        await loadAnalytics(user.uid);
        loadSidebarAndConfig();
        loadAboutUs();
        fetchLeaderboard();
    } else {
        window.location.href = "login.html";
    }
});

if (cancelSetupBtn) cancelSetupBtn.addEventListener('click', () => setupModal.classList.add('hidden'));

if (launchQuizBtn) {
    launchQuizBtn.addEventListener('click', () => {
        const selectedCat = document.getElementById('configCat').value;
        const selectedSec = document.getElementById('configSec').value;
        const selectedYear = document.getElementById('configYear').value;
        
        if (!isPremiumUser && selectedCat !== 'All' && categoryAccessMap[selectedCat] === 'locked') {
            setupModal.classList.add('hidden');
            showPremiumUpsellModal();
            return;
        }

        localStorage.setItem('medq_mode', document.getElementById('configMode').value);
        localStorage.setItem('medq_category', selectedCat);
        localStorage.setItem('medq_section', selectedSec);
        localStorage.setItem('medq_year', selectedYear);
        window.location.href = 'question.html';
    });
}

async function fetchLeaderboard() {
    const list = document.getElementById('leaderboardList');
    if(!list) return;
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

            // FIXED: Used text-textMain here instead of text-slate-800
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    ${rankElement}
                    <div>
                        <p class="font-bold text-textMain text-sm group-hover:text-primary transition-colors truncate w-32">${u.displayName}</p>
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

async function loadAnalytics(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            const now = new Date().getTime();
            
            if (userData.role !== 'admin' && userData.accessExpiresAt && now > userData.accessExpiresAt) {
                isPremiumUser = false;
            } else {
                isPremiumUser = true;
            }
            
            const totalSolved = userData.stats?.questionsSolved || 0;
            const correctAnswers = userData.stats?.correctAnswers || 0;
            const incorrectAnswers = totalSolved > correctAnswers ? totalSolved - correctAnswers : 0;

            let accuracy = 0;
            if (totalSolved > 0) accuracy = Math.round((correctAnswers / totalSolved) * 100);
            if (accuracyText) accuracyText.innerText = `${accuracy}%`;

            const ctx = document.getElementById('accuracyChart');
            if (ctx && typeof Chart !== 'undefined') {
                new Chart(ctx.getContext('2d'), {
                    type: 'doughnut',
                    data: { 
                        labels: ['Mastered', 'Needs Review'], 
                        datasets: [{ data: [correctAnswers, incorrectAnswers], backgroundColor: ['#10B981', '#EF4444'], borderWidth: 0, hoverOffset: 8, borderRadius: 4 }] 
                    },
                    options: { responsive: true, maintainAspectRatio: false, cutout: '78%', plugins: { legend: { position: 'right', labels: { font: { family: "'Manrope', sans-serif" }, color: '#0F172A', usePointStyle: true } } } }
                });
            }

            if (subjectContainer && userData.categoryStats) {
                subjectContainer.innerHTML = ''; 
                const colors = ['bg-primary text-primary', 'bg-accent text-accent', 'bg-warning text-warning', 'bg-secondary text-secondary'];
                let colorIndex = 0;
                
                for (const [subject, data] of Object.entries(userData.categoryStats)) {
                    if (data.total > 0) {
                        const subjAccuracy = Math.round((data.correct / data.total) * 100);
                        const [bgClass, textClass] = colors[colorIndex % colors.length].split(' ');
                        const div = document.createElement('div');
                        div.innerHTML = `
                            <div class="flex justify-between text-sm font-semibold mb-2">
                                <span class="text-textMain">${subject} <span class="text-xs text-slate-400 font-normal">(${data.total} attempts)</span></span>
                                <span class="${textClass}">${subjAccuracy}%</span>
                            </div>
                            <div class="w-full bg-slate-100 rounded-full h-2.5 shadow-inner">
                                <div class="${bgClass} h-2.5 rounded-full" style="width: ${subjAccuracy}%"></div>
                            </div>
                        `;
                        subjectContainer.appendChild(div);
                        colorIndex++;
                    }
                }
            } else if (subjectContainer) {
                subjectContainer.innerHTML = '<p class="text-textMuted text-sm">Complete a clinical block to view subject mastery data.</p>';
            }
        }
    } catch (error) {}
}

async function loadSidebarAndConfig() {
    const sidebar = document.getElementById('dynamicSidebarCats');
    const catSelect = document.getElementById('configCat');
    const secSelect = document.getElementById('configSec');
    const yearSelect = document.getElementById('configYear');

    try {
        const accessDoc = await getDoc(doc(db, "settings", "categoryAccess"));
        if (accessDoc.exists()) categoryAccessMap = accessDoc.data();

        const metaDoc = await getDoc(doc(db, "settings", "metadata"));
        
        if (metaDoc.exists()) {
            const meta = metaDoc.data();
            globalCategories = new Set(meta.categories || []);
            globalYears = new Set(meta.years || []);
            catToSecMap = meta.catToSecMap || {};
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
                    showPremiumUpsellModal();
                } else {
                    if (catSelect) {
                        catSelect.value = cat;
                        catSelect.dispatchEvent(new Event('change'));
                    }
                    if (yearSelect) yearSelect.value = 'All';
                    if (setupModal) setupModal.classList.remove('hidden');
                }
            };
            sidebar.appendChild(btn);
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch(e) {}
}

async function loadAboutUs() {
    const aboutBtn = document.getElementById('aboutUsBtn');
    const aboutModal = document.getElementById('aboutModal');
    const closeBtn = document.getElementById('closeAboutBtn');
    
    if(!aboutBtn || !aboutModal || !closeBtn) return;
    
    aboutBtn.addEventListener('click', () => aboutModal.classList.remove('hidden'));
    closeBtn.addEventListener('click', () => aboutModal.classList.add('hidden'));

    const setDefaults = () => {
        document.getElementById('aboutName').innerText = "Dr. Hassan Salah Aldin";
        document.getElementById('aboutTitle').innerText = "Clinical Medical Developer";
        document.getElementById('aboutBio').innerText = "Lead Developer for MEDQ. Ensuring continuous clinical practice improvement for our users.";
        document.getElementById('aboutIconPlaceholder').classList.remove('hidden');
        if(document.getElementById('aboutMediaContainer')) {
            document.getElementById('aboutMediaContainer').classList.add('hidden');
        }
    };

    try {
        const snap = await getDoc(doc(db, "settings", "aboutUs"));
        if(snap.exists()) {
            const data = snap.data();
            document.getElementById('aboutName').innerText = data.name || "Loading...";
            document.getElementById('aboutTitle').innerText = data.title || "";
            document.getElementById('aboutBio').innerText = data.bio || "";
            
            const mediaCont = document.getElementById('aboutMediaContainer');
            const iconPlaceholder = document.getElementById('aboutIconPlaceholder');
            
            if (data.mediaUrl) {
                iconPlaceholder.classList.add('hidden');
                mediaCont.classList.remove('hidden');
                mediaCont.innerHTML = generateMediaHTML(data.mediaUrl, "w-full h-full border-0", "cover");
            } else {
                iconPlaceholder.classList.remove('hidden');
                mediaCont.classList.add('hidden');
                mediaCont.innerHTML = '';
            }
        } else { setDefaults(); }
    } catch(e) { setDefaults(); }
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => { 
        e.preventDefault(); 
        await signOut(auth); 
        window.location.href = "login.html"; 
    });
}

const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const appSidebar = document.getElementById('appSidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');

if (mobileMenuBtn && appSidebar && sidebarOverlay) {
    const toggleSidebar = () => {
        const isClosed = appSidebar.classList.contains('-translate-x-[120%]');
        if (isClosed) {
            appSidebar.classList.remove('-translate-x-[120%]');
            sidebarOverlay.classList.remove('hidden');
        } else {
            appSidebar.classList.add('-translate-x-[120%]');
            sidebarOverlay.classList.add('hidden');
        }
    };
    mobileMenuBtn.addEventListener('click', toggleSidebar);
    if(closeSidebarBtn) closeSidebarBtn.addEventListener('click', toggleSidebar);
    sidebarOverlay.addEventListener('click', toggleSidebar);
}
