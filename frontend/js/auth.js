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
    } catch (err) {
        console.warn('[KYROS] Auth expirée ou erreur :', err.response?.data || err.message);

        if (!hasTriedRefresh) {
            hasTriedRefresh = true;
            const refreshed = await refreshKyrosToken();
            if (refreshed) return refreshAuthUI();
        }

        resetAuthUI();
        toggleAppUI(false);
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

// === UI : Bouton Connexion/Deconnexion ===
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

// === UI : Création Bloc Profil ===
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

// === UI : Show/Hide App ===
function toggleAppUI(isConnected) {
    const app = document.getElementById('app');
    if (app) app.style.display = isConnected ? 'block' : 'none';
}
