// app.js
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const sharedSession = require('express-socket.io-session');
const axios = require('axios');
const kyrosAuth = require('./middlewares/kyrosAuth');
const authRoutes = require('./routes/auth');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === ENV ===
const {
    KYROS_CLIENT_ID,
    KYROS_CLIENT_SECRET,
    KYROS_REDIRECT_URI,
    KYROS_AUTH_URL,
    KYROS_TOKEN_ENDPOINT,
    KYROS_USERINFO_ENDPOINT,
    SESSION_SECRET
} = process.env;

// === DB ===
const db = new sqlite3.Database('./db.sqlite');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kyros_id TEXT UNIQUE,
        username TEXT,
        name TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS dispos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        date TEXT,
        note TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
});

// === Middleware ===
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
});

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, '../frontend')));

io.use(sharedSession(sessionMiddleware, { autoSave: true }));

// === Utils ===
function getOrCreateUser(profile, callback) {
    db.get(`SELECT id FROM users WHERE kyros_id = ?`, [profile.kyros_id], (err, row) => {
        if (row) {
            callback(row.id);
        } else {
            db.run(`INSERT INTO users (kyros_id, username, name) VALUES (?, ?, ?)`,
                [profile.kyros_id, profile.username, profile.name],
                function () {
                    callback(this.lastID);
                }
            );
        }
    });
}

// === Socket.IO ===
const connectedUsers = {}; 
// Structure : { kyros_id: { username, name, sockets: [socket.id, ...] } }

io.on('connection', (socket) => {
    const user = socket.handshake.session.user;

    if (!user) {
        console.log('❌ Connexion socket sans session valide');
        socket.disconnect();
        return;
    }

    const kyrosId = user.id;

    // Gestion des connexions multiples
    if (!connectedUsers[kyrosId]) {
        connectedUsers[kyrosId] = {
            username: user.username,
            name: user.name,
            sockets: []
        };
    }
    connectedUsers[kyrosId].sockets.push(socket.id);

    console.log(`✅ Socket connecté : ${user.username} (${socket.id})`);

    io.emit('user_connected', {
        kyros_id: kyrosId,
        username: user.username,
        name: user.name
    });

    // === Disconnect ===
    socket.on('disconnect', () => {
        const userData = connectedUsers[kyrosId];
        if (userData) {
            userData.sockets = userData.sockets.filter(id => id !== socket.id);
            if (userData.sockets.length === 0) {
                delete connectedUsers[kyrosId];
                console.log(`❌ ${user.username} totalement déconnecté`);
                io.emit('user_disconnected', {
                    kyros_id: kyrosId,
                    username: user.username,
                    name: user.name
                });
            } else {
                console.log(`🔌 ${user.username} socket déconnectée (${socket.id})`);
            }
        }
    });

    // === Dispos ===
    socket.on('set_dispo', ({ date, note }) => {
        if (!date) return;

        getOrCreateUser({
            kyros_id: kyrosId,
            username: user.username,
            name: user.name
        }, (userId) => {
            db.run(`INSERT INTO dispos (user_id, date, note) VALUES (?, ?, ?)`,
                [userId, date, note || ''],
                function (err) {
                    if (err) {
                        console.error('[DB] Erreur ajout dispo :', err.message);
                        return;
                    }
                    const dispo = {
                        id: this.lastID,
                        username: user.username,
                        name: user.name,
                        date,
                        note
                    };
                    io.emit('new_dispo', dispo);
                }
            );
        });
    });

    socket.on('get_dispos', (callback) => {
        const sql = `
            SELECT dispos.id, dispos.date, dispos.note, users.username, users.name
            FROM dispos
            JOIN users ON dispos.user_id = users.id
        `;
        db.all(sql, (err, rows) => {
            if (err) {
                console.error('[DB] Erreur chargement dispos :', err.message);
                return callback([]);
            }
            callback(rows);
        });
    });

    // === Chat ===
    socket.on('send_message', ({ content }) => {
        if (!content) return;

        getOrCreateUser({
            kyros_id: kyrosId,
            username: user.username,
            name: user.name
        }, (userId) => {
            db.run(`INSERT INTO messages (user_id, content) VALUES (?, ?)`,
                [userId, content],
                function (err) {
                    if (err) {
                        console.error('[DB] Erreur ajout message :', err.message);
                        return;
                    }
                    const message = {
                        id: this.lastID,
                        username: user.username,
                        name: user.name,
                        content,
                        timestamp: new Date().toISOString()
                    };
                    io.emit('new_message', message);
                }
            );
        });
    });

    socket.on('get_messages', (callback) => {
        const sql = `
            SELECT messages.id, messages.content, messages.timestamp, users.username, users.name
            FROM messages
            JOIN users ON messages.user_id = users.id
            ORDER BY timestamp ASC
        `;
        db.all(sql, (err, rows) => {
            if (err) {
                console.error('[DB] Erreur chargement messages :', err.message);
                return callback([]);
            }
            callback(rows);
        });
    });
});


// === Auth ===
app.use('/api/auth', authRoutes);

app.get('/api/auth/config', (req, res) => {
    res.json({
        client_id: KYROS_CLIENT_ID,
        auth_url: KYROS_AUTH_URL,
        redirect_uri: KYROS_REDIRECT_URI
    });
});

// === API ===
app.get('/api/me', kyrosAuth, (req, res) => {
    res.json(req.user);
});

app.get('/api/connected-users', (req, res) => {
    const users = Object.entries(connectedUsers).map(([kyros_id, data]) => ({
        kyros_id,
        username: data.username,
        name: data.name,
        sockets: data.sockets
    }));
    res.json(users);
});


// === Dispo sécurisée ===
app.patch('/api/agenda/:id', kyrosAuth, (req, res) => {
    const { date, note } = req.body;
    const id = req.params.id;

    const sql = `
        SELECT dispos.*, users.kyros_id 
        FROM dispos 
        JOIN users ON dispos.user_id = users.id 
        WHERE dispos.id = ?
    `;
    db.get(sql, [id], (err, dispo) => {
        if (err || !dispo) return res.status(404).json({ error: 'Dispo introuvable' });
        if (dispo.kyros_id !== req.user.sub) return res.status(403).json({ error: 'Non autorisé' });

        db.run(`UPDATE dispos SET date = ?, note = ? WHERE id = ?`,
            [date, note, id],
            function (err) {
                if (err) return res.status(500).json({ error: 'Erreur DB' });
                res.json({ success: true });
            }
        );
    });
});

app.delete('/api/agenda/:id', kyrosAuth, (req, res) => {
    const id = req.params.id;

    const sql = `
        SELECT dispos.*, users.kyros_id 
        FROM dispos 
        JOIN users ON dispos.user_id = users.id 
        WHERE dispos.id = ?
    `;
    db.get(sql, [id], (err, dispo) => {
        if (err || !dispo) return res.status(404).json({ error: 'Dispo introuvable' });
        if (dispo.kyros_id !== req.user.sub) return res.status(403).json({ error: 'Non autorisé' });

        db.run(`DELETE FROM dispos WHERE id = ?`, [id], function (err) {
            if (err) return res.status(500).json({ error: 'Erreur DB' });
            res.json({ success: true });
        });
    });
});

// === Auth Callback ===
app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('Code manquant');

    try {
        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: KYROS_REDIRECT_URI,
            client_id: KYROS_CLIENT_ID,
            client_secret: KYROS_CLIENT_SECRET
        });

        const tokenRes = await axios.post(KYROS_TOKEN_ENDPOINT, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token } = tokenRes.data;
        const userinfoRes = await axios.get(KYROS_USERINFO_ENDPOINT, {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const user = userinfoRes.data;
        req.session.user = user;
        req.session.accessToken = access_token;

        console.log(`[KYROS] ✅ ${user.username} connecté via callback`);

        res.redirect('/');
    } catch (err) {
        console.error('[KYROS][callback] ❌', err.response?.data || err.message);
        res.status(500).send('Erreur de connexion Kyros.');
    }
});


// === Frontend ===
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// === Start ===
const PORT = 3001;
server.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});
