/* MusafirMate — front-end */

const appEl = document.getElementById('app');
const navEl = document.getElementById('nav');
const toastEl = document.getElementById('toast');

const SUPPORT_EMAIL = 'hello@musafirmate.com';
const VIBES = ['Backpacking', 'Budget', 'Foodie', 'Trekking', 'Road trip', 'Luxury', 'Culture', 'Beach'];

const VIBE_META = {
  'Backpacking': { emoji: '🎒', cover: 'cover-1' },
  'Budget': { emoji: '💸', cover: 'cover-2' },
  'Foodie': { emoji: '🍜', cover: 'cover-3' },
  'Trekking': { emoji: '🥾', cover: 'cover-4' },
  'Road trip': { emoji: '🚗', cover: 'cover-5' },
  'Luxury': { emoji: '✨', cover: 'cover-6' },
  'Culture': { emoji: '🏛️', cover: 'cover-7' },
  'Beach': { emoji: '🏖️', cover: 'cover-8' },
};

const POPULAR_DESTS = [
  { name: 'Agra', sub: 'Taj Mahal', photo: 'photo-1564507592333-c60657eea523' },
  { name: 'Goa', sub: 'Beaches & cafés', photo: 'photo-1512343879784-a960bf40e7f2' },
  { name: 'Kerala', sub: 'Backwaters', photo: 'photo-1602216056096-3b40cc0c9944' },
  { name: 'Ladakh', sub: 'High passes', photo: 'photo-1589308078059-be1415eab4c3' },
  { name: 'Jaipur', sub: 'Pink City', photo: 'photo-1599661046289-e31897846e41' },
  { name: 'Varanasi', sub: 'Ghats & ritual', photo: 'photo-1561361513-2d000a50f0dc' },
];

const state = { me: null };
let chatTimer = null;
let toastTimer = null;

/* ---------------- utils ---------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function hashQuery() {
  const raw = location.hash.slice(1) || '';
  const i = raw.indexOf('?');
  return new URLSearchParams(i === -1 ? '' : raw.slice(i + 1));
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return esc(d);
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const fmtRange = (a, b) => `${fmtDate(a)} → ${fmtDate(b)}`;

function memberSince(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function tripStatus(t) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(t.startDate + 'T00:00:00');
  const end = new Date(t.endDate + 'T00:00:00');
  if (end < today) return { label: 'Completed' };
  if (start <= today) return { label: 'Happening now' };
  const days = Math.round((start - today) / 86400000);
  return { label: days === 0 ? 'Starts today' : `Starts in ${days} day${days === 1 ? '' : 's'}` };
}

const spotsLeft = t => Math.max(0, t.maxMates - (t.memberCount - 1));
const vibeMeta = v => VIBE_META[v] || { emoji: '🧭', cover: 'cover-1' };

function avatar(user, size = 'md') {
  if (!user || (!user.avatar && !user.name)) return `<span class="avatar ${size} av-0">?</span>`;
  if (user.avatar) return `<span class="avatar ${size}"><img src="${esc(user.avatar)}" alt=""></span>`;
  const initials = user.name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const h = [...user.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  return `<span class="avatar ${size} av-${h}">${esc(initials)}</span>`;
}

function trustBadge(u, cls = '') {
  if (!u) return '';
  const level = (u.trustLevel || 'New').toLowerCase();
  const icons = { new: '🌱', verified: '✅', trusted: '⭐', elite: '🏆' };
  return `<span class="trust trust-${level} ${cls}">${icons[level] || '⭐'} ${u.trustScore || 0}/100</span>`;
}

function gmailLink(email, subject, body) {
  const p = new URLSearchParams({ view: 'cm', fs: '1', to: email, su: subject, body });
  return `https://mail.google.com/mail/?${p.toString()}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('Copied');
  }
}

async function shareTrip(t) {
  const url = `${location.origin}${location.pathname}#/trips/${t.id}`;
  if (navigator.share) {
    try { await navigator.share({ title: `Trip to ${t.destination} · MusafirMate`, url }); return; } catch (_) { }
  }
  copyText(url);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function contactBody(t, kind) {
  const me = state.me ? state.me.name : 'A traveller';
  return `Hi,\n\n${me} here — I found your trip to ${t.destination} (${fmtRange(t.startDate, t.endDate)}) on MusafirMate and would love to ${kind === 'host' ? 'join and coordinate plans' : 'plan the trip together'}.\n\nDates: ${fmtRange(t.startDate, t.endDate)}\nVibe: ${t.vibe}\n\nLet me know!\n${me}\n\n— sent from MusafirMate`;
}

function openLightbox(src) {
  const d = document.createElement('div');
  d.className = 'lightbox';
  d.innerHTML = `<img src="${esc(src)}" alt="">`;
  d.onclick = () => d.remove();
  document.body.appendChild(d);
}

/* ---------------- shell ---------------- */

async function refreshMe() {
  try { state.me = (await api('/me')).user; } catch (_) { state.me = null; }
}

function renderNav() {
  if (state.me) {
    const first = state.me.name.split(/\s+/)[0];
    navEl.innerHTML = `
      <a class="nav-link" href="#/trips">Explore</a>
      <a class="nav-link" href="#/new">Post a trip</a>
      <a class="nav-link" href="#/requests">Requests</a>
      <a class="nav-link" href="#/profile">${avatar(state.me, 'xs')} ${esc(first)}</a>
      <a class="nav-link" href="#/logout">Log out</a>`;
  } else {
    navEl.innerHTML = `
      <a class="nav-link" href="#/trips">Explore</a>
      <a class="nav-link" href="#/login">Log in</a>
      <a class="btn sm" href="#/signup">Sign up free</a>`;
  }
}

async function route() {
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  await refreshMe();
  renderNav();

  const raw = location.hash.slice(1) || '/';
  const parts = raw.split('?')[0].split('/').filter(Boolean);
  const section = parts[0] || 'home';
  const param = parts[1];

  window.scrollTo({ top: 0 });
  try {
    if (section === 'home') return await renderLanding();
    if (section === 'trips' && param) return await renderTrip(param);
    if (section === 'trips') return await renderTrips();
    if (section === 'new') return await renderNew();
    if (section === 'requests') return await renderRequests();
    if (section === 'profile') return await renderProfile();
    if (section === 'login') return renderAuth('login');
    if (section === 'signup') return renderAuth('signup');
    if (section === 'logout') {
      await api('/auth/logout', { method: 'POST' });
      state.me = null;
      toast('Logged out');
      return go('#/trips');
    }
    go('#/');
  } catch (e) {
    appEl.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p class="error">${esc(e.message)}</p></div>`;
  }
}

/* ---------------- landing ---------------- */

async function renderLanding() {
  const popularHTML = POPULAR_DESTS.map(d => `
    <a class="dest-card" href="#/trips?q=${encodeURIComponent(d.name)}"
       style="background-image:url('https://images.unsplash.com/${d.photo}?auto=format&fit=crop&w=600&q=70')">
      <span class="dest-label">${esc(d.name)}<small>${esc(d.sub)}</small></span>
    </a>`).join('');

  appEl.innerHTML = `
    <section class="hero">
      <div class="hero-inner">
        <span class="hero-badge">✈️ Find your travel mate</span>
        <h1>Travel together.<br><span class="grad">Come back with stories.</span></h1>
        <p class="hero-sub">Post your trip, match with travellers heading your way, plan it over chat — and come home with mates for life.</p>
        <div class="actions">
          <a class="btn lg" href="#/trips">Explore trips</a>
          <a class="btn ghost lg" href="#/new">Post your trip</a>
        </div>

        <form id="search-widget" class="search-widget">
          <input name="q" placeholder="Where to? Try “Spiti” or “Goa”" />
          <select name="vibe">
            <option value="">Any vibe</option>
            ${VIBES.map(v => `<option value="${v}">${VIBE_META[v].emoji} ${v}</option>`).join('')}
          </select>
          <button class="btn accent" type="submit">Search</button>
        </form>

        <div class="stats" id="stats"></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Popular destinations</h2><a class="link" href="#/trips">See all trips →</a></div>
      <div class="grid dests">${popularHTML}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Browse by vibe</h2></div>
      <div class="chips">
        ${VIBES.map(v => `<a class="chip" href="#/trips?vibe=${encodeURIComponent(v)}">${VIBE_META[v].emoji} ${v}</a>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Fresh trips</h2><a class="link" href="#/trips">See all →</a></div>
      <div id="featured" class="grid trips"><p class="muted">Loading…</p></div>
    </section>

    <section class="section">
      <h2>How MusafirMate works</h2>
      <div class="steps" style="margin-top:14px">
        <div class="step"><span class="step-no">1</span><h3>Post your trip</h3><p>Destination, dates, budget and the kind of trip you want.</p></div>
        <div class="step"><span class="step-no">2</span><h3>Get mate requests</h3><p>Travellers heading your way ask to join. You accept the ones who fit.</p></div>
        <div class="step"><span class="step-no">3</span><h3>Plan & go</h3><p>Chat in the group, then travel together. Share a feedback story after.</p></div>
      </div>
    </section>

    <section class="cta-band">
      <div>
        <h2>Your next trip is better with a mate.</h2>
        <p class="muted">Free to join. Post a trip in under a minute.</p>
      </div>
      <div class="actions">
        <a class="btn lg" href="#/signup">Create free account</a>
        <a class="btn ghost lg" href="mailto:${SUPPORT_EMAIL}?subject=Hi%20MusafirMate">Talk to us</a>
      </div>
    </section>`;

  document.getElementById('search-widget').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const params = new URLSearchParams();
    if (f.get('q')) params.set('q', f.get('q'));
    if (f.get('vibe')) params.set('vibe', f.get('vibe'));
    go('#/trips?' + params.toString());
  });

  try {
    const s = await api('/stats');
    document.getElementById('stats').innerHTML = [
      [s.travelers, 'travellers'],
      [s.trips, 'trips posted'],
      [s.destinations, 'destinations'],
      [s.mates, 'mates matched'],
    ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
  } catch (_) { }

  try {
    const trips = await api('/trips');
    const box = document.getElementById('featured');
    box.innerHTML = trips.length
      ? trips.slice(0, 3).map(tripCard).join('')
      : `<div class="empty"><p class="muted">No trips posted yet — be the first.</p><a class="btn" href="#/new">Post a trip</a></div>`;
  } catch (_) { }
}

/* ---------------- explore ---------------- */

function tripCard(t) {
  const meta = vibeMeta(t.vibe);
  const st = tripStatus(t);
  const spots = spotsLeft(t);
  const owner = t.owner;
  return `
    <a class="card trip" href="#/trips/${t.id}">
      <div class="trip-cover ${meta.cover}">
        <span class="pill glass top">${esc(st.label)}</span>
        <span class="pill glass right">${esc(t.vibe)}</span>
        <span class="trip-emoji">${meta.emoji}</span>
      </div>
      <div class="trip-body">
        <h3>${esc(t.destination)}</h3>
        <p class="route">${esc(t.from || 'Anywhere')} <span class="arrow">→</span> ${esc(t.destination)}</p>
        <p class="dates">📅 ${fmtRange(t.startDate, t.endDate)}</p>
        <div class="trip-foot">
          <span class="host">${avatar(owner, 'xs')} ${esc(owner ? owner.name : '—')} ${trustBadge(owner)}</span>
        </div>
        <div class="trip-foot">
          <span class="spots ${spots <= 1 ? 'warn' : ''}">👥 ${spots} spot${spots === 1 ? '' : 's'} left</span>
          <span>💰 ${esc(t.budget || 'Flexible')}</span>
          ${t.avgRating ? `<span style="color:var(--accent-dark);font-weight:700">★ ${t.avgRating}</span>` : ''}
        </div>
      </div>
    </a>`;
}

async function renderTrips() {
  const q0 = hashQuery();
  const activeVibe = q0.get('vibe') || '';
  appEl.innerHTML = `
    <div class="page-head">
      <div><h1>Explore trips</h1><p class="muted">Find a trip that matches your dates and vibe.</p></div>
      <a class="btn" href="#/new">+ Post a trip</a>
    </div>
    <form id="filters" class="filters card">
      <input name="q" placeholder="Search destination or city…" value="${esc(q0.get('q') || '')}" />
      <button class="btn" type="submit">Search</button>
    </form>
    <div class="chips" style="margin-bottom:16px">
      <a class="chip ${!activeVibe ? 'active' : ''}" href="#/trips${q0.get('q') ? '?q=' + encodeURIComponent(q0.get('q')) : ''}">All vibes</a>
      ${VIBES.map(v => {
    const p = new URLSearchParams();
    if (q0.get('q')) p.set('q', q0.get('q'));
    p.set('vibe', v);
    return `<a class="chip ${activeVibe === v ? 'active' : ''}" href="#/trips?${p.toString()}">${VIBE_META[v].emoji} ${v}</a>`;
  }).join('')}
    </div>
    <div id="trip-list" class="grid trips"><p class="muted">Loading…</p></div>`;

  const load = async (q = '', vibe = '') => {
    const list = document.getElementById('trip-list');
    list.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const trips = await api(`/trips?q=${encodeURIComponent(q)}&vibe=${encodeURIComponent(vibe)}`);
      list.innerHTML = trips.length
        ? trips.map(tripCard).join('')
        : `<div class="empty"><p class="muted">No trips match that search.</p><a class="btn ghost" href="#/new">Post the first one</a></div>`;
    } catch (e) {
      list.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  };

  document.getElementById('filters').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const p = new URLSearchParams();
    if (f.get('q')) p.set('q', f.get('q'));
    if (activeVibe) p.set('vibe', activeVibe);
    go('#/trips' + (p.toString() ? '?' + p.toString() : ''));
  });

  load(q0.get('q') || '', activeVibe);
}

/* ---------------- trip detail ---------------- */

async function renderTrip(tripId) {
  const t = await api(`/trips/${tripId}`);
  const meta = vibeMeta(t.vibe);
  const st = tripStatus(t);
  const spots = spotsLeft(t);
  const contacts = t.contacts || {};
  const ownerEmail = contacts[t.ownerId];

  let action = '';
  if (!state.me) action = `<a class="btn" href="#/login">Log in to request</a>`;
  else if (t.isOwner) action = `<a class="btn ghost" href="#/requests">Manage requests</a>`;
  else if (t.myRequest === 'accepted') action = `<span class="pill ok big">✅ You're in</span>`;
  else if (t.myRequest === 'pending') action = `<span class="pill big">⏳ Request pending</span>`;
  else if (spots <= 0) action = `<span class="pill warn big">Trip is full</span>`;
  else action = `<button class="btn" id="req-btn">Request to join</button>`;

  const contactHost = (t.canChat && !t.isOwner && ownerEmail) ? `
    <a class="btn ghost" target="_blank" rel="noopener"
       href="${gmailLink(ownerEmail, `MusafirMate · Trip to ${t.destination}`, contactBody(t, 'host'))}">✉️ Email host via Gmail</a>
    <button class="btn ghost" data-copy="${esc(ownerEmail)}">Copy email</button>` : '';

  const safetyList = Object.entries(t.safetyContacts || {});

  const feedbackHTML = t.feedback && t.feedback.length ? `
    <section class="card">
      <div class="section-head"><h3 style="margin:0">Traveller feedback (${t.feedback.length})</h3></div>
      <div class="fb-grid">
        ${t.feedback.map(f => `
          <div class="fb-card">
            <div class="fb-head">
              ${avatar(f.user, 'sm')}
              <div class="person">
                <strong>${esc(f.user ? f.user.name : '—')}</strong>
                <span class="fb-stars">${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}</span>
              </div>
            </div>
            <p style="margin:0;font-size:.9rem;color:var(--text-muted)">${esc(f.text)}</p>
            ${f.photos && f.photos.length ? `
              <div class="fb-photos">
                ${f.photos.map(p => `<img src="${esc(p)}" alt="" onclick="event.preventDefault();window.__lb && window.__lb('${esc(p).replace(/'/g, "\\'")}')">`).join('')}
              </div>` : ''}
          </div>`).join('')}
      </div>
    </section>` : '';

  const feedbackForm = (t.isCompleted && t.canChat && !t.myFeedback) ? `
    <section class="card tint">
      <h3>How did it feel? Share your trip story</h3>
      <p class="muted small">Photos and honest words help other musafirs decide who to travel with.</p>
      <form id="feedback-form">
        <label>Rating</label>
        <div class="star-input" id="star-input" data-value="0">
          ${[1, 2, 3, 4, 5].map(i => `<span data-i="${i}">★</span>`).join('')}
        </div>
        <label>Your experience</label>
        <textarea name="text" placeholder="What was the highlight? Who did you travel with? Anything to note for next time?"></textarea>
        <label>Photos (up to 4)</label>
        <div class="photo-slots" id="photo-slots">
          ${[0, 1, 2, 3].map(i => `<label class="photo-slot" data-slot="${i}">+<input type="file" accept="image/*" hidden></label>`).join('')}
        </div>
        <div class="actions"><button class="btn" type="submit">Post feedback</button></div>
      </form>
    </section>` : '';

  const alreadyFeedbackMsg = (t.isCompleted && t.canChat && t.myFeedback) ?
    `<section class="card tint"><p class="muted" style="margin:0">✅ Thanks — you've already shared feedback for this trip.</p></section>` : '';

  appEl.innerHTML = `
    <a class="link" href="#/trips">← All trips</a>
    <section class="card" style="margin-top:14px;padding:0;overflow:hidden">
      <div class="trip-cover tall ${meta.cover}">
        <span class="pill glass top">${esc(st.label)}</span>
        <span class="pill glass right">${esc(t.vibe)}</span>
        <span class="trip-emoji big">${meta.emoji}</span>
      </div>
      <div class="trip-body">
        <h1>${esc(t.destination)}</h1>
        <p class="route">${esc(t.from || 'Anywhere')} <span class="arrow">→</span> ${esc(t.destination)}</p>
        <div class="factrow">
          <span>📅 ${fmtRange(t.startDate, t.endDate)}</span>
          <span>💰 ${esc(t.budget || 'Flexible')}</span>
          <span>👥 ${t.memberCount} of ${t.maxMates + 1}</span>
          <span class="${spots <= 1 ? 'warn' : 'spots'}">🎟️ ${spots} spot${spots === 1 ? '' : 's'} left</span>
        </div>
        <p class="desc">${esc(t.description) || '<span class="muted">No description added.</span>'}</p>
        <div class="actions">
          ${action}
          <button class="btn ghost" id="share-btn">🔗 Share trip</button>
          ${contactHost}
        </div>
      </div>
    </section>

    <section class="card">
      <h3>Travellers</h3>
      <ul class="people">
        <li>
          ${avatar(t.owner, 'md')}
          <div class="person">
            <strong>${esc(t.owner ? t.owner.name : '—')} <span class="pill ok tiny">Host</span> ${trustBadge(t.owner)}</strong>
            <span class="muted small">${esc(t.owner && t.owner.city || '—')} · Member since ${memberSince(t.owner && t.owner.memberSince)} · ${t.owner ? t.owner.tripsHosted : 0} trips hosted</span>
          </div>
          ${state.me && state.me.id !== t.ownerId ? `<button class="btn ghost sm" data-report="${t.ownerId}">🚩 Report</button>` : ''}
        </li>
        ${t.members.map(m => `
          <li>
            ${avatar(m, 'md')}
            <div class="person">
              <strong>${esc(m.name)} ${trustBadge(m)}</strong>
              <span class="muted small">${esc(m.city || '—')} · ${m.tripsHosted} trips hosted</span>
            </div>
            ${t.canChat && contacts[m.id] ? `
              <a class="btn ghost sm" target="_blank" rel="noopener"
                 href="${gmailLink(contacts[m.id], `MusafirMate · Trip to ${t.destination}`, contactBody(t, 'mate'))}">✉️ Gmail</a>` : ''}
            ${state.me && state.me.id !== m.id ? `<button class="btn ghost sm" data-report="${m.id}">🚩</button>` : ''}
          </li>`).join('')}
      </ul>
    </section>

    ${t.canChat ? `
      <section class="card safety-card">
        <h4>🛡️ Travel safely</h4>
        <ul>
          <li>Meet your mate in a public place before the trip.</li>
          <li>Share your itinerary and host's contact with someone at home.</li>
          <li>Only use the in-app chat until you feel comfortable — don't share personal IDs or OTPs.</li>
          <li>If something feels off, report it using the 🚩 button above.</li>
        </ul>
        ${safetyList.length ? `
          <div class="contact">
            <strong>Emergency contacts on this trip</strong><br>
            ${safetyList.map(([n, c]) => `${esc(n)}: <strong>${esc(c)}</strong>`).join(' · ')}
          </div>` : '<div class="contact">No emergency contacts shared on this trip yet.</div>'}
      </section>` : ''}

    ${feedbackHTML}
    ${feedbackForm}
    ${alreadyFeedbackMsg}

    ${t.canChat && !t.isCompleted ? `
      <section class="card">
        <h3>Trip chat</h3>
        <div id="msgs" class="msgs"></div>
        <form id="msg-form" class="row">
          <input name="text" placeholder="Say something to the group…" autocomplete="off" />
          <button class="btn" type="submit">Send</button>
        </form>
      </section>` : ''}`;

  /* hookups */
  window.__lb = openLightbox;

  const reqBtn = document.getElementById('req-btn');
  if (reqBtn) {
    reqBtn.addEventListener('click', async () => {
      try {
        await api(`/trips/${t.id}/requests`, { method: 'POST' });
        toast('Request sent!');
        route();
      } catch (e) { toast(e.message); }
    });
  }

  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) shareBtn.addEventListener('click', () => shareTrip(t));

  appEl.querySelectorAll('[data-copy]').forEach(b =>
    b.addEventListener('click', () => copyText(b.dataset.copy)));

  appEl.querySelectorAll('[data-report]').forEach(b => {
    b.addEventListener('click', async () => {
      const reason = prompt('Why are you reporting this user? (we keep it private)');
      if (!reason) return;
      try {
        await api(`/users/${b.dataset.report}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
        toast('Report sent — thank you');
      } catch (e) { toast(e.message); }
    });
  });

  /* feedback form */
  const fbForm = document.getElementById('feedback-form');
  if (fbForm) {
    const starInput = document.getElementById('star-input');
    let rating = 0;
    starInput.querySelectorAll('span').forEach(s => {
      s.addEventListener('click', () => {
        rating = Number(s.dataset.i);
        starInput.querySelectorAll('span').forEach(x => x.classList.toggle('on', Number(x.dataset.i) <= rating));
      });
      s.addEventListener('mouseover', () => {
        starInput.querySelectorAll('span').forEach(x => x.classList.toggle('on', Number(x.dataset.i) <= Number(s.dataset.i)));
      });
    });
    starInput.addEventListener('mouseleave', () => {
      starInput.querySelectorAll('span').forEach(x => x.classList.toggle('on', Number(x.dataset.i) <= rating));
    });

    const photos = [null, null, null, null];
    document.querySelectorAll('#photo-slots .photo-slot').forEach(slot => {
      const i = Number(slot.dataset.slot);
      const input = slot.querySelector('input');
      slot.addEventListener('click', e => {
        if (e.target.tagName !== 'INPUT') { e.preventDefault(); input.click(); }
      });
      input.addEventListener('change', async () => {
        const f = input.files[0];
        if (!f) return;
        if (f.size > 3_000_000) { toast('Photo must be under 3 MB'); return; }
        photos[i] = await readFileAsDataURL(f);
        slot.classList.add('filled');
        slot.innerHTML = `<img src="${esc(photos[i])}" alt=""><input type="file" accept="image/*" hidden>`;
      });
    });

    fbForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!rating) { toast('Pick a rating first'); return; }
      const text = fbForm.querySelector('textarea').value.trim();
      if (!text) { toast('Tell us how it felt'); return; }
      const btn = fbForm.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Posting…';
      try {
        await api(`/trips/${t.id}/feedback`, {
          method: 'POST',
          body: JSON.stringify({ rating, text, photos: photos.filter(Boolean) }),
        });
        toast('Feedback posted — thanks!');
        route();
      } catch (err) {
        toast(err.message);
        btn.disabled = false; btn.textContent = 'Post feedback';
      }
    });
  }

  /* chat */
  if (t.canChat && !t.isCompleted) {
    const loadMessages = async () => {
      const box = document.getElementById('msgs');
      if (!box) return;
      const msgs = await api(`/trips/${t.id}/messages`).catch(() => []);
      box.innerHTML = msgs.length
        ? msgs.map(m => `
            <div class="msg ${state.me && m.userId === state.me.id ? 'me' : ''}">
              <span class="who">${esc(m.user ? m.user.name : 'Traveller')}</span>
              <span>${esc(m.text)}</span>
              <span class="when">${new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>`).join('')
        : '<p class="muted small">No messages yet — say hi 👋</p>';
      box.scrollTop = box.scrollHeight;
    };

    loadMessages();
    chatTimer = setInterval(loadMessages, 4000);

    document.getElementById('msg-form').addEventListener('submit', async e => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        await api(`/trips/${t.id}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
        loadMessages();
      } catch (err) { toast(err.message); }
    });
  }
}

/* ---------------- post a trip ---------------- */

async function renderNew() {
  if (!state.me) return go('#/login');

  appEl.innerHTML = `
    <div class="page-head"><div><h1>Post a trip</h1><p class="muted">Tell travellers where you're going and who you'd like along.</p></div></div>
    <form id="trip-form" class="card">
      <div class="row">
        <div><label>From</label><input name="from" placeholder="Mumbai" /></div>
        <div><label>Destination *</label><input name="destination" placeholder="Spiti Valley" required /></div>
      </div>
      <div class="row">
        <div><label>Start date *</label><input type="date" name="startDate" required /></div>
        <div><label>End date *</label><input type="date" name="endDate" required /></div>
      </div>
      <div class="row">
        <div><label>Budget</label><input name="budget" placeholder="₹15,000" /></div>
        <div><label>Vibe</label><select name="vibe">${VIBES.map(v => `<option value="${v}">${v}</option>`).join('')}</select></div>
        <div><label>Max mates</label><input type="number" name="maxMates" min="1" max="10" value="3" /></div>
      </div>
      <label>Description</label>
      <textarea name="description" placeholder="Plan, pace, what you're looking for in a mate…"></textarea>
      <div class="actions"><button class="btn" type="submit">Post trip</button></div>
    </form>`;

  document.getElementById('trip-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const trip = await api('/trips', { method: 'POST', body: JSON.stringify(body) });
      toast('Trip posted!');
      go(`#/trips/${trip.id}`);
    } catch (err) { toast(err.message); }
  });
}

/* ---------------- requests ---------------- */

async function renderRequests() {
  if (!state.me) return go('#/login');
  const { incoming, outgoing } = await api('/requests');

  appEl.innerHTML = `
    <div class="page-head"><div><h1>Mate requests</h1><p class="muted">Accept the travellers you'd like to go with.</p></div></div>

    <section class="card">
      <h3>Requests to join your trips</h3>
      ${incoming.length ? incoming.map(r => `
        <div class="req">
          <div class="req-left">
            ${avatar(r.user, 'md')}
            <div class="person">
              <strong>${esc(r.user ? r.user.name : '—')} ${trustBadge(r.user)}</strong>
              <span class="muted small">wants to join <a class="link" href="#/trips/${r.trip ? r.trip.id : ''}">${esc(r.trip ? r.trip.destination : 'trip')}</a></span>
            </div>
          </div>
          <div class="req-actions">
            ${r.status === 'pending'
      ? `<button class="btn sm" data-accept="${r.id}">Accept</button>
                 <button class="btn ghost sm" data-decline="${r.id}">Decline</button>`
      : `<span class="pill ${r.status === 'accepted' ? 'ok' : ''}">${r.status}</span>`}
            ${r.user && r.user.email
      ? `<a class="btn ghost sm" target="_blank" rel="noopener"
                    href="${gmailLink(r.user.email, `MusafirMate · ${r.trip ? r.trip.destination : 'Trip'}`, `Hi ${esc(r.user.name)},\n\nThanks for asking to join ${r.trip ? r.trip.destination : 'my trip'} on MusafirMate.\n\n${state.me.name}`)}">✉️ Gmail</a>` : ''}
          </div>
        </div>`).join('') : '<p class="muted">No requests yet. Share your trip link to get some.</p>'}
    </section>

    <section class="card">
      <h3>Requests you sent</h3>
      ${outgoing.length ? outgoing.map(r => `
        <div class="req">
          <div class="req-left">
            ${avatar(r.trip ? r.trip.owner : null, 'md')}
            <div class="person">
              <a class="link" href="#/trips/${r.trip ? r.trip.id : ''}">${esc(r.trip ? r.trip.destination : 'Trip')}</a>
              <span class="muted small">hosted by ${esc(r.trip && r.trip.owner ? r.trip.owner.name : '—')}</span>
            </div>
          </div>
          <span class="pill ${r.status === 'accepted' ? 'ok' : ''}">${r.status}</span>
        </div>`).join('') : `<p class="muted">You haven't sent any requests yet. <a class="link" href="#/trips">Find a trip →</a></p>`}
    </section>`;

  appEl.querySelectorAll('[data-accept]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/requests/${btn.dataset.accept}/accept`, { method: 'POST' });
        toast('Accepted');
        route();
      } catch (e) { toast(e.message); }
    });
  });

  appEl.querySelectorAll('[data-decline]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/requests/${btn.dataset.decline}/decline`, { method: 'POST' });
        toast('Declined');
        route();
      } catch (e) { toast(e.message); }
    });
  });
}

/* ---------------- profile ---------------- */

async function renderProfile() {
  if (!state.me) return go('#/login');
  const me = state.me;
  const myTrips = await api('/trips?mine=1');
  const level = (me.trustLevel || 'New').toLowerCase();

  appEl.innerHTML = `
    <div class="card profile-head">
        <div class="avatar-upload">
        ${avatar(me, 'xl')}
        <button class="avatar-edit-btn" id="avatar-btn" title="Change photo">📷</button>
        ${me.avatar ? `<button class="avatar-remove-btn" id="avatar-remove-btn" title="Remove photo">✕</button>` : ''}
        <input type="file" accept="image/*" id="avatar-input" hidden>
      </div>
      <div style="flex:1">
        <h1 style="margin:0">${esc(me.name)}</h1>
        <p class="muted small" style="margin:4px 0 6px">${esc(me.city || 'Add your city')} · Member since ${memberSince(me.memberSince)}</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${trustBadge(me, 'big')}
          <span class="pill">🏠 ${me.tripsHosted} trips hosted</span>
        </div>
      </div>
    </div>

    <section class="card tint">
      <h4>🏆 Trust score breakdown</h4>
      <p class="muted small" style="margin-bottom:12px">Complete your profile and finish trips to climb the ranks.</p>
      <div class="row" style="flex-wrap:wrap;gap:16px">
        <div style="flex:1 1 180px"><strong>${level === 'elite' ? '🏆 Elite' : level === 'trusted' ? '⭐ Trusted' : level === 'verified' ? '✅ Verified' : '🌱 New'}</strong><br><span class="muted small">Level</span></div>
        <div style="flex:1 1 180px"><strong>${me.trustScore}/100</strong><br><span class="muted small">Score</span></div>
        <div style="flex:1 1 180px"><strong>${me.avatar ? '✅' : '—'} Profile photo</strong><br><span class="muted small">+15 pts</span></div>
        <div style="flex:1 1 180px"><strong>${me.city ? '✅' : '—'} City</strong><br><span class="muted small">+10 pts</span></div>
        <div style="flex:1 1 180px"><strong>${me.bio ? '✅' : '—'} Bio</strong><br><span class="muted small">+10 pts</span></div>
      </div>
    </section>

    <form id="profile-form" class="card">
      <h3>Edit profile</h3>
      <div class="row">
        <div><label>Name</label><input name="name" value="${esc(me.name)}" /></div>
        <div><label>City</label><input name="city" value="${esc(me.city || '')}" placeholder="Pune" /></div>
      </div>
      <label>Email</label>
      <input value="${esc(me.email)}" disabled />
      <div class="row">
        <div><label>Languages</label><input name="languages" value="${esc(me.languages || '')}" placeholder="Hindi, English" /></div>
        <div><label>Travel style</label><input name="style" value="${esc(me.style || '')}" placeholder="Slow travel, hostels" /></div>
      </div>
      <label>Bio</label>
      <textarea name="bio" placeholder="A line or two about how you travel">${esc(me.bio || '')}</textarea>
      <label>Emergency contact (shared only with trip mates)</label>
      <input name="emergencyContact" value="${esc(me.emergencyContact || '')}" placeholder="+91 98765 43210 · a parent or friend" />
      <div class="actions"><button class="btn" type="submit">Save changes</button></div>
    </form>

    <section class="card">
      <h3>Your trips</h3>
      ${myTrips.length ? myTrips.map(t => `
        <div class="req">
          <div class="req-left">
            <div class="person">
              <a class="link" href="#/trips/${t.id}">${esc(t.destination)}</a>
              <span class="muted small">${fmtRange(t.startDate, t.endDate)} · ${t.memberCount} of ${t.maxMates + 1}</span>
            </div>
          </div>
          <span class="pill ${t.isCompleted ? '' : 'ok'}">${esc(tripStatus(t).label)}</span>
        </div>`).join('') : '<p class="muted">No trips yet. <a class="link" href="#/new">Post one →</a></p>'}
    </section>`;

  /* avatar upload */
  const btn = document.getElementById('avatar-btn');
  const input = document.getElementById('avatar-input');
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    if (f.size > 3_000_000) { toast('Photo must be under 3 MB'); return; }
    btn.textContent = '…';
    try {
      const dataUrl = await readFileAsDataURL(f);
      const d = await api('/me/avatar', { method: 'POST', body: JSON.stringify({ dataUrl }) });
      state.me = d.user;
      toast('Profile photo updated');
      route();
    } catch (e) {
      toast(e.message);
      btn.textContent = '📷';
    }
  });
   const removeBtn = document.getElementById('avatar-remove-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      if (!confirm('Remove your profile photo?')) return;
      try {
        const d = await api('/me/avatar', { method: 'DELETE' });
        state.me = d.user;
        toast('Photo removed');
        route();
      } catch (e) { toast(e.message); }
    });
  }
  document.getElementById('profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const d = await api('/me', { method: 'PATCH', body: JSON.stringify(body) });
      state.me = d.user;
      toast('Profile saved');
      route();
    } catch (err) { toast(err.message); }
  });
}

/* ---------------- auth ---------------- */

function logoMark(size, gid) {
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0" stop-color="#A7C957" /><stop offset="1" stop-color="#1B5E3B" />
    </linearGradient></defs>
    <rect x="1" y="1" width="46" height="46" rx="13" fill="url(#${gid})" />
    <path d="M12 34c0-7 7-7 10.5-10.5S26 12 33 12" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 5.5" />
        <circle cx="33" cy="15" r="2.4" fill="#E07A5F" />
    <path d="M33 8.5c3.6 0 6.5 2.9 6.5 6.5 0 4.8-6.5 10.5-6.5 10.5S26.5 19.8 26.5 15c0-3.6 2.9-6.5 6.5-6.5z" fill="#fff" />
    <circle cx="33" cy="15" r="2.4" fill="#facc15" />
  </svg>`;
}

function renderAuth(mode) {
  const isSignup = mode === 'signup';
  appEl.innerHTML = `
    <div class="card auth">
      <div class="auth-logo">${logoMark(46, 'lga')}</div>
      <h1>${isSignup ? 'Join MusafirMate' : 'Welcome back'}</h1>
      <p class="muted">${isSignup ? 'Create a free account and post your first trip.' : 'Log in to manage your trips and mates.'}</p>
      <form id="auth-form">
        ${isSignup ? `
          <label>Full name</label>
          <input name="name" placeholder="Aarav Sharma" required />
          <label>City</label>
          <input name="city" placeholder="Pune" />` : ''}
        <label>Email</label>
        <input type="email" name="email" placeholder="you@gmail.com" required />
        <label>Password</label>
        <input type="password" name="password" placeholder="At least 6 characters" required />
        <button class="btn" type="submit">${isSignup ? 'Create account' : 'Log in'}</button>
      </form>
      <p class="muted small">${isSignup ? 'Already have an account?' : 'New here?'} <a class="link" href="#/${isSignup ? 'login' : 'signup'}">${isSignup ? 'Log in' : 'Sign up free'}</a></p>
      <p class="muted small">Need help? <a class="link" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
    </div>`;

  document.getElementById('auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const d = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
      state.me = d.user;
      toast(isSignup ? 'Welcome to MusafirMate!' : 'Logged in');
      go('#/trips');
    } catch (err) { toast(err.message); }
  });
}

/* ---------------- boot ---------------- */

window.addEventListener('hashchange', route);
route();