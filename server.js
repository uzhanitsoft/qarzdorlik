const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// CORS - Allow all origins
app.use(cors());
app.use(express.json());

// Data file path
const DATA_FILE = path.join(__dirname, 'data.json');

// Admin password
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ============ DATA FUNCTIONS ============

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (!data.history) {
                data.history = [];
            }
            return data;
        }
    } catch (e) {
        console.error('Error loading data:', e);
    }
    return {
        agents: [],
        lastUpdated: null,
        previousData: null,
        history: []
    };
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function saveToHistory(agents) {
    const today = getTodayDate();
    const totalUSD = agents.reduce((sum, a) => sum + a.totalUSD, 0);
    const totalUZS = agents.reduce((sum, a) => sum + a.totalUZS, 0);
    const totalDebtors = agents.reduce((sum, a) => sum + a.debtorCount, 0);

    const snapshot = {
        date: today,
        totalUSD,
        totalUZS,
        totalDebtors,
        agentCount: agents.length,
        agents: agents.map(a => ({
            name: a.name,
            totalUSD: a.totalUSD,
            totalUZS: a.totalUZS,
            debtorCount: a.debtorCount
        }))
    };

    dashboardData.history = dashboardData.history.filter(h => h.date !== today);
    dashboardData.history.push(snapshot);
    dashboardData.history.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function calculateChanges(current, previous) {
    if (!previous) return null;

    const usdChange = current.totalUSD - previous.totalUSD;
    const uzsChange = current.totalUZS - previous.totalUZS;
    const debtorChange = current.totalDebtors - previous.totalDebtors;

    let trend = 'stable';
    if (usdChange > 0 || uzsChange > 0) trend = 'up';
    if (usdChange < 0 && uzsChange <= 0) trend = 'down';

    return {
        usdChange,
        uzsChange,
        debtorChange,
        trend,
        previousDate: previous.date
    };
}

let dashboardData = loadData();

// File upload setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'))
});
const upload = multer({ storage });

function processExcelFiles(files) {
    if (dashboardData.agents.length > 0) {
        dashboardData.previousData = [...dashboardData.agents];
    }

    const agents = [];

    for (const file of files) {
        try {
            const workbook = XLSX.readFile(file.path);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

            const agentName = file.originalname.replace(/\s*\d+\.\d+\.\d+\.xlsx?$/i, '').replace(/\.xlsx?$/i, '').trim();

            let totalUSD = 0;
            let totalUZS = 0;
            let debtorCount = 0;
            const debtors = [];

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row) continue;

                const dVal = row[3];
                const eVal = row[4];

                if (typeof dVal === 'number' || typeof eVal === 'number') {
                    const usd = (typeof dVal === 'number') ? dVal : 0;
                    const uzs = (typeof eVal === 'number') ? eVal : 0;

                    if (usd > 0 || uzs > 0) {
                        totalUSD += usd;
                        totalUZS += uzs;
                        debtorCount++;

                        const name = row[1] || `Qarzdor ${debtorCount}`;
                        debtors.push({ name: String(name), usd, uzs });
                    }
                }
            }

            agents.push({
                name: agentName,
                debtors,
                totalUSD,
                totalUZS,
                debtorCount
            });

            try { fs.unlinkSync(file.path); } catch (e) { }

        } catch (err) {
            console.error('Error processing file:', file.originalname, err);
        }
    }

    dashboardData.agents = agents;
    dashboardData.lastUpdated = new Date().toISOString();
    saveToHistory(agents);
    saveData(dashboardData);

    return agents;
}

// ============ API ENDPOINTS ============

app.get('/api/data', (req, res) => {
    const currentTotals = {
        totalUSD: dashboardData.agents.reduce((sum, a) => sum + a.totalUSD, 0),
        totalUZS: dashboardData.agents.reduce((sum, a) => sum + a.totalUZS, 0),
        totalDebtors: dashboardData.agents.reduce((sum, a) => sum + a.debtorCount, 0)
    };

    const yesterday = dashboardData.history.find(h => h.date !== getTodayDate());
    const changes = calculateChanges(currentTotals, yesterday);

    res.json({
        agents: dashboardData.agents,
        previousData: dashboardData.previousData,
        lastUpdated: dashboardData.lastUpdated,
        totals: currentTotals,
        changes,
        historyCount: dashboardData.history.length
    });
});

app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 0;
    const history = limit > 0
        ? dashboardData.history.slice(0, limit)
        : dashboardData.history;

    res.json({
        count: history.length,
        history
    });
});

app.get('/api/compare/:date', (req, res) => {
    const targetDate = req.params.date;
    const targetData = dashboardData.history.find(h => h.date === targetDate);

    if (!targetData) {
        return res.status(404).json({ error: 'Bu sana uchun ma\'lumot topilmadi' });
    }

    const currentTotals = {
        totalUSD: dashboardData.agents.reduce((sum, a) => sum + a.totalUSD, 0),
        totalUZS: dashboardData.agents.reduce((sum, a) => sum + a.totalUZS, 0),
        totalDebtors: dashboardData.agents.reduce((sum, a) => sum + a.debtorCount, 0)
    };

    const changes = calculateChanges(currentTotals, targetData);

    res.json({
        current: currentTotals,
        compared: targetData,
        changes
    });
});

app.get('/api/dates', (req, res) => {
    const dates = dashboardData.history.map(h => ({
        date: h.date,
        totalUSD: h.totalUSD,
        totalUZS: h.totalUZS
    }));
    res.json(dates);
});

app.post('/api/auth', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Noto\'g\'ri parol' });
    }
});

app.post('/api/upload', upload.array('files'), (req, res) => {
    const password = req.headers['x-admin-password'];

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ruxsat yo\'q' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Fayllar yuklanmadi' });
    }

    const agents = processExcelFiles(req.files);

    res.json({
        success: true,
        message: `${agents.length} ta agent ma'lumotlari yuklandi`,
        agents: agents.length,
        lastUpdated: dashboardData.lastUpdated,
        historyCount: dashboardData.history.length
    });
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'upload.html'));
});

// ============ MINI APP (INLINE) ============
app.get('/app', (req, res) => {
    res.send(getMiniAppHTML());
});

app.get('/app/debt-styles.css', (req, res) => {
    res.type('text/css').send(getMiniAppCSS());
});

app.get('/app/debt-app.js', (req, res) => {
    res.type('application/javascript').send(getMiniAppJS());
});

app.get('/', (req, res) => {
    res.json({
        status: 'running',
        agents: dashboardData.agents.length,
        lastUpdated: dashboardData.lastUpdated,
        historyCount: dashboardData.history.length
    });
});

// ============ MINI APP HTML/CSS/JS ============

function getMiniAppHTML() {
    return `<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Qarzdorlik Analitikasi</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/app/debt-styles.css">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="app">
        <aside class="sidebar">
            <div class="logo">
                <div class="logo-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="3" width="20" height="14" rx="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                </div>
                <span class="logo-text">Qarzdorlik</span>
            </div>
            <nav class="nav-menu">
                <a href="#" class="nav-item active">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                    <span>Dashboard</span>
                </a>
            </nav>
        </aside>
        <main class="main-content">
            <header class="header">
                <div class="header-left">
                    <h1 class="page-title">Qarzdorlik Dashboard</h1>
                    <p class="page-subtitle">Agent va qarzdorlar analitikasi</p>
                </div>
                <div class="header-right">
                    <div class="date-display">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        <span id="currentDate"></span>
                    </div>
                </div>
            </header>
            <div id="emptyState" class="empty-state hidden">
                <div class="empty-icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                    </svg>
                </div>
                <h2>Ma'lumotlar yuklanmoqda...</h2>
                <p>Serverdan ma'lumotlar olinmoqda</p>
            </div>
            <div id="dashboardContent" class="dashboard-content hidden">
                <section class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon blue">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                            </svg>
                        </div>
                        <div class="stat-info">
                            <span class="stat-value" id="totalAgents">0</span>
                            <span class="stat-label">Jami agentlar</span>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon purple">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="8.5" cy="7" r="4" />
                                <path d="M20 8v6" />
                                <path d="M23 11h-6" />
                            </svg>
                        </div>
                        <div class="stat-info">
                            <span class="stat-value" id="totalDebtors">0</span>
                            <span class="stat-label">Jami qarzdorlar</span>
                        </div>
                    </div>
                    <div class="stat-card usd-card">
                        <div class="stat-icon green"><span class="currency-symbol">$</span></div>
                        <div class="stat-info">
                            <span class="stat-value" id="totalUSD">$0</span>
                            <span class="stat-label">Jami qarz (USD)</span>
                        </div>
                    </div>
                    <div class="stat-card uzs-card">
                        <div class="stat-icon red"><span class="currency-symbol">S</span></div>
                        <div class="stat-info">
                            <span class="stat-value" id="totalUZS">0</span>
                            <span class="stat-label">Jami qarz (UZS)</span>
                        </div>
                    </div>
                </section>
                <section class="charts-section">
                    <div class="chart-card main-chart">
                        <div class="chart-header"><h3>💵 Agentlar bo'yicha qarz (USD)</h3></div>
                        <div class="chart-container"><canvas id="agentChartUSD"></canvas></div>
                    </div>
                    <div class="chart-card">
                        <div class="chart-header"><h3>Qarz taqsimoti</h3></div>
                        <div class="chart-container pie-container"><canvas id="pieChartUSD"></canvas></div>
                    </div>
                </section>
                <section class="table-section">
                    <div class="table-card">
                        <div class="table-header">
                            <h3>Agentlar ro'yxati</h3>
                            <div class="search-box">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="11" cy="11" r="8" />
                                    <path d="m21 21-4.35-4.35" />
                                </svg>
                                <input type="text" id="searchAgent" placeholder="Qidirish...">
                            </div>
                        </div>
                        <div class="table-wrapper">
                            <table id="agentsTable">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Agent nomi</th>
                                        <th>Qarzdorlar</th>
                                        <th>💵 USD</th>
                                        <th>🇺🇿 UZS</th>
                                    </tr>
                                </thead>
                                <tbody id="agentsTableBody"></tbody>
                            </table>
                        </div>
                    </div>
                </section>
            </div>
        </main>
    </div>
    <div id="clientModal" class="modal hidden">
        <div class="modal-overlay" onclick="closeModal()"></div>
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="modalAgentName">Agent nomi</h2>
                <button class="modal-close" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-stats">
                <div class="modal-stat">
                    <span class="modal-stat-value" id="modalDebtorCount">0</span>
                    <span class="modal-stat-label">Qarzdorlar</span>
                </div>
                <div class="modal-stat usd">
                    <span class="modal-stat-value" id="modalTotalUSD">$0</span>
                    <span class="modal-stat-label">Jami USD</span>
                </div>
                <div class="modal-stat uzs">
                    <span class="modal-stat-value" id="modalTotalUZS">0</span>
                    <span class="modal-stat-label">Jami UZS</span>
                </div>
            </div>
            <div class="modal-table-wrapper">
                <table class="modal-table">
                    <thead><tr><th>#</th><th>Klient</th><th>💵 USD</th><th>🇺🇿 UZS</th></tr></thead>
                    <tbody id="modalTableBody"></tbody>
                </table>
            </div>
        </div>
    </div>
    <script src="/app/debt-app.js"></script>
</body>
</html>`;
}

function getMiniAppCSS() {
    return `:root{--bg-primary:#0f172a;--bg-secondary:#1e293b;--bg-tertiary:#334155;--bg-card:#1e293b;--bg-hover:rgba(255,255,255,0.05);--text-primary:#f1f5f9;--text-secondary:#94a3b8;--text-tertiary:#64748b;--accent-blue:#3b82f6;--accent-purple:#a855f7;--accent-green:#22c55e;--accent-red:#ef4444;--gradient-blue:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%);--gradient-green:linear-gradient(135deg,#22c55e 0%,#10b981 100%);--gradient-red:linear-gradient(135deg,#ef4444 0%,#f97316 100%);--border-color:rgba(255,255,255,0.08);--shadow-lg:0 8px 24px rgba(0,0,0,0.5);--radius-md:12px;--radius-lg:16px;--transition-smooth:0.3s cubic-bezier(0.4,0,0.2,1);--sidebar-width:260px}*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;min-height:100vh}.app{display:flex;min-height:100vh}.hidden{display:none!important}.sidebar{width:var(--sidebar-width);background:var(--bg-secondary);border-right:1px solid var(--border-color);display:flex;flex-direction:column;position:fixed;height:100vh}.logo{display:flex;align-items:center;gap:14px;padding:24px 20px;border-bottom:1px solid var(--border-color)}.logo-icon{width:44px;height:44px;background:var(--gradient-red);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;color:white}.logo-text{font-size:18px;font-weight:700}.nav-menu{flex:1;padding:20px 14px}.nav-item{display:flex;align-items:center;gap:14px;padding:14px 16px;color:var(--text-secondary);text-decoration:none;border-radius:var(--radius-md);font-size:14px;font-weight:500;transition:all var(--transition-smooth)}.nav-item.active{background:var(--gradient-blue);color:white}.main-content{flex:1;margin-left:var(--sidebar-width);padding:28px 36px}.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:32px}.page-title{font-size:28px;font-weight:800}.page-subtitle{font-size:14px;color:var(--text-secondary);margin-top:6px}.date-display{display:flex;align-items:center;gap:10px;padding:12px 18px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-md);font-size:14px;color:var(--text-secondary)}.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;text-align:center}.empty-state h2{font-size:24px;margin-bottom:10px}.empty-state p{color:var(--text-secondary)}.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-bottom:28px}.stat-card{background:var(--bg-secondary);border-radius:var(--radius-lg);padding:22px;border:1px solid var(--border-color);display:flex;align-items:center;gap:18px;transition:all var(--transition-smooth)}.stat-card:hover{transform:translateY(-4px);box-shadow:var(--shadow-lg)}.stat-icon{width:52px;height:52px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;font-size:22px}.stat-icon.blue{background:rgba(59,130,246,0.15);color:var(--accent-blue)}.stat-icon.purple{background:rgba(168,85,247,0.15);color:var(--accent-purple)}.stat-icon.green{background:rgba(34,197,94,0.15);color:var(--accent-green)}.stat-icon.red{background:rgba(239,68,68,0.15);color:var(--accent-red)}.stat-value{font-size:28px;font-weight:800}.stat-label{font-size:13px;color:var(--text-secondary)}.currency-symbol{font-size:22px;font-weight:800}.usd-card{border-left:3px solid var(--accent-green)}.uzs-card{border-left:3px solid var(--accent-red)}.charts-section{display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:28px}.chart-card{background:var(--bg-secondary);border-radius:var(--radius-lg);padding:24px;border:1px solid var(--border-color)}.chart-header{margin-bottom:20px}.chart-header h3{font-size:16px;font-weight:600}.chart-container{height:300px;position:relative}.pie-container{height:240px}.table-card{background:var(--bg-secondary);border-radius:var(--radius-lg);border:1px solid var(--border-color);overflow:hidden}.table-header{display:flex;justify-content:space-between;align-items:center;padding:22px 24px;border-bottom:1px solid var(--border-color)}.table-header h3{font-size:16px;font-weight:600}.search-box{display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--bg-tertiary);border-radius:var(--radius-md);border:1px solid var(--border-color)}.search-box input{border:none;outline:none;background:transparent;font-size:14px;width:200px;color:var(--text-primary)}.search-box input::placeholder{color:var(--text-tertiary)}table{width:100%;border-collapse:collapse}th,td{padding:16px 24px;text-align:left}th{background:var(--bg-tertiary);font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase}td{font-size:14px;border-bottom:1px solid var(--border-color)}tr:hover td{background:var(--bg-hover)}.clickable-row{cursor:pointer}.usd-amount{color:var(--accent-green);font-weight:600}.uzs-amount{color:var(--accent-red);font-weight:600}.modal{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;display:flex;align-items:center;justify-content:center}.modal-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px)}.modal-content{position:relative;background:var(--bg-secondary);border-radius:var(--radius-lg);width:90%;max-width:850px;max-height:85vh;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,0.5);border:1px solid var(--border-color)}.modal-header{display:flex;justify-content:space-between;align-items:center;padding:24px 28px;border-bottom:2px solid var(--accent-blue);background:linear-gradient(135deg,var(--bg-tertiary) 0%,var(--bg-secondary) 100%)}.modal-header h2{font-size:22px;font-weight:800}.modal-close{width:36px;height:36px;border:none;background:var(--bg-secondary);border-radius:8px;font-size:24px;cursor:pointer;color:var(--text-secondary)}.modal-close:hover{background:var(--accent-red);color:white}.modal-stats{display:flex;gap:16px;padding:24px 28px;background:linear-gradient(180deg,var(--bg-tertiary),var(--bg-primary))}.modal-stat{flex:1;text-align:center;padding:20px 16px;background:var(--bg-secondary);border-radius:var(--radius-lg);border:1px solid var(--border-color)}.modal-stat-value{display:block;font-size:26px;font-weight:800}.modal-stat-label{font-size:12px;color:var(--text-secondary)}.modal-table-wrapper{overflow-y:auto;max-height:300px;padding:0 28px 28px}@media(max-width:1024px){.sidebar{display:none}.main-content{margin-left:0}.stats-grid{grid-template-columns:repeat(2,1fr)}.charts-section{grid-template-columns:1fr}}@media(max-width:640px){.stats-grid{grid-template-columns:1fr}.main-content{padding:16px}}`;
}

function getMiniAppJS() {
    return `let agentsData=[];let previousData=null;let serverChanges=null;const API_BASE_URL=window.location.origin;async function loadDataFromServer(){try{const response=await fetch(API_BASE_URL+'/api/data');if(!response.ok)throw new Error('Server error');const data=await response.json();agentsData=data.agents||[];previousData=data.previousData||null;serverChanges=data.changes||null;console.log('✅ Data loaded:',data.lastUpdated);if(agentsData.length>0){showDashboard();updateStats();updateChangeBadges();renderCharts();renderTable()}else{document.getElementById('emptyState').classList.remove('hidden');document.getElementById('emptyState').querySelector('h2').textContent='Ma\\'lumotlar topilmadi';document.getElementById('emptyState').querySelector('p').textContent='Admin paneldan Excel yuklang'}return true}catch(e){console.log('⚠️ Server error:',e);document.getElementById('emptyState').classList.remove('hidden');return false}}function updateChangeBadges(){if(!serverChanges)return;const usdCard=document.querySelector('.usd-card');if(usdCard&&serverChanges.usdChange!==0){const badge=createChangeBadge(serverChanges.usdChange,'usd');const existing=usdCard.querySelector('.change-badge');if(existing)existing.remove();usdCard.appendChild(badge)}const uzsCard=document.querySelector('.uzs-card');if(uzsCard&&serverChanges.uzsChange!==0){const badge=createChangeBadge(serverChanges.uzsChange,'uzs');const existing=uzsCard.querySelector('.change-badge');if(existing)existing.remove();uzsCard.appendChild(badge)}}function createChangeBadge(change,currency){const badge=document.createElement('div');badge.className='change-badge '+(change>0?'increase':'decrease');badge.style.cssText='position:absolute;top:12px;right:12px;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;'+(change>0?'background:rgba(239,68,68,0.2);color:#ef4444':'background:rgba(34,197,94,0.2);color:#22c55e');const icon=change>0?'↑':'↓';const absVal=Math.abs(change);badge.innerHTML=currency==='usd'?icon+' $'+absVal.toLocaleString('en-US',{maximumFractionDigits:0}):icon+' '+(absVal/1000000).toFixed(1)+'M';return badge}document.addEventListener('DOMContentLoaded',async function(){Chart.defaults.color='#94a3b8';Chart.defaults.borderColor='rgba(255,255,255,0.1)';if(window.Telegram&&window.Telegram.WebApp){const tg=window.Telegram.WebApp;tg.ready();tg.expand();console.log('📱 Telegram Mini App ready')}document.getElementById('currentDate').textContent=new Date().toLocaleDateString('uz-UZ');await loadDataFromServer();initSearch()});function showDashboard(){document.getElementById('emptyState').classList.add('hidden');document.getElementById('dashboardContent').classList.remove('hidden')}function updateStats(){const totalAgents=agentsData.length;const totalDebtors=agentsData.reduce((sum,a)=>sum+a.debtorCount,0);const totalUSD=agentsData.reduce((sum,a)=>sum+a.totalUSD,0);const totalUZS=agentsData.reduce((sum,a)=>sum+a.totalUZS,0);document.getElementById('totalAgents').textContent=totalAgents;document.getElementById('totalDebtors').textContent=totalDebtors;document.getElementById('totalUSD').textContent='$'+totalUSD.toLocaleString('en-US',{minimumFractionDigits:2});document.getElementById('totalUZS').textContent=totalUZS.toLocaleString('uz-UZ')}function renderCharts(){renderBarChart('agentChartUSD','totalUSD','$','#10b981');renderPieChart('pieChartUSD','totalUSD')}function renderBarChart(canvasId,field,prefix,color){const ctx=document.getElementById(canvasId);if(!ctx)return;const existingChart=Chart.getChart(ctx);if(existingChart)existingChart.destroy();const sorted=[...agentsData].sort((a,b)=>b[field]-a[field]).filter(a=>a[field]>0);if(sorted.length===0){ctx.parentElement.innerHTML='<p style="text-align:center;color:#64748b;padding:60px">Ma\\'lumot yo\\'q</p>';return}const gradient=ctx.getContext('2d').createLinearGradient(0,0,0,250);gradient.addColorStop(0,color+'cc');gradient.addColorStop(1,color+'33');new Chart(ctx,{type:'bar',data:{labels:sorted.map(a=>a.name),datasets:[{data:sorted.map(a=>a[field]),backgroundColor:gradient,borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(ctx)=>prefix==='$'?'$'+ctx.parsed.y.toLocaleString('en-US',{minimumFractionDigits:2}):ctx.parsed.y.toLocaleString('uz-UZ')+' so\\'m'}}},scales:{x:{grid:{display:false},ticks:{color:'#64748b',font:{size:10}}},y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#64748b',callback:(v)=>prefix==='$'?'$'+v:(v/1000000).toFixed(1)+'M'}}}}})}function renderPieChart(canvasId,field){const ctx=document.getElementById(canvasId);if(!ctx)return;const existingChart=Chart.getChart(ctx);if(existingChart)existingChart.destroy();const colors=['#ef4444','#f97316','#10b981','#3b82f6','#8b5cf6'];const top5=[...agentsData].sort((a,b)=>b[field]-a[field]).filter(a=>a[field]>0).slice(0,5);if(top5.length===0){ctx.parentElement.innerHTML='<p style="text-align:center;color:#64748b;padding:40px">Ma\\'lumot yo\\'q</p>';return}new Chart(ctx,{type:'doughnut',data:{labels:top5.map(a=>a.name),datasets:[{data:top5.map(a=>a[field]),backgroundColor:colors,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'bottom',labels:{padding:12,usePointStyle:true,font:{size:10}}}}}})}function renderTable(filter=''){const tbody=document.getElementById('agentsTableBody');const sorted=[...agentsData].sort((a,b)=>(b.totalUSD+b.totalUZS)-(a.totalUSD+a.totalUZS));const filtered=filter?sorted.filter(a=>a.name.toLowerCase().includes(filter.toLowerCase())):sorted;tbody.innerHTML=filtered.map((agent,i)=>'<tr class="clickable-row" onclick="showAgentDetails(\\''+agent.name.replace(/'/g,"\\\\'")+'\\')"><td>'+(i+1)+'</td><td><strong>'+agent.name+'</strong></td><td>'+agent.debtorCount+'</td><td class="usd-amount">$'+agent.totalUSD.toLocaleString('en-US',{minimumFractionDigits:2})+'</td><td class="uzs-amount">'+agent.totalUZS.toLocaleString('uz-UZ')+'</td></tr>').join('')}function initSearch(){const searchInput=document.getElementById('searchAgent');if(searchInput){searchInput.addEventListener('input',(e)=>renderTable(e.target.value))}}function showAgentDetails(agentName){const agent=agentsData.find(a=>a.name===agentName);if(!agent)return;document.getElementById('modalAgentName').textContent=agent.name;document.getElementById('modalDebtorCount').textContent=agent.debtorCount;document.getElementById('modalTotalUSD').textContent='$'+agent.totalUSD.toLocaleString('en-US',{minimumFractionDigits:2});document.getElementById('modalTotalUZS').textContent=agent.totalUZS.toLocaleString('uz-UZ');const sortedDebtors=[...agent.debtors].sort((a,b)=>(b.usd+b.uzs)-(a.usd+a.uzs));document.getElementById('modalTableBody').innerHTML=sortedDebtors.map((d,i)=>'<tr><td>'+(i+1)+'</td><td>'+d.name+'</td><td class="usd-amount">'+(d.usd>0?'$'+d.usd.toLocaleString('en-US',{minimumFractionDigits:2}):'-')+'</td><td class="uzs-amount">'+(d.uzs>0?d.uzs.toLocaleString('uz-UZ'):'-')+'</td></tr>').join('');document.getElementById('clientModal').classList.remove('hidden');document.body.style.overflow='hidden'}function closeModal(){document.getElementById('clientModal').classList.add('hidden');document.body.style.overflow=''}document.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeModal()});`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
    console.log('Admin panel: http://localhost:' + PORT + '/admin');
    console.log('Mini App: http://localhost:' + PORT + '/app');
    console.log('History entries: ' + dashboardData.history.length);
});
