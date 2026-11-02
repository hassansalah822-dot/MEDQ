import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, addDoc, serverTimestamp, doc, getDoc, getDocs, deleteDoc, updateDoc, setDoc, query, limit, startAfter, where, writeBatch, orderBy, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseTimeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("Network timeout: Firebase connection stalled. Check your firewall or network.")), ms));

const addQuestionForm = document.getElementById('addQuestionForm');
const adminQuestionList = document.getElementById('adminQuestionList');
const adminUserList = document.getElementById('adminUserList');
const adminReportsList = document.getElementById('adminReportsList');
const addAdForm = document.getElementById('addAdForm');
const adminAdList = document.getElementById('adminAdList');
const editAboutForm = document.getElementById('editAboutForm');
const launchLiveExamForm = document.getElementById('launchLiveExamForm');
const bulkEmailBtn = document.getElementById('bulkEmailBtn');
const loadMoreUsersBtn = document.getElementById('loadMoreUsersBtn');
const loadMoreQuestionsBtn = document.getElementById('loadMoreQuestionsBtn');
const adminCategoryAccessList = document.getElementById('adminCategoryAccessList');
const saveCategoryAccessBtn = document.getElementById('saveCategoryAccessBtn');
const syncMetadataBtn = document.getElementById('syncMetadataBtn');
const cancelAdEditBtn = document.getElementById('cancelAdEditBtn');
const processBulkBtn = document.getElementById('processBulkBtn');
const toggleAddScenarioBtn = document.getElementById('toggleAddScenarioBtn');
const fileInput = document.getElementById('bulkFileInput');
const commitScenarioBtn = document.getElementById('commitScenarioBtn');
const commitEditScenarioBtn = document.getElementById('commitEditScenarioBtn');
const broadcastExamBtn = document.getElementById('broadcastExamBtn');
const scheduleAdBtn = document.getElementById('scheduleAdBtn');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const adminUserSearch = document.getElementById('adminUserSearch');

let categoryAccessMap = {};
let revenueChartInstance = null;
let userEmails = [];
let lastVisibleUser = null;
let lastVisibleQuestion = null;
let globalQuestionsCache = {}; 
let allQuestionsRawList = []; 
let uniqueCategories = new Set();
let uniqueSections = new Set();
let uniqueYears = new Set();

if (adminUserSearch) {
    adminUserSearch.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const userCards = document.querySelectorAll('#adminUserList > div');
        userCards.forEach(card => {
            const text = card.innerText.toLowerCase();
            card.style.display = text.includes(term) ? 'flex' : 'none';
        });
    });
}

if (toggleAddScenarioBtn && addQuestionForm) {
    toggleAddScenarioBtn.addEventListener('click', (e) => {
        e.preventDefault(); 
        addQuestionForm.classList.toggle('hidden');
        if (!addQuestionForm.classList.contains('hidden')) {
            setTimeout(() => { addQuestionForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
        }
    });
}

if (fileInput) {
    fileInput.addEventListener('change', function() {
        const nameDisplay = document.getElementById('selectedFileName');
        if(this.files && this.files.length > 0) {
            nameDisplay.innerText = "Selected File: " + this.files[0].name;
            nameDisplay.classList.add('text-primary');
        } else {
            nameDisplay.innerText = "No file selected";
            nameDisplay.classList.remove('text-primary');
        }
    });
}

if (syncMetadataBtn) {
    syncMetadataBtn.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Syncing...`;
        btn.disabled = true;
        try {
            const snap = await Promise.race([getDocs(collection(db, "questions")), firebaseTimeout(10000)]);
            let categories = new Set(); let years = new Set(); let catMap = {};
            snap.forEach(document => { 
                const d = document.data();
                if(d.status !== 'draft') {
                    const cat = d.subject || 'General';
                    const sec = d.section || d.specialty || 'General Section';
                    const yr = d.year || 'General';
                    categories.add(cat);
                    years.add(yr);
                    if(!catMap[cat]) catMap[cat] = [];
                    if(!catMap[cat].includes(sec)) catMap[cat].push(sec);
                }
            });
            await Promise.race([setDoc(doc(db, "settings", "metadata"), { categories: Array.from(categories), years: Array.from(years), catToSecMap: catMap }), firebaseTimeout(10000)]);
            btn.innerHTML = `<i data-lucide="check" class="w-5 h-5"></i> Synced Successfully!`;
        } catch (err) {
            btn.innerHTML = `Error: ${err.message}`;
        } finally {
            setTimeout(() => { btn.innerHTML = `Sync Categories`; btn.disabled = false; if(typeof lucide !== 'undefined') lucide.createIcons(); }, 3000);
        }
    });
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDocRef = doc(db, "users", user.uid);
        try {
            const userDocSnap = await Promise.race([getDoc(userDocRef), firebaseTimeout(10000)]);
            if (userDocSnap.exists() && userDocSnap.data().role === 'admin') {
                await fetchAllQuestionsForCache(); 
                fetchAdminQuestions(); 
                fetchUsers();
                fetchAds();
                fetchRevenueData();
                loadAboutProfile();
                fetchCategoryAccess();
                fetchReports();
                fetchLiveExams();
            } else {
                alert("ACCESS DENIED: You are not an administrator.");
                window.location.href = "dashboard.html";
            }
        } catch (error) {
            alert("Connection error: " + error.message);
        }
    } else {
        window.location.href = "login.html";
    }
});

function populateDatalists() {
    const catList = document.getElementById('category-options');
    const secList = document.getElementById('section-options');
    const yearList = document.getElementById('year-options');
    
    if (catList) catList.innerHTML = Array.from(uniqueCategories).sort().map(c => `<option value="${c}">`).join('');
    if (secList) secList.innerHTML = Array.from(uniqueSections).sort().map(s => `<option value="${s}">`).join('');
    if (yearList) yearList.innerHTML = Array.from(uniqueYears).sort((a,b)=>b-a).map(y => `<option value="${y}">`).join('');
}

function renderCategoryManager(groupedForManager) {
    const managerList = document.getElementById('categoryManagerList');
    if(!managerList) return;
    managerList.innerHTML = '';
    const sortedCats = Object.keys(groupedForManager).sort();
    
    if (sortedCats.length === 0) {
        managerList.innerHTML = '<p class="text-slate-500">No categories found in the database.</p>';
        return;
    }

    for (const cat of sortedCats) {
        const catDiv = document.createElement('div');
        catDiv.className = "border border-slate-200 rounded-xl p-4 bg-slate-50";
        
        const header = document.createElement('div');
        header.className = "flex justify-between items-center mb-2";
        header.innerHTML = `
            <h3 class="font-bold text-lg text-slate-800 flex items-center gap-2"><i data-lucide="folder" class="w-4 h-4 text-primary"></i> ${cat}</h3>
            <button data-cat="${cat}" class="delete-cat-btn px-3 py-1.5 bg-error/10 text-error font-bold rounded-lg text-sm hover:bg-error hover:text-white transition-colors border border-error/20">Delete Category</button>
        `;
        catDiv.appendChild(header);

        const sortedSecs = Array.from(groupedForManager[cat]).sort();
        const secContainer = document.createElement('div');
        secContainer.className = "pl-4 space-y-2 mt-3 border-l-2 border-slate-200";
        
        sortedSecs.forEach(sec => {
            const secDiv = document.createElement('div');
            secDiv.className = "flex justify-between items-center p-2 bg-white rounded-lg border border-slate-100 shadow-sm";
            secDiv.innerHTML = `
                <span class="text-sm font-medium text-slate-700 flex items-center gap-2"><i data-lucide="corner-down-right" class="w-3 h-3 text-slate-400"></i> ${sec}</span>
                <button data-cat="${cat}" data-sec="${sec}" class="delete-sec-btn px-3 py-1 bg-warning/10 text-warning font-bold rounded text-xs hover:bg-warning hover:text-white transition-colors border border-warning/20">Delete Section</button>
            `;
            secContainer.appendChild(secDiv);
        });
        
        catDiv.appendChild(secContainer);
        managerList.appendChild(catDiv);
    }
    
    if(typeof lucide !== 'undefined') lucide.createIcons();
    
    document.querySelectorAll('.delete-cat-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const cat = e.target.getAttribute('data-cat');
            if(confirm(`WARNING: Are you sure you want to completely delete the category "${cat}" and ALL its questions? This cannot be undone.`)) {
                e.target.innerText = "Deleting..."; e.target.disabled = true;
                await deleteCategoryAndQuestions(cat, null);
            }
        });
    });
    
    document.querySelectorAll('.delete-sec-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const cat = e.target.getAttribute('data-cat');
            const sec = e.target.getAttribute('data-sec');
            if(confirm(`WARNING: Are you sure you want to completely delete the section "${sec}" in "${cat}" and ALL its questions?`)) {
                e.target.innerText = "Deleting..."; e.target.disabled = true;
                await deleteCategoryAndQuestions(cat, sec);
            }
        });
    });
}

async function deleteCategoryAndQuestions(cat, sec) {
    try {
        let qQuery;
        if (sec) qQuery = query(collection(db, "questions"), where("subject", "==", cat), where("section", "==", sec));
        else qQuery = query(collection(db, "questions"), where("subject", "==", cat));
        
        const snap = await Promise.race([getDocs(qQuery), firebaseTimeout(10000)]);
        
        if (snap.empty) {
            alert("No questions found to delete.");
            return;
        }

        const batchSize = 400;
        let batch = writeBatch(db);
        let count = 0;
        
        for (const docSnap of snap.docs) {
            batch.delete(docSnap.ref);
            count++;
            if (count % batchSize === 0) {
                await Promise.race([batch.commit(), firebaseTimeout(10000)]);
                batch = writeBatch(db);
            }
        }
        if (count % batchSize !== 0) {
            await Promise.race([batch.commit(), firebaseTimeout(10000)]);
        }
        
        alert(`Successfully deleted ${count} scenarios.`);
        await fetchAllQuestionsForCache();
        fetchAdminQuestions(); 
        
    } catch(e) { alert("Error deleting: " + e.message); }
}

async function fetchAllQuestionsForCache() {
    try {
        const qSnap = await getDocs(collection(db, "questions"));
        allQuestionsRawList = [];
        uniqueCategories.clear();
        uniqueSections.clear();
        uniqueYears.clear();
        
        const groupedForManager = {};

        qSnap.forEach(docSnap => {
            const data = docSnap.data();
            allQuestionsRawList.push({ id: docSnap.id, ...data });
            
            const cat = data.subject || 'General';
            const sec = data.section || data.specialty || 'General Section';
            
            uniqueCategories.add(cat);
            uniqueSections.add(sec);
            if (data.year) uniqueYears.add(data.year);

            if (!groupedForManager[cat]) groupedForManager[cat] = new Set();
            groupedForManager[cat].add(sec);
        });
        
        populateDatalists();
        renderCategoryManager(groupedForManager);
    } catch(err) {}
}

async function fetchRevenueData() {
    try {
        const revSnap = await getDocs(collection(db, "revenue"));
        let totalRev = 0;
        let monthlyData = {};

        revSnap.forEach(doc => {
            const data = doc.data();
            totalRev += data.amount || 0;
            const date = new Date(data.date);
            const monthYear = date.toLocaleString('default', { month: 'short', year: 'numeric' });
            if(!monthlyData[monthYear]) monthlyData[monthYear] = 0;
            monthlyData[monthYear] += data.amount || 0;
        });

        document.getElementById('totalRevenueText').innerText = totalRev.toString();

        const ctx = document.getElementById('revenueChart');
        if (revenueChartInstance) revenueChartInstance.destroy(); 
        if (ctx && typeof Chart !== 'undefined') {
            revenueChartInstance = new Chart(ctx.getContext('2d'), {
                type: 'line',
                data: {
                    labels: Object.keys(monthlyData).length > 0 ? Object.keys(monthlyData) : ['No Data'],
                    datasets: [{
                        label: 'Activation Value',
                        data: Object.keys(monthlyData).length > 0 ? Object.values(monthlyData) : [0],
                        borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3, tension: 0.4, fill: true,
                        pointBackgroundColor: '#2563EB', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 5
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { borderDash: [4, 4] } }, x: { grid: { display: false } } } }
            });
        }
    } catch(err) {}
}

async function fetchCategoryAccess() {
    if (!adminCategoryAccessList) return;
    try {
        const accessDoc = await getDoc(doc(db, "settings", "categoryAccess"));
        if (accessDoc.exists()) categoryAccessMap = accessDoc.data();
        adminCategoryAccessList.innerHTML = '';
        if (uniqueCategories.size === 0) {
            adminCategoryAccessList.innerHTML = '<p class="text-textMuted">No categories found in database yet.</p>';
            return;
        }

        Array.from(uniqueCategories).sort().forEach(cat => {
            const isLocked = categoryAccessMap[cat] === 'locked';
            const div = document.createElement('div');
            div.className = "flex justify-between items-center p-4 border border-slate-200 rounded-xl bg-slate-50";
            div.innerHTML = `
                <span class="font-bold text-textMain">${cat}</span>
                <select class="category-access-select p-2 rounded-lg border outline-primary font-bold ${isLocked ? 'text-error bg-red-50 border-error/30' : 'text-emerald-600 bg-emerald-50 border-emerald-500/30'}" data-category="${cat}">
                    <option value="free" ${!isLocked ? 'selected' : ''}>Free Access</option>
                    <option value="locked" ${isLocked ? 'selected' : ''}>Locked (Requires Activation)</option>
                </select>
            `;
            
            const select = div.querySelector('select');
            select.addEventListener('change', (e) => {
                if (e.target.value === 'locked') e.target.className = "category-access-select p-2 rounded-lg outline-primary font-bold text-error bg-red-50 border-2 border-error/30";
                else e.target.className = "category-access-select p-2 rounded-lg outline-primary font-bold text-emerald-600 bg-emerald-50 border-2 border-emerald-500/30";
            });
            adminCategoryAccessList.appendChild(div);
        });
        if(typeof lucide !== 'undefined') lucide.createIcons();
    } catch (error) {}
}

if (saveCategoryAccessBtn) {
    saveCategoryAccessBtn.addEventListener('click', async () => {
        const selects = adminCategoryAccessList.querySelectorAll('.category-access-select');
        const newMap = {};
        selects.forEach(select => newMap[select.getAttribute('data-category')] = select.value);

        const originalHtml = saveCategoryAccessBtn.innerHTML;
        saveCategoryAccessBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Saving...';
        saveCategoryAccessBtn.disabled = true;
        
        try {
            await Promise.race([setDoc(doc(db, "settings", "categoryAccess"), newMap), firebaseTimeout(10000)]);
            categoryAccessMap = newMap;
            alert("Category Access Levels Saved Successfully!");
        } catch (error) { alert("Error saving: " + error.message); } 
        finally { saveCategoryAccessBtn.innerHTML = originalHtml; saveCategoryAccessBtn.disabled = false; if(typeof lucide !== 'undefined') lucide.createIcons(); }
    });
}

if (commitScenarioBtn) {
    commitScenarioBtn.addEventListener('click', async () => {
        const requiredIds = ['qSubject', 'qSection', 'qTopic', 'qScenario', 'optA', 'optB', 'optC', 'optD', 'qExplanation'];
        for (let id of requiredIds) {
            const el = document.getElementById(id);
            if (el && !el.value.trim()) {
                alert("Please fill in all required fields. Missing: " + id.replace('q', '').replace('opt', 'Option '));
                return;
            }
        }

        commitScenarioBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Saving...';
        commitScenarioBtn.disabled = true;

        const mediaInput = document.getElementById('qMedia');
        const finalMediaUrl = mediaInput ? mediaInput.value.trim() : null;

        const eOpt = document.getElementById('optE');
        const wExp = document.getElementById('qWrongExplanation');

        const newQuestion = {
            status: document.getElementById('qStatus').value, 
            subject: document.getElementById('qSubject').value.trim(), 
            section: document.getElementById('qSection').value.trim(), 
            topic: document.getElementById('qTopic').value.trim(),
            difficulty: document.getElementById('qDifficulty').value, 
            year: document.getElementById('qYear').value.trim(),
            mediaUrl: finalMediaUrl,
            scenario: document.getElementById('qScenario').value.trim(), 
            correctAnswer: document.getElementById('qCorrect').value,
            explanation: document.getElementById('qExplanation').value.trim(), 
            wrongExplanation: wExp ? wExp.value.trim() : "", 
            createdAt: serverTimestamp(),
            reportCount: 0,
            options: { 
                A: document.getElementById('optA').value.trim(), 
                B: document.getElementById('optB').value.trim(), 
                C: document.getElementById('optC').value.trim(), 
                D: document.getElementById('optD').value.trim(),
                E: eOpt ? eOpt.value.trim() : "" 
            }
        };

        try {
            await Promise.race([addDoc(collection(db, "questions"), newQuestion), firebaseTimeout(10000)]);
            if(addQuestionForm) { addQuestionForm.reset(); addQuestionForm.classList.add('hidden'); }
            await fetchAllQuestionsForCache();
            fetchAdminQuestions(); 
            alert("Scenario successfully added!");
        } catch (error) { 
            alert("Failed to save: " + error.message); 
        } finally { 
            commitScenarioBtn.innerHTML = '<i data-lucide="cloud-upload" class="w-5 h-5"></i> Commit Scenario'; 
            commitScenarioBtn.disabled = false; 
            if(typeof lucide !== 'undefined') lucide.createIcons(); 
        }
    });
}

async function fetchAdminQuestions(isLoadMore = false) {
    if(!adminQuestionList) return;
    try {
        let q;
        if (isLoadMore && lastVisibleQuestion) q = query(collection(db, "questions"), startAfter(lastVisibleQuestion), limit(50));
        else { q = query(collection(db, "questions"), limit(50)); adminQuestionList.innerHTML = ''; globalQuestionsCache = {}; }

        const snapshot = await getDocs(q);
        if (snapshot.empty && !isLoadMore) { adminQuestionList.innerHTML = '<p class="text-textMuted">No questions found.</p>'; return; }

        lastVisibleQuestion = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.docs.length < 50 && loadMoreQuestionsBtn) loadMoreQuestionsBtn.classList.add('hidden');
        else if(loadMoreQuestionsBtn) loadMoreQuestionsBtn.classList.remove('hidden');

        const groupedData = {};
        snapshot.forEach(docSnap => {
            const data = docSnap.data(); 
            const category = data.subject || 'Uncategorized';
            const section = data.section || data.specialty || 'General Section'; 
            globalQuestionsCache[docSnap.id] = data;
            if (!groupedData[category]) groupedData[category] = {};
            if (!groupedData[category][section]) groupedData[category][section] = [];
            groupedData[category][section].push({ id: docSnap.id, ...data });
        });

        const sortedCategories = Object.keys(groupedData).sort();
        for (const category of sortedCategories) {
            const sectionsMap = groupedData[category];
            const catDiv = document.createElement('div');
            catDiv.className = "mb-6";
            const catHeader = document.createElement('h3');
            catHeader.className = "text-xl font-extrabold text-primary mb-3 flex items-center gap-2 border-b-2 border-primary/20 pb-2";
            catHeader.innerHTML = `<i data-lucide="folder-open" class="w-6 h-6"></i> Category: ${category}`;
            catDiv.appendChild(catHeader);

            const sortedSections = Object.keys(sectionsMap).sort();
            for (const section of sortedSections) {
                const questions = sectionsMap[section];
                const secHeader = document.createElement('h4');
                secHeader.className = "text-lg font-bold text-slate-700 mt-4 mb-3 ml-4 flex items-center gap-2";
                secHeader.innerHTML = `<i data-lucide="layout-list" class="w-5 h-5 text-slate-400"></i> Section: ${section} <span class="text-xs font-normal text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full">${questions.length} items</span>`;
                catDiv.appendChild(secHeader);

                const qListContainer = document.createElement('div');
                qListContainer.className = "ml-6 pl-4 border-l-2 border-slate-200 space-y-3";

                questions.forEach(data => {
                    const isDraft = data.status === 'draft';
                    const statusBadge = isDraft ? `<span class="bg-warning/10 text-warning px-2 py-1 rounded text-xs font-bold uppercase"><i data-lucide="eye-off" class="w-3 h-3 inline"></i> Draft</span>` : `<span class="bg-accent/10 text-accent px-2 py-1 rounded text-xs font-bold uppercase"><i data-lucide="eye" class="w-3 h-3 inline"></i> Published</span>`;
                    const div = document.createElement('div');
                    div.className = "flex justify-between items-center p-4 border border-slate-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow";
                    div.innerHTML = `
                        <div class="flex-1 mr-4">
                            <p class="font-bold text-textMain line-clamp-1 ${isDraft ? 'text-slate-400' : ''}">${data.scenario}</p>
                            <div class="flex gap-2 mt-2 text-xs font-bold uppercase tracking-wider">
                                ${statusBadge} <span class="bg-slate-200 text-slate-600 px-2 py-1 rounded">Diff: ${data.difficulty || 'N/A'} | Year: ${data.year || 'Gen'}</span>
                            </div>
                        </div>
                        <div class="flex gap-2 flex-wrap justify-end">
                            <button data-id="${data.id}" class="edit-q-btn px-3 py-2 bg-blue-50 text-blue-600 font-bold rounded-lg text-sm hover:bg-blue-600 hover:text-white transition-colors border border-blue-200">Edit</button>
                            <button data-id="${data.id}" data-current-status="${data.status || 'published'}" class="toggle-status-btn px-3 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg text-sm hover:bg-slate-200 transition-colors">${isDraft ? 'Publish' : 'Hide'}</button>
                            <button data-id="${data.id}" class="delete-btn px-3 py-2 bg-error/10 text-error font-bold rounded-lg text-sm hover:bg-error hover:text-white transition-colors border border-error/20">Del</button>
                        </div>
                    `;
                    qListContainer.appendChild(div);
                });
                catDiv.appendChild(qListContainer);
            }
            adminQuestionList.appendChild(catDiv);
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
        attachQuestionListeners();
    } catch (error) {}
}

if(loadMoreQuestionsBtn) loadMoreQuestionsBtn.addEventListener('click', () => fetchAdminQuestions(true));

function attachQuestionListeners() {
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(confirm("Permanently delete this scenario?")) { await Promise.race([deleteDoc(doc(db, "questions", e.currentTarget.getAttribute('data-id'))), firebaseTimeout(10000)]); await fetchAllQuestionsForCache(); fetchAdminQuestions(); }
        });
    });
    document.querySelectorAll('.toggle-status-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const targetId = e.currentTarget.getAttribute('data-id');
            const currentStatus = e.currentTarget.getAttribute('data-current-status');
            const newStatus = currentStatus === 'draft' ? 'published' : 'draft';
            await Promise.race([updateDoc(doc(db, "questions", targetId), { status: newStatus }), firebaseTimeout(10000)]);
            fetchAdminQuestions(); 
        });
    });
    document.querySelectorAll('.edit-q-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-id');
            const data = globalQuestionsCache[targetId];
            if(data) {
                document.getElementById('editQId').value = targetId;
                document.getElementById('editQSubject').value = data.subject || '';
                document.getElementById('editQSection').value = data.section || data.specialty || '';
                document.getElementById('editQDifficulty').value = data.difficulty || 'Medium';
                document.getElementById('editQYear').value = data.year || '';
                document.getElementById('editQTopic').value = data.topic || '';
                
                if(document.getElementById('editQMedia')) document.getElementById('editQMedia').value = data.mediaUrl || '';
                
                document.getElementById('editQScenario').value = data.scenario || '';
                document.getElementById('editOptA').value = data.options?.A || '';
                document.getElementById('editOptB').value = data.options?.B || '';
                document.getElementById('editOptC').value = data.options?.C || '';
                document.getElementById('editOptD').value = data.options?.D || '';
                document.getElementById('editOptE').value = data.options?.E || '';
                document.getElementById('editQCorrect').value = data.correctAnswer || 'A';
                document.getElementById('editQExplanation').value = data.explanation || '';
                document.getElementById('editQWrongExplanation').value = data.wrongExplanation || '';
                document.getElementById('editQuestionModal').classList.remove('hidden');
            }
        });
    });
}

if(commitEditScenarioBtn) {
    commitEditScenarioBtn.addEventListener('click', async () => {
        
        const requiredIds = ['editQSubject', 'editQSection', 'editQTopic', 'editQScenario', 'editOptA', 'editOptB', 'editOptC', 'editOptD', 'editQExplanation'];
        for (let id of requiredIds) {
            const el = document.getElementById(id);
            if (el && !el.value.trim()) {
                alert("Please fill in all required fields.");
                return;
            }
        }

        commitEditScenarioBtn.disabled = true; 
        commitEditScenarioBtn.innerHTML = 'Saving...';
        
        const qId = document.getElementById('editQId').value;
        const editMediaInput = document.getElementById('editQMedia');
        const finalEditMediaUrl = editMediaInput ? editMediaInput.value.trim() : null;
        
        const eOpt = document.getElementById('editOptE');
        const wExp = document.getElementById('editQWrongExplanation');

        try {
            await Promise.race([updateDoc(doc(db, "questions", qId), {
                subject: document.getElementById('editQSubject').value.trim(),
                section: document.getElementById('editQSection').value.trim(),
                difficulty: document.getElementById('editQDifficulty').value,
                year: document.getElementById('editQYear').value.trim(),
                topic: document.getElementById('editQTopic').value.trim(),
                mediaUrl: finalEditMediaUrl,
                scenario: document.getElementById('editQScenario').value.trim(),
                correctAnswer: document.getElementById('editQCorrect').value,
                explanation: document.getElementById('editQExplanation').value.trim(),
                wrongExplanation: wExp ? wExp.value.trim() : "",
                options: {
                    A: document.getElementById('editOptA').value.trim(), 
                    B: document.getElementById('editOptB').value.trim(),
                    C: document.getElementById('editOptC').value.trim(), 
                    D: document.getElementById('editOptD').value.trim(),
                    E: eOpt ? eOpt.value.trim() : ""
                }
            }), firebaseTimeout(10000)]);
            document.getElementById('editQuestionModal').classList.add('hidden');
            await fetchAllQuestionsForCache();
            fetchAdminQuestions(); 
            alert("Scenario successfully updated!");
        } catch(err) { 
            alert("Error updating question: " + err.message); 
        } finally { 
            commitEditScenarioBtn.disabled = false; 
            commitEditScenarioBtn.innerHTML = 'Save Changes'; 
        }
    });
}

if (broadcastExamBtn) {
    broadcastExamBtn.addEventListener('click', async () => {
        const title = document.getElementById('liveExamTitle').value.trim();
        const timer = document.getElementById('liveExamTimer').value;
        
        if(!title || !timer) {
            alert("Please fill in the Exam Title and Timer.");
            return;
        }

        const cat = document.getElementById('liveExamCat').value || 'All';
        const sec = document.getElementById('liveExamSec').value || 'All';
        const selectionMode = document.querySelector('input[name="selectionMode"]:checked').value;
        
        let finalQuestionIds = [];
        let finalCount = 0;

        if (selectionMode === 'manual') {
            const checkedBoxes = document.querySelectorAll('.manual-q-checkbox:checked');
            if(checkedBoxes.length === 0) return alert("Please select at least one question in Manual Mode.");
            checkedBoxes.forEach(cb => finalQuestionIds.push(cb.value));
            finalCount = finalQuestionIds.length;
        } else {
            const reqCount = parseInt(document.getElementById('liveExamCount').value);
            let pool = allQuestionsRawList.filter(q => {
                const matchCat = cat === 'All' || q.subject === cat;
                const matchSec = sec === 'All' || (q.section || q.specialty) === sec;
                return matchCat && matchSec && q.status !== 'draft';
            });
            if(pool.length === 0) return alert("No valid published questions found for this filter combination.");
            
            pool = pool.sort(() => 0.5 - Math.random()).slice(0, reqCount);
            finalQuestionIds = pool.map(q => q.id);
            finalCount = finalQuestionIds.length;
        }

        broadcastExamBtn.disabled = true; broadcastExamBtn.innerHTML = 'Broadcasting...';

        try {
            await Promise.race([addDoc(collection(db, "liveExams"), {
                title: title,
                duration: parseInt(timer),
                category: cat,
                section: sec,
                qCount: finalCount,
                questionIds: finalQuestionIds,
                status: 'active',
                createdAt: serverTimestamp()
            }), firebaseTimeout(10000)]);
            alert("Live Exam successfully broadcasted to all active students!");
            if(launchLiveExamForm) launchLiveExamForm.reset();
            const countBadge = document.getElementById('manualSelectedCount');
            if(countBadge) countBadge.innerText = "0 selected";
            fetchLiveExams();
        } catch (err) { alert("Error launching exam: " + err.message); } 
        finally { broadcastExamBtn.disabled = false; broadcastExamBtn.innerHTML = 'Broadcast Exam'; }
    });
}

async function fetchLiveExams() {
    const list = document.getElementById('adminLiveExamsList');
    if (!list) return;

    try {
        const q = query(collection(db, "liveExams"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        list.innerHTML = '';

        if(snap.empty) {
            list.innerHTML = '<p class="text-slate-500">No exams have been launched yet.</p>';
            return;
        }

        snap.forEach(docSnap => {
            const data = docSnap.data();
            let statusBadge = ''; let styleClass = ''; let actionBtn = '';

            if(data.status === 'active') {
                statusBadge = `<span class="animate-pulse bg-rose-600 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">Live Now</span>`;
                styleClass = 'border-rose-500 bg-rose-50';
                actionBtn = `<button data-id="${docSnap.id}" class="stop-exam-btn px-4 py-2 bg-slate-800 text-white font-bold rounded-lg text-sm hover:bg-slate-900 transition-colors">Stop Exam</button>`;
            } else if (data.status === 'published') {
                statusBadge = `<span class="bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">Results Published</span>`;
                styleClass = 'border-emerald-500 bg-emerald-50';
                actionBtn = `<button data-id="${docSnap.id}" class="unpublish-exam-btn px-4 py-2 bg-amber-500 text-white font-bold rounded-lg text-sm hover:bg-amber-600 transition-colors">Hide Results</button>`;
            } else {
                statusBadge = `<span class="bg-slate-300 text-slate-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">Stopped</span>`;
                styleClass = 'border-slate-200 bg-slate-50';
                actionBtn = `<button data-id="${docSnap.id}" class="publish-exam-btn px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg text-sm hover:bg-emerald-700 transition-colors shadow">Publish Results</button>`;
            }

            const div = document.createElement('div');
            div.className = `p-5 rounded-xl border-2 ${styleClass}`;
            const dateStr = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleString() : 'Just now';

            div.innerHTML = `
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h4 class="font-black text-lg text-textMain">${data.title}</h4>
                        <p class="text-sm text-slate-500">${dateStr} | ${data.category} > ${data.section} | ${data.qCount} Q's | ${data.duration} mins</p>
                    </div>
                    ${statusBadge}
                </div>
                <div class="flex gap-3 mt-4">
                    ${actionBtn}
                    <button data-id="${docSnap.id}" class="view-results-btn px-4 py-2 bg-primary/10 text-primary border border-primary/20 font-bold rounded-lg text-sm hover:bg-primary hover:text-white transition-colors">View Scores</button>
                    <button data-id="${docSnap.id}" class="delete-exam-btn px-4 py-2 bg-error/10 text-error font-bold rounded-lg text-sm hover:bg-error hover:text-white transition-colors"><i data-lucide="trash" class="w-4 h-4"></i></button>
                </div>
            `;
            list.appendChild(div);
        });

        document.querySelectorAll('.stop-exam-btn').forEach(btn => btn.addEventListener('click', async (e) => { await Promise.race([updateDoc(doc(db, "liveExams", e.target.getAttribute('data-id')), { status: 'stopped' }), firebaseTimeout(10000)]); fetchLiveExams(); }));
        document.querySelectorAll('.publish-exam-btn').forEach(btn => btn.addEventListener('click', async (e) => { if(confirm("Publish these results to student dashboards?")) { await Promise.race([updateDoc(doc(db, "liveExams", e.target.getAttribute('data-id')), { status: 'published' }), firebaseTimeout(10000)]); fetchLiveExams(); } }));
        document.querySelectorAll('.unpublish-exam-btn').forEach(btn => btn.addEventListener('click', async (e) => { await Promise.race([updateDoc(doc(db, "liveExams", e.target.getAttribute('data-id')), { status: 'stopped' }), firebaseTimeout(10000)]); fetchLiveExams(); }));
        document.querySelectorAll('.delete-exam-btn').forEach(btn => btn.addEventListener('click', async (e) => { if(confirm("Delete this exam record?")) { await Promise.race([deleteDoc(doc(db, "liveExams", e.currentTarget.getAttribute('data-id'))), firebaseTimeout(10000)]); fetchLiveExams(); } }));

        document.querySelectorAll('.view-results-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const examId = e.target.getAttribute('data-id');
                const modal = document.getElementById('liveExamResultsModal');
                const tableContainer = document.getElementById('liveExamResultsTable');
                modal.classList.remove('hidden');
                tableContainer.innerHTML = '<p class="text-slate-500 text-center py-4">Fetching results...</p>';
                
                try {
                    const resSnap = await getDocs(collection(db, "liveExams", examId, "results"));
                    if(resSnap.empty) { tableContainer.innerHTML = '<p class="text-slate-500 text-center py-4">No students have submitted scores.</p>'; return; }
                    
                    let resultsArray = [];
                    resSnap.forEach(resDoc => resultsArray.push({ id: resDoc.id, ...resDoc.data() }));
                    resultsArray.sort((a, b) => b.score - a.score);
                    
                    let html = '<div class="space-y-3">';
                    resultsArray.forEach((resData, index) => {
                        const pct = Math.round((resData.score / resData.total) * 100);
                        const timeStr = resData.submittedAt ? new Date(resData.submittedAt.toDate()).toLocaleString() : '';
                        let rankIcon = `<span class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 font-bold flex items-center justify-center border border-slate-300 shadow-sm">${index + 1}</span>`;
                        if (index === 0) rankIcon = `<span class="w-8 h-8 rounded-full bg-amber-100 text-amber-600 font-bold flex items-center justify-center ring-2 ring-amber-400 shadow">1</span>`;
                        else if (index === 1) rankIcon = `<span class="w-8 h-8 rounded-full bg-slate-200 text-slate-600 font-bold flex items-center justify-center ring-2 ring-slate-400 shadow">2</span>`;
                        else if (index === 2) rankIcon = `<span class="w-8 h-8 rounded-full bg-orange-100 text-orange-700 font-bold flex items-center justify-center ring-2 ring-orange-400 shadow">3</span>`;

                        html += `
                            <div class="flex justify-between items-center p-4 bg-slate-50 border border-slate-200 rounded-xl shadow-sm">
                                <div class="flex items-center gap-4">
                                    ${rankIcon}
                                    <div>
                                        <p class="font-bold text-textMain text-lg">${resData.userName}</p>
                                        <p class="text-xs text-slate-500 mt-1"><i data-lucide="clock" class="inline w-3 h-3"></i> ${timeStr}</p>
                                    </div>
                                </div>
                                <div class="text-right bg-white px-4 py-2 rounded-lg border border-slate-100 shadow-sm">
                                    <p class="font-black text-xl ${pct >= 70 ? 'text-emerald-600' : 'text-rose-600'}">${resData.score} <span class="text-slate-400 text-sm">/ ${resData.total}</span></p>
                                    <p class="text-xs font-bold ${pct >= 70 ? 'text-emerald-500' : 'text-rose-500'}">${pct}% Accuracy</p>
                                </div>
                            </div>
                        `;
                    });
                    html += '</div>';
                    tableContainer.innerHTML = html;
                    if(typeof lucide !== 'undefined') lucide.createIcons();
                } catch(err) {}
            });
        });

        if(typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {}
}

async function fetchUsers(isLoadMore = false) {
    if(!adminUserList) return;
    try {
        const countSnap = await getCountFromServer(collection(db, "users"));
        const totalUsersBadge = document.getElementById('totalUsersBadge');
        if (totalUsersBadge) totalUsersBadge.innerText = `Total: ${countSnap.data().count}`;
    } catch (e) {}

    try {
        let q;
        if (isLoadMore && lastVisibleUser) q = query(collection(db, "users"), startAfter(lastVisibleUser), limit(50));
        else { q = query(collection(db, "users"), limit(50)); adminUserList.innerHTML = ''; userEmails = []; }

        const snapshot = await getDocs(q);
        lastVisibleUser = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.docs.length < 50 && loadMoreUsersBtn) loadMoreUsersBtn.classList.add('hidden');
        else if (loadMoreUsersBtn) loadMoreUsersBtn.classList.remove('hidden');

        snapshot.forEach(docSnap => {
            const u = docSnap.data();
            if (u.role === 'admin') return; 
            if (u.email) userEmails.push(u.email);

            const now = new Date().getTime();
            const expiresAt = u.accessExpiresAt || 0;
            const isExpired = now > expiresAt;
            const statusHtml = isExpired ? `<span class="bg-error/10 text-error px-2 py-1 rounded text-xs font-bold uppercase">Expired</span>` : `<span class="bg-accent/10 text-accent px-2 py-1 rounded text-xs font-bold uppercase">Active Access</span>`;

            let expiryDate = "Never";
            if (expiresAt > 0) {
                const dateObj = new Date(expiresAt);
                if (dateObj.getFullYear() > new Date().getFullYear() + 50) expiryDate = "Unlimited";
                else expiryDate = dateObj.toLocaleDateString();
            }

            const userCard = document.createElement('div');
            userCard.className = "flex flex-col md:flex-row justify-between md:items-center p-4 border border-slate-200 rounded-xl bg-slate-50 gap-4";
            userCard.innerHTML = `
                <div>
                    <p class="font-bold text-textMain text-lg">${u.displayName}</p>
                    <p class="text-sm text-textMuted mb-1">${u.email} <span class="mx-2">|</span> <i data-lucide="phone" class="w-3 h-3 inline"></i> ${u.phone || 'N/A'}</p>
                    <p class="text-xs text-slate-500 font-medium mb-2"><i data-lucide="briefcase" class="w-3 h-3 inline"></i> ${u.profession || 'N/A'} <span class="mx-2">|</span> <i data-lucide="building" class="w-3 h-3 inline"></i> ${u.university || 'N/A'}</p>
                    <div class="flex gap-2 items-center">
                        ${statusHtml} <span class="text-xs text-slate-500 font-medium">Valid until: ${expiryDate}</span>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 buttons-container"></div>
            `;

            const buttonContainer = userCard.querySelector('.buttons-container');
            
            [3, 6, 12, 'Unlimited'].forEach(months => {
                const btn = document.createElement('button');
                btn.className = "px-4 py-2 bg-primary/10 text-primary font-bold text-sm rounded-lg hover:bg-primary hover:text-white transition-colors border border-primary/20";
                btn.innerText = months === 'Unlimited' ? 'Unlimited' : `+${months} M`;
                btn.addEventListener('click', () => extendSubscription(docSnap.id, expiresAt, months, u.displayName));
                buttonContainer.appendChild(btn);
            });

            if (!isExpired) {
                const revokeBtn = document.createElement('button');
                revokeBtn.className = "px-4 py-2 bg-error/10 text-error font-bold text-sm rounded-lg hover:bg-error hover:text-white transition-colors border border-error/20 flex items-center gap-1 ml-2";
                revokeBtn.innerHTML = `Revoke`;
                revokeBtn.addEventListener('click', () => revokeSubscription(docSnap.id, u.displayName));
                buttonContainer.appendChild(revokeBtn);
            }

            const makeAdminBtn = document.createElement('button');
            makeAdminBtn.className = "px-4 py-2 bg-indigo-100 text-indigo-700 font-bold text-sm rounded-lg hover:bg-indigo-600 hover:text-white transition-colors border border-indigo-200 flex items-center gap-1 ml-2 mt-2 md:mt-0";
            makeAdminBtn.innerHTML = `<i data-lucide="shield" class="w-4 h-4"></i> Admin`;
            makeAdminBtn.addEventListener('click', async () => {
                if(confirm(`WARNING: Are you absolutely sure you want to upgrade ${u.displayName} to an Administrator? They will have full access to the database.`)) {
                    try {
                        await Promise.race([updateDoc(doc(db, "users", docSnap.id), { role: 'admin' }), firebaseTimeout(10000)]);
                        alert(`${u.displayName} has been upgraded to Admin!`);
                        fetchUsers(); 
                    } catch(err) {
                        alert("Upgrade failed: " + err.message);
                    }
                }
            });
            buttonContainer.appendChild(makeAdminBtn);

            adminUserList.appendChild(userCard);
        });
        
        if (adminUserSearch && adminUserSearch.value) {
            const term = adminUserSearch.value.toLowerCase();
            document.querySelectorAll('#adminUserList > div').forEach(card => {
                const text = card.innerText.toLowerCase();
                card.style.display = text.includes(term) ? 'flex' : 'none';
            });
        }
        
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (error) {}
}

if(loadMoreUsersBtn) loadMoreUsersBtn.addEventListener('click', () => fetchUsers(true));
if(bulkEmailBtn) bulkEmailBtn.addEventListener('click', () => { if(userEmails.length === 0) return alert("No active user emails found."); window.open(`mailto:salahaldin10111@gmail.com?bcc=${userEmails.join(',')}`); });

async function extendSubscription(userId, currentExpiry, monthsToAdd, userName) {
    if(!confirm(`Grant ${monthsToAdd === 'Unlimited' ? 'Unlimited Access' : monthsToAdd + ' months'} to ${userName}?`)) return;
    const baseDate = new Date().getTime() > currentExpiry ? new Date() : new Date(currentExpiry);
    let generatedRevenue = 0;

    if (monthsToAdd === 'Unlimited') { baseDate.setFullYear(baseDate.getFullYear() + 100); generatedRevenue = 200; } 
    else { baseDate.setMonth(baseDate.getMonth() + monthsToAdd); generatedRevenue = { 3: 30, 6: 50, 12: 90 }[monthsToAdd] || 0; }

    try {
        await Promise.race([updateDoc(doc(db, "users", userId), { accessExpiresAt: baseDate.getTime() }), firebaseTimeout(10000)]);
        await Promise.race([addDoc(collection(db, "revenue"), { amount: generatedRevenue, plan: monthsToAdd === 'Unlimited' ? 'Unlimited' : `${monthsToAdd} Months`, userName: userName, date: new Date().getTime() }), firebaseTimeout(10000)]);
        alert(`Success! Access granted to ${userName}.`); fetchUsers(); fetchRevenueData(); 
    } catch(error) { alert("Failed to update."); }
}

async function revokeSubscription(userId, userName) {
    if(!confirm(`Are you absolutely sure you want to completely REVOKE access for ${userName}?`)) return;
    try { await Promise.race([updateDoc(doc(db, "users", userId), { accessExpiresAt: new Date().getTime() - 60000 }), firebaseTimeout(10000)]); fetchUsers(); } catch(error) {}
}

if (scheduleAdBtn) {
    scheduleAdBtn.addEventListener('click', async () => {
        const titleEl = document.getElementById('adTitle');
        const mediaEl = document.getElementById('adMediaUrl');
        const startEl = document.getElementById('adStartTime');
        const endEl = document.getElementById('adEndTime');

        if (!titleEl.value.trim() || !mediaEl.value.trim() || !startEl.value || !endEl.value) {
            alert("Please fill in all required fields: Title, Media URL, Start Date, and End Date.");
            return;
        }

        scheduleAdBtn.disabled = true;
        scheduleAdBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Saving...';
        if (typeof lucide !== 'undefined') lucide.createIcons();

        const editId = addAdForm ? addAdForm.getAttribute('data-edit-id') : null;
        
        const adData = {
            title: titleEl.value.trim(),
            mediaUrl: mediaEl.value.trim(),
            linkUrl: document.getElementById('adLink').value.trim() || null,
            startTime: new Date(startEl.value).getTime(),
            endTime: new Date(endEl.value).getTime(),
            createdAt: serverTimestamp()
        };

        try {
            if (editId) {
                await Promise.race([updateDoc(doc(db, "announcements", editId), adData), firebaseTimeout(10000)]);
                if(addAdForm) addAdForm.removeAttribute('data-edit-id');
                alert("Announcement successfully updated!");
            } else {
                await Promise.race([addDoc(collection(db, "announcements"), adData), firebaseTimeout(10000)]);
                alert("Announcement successfully scheduled!");
            }
            
            if(addAdForm) addAdForm.reset();
            if (cancelAdEditBtn) cancelAdEditBtn.classList.add('hidden');
            fetchAds();
            
        } catch (err) { alert("Error saving announcement: " + err.message); } 
        finally { scheduleAdBtn.disabled = false; scheduleAdBtn.innerHTML = 'Schedule Announcement'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    });
}

if (cancelAdEditBtn) {
    cancelAdEditBtn.addEventListener('click', () => {
        if(addAdForm) { addAdForm.reset(); addAdForm.removeAttribute('data-edit-id'); }
        if(scheduleAdBtn) scheduleAdBtn.innerHTML = 'Schedule Announcement';
        cancelAdEditBtn.classList.add('hidden');
    });
}

async function fetchAds() {
    if(!adminAdList) return;
    try {
        const snap = await getDocs(collection(db, "announcements"));
        adminAdList.innerHTML = '';
        snap.forEach(docSnap => {
            const ad = docSnap.data();
            const div = document.createElement('div');
            const startStr = ad.startTime ? new Date(ad.startTime).toLocaleString() : "Now";
            const endStr = ad.endTime ? new Date(ad.endTime).toLocaleString() : "Forever";
            const now = new Date().getTime();
            const isActive = (now >= ad.startTime && now <= ad.endTime);
            const statusBadge = isActive ? `<span class="bg-accent/10 text-accent px-2 py-1 rounded text-xs font-bold uppercase">Live</span>` : `<span class="bg-slate-200 text-slate-600 px-2 py-1 rounded text-xs font-bold uppercase">Queued / Expired</span>`;

            div.className = "flex flex-col md:flex-row justify-between p-4 border border-slate-200 rounded-xl bg-slate-50 gap-4";
            div.innerHTML = `
                <div>
                    <div class="flex items-center gap-3 mb-1"><p class="font-bold text-textMain text-lg">${ad.title}</p>${statusBadge}</div>
                    <p class="text-xs text-textMuted mb-2"><i data-lucide="calendar" class="w-3 h-3 inline"></i> ${startStr} — ${endStr}</p>
                    <a href="${ad.mediaUrl}" target="_blank" class="text-xs text-primary hover:underline">View Source Media</a>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                    <button data-id="${docSnap.id}" class="relaunch-ad-btn px-3 py-2 bg-emerald-100 text-emerald-700 font-bold rounded-lg text-sm hover:bg-emerald-600 hover:text-white transition-colors"><i data-lucide="play" class="w-4 h-4 inline"></i> Relaunch (24h)</button>
                    <button data-id="${docSnap.id}" class="edit-ad-btn px-3 py-2 bg-blue-100 text-blue-700 font-bold rounded-lg text-sm hover:bg-blue-600 hover:text-white transition-colors">Edit</button>
                    <button data-id="${docSnap.id}" class="delete-ad-btn px-3 py-2 bg-error/10 text-error font-bold rounded-lg text-sm transition-colors hover:bg-error hover:text-white"><i data-lucide="trash" class="w-4 h-4 inline"></i></button>
                </div>
            `;
            adminAdList.appendChild(div);
        });
        
        document.querySelectorAll('.delete-ad-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if(confirm("Permanently delete this scheduled announcement?")) { await Promise.race([deleteDoc(doc(db, "announcements", e.currentTarget.getAttribute('data-id'))), firebaseTimeout(10000)]); fetchAds(); }
            });
        });
        document.querySelectorAll('.relaunch-ad-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const now = new Date().getTime();
                const tomorrow = now + (24 * 60 * 60 * 1000); 
                await Promise.race([updateDoc(doc(db, "announcements", id), { startTime: now, endTime: tomorrow }), firebaseTimeout(10000)]);
                alert("Announcement relaunched for the next 24 hours!"); fetchAds();
            });
        });
        document.querySelectorAll('.edit-ad-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const adDoc = await getDoc(doc(db, "announcements", id));
                if(adDoc.exists()){
                    const ad = adDoc.data();
                    document.getElementById('adTitle').value = ad.title;
                    document.getElementById('adMediaUrl').value = ad.mediaUrl;
                    document.getElementById('adLink').value = ad.linkUrl || '';
                    const formatTime = (ts) => { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
                    document.getElementById('adStartTime').value = formatTime(ad.startTime);
                    document.getElementById('adEndTime').value = formatTime(ad.endTime);
                    
                    if(addAdForm) {
                        addAdForm.setAttribute('data-edit-id', id);
                        if(scheduleAdBtn) scheduleAdBtn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Update Announcement';
                        if (cancelAdEditBtn) cancelAdEditBtn.classList.remove('hidden');
                        window.scrollTo({ top: addAdForm.offsetTop - 100, behavior: 'smooth' });
                    }
                    if(typeof lucide !== 'undefined') lucide.createIcons();
                }
            });
        });
    } catch(e) {}
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function loadAboutProfile() {
    getDoc(doc(db, "settings", "aboutUs")).then(snap => {
        if(snap.exists()) {
            const data = snap.data();
            document.getElementById('devName').value = data.name || '';
            document.getElementById('devTitle').value = data.title || '';
            document.getElementById('devMedia').value = data.mediaUrl || '';
            document.getElementById('devBio').value = data.bio || '';
        }
    });

    if (saveProfileBtn) {
        saveProfileBtn.addEventListener('click', async () => {
            const name = document.getElementById('devName').value.trim();
            const title = document.getElementById('devTitle').value.trim();
            const bio = document.getElementById('devBio').value.trim();

            if (!name || !title || !bio) {
                alert("Please fill in Developer Name, Title, and Biography.");
                return;
            }

            saveProfileBtn.disabled = true; saveProfileBtn.innerHTML = 'Saving...';
            try {
                await Promise.race([setDoc(doc(db, "settings", "aboutUs"), { 
                    name: name, 
                    title: title, 
                    mediaUrl: document.getElementById('devMedia').value.trim(), 
                    bio: bio 
                }), firebaseTimeout(10000)]);
                alert("Profile saved successfully!");
            } catch (err) {
                alert("Error saving profile: " + err.message);
            } finally { 
                saveProfileBtn.disabled = false; saveProfileBtn.innerHTML = 'Save Profile'; 
            }
        });
    }
}

async function fetchReports() {
    if(!adminReportsList) return;
    try {
        const q = query(collection(db, "questions"), where("reportCount", ">=", 3));
        const snap = await getDocs(q);
        
        adminReportsList.innerHTML = '';
        if(snap.empty) {
            adminReportsList.innerHTML = '<p class="text-slate-500 flex items-center gap-2"><i data-lucide="check-circle" class="text-emerald-500 w-5 h-5"></i> No highly reported questions at this time.</p>';
            if(typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        snap.forEach(docSnap => {
            const data = docSnap.data();
            globalQuestionsCache[docSnap.id] = data; 
            const div = document.createElement('div');
            div.className = "p-5 border-2 border-rose-200 bg-rose-50 rounded-xl mb-4";
            div.innerHTML = `
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <span class="bg-rose-200 text-rose-800 text-xs font-black uppercase px-2 py-1 rounded">Reported ${data.reportCount} Times</span>
                        <p class="font-bold text-slate-800 mt-2">${data.subject} > ${data.section || data.specialty}</p>
                    </div>
                </div>
                <p class="text-slate-700 text-sm italic mb-4 line-clamp-2">"${data.scenario}"</p>
                <div class="flex gap-2 flex-wrap">
                    <button data-id="${docSnap.id}" class="edit-q-btn px-4 py-2 bg-blue-600 text-white font-bold rounded-lg text-sm hover:bg-blue-700 shadow">Review & Edit</button>
                    <button data-id="${docSnap.id}" class="clear-reports-btn px-4 py-2 bg-emerald-100 text-emerald-700 font-bold rounded-lg text-sm hover:bg-emerald-200 border border-emerald-300">Clear Flags</button>
                    <button data-id="${docSnap.id}" class="delete-btn px-4 py-2 bg-red-100 text-red-700 font-bold rounded-lg text-sm hover:bg-red-200 border border-red-300">Delete Question</button>
                </div>
            `;
            adminReportsList.appendChild(div);
        });
        attachQuestionListeners(); 
        
        document.querySelectorAll('.clear-reports-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetId = e.currentTarget.getAttribute('data-id');
                if(confirm("Reset report count to 0?")) { await Promise.race([updateDoc(doc(db, "questions", targetId), { reportCount: 0, reportedBy: [] }), firebaseTimeout(10000)]); fetchReports(); }
            });
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch(e) {}
}

const radioModes = document.querySelectorAll('input[name="selectionMode"]');
const randomCountDiv = document.getElementById('randomCountDiv');
const manualSelectionDiv = document.getElementById('manualSelectionDiv');
const manualQuestionsList = document.getElementById('manualQuestionsList');
const liveExamCat = document.getElementById('liveExamCat');
const liveExamSec = document.getElementById('liveExamSec');

if(radioModes) {
    radioModes.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if(e.target.value === 'manual') {
                if(randomCountDiv) randomCountDiv.classList.add('hidden');
                if(manualSelectionDiv) manualSelectionDiv.classList.remove('hidden');
                updateManualQuestionList();
            } else {
                if(randomCountDiv) randomCountDiv.classList.remove('hidden');
                if(manualSelectionDiv) manualSelectionDiv.classList.add('hidden');
            }
        });
    });
}

async function updateManualQuestionList() {
    if(!manualQuestionsList) return;
    const selectedCat = document.getElementById('liveExamCat').value;
    const selectedSec = document.getElementById('liveExamSec').value;
    
    manualQuestionsList.innerHTML = '<p class="text-slate-500 text-sm"><i class="animate-spin inline-block mr-2" data-lucide="loader-2"></i> Searching Database...</p>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    try {
        let q;
        if (selectedCat && selectedCat !== 'All') q = query(collection(db, "questions"), where("subject", "==", selectedCat));
        else q = collection(db, "questions");

        const snap = await getDocs(q);
        manualQuestionsList.innerHTML = '';
        let count = 0;
        
        snap.forEach(docSnap => {
            const qData = { id: docSnap.id, ...docSnap.data() };
            if (qData.status === 'published') {
                const matchSec = (selectedSec === 'All' || !selectedSec) || (qData.section || qData.specialty) === selectedSec;
                if(matchSec) {
                    const div = document.createElement('label');
                    div.className = "flex items-start gap-3 p-2 bg-slate-700/50 rounded-lg cursor-pointer hover:bg-slate-700 transition-colors";
                    div.innerHTML = `
                        <input type="checkbox" value="${qData.id}" class="manual-q-checkbox mt-1 text-rose-500 focus:ring-rose-500 rounded bg-slate-900 border-slate-600">
                        <span class="text-sm text-indigo-100 flex-1 line-clamp-2">${qData.scenario}</span>
                    `;
                    manualQuestionsList.appendChild(div);
                    count++;
                }
            }
        });
        if(count === 0) manualQuestionsList.innerHTML = `<p class="text-slate-500 text-sm">No published questions found for this filter.</p>`;
        
        document.querySelectorAll('.manual-q-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const checked = document.querySelectorAll('.manual-q-checkbox:checked').length;
                const countBadge = document.getElementById('manualSelectedCount');
                if(countBadge) countBadge.innerText = `${checked} selected`;
            });
        });
    } catch(e) {}
}

if(liveExamCat) liveExamCat.addEventListener('input', updateManualQuestionList);
if(liveExamSec) liveExamSec.addEventListener('input', updateManualQuestionList);

if (processBulkBtn) {
    processBulkBtn.addEventListener('click', async () => {
        if (!fileInput || fileInput.files.length === 0) return alert("Please select a JSON file first.");

        const statusMsg = document.getElementById('bulkStatusMsg');
        const file = fileInput.files[0];
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                let data;
                try { data = JSON.parse(e.target.result); } 
                catch (parseError) { throw new Error("Invalid JSON format."); }

                if(!Array.isArray(data)) throw new Error("JSON must be an array of objects [ { ... } ].");
                
                processBulkBtn.disabled = true;
                processBulkBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Processing...';
                if (typeof lucide !== 'undefined') lucide.createIcons();

                if (statusMsg) {
                    statusMsg.classList.remove('hidden', 'text-error', 'text-emerald-600');
                    statusMsg.className = "mt-4 font-bold text-sm text-primary";
                    statusMsg.innerText = `Starting upload of ${data.length} questions...`;
                }

                const CHUNK_SIZE = 400;
                let batchesCompleted = 0;

                const cleanText = (text) => {
                    if (typeof text === 'string') return text.replace(/\[span_\d+\]/gi, '').replace(/\(start_span\)/gi, '').replace(/\(end_span\)/gi, '').replace(/<\/?span[^>]*>/gi, '').trim();
                    return text || "";
                };

                for (let i = 0; i < data.length; i += CHUNK_SIZE) {
                    const chunk = data.slice(i, i + CHUNK_SIZE);
                    const batch = writeBatch(db);

                    chunk.forEach((q) => {
                        const opts = q.options || {}; 
                        const docRef = doc(collection(db, "questions"));
                        const finalQ = {
                            status: q.status || "published",
                            subject: cleanText(q.subject) || "General",
                            section: cleanText(q.section) || "General",
                            topic: cleanText(q.topic) || "General Topic",
                            difficulty: cleanText(q.difficulty) || "Medium",
                            year: cleanText(q.year) || "",
                            scenario: cleanText(q.scenario) || "Missing Scenario",
                            mediaUrl: q.mediaUrl || null,
                            correctAnswer: cleanText(q.correctAnswer) || "A",
                            explanation: cleanText(q.explanation) || "",
                            wrongExplanation: cleanText(q.wrongExplanation) || "",
                            reportCount: 0,
                            createdAt: serverTimestamp(),
                            options: { A: cleanText(opts.A) || "Option A", B: cleanText(opts.B) || "Option B", C: cleanText(opts.C) || "Option C", D: cleanText(opts.D) || "Option D", E: cleanText(opts.E) || "" }
                        };
                        batch.set(docRef, finalQ);
                    });

                    await Promise.race([batch.commit(), firebaseTimeout(15000)]);
                    batchesCompleted += chunk.length;
                    if(statusMsg) statusMsg.innerText = `Uploaded ${batchesCompleted} / ${data.length}...`;
                }

                if(statusMsg) { statusMsg.className = "mt-4 font-bold text-sm text-emerald-600"; statusMsg.innerText = `Successfully uploaded ${data.length} scenarios!`; }
                
                if (fileInput) fileInput.value = ""; 
                const nameDisplay = document.getElementById('selectedFileName');
                if(nameDisplay) { nameDisplay.innerText = "No file selected"; nameDisplay.classList.remove('text-primary'); }
                await fetchAllQuestionsForCache();
                fetchAdminQuestions(); 
                
            } catch (err) {
                if(statusMsg) { statusMsg.className = "mt-4 font-bold text-sm text-error"; statusMsg.innerText = "Upload Failed: " + err.message; }
            } finally {
                processBulkBtn.disabled = false;
                processBulkBtn.innerHTML = 'Upload Batch';
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        };
        reader.readAsText(file);
    });
}
