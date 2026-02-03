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
app.use(express.static(path.join(__dirname, 'public')));

// Serve Mini App files
app.use('/app', express.static(path.join(__dirname, '..', 'netlify-build')));

// Data file path
const DATA_FILE = path.join(__dirname, 'data.json');

// Admin password
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ============ DATA FUNCTIONS ============

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            // Ensure history array exists (for legacy data)
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
        history: [] // Cheksiz tarix
    };
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Get today's date as YYYY-MM-DD
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

// Save to history (snapshot)
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

    // Remove existing entry for today (if updating same day)
    dashboardData.history = dashboardData.history.filter(h => h.date !== today);

    // Add new snapshot
    dashboardData.history.push(snapshot);

    // Sort by date (newest first)
    dashboardData.history.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Calculate changes
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

// Initialize data
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

// Process Excel files
function processExcelFiles(files) {
    // Save previous data for comparison
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

            // Clean up
            try { fs.unlinkSync(file.path); } catch (e) { }

        } catch (err) {
            console.error('Error processing file:', file.originalname, err);
        }
    }

    dashboardData.agents = agents;
    dashboardData.lastUpdated = new Date().toISOString();

    // Save to history
    saveToHistory(agents);

    // Save to file
    saveData(dashboardData);

    return agents;
}

// ============ API ENDPOINTS ============

// Get dashboard data with comparison
app.get('/api/data', (req, res) => {
    const currentTotals = {
        totalUSD: dashboardData.agents.reduce((sum, a) => sum + a.totalUSD, 0),
        totalUZS: dashboardData.agents.reduce((sum, a) => sum + a.totalUZS, 0),
        totalDebtors: dashboardData.agents.reduce((sum, a) => sum + a.debtorCount, 0)
    };

    // Get yesterday's data for comparison
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

// Get full history
app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 0; // 0 = all
    const history = limit > 0
        ? dashboardData.history.slice(0, limit)
        : dashboardData.history;

    res.json({
        count: history.length,
        history
    });
});

// Compare with specific date
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

// Get available dates
app.get('/api/dates', (req, res) => {
    const dates = dashboardData.history.map(h => ({
        date: h.date,
        totalUSD: h.totalUSD,
        totalUZS: h.totalUZS
    }));
    res.json(dates);
});

// Admin authentication
app.post('/api/auth', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Noto\'g\'ri parol' });
    }
});

// Upload files (admin only)
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

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'upload.html'));
});

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        agents: dashboardData.agents.length,
        lastUpdated: dashboardData.lastUpdated,
        historyCount: dashboardData.history.length
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`📱 Mini App: http://localhost:${PORT}/app`);
    console.log(`📈 History entries: ${dashboardData.history.length}`);
});
