/* global io */

const state = {
  user: null,
  availability: [],
  events: [],
  messages: [],
  presence: [],
  range: 'week',
  search: '',
  view: 'availability',
  activeEventId: null,
  socket: null,
};

const elements = {};
const dateFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  return new Date(`${value}T12:00:00`);
}

function initials(person) {
  const label = person.displayName || person.username || '?';
  return label.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function createAvatar(person) {
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  if (person.avatarUrl) {
    const image = document.createElement('img');
    image.src = person.avatarUrl;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      avatar.replaceChildren(document.createTextNode(initials(person)));
    }, { once: true });
    avatar.append(image);
  } else {
    avatar.textContent = initials(person);
  }
  return avatar;
}

function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

function toast(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.append(icon(type === 'success' ? 'm5 12 4 4L19 6' : type === 'error' ? 'M12 8v5m0 4h.01M10.3 3.5 2.6 17a2 2 0 0 0 1.8 3h15.2a2 2 0 0 0 1.8-3L13.7 3.5a2 2 0 0 0-3.4 0Z' : 'M12 8h.01M11 12h1v4h1m9-4A10 10 0 1 1 2 12a10 10 0 0 1 20 0Z'));
  const copy = document.createElement('span');
  copy.textContent = message;
  item.append(copy);
  elements.toastRegion.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

async function rawApi(url, options) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
}

async function api(url, options = {}, canRefresh = true) {
  let { response, body } = await rawApi(url, options);
  if (response.status === 401 && canRefresh) {
    const refreshed = await rawApi('/api/session/refresh', { method: 'POST' });
    if (refreshed.response.ok) ({ response, body } = await rawApi(url, options));
  }
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error(body?.error || 'Konekt n’a pas pu terminer cette action. Réessaie.');
  }
  return body;
}

function showLogin() {
  elements.appShell.hidden = true;
  elements.loginScreen.hidden = false;
  state.socket?.disconnect();
  state.socket = null;
}

function userContext(user) {
  const companies = user.enterpriseAccess || [];
  if (!companies.length) return 'Compte Kyros';
  if (companies.length === 1) return companies[0].companyName || 'Espace entreprise';
  return `${companies.length} espaces Kyros`;
}

function showApp(user) {
  state.user = user;
  elements.loginScreen.hidden = true;
  elements.appShell.hidden = false;
  elements.profileName.textContent = user.displayName || user.username;
  elements.profileContext.textContent = userContext(user);
  elements.profileAvatar.replaceWith(createAvatar(user));
  elements.profileAvatar = document.querySelector('#profile .avatar');
}

function loadingAvailability() {
  elements.availabilityList.setAttribute('aria-busy', 'true');
  const wrapper = document.createElement('div');
  wrapper.className = 'loading-state';
  const content = document.createElement('div');
  const rule = document.createElement('div');
  rule.className = 'loading-rule';
  const label = document.createElement('p');
  label.textContent = 'Ouverture du registre…';
  content.append(rule, label);
  wrapper.append(content);
  elements.availabilityList.replaceChildren(wrapper);
}

function filterAvailability() {
  const today = localDateKey();
  const week = new Date();
  week.setDate(week.getDate() + 6);
  const weekEnd = localDateKey(week);
  const query = state.search.toLocaleLowerCase('fr');
  return state.availability.filter((item) => {
    const inRange = state.range === 'all' || (state.range === 'today' ? item.date === today : item.date >= today && item.date <= weekEnd);
    const haystack = `${item.displayName} ${item.username} ${item.note}`.toLocaleLowerCase('fr');
    return inRange && (!query || haystack.includes(query));
  });
}

function createActionButton(label, path, action) {
  const button = document.createElement('button');
  button.className = 'icon-button';
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.append(icon(path));
  button.addEventListener('click', action);
  return button;
}

function renderAvailability() {
  const records = filterAvailability();
  elements.availabilityList.removeAttribute('aria-busy');
  elements.planningSummary.textContent = records.length
    ? `${records.length} créneau${records.length > 1 ? 'x' : ''} visible${records.length > 1 ? 's' : ''} dans le registre.`
    : 'Le registre partagé de l’équipe.';

  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.append(icon('M6 2v4M18 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm4 11h6'));
    const heading = document.createElement('h2');
    heading.textContent = state.search ? 'Aucun créneau ne correspond' : 'Le registre est libre';
    const copy = document.createElement('p');
    copy.textContent = state.search ? 'Essaie un autre nom ou retire le filtre.' : 'Ajoute ta disponibilité pour donner le premier repère à l’équipe.';
    empty.append(heading, copy);
    if (!state.search) {
      const button = document.createElement('button');
      button.className = 'button button-primary';
      button.type = 'button';
      button.textContent = 'Ajouter mon créneau';
      button.addEventListener('click', () => openEditor());
      empty.append(button);
    }
    elements.availabilityList.replaceChildren(empty);
    return;
  }

  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.date)) groups.set(record.date, []);
    groups.get(record.date).push(record);
  }
  const fragment = document.createDocumentFragment();
  for (const [date, items] of groups) {
    const group = document.createElement('section');
    group.className = 'day-group';
    const label = document.createElement('div');
    label.className = 'day-label';
    const day = document.createElement('strong');
    day.textContent = date === localDateKey() ? 'Aujourd’hui' : dateFormat.format(parseDate(date)).split(' ')[0];
    const numeric = document.createElement('span');
    numeric.textContent = shortDateFormat.format(parseDate(date));
    label.append(day, numeric);
    const list = document.createElement('div');
    list.className = 'day-items';

    for (const item of items) {
      const row = document.createElement('article');
      row.className = `availability-row${item.ownedByCurrentUser ? ' mine' : ''}`;
      row.append(createAvatar(item));
      const copy = document.createElement('div');
      copy.className = 'availability-copy';
      const name = document.createElement('b');
      name.textContent = item.ownedByCurrentUser ? `${item.displayName} · moi` : item.displayName;
      const note = document.createElement('p');
      note.textContent = item.note || '';
      copy.append(name, note);
      row.append(copy);
      if (item.ownedByCurrentUser) {
        const actions = document.createElement('div');
        actions.className = 'row-actions';
        actions.append(
          createActionButton('Modifier ce créneau', 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z', () => openEditor(item)),
          createActionButton('Supprimer ce créneau', 'M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v5m4-5v5', () => removeAvailability(item)),
        );
        row.append(actions);
      }
      list.append(row);
    }
    group.append(label, list);
    fragment.append(group);
  }
  elements.availabilityList.replaceChildren(fragment);
}

function renderAvailabilityError(error) {
  const wrapper = document.createElement('div');
  wrapper.className = 'error-state';
  wrapper.append(icon('M12 8v4m0 4h.01M10.3 3.5 2.6 17a2 2 0 0 0 1.8 3h15.2a2 2 0 0 0 1.8-3L13.7 3.5a2 2 0 0 0-3.4 0Z'));
  const heading = document.createElement('h2');
  heading.textContent = 'Le registre ne répond pas';
  const copy = document.createElement('p');
  copy.textContent = error.message;
  const retry = document.createElement('button');
  retry.className = 'button button-secondary';
  retry.type = 'button';
  retry.textContent = 'Réessayer';
  retry.addEventListener('click', loadAvailability);
  wrapper.append(heading, copy, retry);
  elements.availabilityList.replaceChildren(wrapper);
}

async function loadAvailability() {
  loadingAvailability();
  try {
    state.availability = await api('/api/availability');
    renderAvailability();
  } catch (error) {
    renderAvailabilityError(error);
  }
}

function upsertAvailability(record) {
  const index = state.availability.findIndex((item) => item.id === record.id);
  const normalized = { ...record, ownedByCurrentUser: record.userId === state.user.id };
  if (index === -1) state.availability.push(normalized);
  else state.availability[index] = normalized;
  state.availability.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  renderAvailability();
}

function openEditor(record) {
  elements.dialogTitle.textContent = record ? 'Modifier mon créneau' : 'Ajouter un créneau';
  elements.availabilityId.value = record?.id || '';
  elements.availabilityDate.value = record?.date || localDateKey();
  elements.availabilityNote.value = record?.note || '';
  elements.noteCount.textContent = String(elements.availabilityNote.value.length);
  elements.availabilityDialog.showModal();
  window.setTimeout(() => elements.availabilityDate.focus(), 0);
}

async function saveAvailability() {
  if (!elements.availabilityDate.reportValidity()) return;
  const id = elements.availabilityId.value;
  const button = elements.saveAvailability;
  button.disabled = true;
  button.textContent = 'Enregistrement…';
  try {
    const record = await api(id ? `/api/availability/${id}` : '/api/availability', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify({ date: elements.availabilityDate.value, note: elements.availabilityNote.value }),
    });
    upsertAvailability(record);
    elements.availabilityDialog.close();
    toast(id ? 'Ton créneau a été mis à jour.' : 'Ton créneau est dans le registre.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Enregistrer';
  }
}

function confirmAction(title, text) {
  return new Promise((resolve) => {
    elements.confirmTitle.textContent = title;
    elements.confirmText.textContent = text;
    elements.confirmDialog.showModal();
    elements.confirmDialog.addEventListener('close', () => resolve(elements.confirmDialog.returnValue === 'confirm'), { once: true });
  });
}

async function removeAvailability(record) {
  if (!await confirmAction('Supprimer ce créneau ?', 'Il disparaîtra immédiatement du registre de l’équipe.')) return;
  try {
    await api(`/api/availability/${record.id}`, { method: 'DELETE' });
    state.availability = state.availability.filter((item) => item.id !== record.id);
    renderAvailability();
    toast('Le créneau a été supprimé.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function formatEventRange(event) {
  if (event.startDate === event.endDate) return dateFormat.format(parseDate(event.startDate));
  const start = dateFormat.format(parseDate(event.startDate));
  const end = dateFormat.format(parseDate(event.endDate));
  const endParts = end.split(' ');
  return start.split(' ')[2] === endParts[2]
    ? `du ${start} au ${endParts.slice(0, 2).join(' ')}`
    : `du ${start} au ${end}`;
}

function daySlotLabels(startDate, endDate) {
  const labels = [];
  const current = new Date(parseDate(startDate));
  const end = parseDate(endDate);
  while (current <= end) {
    labels.push(dateFormat.format(current));
    current.setDate(current.getDate() + 1);
  }
  return labels;
}

function setMainView(view) {
  state.view = view;
  const showAvailability = view === 'availability';
  elements.availabilityView.hidden = !showAvailability;
  elements.eventsView.hidden = showAvailability;
  document.querySelectorAll('.view-tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.view === view)));
}

function renderEvents() {
  const today = localDateKey();
  const upcoming = state.events.filter((event) => event.endDate >= today);
  const past = state.events.filter((event) => event.endDate < today);
  elements.eventsSummary.textContent = upcoming.length
    ? `${upcoming.length} événement${upcoming.length > 1 ? 's' : ''} à venir.`
    : 'Le planning des sorties du groupe.';

  if (!state.events.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.append(icon('M8 2v4M16 2v4M3 9h18M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 9 2 2 4-4'));
    const heading = document.createElement('h2');
    heading.textContent = 'Aucun événement';
    const copy = document.createElement('p');
    copy.textContent = 'Crée un événement pour voir qui est disponible.';
    empty.append(heading, copy);
    const button = document.createElement('button');
    button.className = 'button button-primary';
    button.type = 'button';
    button.textContent = 'Créer un événement';
    button.addEventListener('click', () => openEventEditor());
    empty.append(button);
    elements.eventsList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const event of upcoming) fragment.append(createEventCard(event));
  if (past.length) {
    const title = document.createElement('p');
    title.className = 'events-group-title';
    title.textContent = 'Passés';
    fragment.append(title);
    for (const event of past) fragment.append(createEventCard(event));
  }
  elements.eventsList.replaceChildren(fragment);
}

function createEventCard(event) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `event-card${event.endDate < localDateKey() ? ' past' : ''}`;
  card.addEventListener('click', () => openEventDetail(event.id));

  const thumb = document.createElement('span');
  thumb.className = 'event-card-thumb';
  const src = event.imagePath || event.imageUrl;
  if (src) {
    const image = document.createElement('img');
    image.src = src;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      thumb.replaceChildren(icon('M8 2v4M16 2v4M3 9h18M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 9 2 2 4-4'));
    }, { once: true });
    thumb.append(image);
  } else {
    thumb.append(icon('M8 2v4M16 2v4M3 9h18M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 9 2 2 4-4'));
  }

  const copy = document.createElement('span');
  copy.className = 'event-card-copy';
  const title = document.createElement('b');
  title.textContent = event.title;
  const meta = document.createElement('p');
  const parts = [formatEventRange(event)];
  if (event.location) parts.push(event.location);
  meta.textContent = parts.join(' · ');
  copy.append(title, meta);

  const count = document.createElement('span');
  count.className = `event-card-count${event.endDate < localDateKey() ? ' past' : ''}`;
  count.append(icon('m5 12 4 4L19 6'));
  const text = document.createElement('span');
  text.textContent = event.participantCount ? `${event.participantCount} dispo` : 'Personne encore';
  count.append(text);

  card.append(thumb, copy, count);
  return card;
}

function renderEventsError(error) {
  const wrapper = document.createElement('div');
  wrapper.className = 'error-state';
  wrapper.append(icon('M12 8v4m0 4h.01M10.3 3.5 2.6 17a2 2 0 0 0 1.8 3h15.2a2 2 0 0 0 1.8-3L13.7 3.5a2 2 0 0 0-3.4 0Z'));
  const heading = document.createElement('h2');
  heading.textContent = 'Les événements ne répondent pas';
  const copy = document.createElement('p');
  copy.textContent = error.message;
  const retry = document.createElement('button');
  retry.className = 'button button-secondary';
  retry.type = 'button';
  retry.textContent = 'Réessayer';
  retry.addEventListener('click', loadEvents);
  wrapper.append(heading, copy, retry);
  elements.eventsList.replaceChildren(wrapper);
}

async function loadEvents() {
  try {
    state.events = await api('/api/events');
    renderEvents();
  } catch (error) {
    renderEventsError(error);
  }
}

function upsertEvent(record) {
  const index = state.events.findIndex((item) => item.id === record.id);
  if (index === -1) state.events.push(record);
  else state.events[index] = record;
  state.events.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
  renderEvents();
  if (elements.eventDetailDialog.open && state.activeEventId === record.id) renderEventDetail(record);
}

function openEventEditor(event) {
  elements.eventDialogTitle.textContent = event ? 'Modifier l’événement' : 'Créer un événement';
  elements.eventId.value = event?.id || '';
  elements.eventTitle.value = event?.title || '';
  elements.eventStart.value = event?.startDate || localDateKey();
  elements.eventEnd.value = event?.endDate || localDateKey();
  elements.eventLocation.value = event?.location || '';
  elements.eventDescription.value = event?.description || '';
  elements.eventImagePathValue.value = event?.imagePath || '';
  elements.eventImageUrl.value = event?.imageUrl || '';
  elements.eventImageFile.value = '';
  elements.eventImagePreviewImg.removeAttribute('src');
  const image = event?.imagePath || event?.imageUrl;
  elements.eventImagePreview.hidden = !image;
  if (image) elements.eventImagePreviewImg.src = image;
  elements.eventImageHint.textContent = event
    ? 'Un créneau peut être ajouté depuis la fiche de l’événement.'
    : 'Un créneau par jour sera proposé à l’équipe.';
  elements.saveEvent.textContent = event ? 'Enregistrer' : 'Créer l’événement';
  elements.eventDialog.showModal();
  window.setTimeout(() => elements.eventTitle.focus(), 0);
}

async function saveEvent() {
  if (!elements.eventTitle.reportValidity()) return;
  if (!elements.eventStart.reportValidity() || !elements.eventEnd.reportValidity()) return;
  const start = elements.eventStart.value;
  const end = elements.eventEnd.value;
  if (start > end) {
    toast('La fin doit suivre le début.', 'error');
    return;
  }
  const id = elements.eventId.value;
  const payload = {
    title: elements.eventTitle.value,
    startDate: start,
    endDate: end,
    location: elements.eventLocation.value,
    description: elements.eventDescription.value,
    imageUrl: elements.eventImageUrl.value.trim() || null,
    imagePath: elements.eventImagePathValue.value || null,
  };
  if (!id) payload.slots = daySlotLabels(start, end);
  const button = elements.saveEvent;
  button.disabled = true;
  button.textContent = 'Enregistrement…';
  try {
    const record = await api(id ? `/api/events/${id}` : '/api/events', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    upsertEvent(record);
    elements.eventDialog.close();
    toast(id ? 'L’événement a été mis à jour.' : 'L’événement est dans le planning.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = id ? 'Enregistrer' : 'Créer l’événement';
  }
}

async function uploadEventImage(file) {
  const data = new FormData();
  data.append('image', file);
  const response = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'same-origin',
    body: data,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'Image non enregistrée.');
  return body.url;
}

function resetEventImage() {
  elements.eventImagePathValue.value = '';
  elements.eventImageUrl.value = '';
  elements.eventImageFile.value = '';
  elements.eventImagePreviewImg.removeAttribute('src');
  elements.eventImagePreview.hidden = true;
}

function openEventDetail(id) {
  state.activeEventId = id;
  renderEventDetail(state.events.find((event) => event.id === id));
  elements.eventDetailDialog.showModal();
}

function renderEventDetail(event) {
  if (!event) {
    elements.eventDetailDialog.close();
    return;
  }
  elements.eventDetailTitle.textContent = event.title;
  elements.eventDetailAuthor.textContent = `Proposé par ${event.author.displayName || event.author.username}`;
  elements.eventDetailMeta.textContent = [formatEventRange(event), event.location].filter(Boolean).join(' · ');
  const image = event.imagePath || event.imageUrl;
  elements.eventDetailImage.hidden = !image;
  if (image) {
    elements.eventDetailImage.src = image;
    elements.eventDetailImage.alt = event.title;
    elements.eventDetailImage.referrerPolicy = 'no-referrer';
  } else {
    elements.eventDetailImage.removeAttribute('src');
  }
  elements.eventDetailDescription.hidden = !event.description;
  elements.eventDetailDescription.textContent = event.description;

  const slotList = elements.eventSlotList;
  slotList.replaceChildren();
  const title = document.createElement('p');
  title.className = 'slot-list-title';
  title.textContent = 'Disponibilités par créneau';
  slotList.append(title);
  for (const slot of event.slots) slotList.append(createSlotCard(event, slot));

  elements.eventEditButton.hidden = !event.ownedByCurrentUser;
  elements.eventDeleteButton.hidden = !event.ownedByCurrentUser;
  elements.eventSlotAddRow.hidden = !event.ownedByCurrentUser;
  elements.eventSlotInput.value = '';
}

function createSlotCard(event, slot) {
  const card = document.createElement('div');
  card.className = 'slot-card';

  const head = document.createElement('div');
  head.className = 'slot-head';
  const label = document.createElement('b');
  label.textContent = slot.label;
  const yes = slot.responses.filter((response) => response.status === 'yes').length;
  const no = slot.responses.filter((response) => response.status === 'no').length;
  const count = document.createElement('span');
  count.textContent = `${yes} dispo · ${no} pas dispo`;
  head.append(label, count);

  const toggle = document.createElement('div');
  toggle.className = 'slot-toggle';
  toggle.append(
    createStatusButton('yes', 'Dispo', slot),
    createStatusButton('no', 'Pas dispo', slot),
  );

  const people = document.createElement('div');
  people.className = 'slot-people';
  for (const { user, status } of slot.responses) {
    const chip = document.createElement('span');
    chip.className = `person-chip${status === 'no' ? ' no' : ''}`;
    chip.append(createAvatar(user));
    const name = document.createElement('span');
    name.textContent = user.displayName || user.username;
    chip.append(name);
    people.append(chip);
  }

  card.append(head, toggle, people);

  if (event.ownedByCurrentUser) {
    const remove = document.createElement('button');
    remove.className = 'button button-secondary slot-remove';
    remove.type = 'button';
    remove.textContent = 'Retirer ce créneau';
    remove.addEventListener('click', () => void removeSlot(slot.id));
    card.append(remove);
  }
  return card;
}

function createStatusButton(status, label, slot) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = status;
  button.textContent = label;
  button.setAttribute('aria-pressed', String(slot.myStatus === status));
  button.addEventListener('click', () => {
    void setResponse(slot.id, slot.myStatus === status ? null : status);
  });
  return button;
}

async function setResponse(slotId, status) {
  const event = state.events.find((item) => item.id === state.activeEventId);
  if (!event) return;
  try {
    const updated = await api(`/api/events/${event.id}/slots/${slotId}/response`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    upsertEvent(updated);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function addSlot() {
  const label = elements.eventSlotInput.value.trim();
  if (!label) return;
  const event = state.events.find((item) => item.id === state.activeEventId);
  if (!event) return;
  elements.eventSlotAdd.disabled = true;
  try {
    const updated = await api(`/api/events/${event.id}/slots`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
    upsertEvent(updated);
    elements.eventSlotInput.value = '';
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    elements.eventSlotAdd.disabled = false;
  }
}

async function removeSlot(slotId) {
  if (!await confirmAction('Retirer ce créneau ?', 'Les réponses liées à ce créneau seront effacées.')) return;
  const event = state.events.find((item) => item.id === state.activeEventId);
  if (!event) return;
  try {
    await api(`/api/slots/${slotId}`, { method: 'DELETE' });
    const updated = await api(`/api/events/${event.id}`);
    upsertEvent(updated);
    toast('Le créneau a été retiré.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeEvent() {
  const event = state.events.find((item) => item.id === state.activeEventId);
  if (!event || !await confirmAction('Supprimer cet événement ?', 'Il disparaîtra du planning ainsi que ses créneaux.')) return;
  try {
    await api(`/api/events/${event.id}`, { method: 'DELETE' });
    state.events = state.events.filter((item) => item.id !== event.id);
    renderEvents();
    elements.eventDetailDialog.close();
    toast('L’événement a été supprimé.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function editActiveEvent() {
  const event = state.events.find((item) => item.id === state.activeEventId);
  if (!event) return;
  elements.eventDetailDialog.close();
  openEventEditor(event);
}

function renderPresence() {
  elements.presenceCount.textContent = String(state.presence.length);
  elements.presenceCountMobile.textContent = String(state.presence.length);
  const fragment = document.createDocumentFragment();
  for (const person of state.presence) {
    const item = document.createElement('li');
    item.className = 'presence-item';
    item.append(createAvatar(person));
    const copy = document.createElement('span');
    copy.className = 'presence-person';
    const name = document.createElement('b');
    name.textContent = person.id === state.user.id ? `${person.displayName} · moi` : person.displayName;
    const status = document.createElement('span');
    status.textContent = 'Disponible maintenant';
    copy.append(name, status);
    item.append(copy);
    fragment.append(item);
  }
  if (!state.presence.length) {
    const empty = document.createElement('li');
    empty.className = 'presence-item';
    empty.textContent = 'Personne n’est encore en ligne.';
    fragment.append(empty);
  }
  elements.presenceList.replaceChildren(fragment);
}

function renderMessages() {
  const atBottom = elements.messageList.scrollHeight - elements.messageList.scrollTop - elements.messageList.clientHeight < 90;
  const fragment = document.createDocumentFragment();
  for (const message of state.messages) {
    const article = document.createElement('article');
    article.className = 'message';
    article.append(createAvatar(message));
    const body = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'message-head';
    const author = document.createElement('b');
    author.textContent = message.userId === state.user.id ? `${message.displayName} · moi` : message.displayName;
    const time = document.createElement('time');
    const timestamp = new Date(message.timestamp.endsWith('Z') ? message.timestamp : `${message.timestamp}Z`);
    time.dateTime = timestamp.toISOString();
    time.textContent = timeFormat.format(timestamp);
    head.append(author, time);
    const content = document.createElement('p');
    content.textContent = message.content;
    body.append(head, content);
    article.append(body);
    fragment.append(article);
  }
  elements.messageList.replaceChildren(fragment);
  if (atBottom || !state.messages.length) elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

async function loadMessages() {
  try {
    state.messages = await api('/api/messages');
    renderMessages();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function connectRealtime() {
  state.socket = io({ transports: ['websocket', 'polling'] });
  state.socket.on('presence:changed', (people) => { state.presence = people; renderPresence(); });
  state.socket.on('availability:created', upsertAvailability);
  state.socket.on('availability:updated', upsertAvailability);
  state.socket.on('availability:deleted', ({ id }) => {
    state.availability = state.availability.filter((item) => item.id !== id);
    renderAvailability();
  });
  state.socket.on('message:created', (message) => {
    if (!state.messages.some((item) => item.id === message.id)) state.messages.push(message);
    renderMessages();
  });
  state.socket.on('event:created', upsertEvent);
  state.socket.on('event:updated', upsertEvent);
  state.socket.on('event:deleted', ({ id }) => {
    state.events = state.events.filter((event) => event.id !== id);
    renderEvents();
    if (state.activeEventId === id) elements.eventDetailDialog.close();
  });
  state.socket.on('connect_error', () => toast('Le temps réel est momentanément indisponible.', 'error'));
}

function setMobileView(view) {
  const presenceOpen = view === 'presence';
  const chatOpen = view === 'chat';
  elements.presencePanel.classList.toggle('open', presenceOpen);
  elements.chatPanel.classList.toggle('open', chatOpen);
  document.querySelectorAll('[data-mobile-view]').forEach((button) => button.classList.toggle('active', button.dataset.mobileView === view));
}

function bindEvents() {
  elements.addAvailability.addEventListener('click', () => openEditor());
  elements.availabilityNote.addEventListener('input', () => { elements.noteCount.textContent = String(elements.availabilityNote.value.length); });
  elements.availabilityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') elements.availabilityDialog.close();
    else void saveAvailability();
  });
  elements.rangeFilter.addEventListener('click', (event) => {
    const button = event.target.closest('[data-range]');
    if (!button) return;
    state.range = button.dataset.range;
    elements.rangeFilter.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    renderAvailability();
  });
  elements.searchInput.addEventListener('input', () => { state.search = elements.searchInput.value.trim(); renderAvailability(); });
  elements.messageInput.addEventListener('input', () => {
    elements.messageInput.style.height = 'auto';
    elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 110)}px`;
  });
  elements.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); elements.messageForm.requestSubmit(); }
  });
  elements.messageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const content = elements.messageInput.value.trim();
    if (!content || !state.socket?.connected) return;
    state.socket.emit('message:send', content, (result) => {
      if (!result?.ok) return toast(result?.error || 'Message non envoyé.', 'error');
      elements.messageInput.value = '';
      elements.messageInput.style.height = 'auto';
    });
  });
  elements.logoutButton.addEventListener('click', async () => {
    elements.logoutButton.disabled = true;
    await rawApi('/api/session', { method: 'DELETE' });
    window.location.assign('/');
  });
  elements.presenceToggle.addEventListener('click', () => setMobileView('presence'));
  document.querySelectorAll('[data-mobile-view]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.mobileView === 'events') {
      setMainView('events');
      setMobileView('planning');
    } else {
      setMobileView(button.dataset.mobileView);
    }
  }));
  document.querySelectorAll('[data-close-panel]').forEach((button) => button.addEventListener('click', () => setMobileView('planning')));
  document.querySelectorAll('.view-tab').forEach((tab) => tab.addEventListener('click', () => setMainView(tab.dataset.view)));
  elements.addEvent.addEventListener('click', () => openEventEditor());
  elements.eventForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') elements.eventDialog.close();
    else void saveEvent();
  });
  elements.eventImageFile.addEventListener('change', async () => {
    const file = elements.eventImageFile.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Choisis un fichier image.', 'error');
      elements.eventImageFile.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('L’image dépasse 5 Mo.', 'error');
      elements.eventImageFile.value = '';
      return;
    }
    const preview = new FileReader();
    preview.onload = () => {
      elements.eventImagePreviewImg.src = preview.result;
      elements.eventImagePreview.hidden = false;
    };
    preview.readAsDataURL(file);
    elements.eventImageUrl.value = '';
    try {
      const url = await uploadEventImage(file);
      elements.eventImagePathValue.value = url;
      elements.eventImagePreviewImg.src = url;
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  elements.eventImageUrl.addEventListener('input', () => {
    const value = elements.eventImageUrl.value.trim();
    if (value) {
      elements.eventImagePreviewImg.src = value;
      elements.eventImagePreview.hidden = false;
      elements.eventImagePathValue.value = '';
    } else if (!elements.eventImagePathValue.value) {
      elements.eventImagePreview.hidden = true;
    }
  });
  elements.eventImageClear.addEventListener('click', resetEventImage);
  elements.eventDetailClose.addEventListener('click', () => elements.eventDetailDialog.close());
  elements.eventDetailDialog.addEventListener('click', (event) => {
    if (event.target === elements.eventDetailDialog) elements.eventDetailDialog.close();
  });
  elements.eventEditButton.addEventListener('click', editActiveEvent);
  elements.eventDeleteButton.addEventListener('click', () => void removeEvent());
  elements.eventSlotAdd.addEventListener('click', () => void addSlot());
  elements.eventSlotInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void addSlot();
    }
  });
}

function collectElements() {
  Object.assign(elements, {
    loginScreen: document.getElementById('loginScreen'), appShell: document.getElementById('appShell'), loginDate: document.getElementById('loginDate'), ledgerDate: document.getElementById('ledgerDate'), authError: document.getElementById('authError'),
    todayLabel: document.getElementById('todayLabel'), profileName: document.getElementById('profileName'), profileContext: document.getElementById('profileContext'), profileAvatar: document.getElementById('profileAvatar'), logoutButton: document.getElementById('logoutButton'),
    presencePanel: document.getElementById('presencePanel'), presenceToggle: document.getElementById('presenceToggle'), presenceCount: document.getElementById('presenceCount'), presenceCountMobile: document.getElementById('presenceCountMobile'), presenceList: document.getElementById('presenceList'),
    planningSummary: document.getElementById('planningSummary'), addAvailability: document.getElementById('addAvailability'), rangeFilter: document.getElementById('rangeFilter'), searchInput: document.getElementById('searchInput'), availabilityList: document.getElementById('availabilityList'), availabilityView: document.getElementById('availabilityView'), eventsView: document.getElementById('eventsView'),
    chatPanel: document.getElementById('chatPanel'), messageList: document.getElementById('messageList'), messageForm: document.getElementById('messageForm'), messageInput: document.getElementById('messageInput'),
    availabilityDialog: document.getElementById('availabilityDialog'), availabilityForm: document.getElementById('availabilityForm'), dialogTitle: document.getElementById('dialogTitle'), availabilityId: document.getElementById('availabilityId'), availabilityDate: document.getElementById('availabilityDate'), availabilityNote: document.getElementById('availabilityNote'), noteCount: document.getElementById('noteCount'), saveAvailability: document.getElementById('saveAvailability'), confirmDialog: document.getElementById('confirmDialog'), confirmTitle: document.getElementById('confirmTitle'), confirmText: document.getElementById('confirmText'), toastRegion: document.getElementById('toastRegion'),
    eventsSummary: document.getElementById('eventsSummary'), addEvent: document.getElementById('addEvent'), eventsList: document.getElementById('eventsList'),
    eventDialog: document.getElementById('eventDialog'), eventForm: document.getElementById('eventForm'), eventDialogTitle: document.getElementById('eventDialogTitle'), eventId: document.getElementById('eventId'), eventTitle: document.getElementById('eventTitle'), eventStart: document.getElementById('eventStart'), eventEnd: document.getElementById('eventEnd'), eventLocation: document.getElementById('eventLocation'), eventDescription: document.getElementById('eventDescription'), eventImageUrl: document.getElementById('eventImageUrl'), eventImageFile: document.getElementById('eventImageFile'), eventImagePreview: document.getElementById('eventImagePreview'), eventImagePreviewImg: document.getElementById('eventImagePreviewImg'), eventImageClear: document.getElementById('eventImageClear'), eventImageHint: document.getElementById('eventImageHint'), eventImagePathValue: document.getElementById('eventImagePathValue'), saveEvent: document.getElementById('saveEvent'),
    eventDetailDialog: document.getElementById('eventDetailDialog'), eventDetailTitle: document.getElementById('eventDetailTitle'), eventDetailAuthor: document.getElementById('eventDetailAuthor'), eventDetailImage: document.getElementById('eventDetailImage'), eventDetailMeta: document.getElementById('eventDetailMeta'), eventDetailDescription: document.getElementById('eventDetailDescription'), eventDetailClose: document.getElementById('eventDetailClose'), eventSlotList: document.getElementById('eventSlotList'), eventSlotAddRow: document.getElementById('eventSlotAddRow'), eventSlotInput: document.getElementById('eventSlotInput'), eventSlotAdd: document.getElementById('eventSlotAdd'), eventEditButton: document.getElementById('eventEditButton'), eventDeleteButton: document.getElementById('eventDeleteButton'),
  });
}

async function initialize() {
  collectElements();
  bindEvents();
  const today = new Date();
  elements.loginDate.textContent = dateFormat.format(today);
  elements.ledgerDate.textContent = shortDateFormat.format(today);
  elements.todayLabel.textContent = `En direct · ${dateFormat.format(today)}`;

  const authError = new URLSearchParams(window.location.search).get('auth_error');
  if (authError) {
    elements.authError.hidden = false;
    elements.authError.textContent = authError === 'invalid_callback'
      ? 'La réponse de connexion n’a pas pu être vérifiée. Relance la connexion.'
      : 'Kyros ne répond pas pour le moment. Tu peux réessayer dans un instant.';
    window.history.replaceState({}, '', '/');
  }

  try {
    const session = await api('/api/session', {}, false);
    showApp(session.user);
    await Promise.all([loadAvailability(), loadMessages(), loadEvents()]);
    connectRealtime();
  } catch {
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', initialize);
