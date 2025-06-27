const socket = io();

const dispoContainer = document.getElementById('dispos');
const msgContainer = document.getElementById('messages');

let dispos = [];
let messages = [];

// ---------- Dispos ----------
function appendDispo(d) {
    const div = document.createElement('div');
    div.className = 'dispo-item';
    div.innerHTML = `<b>${d.username}</b> dispo le <b>${d.date}</b> (${d.note})`;
    dispoContainer.appendChild(div);
}

function renderDispos() {
    dispoContainer.innerHTML = '';
    const filterDate = document.getElementById('filterDate').value;
    const filterUser = document.getElementById('filterUser').value.toLowerCase();

    dispos
        .filter(d => (!filterDate || d.date === filterDate))
        .filter(d => (!filterUser || d.username.toLowerCase().includes(filterUser)))
        .forEach(appendDispo);
}

async function loadDispos() {
    try {
        const res = await fetch('/api/agenda');
        if (!res.ok) throw new Error('Erreur API agenda');
        dispos = await res.json();
        renderDispos();
    } catch (err) {
        console.warn('Erreur loadDispos :', err.message);
        dispos = [];
        renderDispos();
    }
}

function addDispo() {
    const date = document.getElementById('date').value;
    const note = document.getElementById('note').value;

    if (!window.userProfile) {
        alert("Non connecté");
        return;
    }
    if (!date) return;

    socket.emit('set_dispo', {
        profile: {
            kyros_id: window.userProfile.sub,
            username: window.userProfile.username,
            name: window.userProfile.name
        },
        date,
        note
    });
}

socket.on('new_dispo', (d) => {
    dispos.push(d);
    renderDispos();
});

function applyFilters() {
    renderDispos();
}

function resetFilters() {
    document.getElementById('filterDate').value = '';
    document.getElementById('filterUser').value = '';
    renderDispos();
}

function appendDispo(d) {
    const div = document.createElement('div');
    div.className = 'dispo-item';
    div.innerHTML = `
        <b>${d.username}</b> dispo le <b>${d.date}</b> (${d.note || 'Aucune note'})
        <button onclick="editDispo(${d.id})">✏️</button>
        <button onclick="deleteDispo(${d.id})">🗑️</button>
    `;
    dispoContainer.appendChild(div);
}

async function deleteDispo(id) {
    if (!confirm('Supprimer cette disponibilité ?')) return;
    try {
        const res = await fetch(`/api/agenda/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Dispo supprimée', 'success');
            dispos = dispos.filter(d => d.id !== id);
            renderDispos();
        }
    } catch {
        showToast('Erreur suppression', 'error');
    }
}

async function editDispo(id) {
    const dispo = dispos.find(d => d.id === id);
    if (!dispo) return;

    const newDate = prompt('Nouvelle date (AAAA-MM-JJ) :', dispo.date);
    if (!newDate) return;
    const newNote = prompt('Nouvelle note :', dispo.note);

    try {
        const res = await fetch(`/api/agenda/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: newDate, note: newNote })
        });

        if (res.ok) {
            showToast('Dispo modifiée', 'success');
            dispo.date = newDate;
            dispo.note = newNote;
            renderDispos();
        }
    } catch {
        showToast('Erreur modification', 'error');
    }
}


// ---------- Chat ----------
function appendMessage(m) {
    const div = document.createElement('div');
    div.innerHTML = `<b>${m.username}</b> : ${m.content}`;
    msgContainer.appendChild(div);
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

async function loadMessages() {
    try {
        const res = await fetch('/api/chat/messages');
        if (!res.ok) throw new Error('Erreur API chat');
        messages = await res.json();
        msgContainer.innerHTML = '';
        messages.forEach(appendMessage);
    } catch (err) {
        console.warn('Erreur loadMessages :', err.message);
        messages = [];
        msgContainer.innerHTML = '';
    }
}

function sendMessage() {
    const content = document.getElementById('msgInput').value;

    if (!window.userProfile) {
        alert("Non connecté");
        return;
    }
    if (!content) return;

    socket.emit('send_message', {
        profile: {
            kyros_id: window.userProfile.sub,
            username: window.userProfile.username,
            name: window.userProfile.name
        },
        content
    });

    document.getElementById('msgInput').value = '';
}

socket.on('new_message', (m) => {
    appendMessage(m);
});

// ---------- Chat Popup ----------
function toggleChat() {
    document.getElementById('chatPopup').classList.toggle('hidden');
}

// ---------- Init ----------
// Chargement des dispos
socket.emit('get_dispos', (data) => {
    dispos = data;
    renderDispos();
});

// Chargement des messages
socket.emit('get_messages', (data) => {
    messages = data;
    msgContainer.innerHTML = '';
    data.forEach(appendMessage);
});
