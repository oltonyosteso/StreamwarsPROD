const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const cors = require('cors'); // Külső eléréshez (opcionális, de ajánlott)

const app = express();
const port = 80;

// Middleware
app.use(cors()); // Engedélyezi a külső kéréseket
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // HTTPS esetén true
}));
app.use(express.static('public')); // Statikus fájlok (auth, secure, uploads)

// === MYSQL CONNECTION POOL (SKÁLÁZHATÓ, BIZTONSÁGOS) ===
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'streaming_db',
    waitForConnections: true,
    connectionLimit: 10,        // Max 10 egyidejű kapcsolat
    queueLimit: 0,              // Nincs korlát a várólistán
    connectTimeout: 10000,
    acquireTimeout: 10000,
    timeout: 60000,
    reconnect: true
});

// Hibafigyelés és újracsatlakozás
db.on('connection', () => {
    console.log('MySQL új kapcsolat létrehozva');
});

db.on('error', (err) => {
    console.error('MySQL Pool hiba:', err.code || err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
        console.log('Kapcsolat megszakadt, újracsatlakozás...');
    } else {
        console.error('Váratlan MySQL hiba:', err);
    }
});

// Teszt: Pool induláskor
db.getConnection((err, connection) => {
    if (err) {
        console.error('MySQL Pool inicializálási hiba:', err);
        process.exit(1);
    } else {
        console.log('MySQL Pool sikeresen inicializálva');
        connection.release();
    }
});

// Statikus uploads mappa (videók streamelése)
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Gyökér útvonal
app.get('/', (req, res) => {
    res.redirect('/auth/login.html');
});

// Middleware: bejelentkezés ellenőrzés
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/auth/login.html');
    }
}

// === AUTH ROUTES ===
app.get('/auth/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/auth/login.html'));
});

app.get('/auth/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/auth/register.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [results] = await db.promise().query('SELECT * FROM users WHERE username = ?', [username]);
        if (results.length > 0 && await bcrypt.compare(password, results[0].password)) {
            req.session.userId = results[0].id;
            console.log('Bejelentkezés sikeres, user ID:', req.session.userId);
            res.redirect('/secure/index.html');
        } else {
            res.send('Hibás felhasználónév vagy jelszó! <a href="/auth/login.html">Vissza</a>');
        }
    } catch (err) {
        console.error('Bejelentkezési hiba:', err);
        res.status(500).send('Szerver hiba! Próbáld újra később.');
    }
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPw = await bcrypt.hash(password, 10);
        await db.promise().query(
            'INSERT INTO users (username, password, profile_pic) VALUES (?, ?, ?)',
            [username, hashedPw, '/uploads/profiles/default_profile.jpg']
        );
        res.redirect('/auth/login.html');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            res.send('Felhasználónév már foglalt! <a href="/auth/register.html">Vissza</a>');
        } else {
            console.error('Regisztrációs hiba:', err);
            res.status(500).send('Szerver hiba!');
        }
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) console.error('Kijelentkezési hiba:', err);
        res.redirect('/auth/login.html');
    });
});

// === SECURE ROUTES ===
app.get('/secure/index.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/secure/index.html'));
});

app.get('/secure/sw.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/secure/sw.html'));
});

app.get('/secure/lotr.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/secure/lotr.html'));
});

app.get('/secure/indi.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/secure/indi.html'));
});

app.get('/secure/sorozat.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/secure/sorozat.html'));
});
app.get('/secure/letoltes.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/secure/letoltes.html'));
});

// === API ENDPOINTS ===
app.get('/api/user', isAuthenticated, async (req, res) => {
    try {
        const [results] = await db.promise().query('SELECT username, profile_pic FROM users WHERE id = ?', [req.session.userId]);
        const user = results[0] || {};
        res.json({
            username: user.username,
            profile_pic: user.profile_pic || '/uploads/profiles/default_profile.jpg'
        });
    } catch (err) {
        console.error('Hiba az /api/user lekérdezéskor:', err);
        res.status(500).json({ error: 'Adatbázis hiba' });
    }
});

app.get('/api/latest-uploads', isAuthenticated, async (req, res) => {
    const query = `
        (SELECT id, title, 'movie' as type, upload_date, file_path, thumbnail FROM movies ORDER BY upload_date DESC LIMIT 3)
        UNION
        (SELECT id, title, 'episode' as type, upload_date, file_path, thumbnail FROM episodes ORDER BY upload_date DESC LIMIT 3)
        ORDER BY upload_date DESC LIMIT 3
    `;
    try {
        const [results] = await db.promise().query(query);
        res.json(results.map(item => ({
            ...item,
            file_path: item.file_path ? '/' + item.file_path : '',
            thumbnail: item.thumbnail || 'https://via.placeholder.com/200',
            audio_tracks: [
                { id: 0, language: 'hun', label: 'Magyar' },
                { id: 1, language: 'eng', label: 'Angol' }
            ]
        })));
    } catch (err) {
        console.error('Hiba az /api/latest-uploads lekérdezéskor:', err);
        res.status(500).json({ error: 'Adatbázis hiba' });
    }
});

app.get('/api/user-progress', isAuthenticated, async (req, res) => {
    const query = `
        SELECT up.id, up.user_id, up.content_id, up.content_type, up.progress, up.file_path, up.thumbnail, up.title
        FROM user_progress up
        WHERE up.user_id = ?
        ORDER BY up.id DESC LIMIT 1
    `;
    try {
        const [results] = await db.promise().query(query, [req.session.userId]);
        const result = results[0] ? {
            content_id: results[0].content_id,
            content_type: results[0].content_type,
            progress: results[0].progress || 0,
            file_path: results[0].file_path ? '/' + results[0].file_path : '',
            thumbnail: results[0].thumbnail || 'https://via.placeholder.com/200',
            title: results[0].title || 'Ismeretlen tartalom',
            audio_tracks: [
                { id: 0, language: 'hun', label: 'Magyar' },
                { id: 1, language: 'eng', label: 'Angol' }
            ]
        } : null;
        res.json(result);
    } catch (err) {
        console.error('Hiba az /api/user-progress lekérdezéskor:', err);
        res.status(500).json({ error: 'Adatbázis hiba' });
    }
});

app.post('/api/save-progress', isAuthenticated, async (req, res) => {
    const { content_id, content_type, progress, file_path, thumbnail, title } = req.body;
    const userId = req.session.userId;

    if (!content_id || !content_type || progress === undefined || !file_path || !title) {
        return res.status(400).json({ success: false, error: 'Hiányzó adatok' });
    }

    try {
        // 1. TÖRÖLJÜK A RÉGI PROGRESS-T (csak 1 marad / user)
        await db.promise().query('DELETE FROM user_progress WHERE user_id = ?', [userId]);

        // 2. MENTSÜK AZ ÚJAT
        await db.promise().query(
            'INSERT INTO user_progress (user_id, content_id, content_type, progress, file_path, thumbnail, title) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [userId, content_id, content_type, progress, file_path, thumbnail, title]
        );

        console.log('Progress mentve (régi törölve):', { userId, content_id, progress });
        res.json({ success: true });
    } catch (err) {
        console.error('Progress mentés hiba:', err);
        res.status(500).json({ success: false });
    }
});

app.get('/api/categories', isAuthenticated, (req, res) => {
    res.json([{ name: 'Star Wars' }, { name: 'Gyűrűk Ura' }, { name: 'Hannibál' }]);
});

app.get('/api/all-content', isAuthenticated, async (req, res) => {
    const query = `
        SELECT id, title, 'movie' as type, category, upload_date, file_path, thumbnail FROM movies
        UNION
        SELECT id, title, 'series' as type, category, NULL as upload_date, NULL as file_path, NULL as thumbnail FROM series
        UNION
        SELECT id, title, 'episode' as type, NULL as category, upload_date, file_path, thumbnail FROM episodes
    `;
    try {
        const [results] = await db.promise().query(query);
        res.json(results.map(item => ({
            ...item,
            file_path: item.file_path ? '/' + item.file_path : '',
            thumbnail: item.thumbnail || 'https://via.placeholder.com/200',
            audio_tracks: item.type !== 'series' ? [
                { id: 0, language: 'hun', label: 'Magyar' },
                { id: 1, language: 'eng', label: 'Angol' }
            ] : []
        })));
    } catch (err) {
        console.error('Hiba az /api/all-content lekérdezéskor:', err);
        res.status(500).json({ error: 'Adatbázis hiba' });
    }
});

app.get('/api/series-episodes', isAuthenticated, async (req, res) => {
    const { series_id, title } = req.query;
    if (!series_id || !title) {
        return res.status(400).json({ error: 'Hiányzó series_id vagy title paraméter' });
    }
    try {
        const [results] = await db.promise().query(
            `SELECT id, series_id, episode_number, title, file_path, thumbnail
             FROM episodes
             WHERE series_id = ? AND title = ?
             ORDER BY episode_number ASC`,
            [series_id, title]
        );
        res.json(results.map(item => ({
            ...item,
            file_path: item.file_path ? '/' + item.file_path : '',
            thumbnail: item.thumbnail || 'https://via.placeholder.com/200',
            content_type: 'episode',
            audio_tracks: [
                { id: 0, language: 'hun', label: 'Magyar' },
                { id: 1, language: 'eng', label: 'Angol' }
            ]
        })));
    } catch (err) {
        console.error('Hiba az /api/series-episodes lekérdezéskor:', err);
        res.status(500).json({ error: 'Adatbázis hiba' });
    }
});
// === API: Összes sorozat ===
app.get('/api/series', isAuthenticated, async (req, res) => {
    try {
        const [results] = await db.promise().query('SELECT id, title, file_path, thumbnail FROM series ORDER BY id ASC');
        res.json(results.map(item => ({
            id: item.id,
            title: item.title,
            link: item.file_path,      // pl. "/secure/andor1.html"
            thumbnail: item.thumbnail || 'https://via.placeholder.com/200'
        })));
    } catch (err) {
        console.error('Hiba a sorozatok lekérdezésekor:', err);
        res.status(500).json({ error: 'Adatbázis hiba' });
    }
});
// === API: Franchise tartalom (külön filmek és sorozatok) ===
app.get('/api/franchise/:group', isAuthenticated, async (req, res) => {
    const group = req.params.group.toLowerCase();

    try {
        const [movieResults] = await db.promise().query(
            `SELECT id, title, file_path AS link, thumbnail 
             FROM movies 
             WHERE LOWER(groups) LIKE ? 
             ORDER BY id ASC`,
            [`%${group}%`]
        );

        const [seriesResults] = await db.promise().query(
            `SELECT id, title, file_path AS link, thumbnail 
             FROM series 
             WHERE LOWER(groups) LIKE ? 
             ORDER BY id ASC`,
            [`%${group}%`]
        );

        res.json({
            movies: movieResults.map(item => ({
                id: item.id,
                title: item.title,
                link: item.link,
                thumbnail: item.thumbnail || 'https://via.placeholder.com/200'
            })),
            series: seriesResults.map(item => ({
                id: item.id,
                title: item.title,
                link: item.link,
                thumbnail: item.thumbnail || 'https://via.placeholder.com/200'
            }))
        });
    } catch (err) {
        console.error('Hiba a franchise lekérdezéskor:', err);
        res.status(500).json({ error: 'Adatbázis hiba' });
    }
});
// === API: Keresés cím alapján (filmek + sorozatok) ===
app.get('/api/search', isAuthenticated, async (req, res) => {
    const query = req.query.q?.trim().toLowerCase();

    if (!query || query.length < 2) {
        return res.json([]);
    }

    try {
        const searchTerm = `%${query}%`;

        // Filmek keresése
        const [movieResults] = await db.promise().query(
            `SELECT id, title, 'movie' AS type, file_path AS link, thumbnail 
             FROM movies 
             WHERE LOWER(title) LIKE ? 
             ORDER BY title ASC`,
            [searchTerm]
        );

        // Sorozatok keresése
        const [seriesResults] = await db.promise().query(
            `SELECT id, title, 'series' AS type, file_path AS link, thumbnail 
             FROM series 
             WHERE LOWER(title) LIKE ? 
             ORDER BY title ASC`,
            [searchTerm]
        );

        // Összeolvasztás
        const results = [
            ...movieResults.map(item => ({
                id: item.id,
                title: item.title,
                type: 'movie',
                link: item.link,
                thumbnail: item.thumbnail || 'https://via.placeholder.com/200'
            })),
            ...seriesResults.map(item => ({
                id: item.id,
                title: item.title,
                type: 'series',
                link: item.link,
                thumbnail: item.thumbnail || 'https://via.placeholder.com/200'
            }))
        ];

        res.json(results);
    } catch (err) {
        console.error('Hiba a kereséskor:', err);
        res.status(500).json({ error: 'Szerver hiba a keresés során' });
    }
});
// === PROFILKÉP ÉS JELSZÓ ===
const upload = multer({ dest: 'public/uploads/profiles/' });

app.post('/update-profile-pic', isAuthenticated, upload.single('profile_pic'), async (req, res) => {
    const filePath = req.file ? `/uploads/profiles/${req.file.filename}` : null;
    if (filePath) {
        try {
            await db.promise().query('UPDATE users SET profile_pic = ? WHERE id = ?', [filePath, req.session.userId]);
            res.json({ success: true, newProfilePic: filePath });
        } catch (err) {
            console.error('Hiba a profilkép frissítésekor:', err);
            res.status(500).json({ error: 'Adatbázis hiba' });
        }
    } else {
        res.json({ success: true });
    }
});

app.post('/update-password', isAuthenticated, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword) {
        return res.status(400).json({ error: 'Jelszó megadása kötelező' });
    }
    try {
        const hashedPw = await bcrypt.hash(newPassword, 10);
        await db.promise().query('UPDATE users SET password = ? WHERE id = ?', [hashedPw, req.session.userId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Hiba a jelszó frissítésekor:', err);
        res.status(500).json({ error: 'Adatbázis hiba' });
    }
});

// === SZERVER INDÍTÁS ===
app.listen(port, () => {
    console.log(`Szerver fut a http://localhost:${port} címen`);
    console.log(`Nyisd meg: http://localhost:${port}/auth/login.html`);
});