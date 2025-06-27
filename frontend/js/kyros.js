console.log('✅ kyros.js loaded');
axios.defaults.withCredentials = true;

let hasTriedRefresh = false;

// === DOM Ready ===
document.addEventListener('DOMContentLoaded', () => {
    ensureProfileBoxExists();
    refreshAuthUI();
});

// === Auth backend ===
async function refreshAuthUI() {
    try {
        const res = await axios.get('/api/auth/check');
        const user = res.data.user;

        localStorage.setItem('kyrosUser', JSON.stringify(user));
        window.userProfile = user;

        setAuthButton('logout');
        updateProfileBox(user);
        toggleAppUI(true);

        // === Socket connecté ===
        if (!window.socket) {
            window.socket = io();
            setupSocketListeners();
        }
    } catch (err) {
        console.warn('[KYROS] Auth expirée ou erreur :', err.response?.data || err.message);

        if (!hasTriedRefresh) {
            hasTriedRefresh = true;
            const refreshed = await refreshKyrosToken();
            if (refreshed) return refreshAuthUI();
        }

        resetAuthUI();
        toggleAppUI(false);

        if (window.socket) {
            window.socket.disconnect();
            window.socket = null;
        }
    }
}

// === Login ===
function startKyrosLogin() {
    fetch('/api/auth/config')
        .then(res => res.json())
        .then(({ client_id, auth_url, redirect_uri }) => {
            const url = `${auth_url}?client_id=${client_id}&response_type=code&scope=profile email&redirect_uri=${encodeURIComponent(redirect_uri)}`;
            window.location.href = url;
        })
        .catch(err => console.error('Erreur config Kyros:', err));
}

// === Logout ===
function logoutKyros() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
        .then(() => {
            localStorage.removeItem('kyrosUser');
            window.userProfile = null;
            resetAuthUI();
            toggleAppUI(false);

            if (window.socket) {
                window.socket.disconnect();
                window.socket = null;
            }
        })
        .catch(err => console.error('[KYROS] Erreur logout:', err));
}

// === Refresh Token ===
async function refreshKyrosToken() {
    try {
        const res = await axios.post("/api/auth/refresh");
        return res.status === 200 && res.data.access_token;
    } catch (e) {
        console.warn("[KYROS] Refresh failed :", e.message);
        return false;
    }
}

// === === Socket === ===

// === Register socket avec le user ===
// function registerSocket() {
//     if (window.userProfile && window.socket) {
//         window.socket.emit('register', {
//             kyros_id: window.userProfile.sub,
//             username: window.userProfile.username,
//             name: window.userProfile.name
//         });
//     }
// }

// === Listeners présence ===
function setupSocketListeners() {
    if (!window.socket) return;

    window.socket.on('user_connected', (user) => {
        console.log(`🟢 ${user.username} est en ligne`);
        showToast(`🟢 ${user.username} est connecté`, 'info');
        loadOnlineUsers()
    });

    window.socket.on('user_disconnected', (user) => {
        console.log(`🔴 ${user.username} s'est déconnecté`);
        showToast(`🔴 ${user.username} est déconnecté`, 'info');
        loadOnlineUsers()
    });
}

// === UI : Gestion Bouton ===
function setAuthButton(mode) {
    const authBtn = document.getElementById('kyrosAuthBtn');
    const authLabel = authBtn?.querySelector('.auth-label');

    if (!authBtn || !authLabel) return;

    if (mode === 'login') {
        authBtn.className = 'auth-btn login';
        authLabel.textContent = 'Connexion Kyros';
        authBtn.onclick = startKyrosLogin;
    } else {
        authBtn.className = 'auth-btn logout';
        authLabel.textContent = 'Déconnexion';
        authBtn.onclick = logoutKyros;
    }
}

// === UI : Bloc Profil ===
function updateProfileBox(user) {
    const avatar = document.querySelector('.profile-avatar');
    const name = document.querySelector('.profile-name');
    const role = document.querySelector('.profile-role');

    if (!avatar || !name || !role) {
        console.warn('[KYROS] Bloc profil manquant');
        return;
    }

    if (!user) {
        avatar.textContent = '?';
        name.textContent = 'Invité';
        role.textContent = 'Non connecté';
    } else {
        avatar.textContent = user.username?.[0]?.toUpperCase() || '?';
        name.textContent = user.username || 'Inconnu';
        role.textContent = 'Connecté via Kyros';
    }
}

// === UI : Reset Auth ===
function resetAuthUI() {
    localStorage.removeItem('kyrosUser');
    window.userProfile = null;
    updateProfileBox(null);
    setAuthButton('login');
}

// === UI : Création Bloc Profil si manquant ===
function ensureProfileBoxExists() {
    const container = document.getElementById('kyrosProfile');
    if (!container) return;

    if (!container.querySelector('.profile-avatar')) {
        container.innerHTML = `
            <div class="profile-avatar">?</div>
            <div class="profile-name">Invité</div>
            <div class="profile-role">Non connecté</div>
        `;
    }
}

// === UI : Affichage App (chat + dispo) ===
function toggleAppUI(isConnected) {
    const app = document.getElementById('app');
    if (app) app.style.display = isConnected ? 'block' : 'none';
}

function renderOnlineUsers(users) {
    const container = document.getElementById('onlineUsersList');
    container.innerHTML = '';

    console.log(users);

    if (!users.length) {
        container.innerHTML = `<li class="empty">Aucun utilisateur connecté</li>`;
        return;
    }

    users.forEach(user => {
        const li = document.createElement('li');
        li.textContent = user.username;
        container.appendChild(li);
    });
}


async function loadOnlineUsers() {
    try {
        const res = await fetch('/api/connected-users');
        if (res.ok) {
            const users = await res.json();
            console.log(users);
            renderOnlineUsers(users);
        }
    } catch {
        console.warn('Erreur chargement users en ligne');
    }
}
