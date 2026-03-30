/**
 * RENTOPIA — script.js
 * Architecture: Single Namespace Object with modular sub-controllers
 * Pattern: dbManager | stateManager | uiController | eventBus
 *
 * Data Storage Strategy:
 *   - IndexedDB  → Users & Items (structured, large)
 *   - Cookies    → Session token (user_session, max-age 3600)
 *   - localStorage → Lightweight meta (last_login_time)
 */

const Rentopia = {

  /* ─────────────────────────────────────────
     STATE MANAGER — single source of truth
  ───────────────────────────────────────── */
  stateManager: {
    user: null,          // active user object from IndexedDB
    editItemId: null,    // id of item being edited
    rentItemData: null,  // item object for rent flow
    tempAvatarB64: null, // base64 string for pending avatar upload
    tempItemPhotoB64: null, // base64 string for pending item photo

    set(key, value) {
      // Validation before writing to state
      if (key === 'user' && value !== null) {
        if (!value.username || typeof value.username !== 'string') {
          console.warn('[stateManager] Invalid user object, rejecting.');
          return false;
        }
      }
      this[key] = value;
      return true;
    },

    get(key) { return this[key]; },

    clear() {
      this.user = null;
      this.editItemId = null;
      this.rentItemData = null;
      this.tempAvatarB64 = null;
      this.tempItemPhotoB64 = null;
    }
  },

  /* ─────────────────────────────────────────
     DB MANAGER — all IndexedDB operations
  ───────────────────────────────────────── */
  dbManager: {
    db: null,
    DB_NAME: 'RentopiaDB',
    DB_VERSION: 2,

    async init() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);

        req.onupgradeneeded = (e) => {
          const db = e.target.result;

          // Object store: users (keyPath = username)
          if (!db.objectStoreNames.contains('users')) {
            db.createObjectStore('users', { keyPath: 'username' });
          }

          // Object store: items (autoIncrement id)
          if (!db.objectStoreNames.contains('items')) {
            const itemStore = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
            itemStore.createIndex('by_owner', 'owner', { unique: false });
          }

          // Object store: rentals
          if (!db.objectStoreNames.contains('rentals')) {
            const rentalStore = db.createObjectStore('rentals', { keyPath: 'id', autoIncrement: true });
            rentalStore.createIndex('by_renter', 'renter', { unique: false });
          }
        };

        req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
        req.onerror   = (e) => reject(e.target.error);
      });
    },

    // ── Users ──
    async getUser(username) {
      return this._get('users', username);
    },

    async addUser(userData) {
      // Data validation before IndexedDB write
      if (!userData.username || !userData.password) throw new Error('Data user tidak lengkap');
      if (userData.password.length < 6) throw new Error('Password minimal 6 karakter');
      return this._add('users', userData);
    },

    async updateUser(userData) {
      if (!userData.username) throw new Error('Username wajib ada');
      return this._put('users', userData);
    },

    // ── Items ──
    async getAllItems() {
      return this._getAll('items');
    },

    async getItemsByOwner(owner) {
      return new Promise((resolve, reject) => {
        const tx    = this.db.transaction('items', 'readonly');
        const index = tx.objectStore('items').index('by_owner');
        const req   = index.getAll(owner);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    },

    async addItem(itemData) {
      // Validation before IndexedDB write
      if (!itemData.title || !itemData.title.trim()) throw new Error('Nama barang wajib diisi');
      if (isNaN(itemData.price) || itemData.price < 0) throw new Error('Harga tidak valid');
      return this._add('items', itemData);
    },

    async updateItem(itemData) {
      if (!itemData.id) throw new Error('ID item tidak ditemukan');
      return this._put('items', itemData);
    },

    async deleteItem(id) {
      return this._delete('items', id);
    },

    async getItem(id) {
      return this._get('items', id);
    },

    // ── Rentals ──
    async addRental(rentalData) {
      if (!rentalData.itemId || !rentalData.renter) throw new Error('Data sewa tidak lengkap');
      return this._add('rentals', rentalData);
    },

    async getRentalsByRenter(renter) {
      return new Promise((resolve, reject) => {
        const tx    = this.db.transaction('rentals', 'readonly');
        const index = tx.objectStore('rentals').index('by_renter');
        const req   = index.getAll(renter);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    },

    // ── Private helpers ──
    _get(store, key) {
      return new Promise((resolve, reject) => {
        const req = this.db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    },

    _getAll(store) {
      return new Promise((resolve, reject) => {
        const req = this.db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    },

    _add(store, data) {
      return new Promise((resolve, reject) => {
        const req = this.db.transaction(store, 'readwrite').objectStore(store).add(data);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    },

    _put(store, data) {
      return new Promise((resolve, reject) => {
        const req = this.db.transaction(store, 'readwrite').objectStore(store).put(data);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    },

    _delete(store, key) {
      return new Promise((resolve, reject) => {
        const req = this.db.transaction(store, 'readwrite').objectStore(store).delete(key);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
      });
    }
  },

  /* ─────────────────────────────────────────
     UI CONTROLLER — all DOM rendering
  ───────────────────────────────────────── */
  uiController: {

    // ── Cache selectors once (memory opt.) ──
    els: {},

    cacheSelectors() {
      this.els = {
        root:          document.getElementById('app-root'),
        displayName:   document.getElementById('display-name'),
        displayLoc:    document.getElementById('display-location'),
        displayDesc:   document.getElementById('display-desc'),
        avatarInitials:document.getElementById('avatar-initials'),
        avatarImg:     document.getElementById('avatar-img'),
        listingGrid:   document.getElementById('listing-grid'),
        listingEmpty:  document.getElementById('listing-empty'),
        rentGrid:      document.getElementById('rent-grid'),
        rentEmpty:     document.getElementById('rent-empty'),
        browseGrid:    document.getElementById('browse-grid'),
        browseEmpty:   document.getElementById('browse-empty'),
        statListings:  document.getElementById('stat-listings'),
        statOverdue:   document.getElementById('stat-overdue'),
        modalOverlay:  document.getElementById('modal-overlay'),
        modalContent:  document.getElementById('modal-content'),
        toast:         document.getElementById('toast'),
      };
    },

    // ── Page navigation ──
    showPage(id, push = true) {
      document.querySelectorAll('.page-view').forEach(p => {
        p.classList.toggle('hidden', p.id !== id);
      });
      if (push) window.history.pushState({ page: id }, '', `#${id}`);
      window.scrollTo(0, 0);
    },

    // ── Profile rendering ──
    renderProfile(user) {
      if (!user) return;
      this.els.displayName.textContent = user.username;
      this.els.displayLoc.textContent  = '📍 ' + (user.location || 'Indonesia');
      this.els.displayDesc.textContent = user.desc || 'Pengguna Rentopia';

      // Avatar: photo or initials
      if (user.avatarB64) {
        this.els.avatarImg.src = user.avatarB64;
        this.els.avatarImg.classList.remove('hidden');
        this.els.avatarInitials.style.display = 'none';
      } else {
        this.els.avatarImg.classList.add('hidden');
        this.els.avatarInitials.style.display = '';
        this.els.avatarInitials.textContent = user.username.charAt(0).toUpperCase();
      }
    },

    // ── Listing cards ──
    renderListings(items, ownerUsername) {
      const grid  = this.els.listingGrid;
      const empty = this.els.listingEmpty;
      grid.innerHTML = '';

      const myItems = items.filter(i => i.owner === ownerUsername);

      if (myItems.length === 0) {
        empty.classList.remove('hidden');
        this.els.statListings.querySelector('span').textContent = '0';
        return;
      }

      empty.classList.add('hidden');
      this.els.statListings.querySelector('span').textContent = myItems.length;

      myItems.forEach(item => {
        grid.appendChild(this._buildListingCard(item));
      });
    },

    _buildListingCard(item) {
      const card = document.createElement('article');
      card.className = 'product-card';
      card.dataset.id = item.id;

      const imgContent = item.photoB64
        ? `<img src="${item.photoB64}" alt="${item.title}" />`
        : `<span style="font-size:42px">${this._categoryEmoji(item.category)}</span>`;

      card.innerHTML = `
        <div class="card-img">${imgContent}</div>
        <div class="card-body">
          <h4>${item.title}</h4>
          <div class="card-meta">
            <span class="card-price">Rp ${Number(item.price).toLocaleString('id-ID')}<small>/hr</small></span>
            <span class="card-cat">${item.category || 'Lainnya'}</span>
          </div>
        </div>
        <div class="card-actions">
          <button data-action="open-rent" data-id="${item.id}">Sewa</button>
          <button data-action="edit-item" data-id="${item.id}">Edit</button>
          <button data-action="delete-item" data-id="${item.id}" class="btn-delete">Hapus</button>
        </div>`;
      return card;
    },

    // ── Rent cards ──
    async renderRentals(rentals) {
      const grid  = this.els.rentGrid;
      const empty = this.els.rentEmpty;
      grid.innerHTML = '';

      if (!rentals || rentals.length === 0) {
        empty.classList.remove('hidden');
        return;
      }

      empty.classList.add('hidden');

      let overdueCount = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      rentals.forEach(rental => {
        const returnDate  = new Date(rental.returnDate);
        const isOverdue   = returnDate < today && !rental.returned;
        if (isOverdue) overdueCount++;

        const card = document.createElement('article');
        card.className = 'product-card rent-card';

        const imgContent = rental.itemPhotoB64
          ? `<img src="${rental.itemPhotoB64}" alt="${rental.itemTitle}" />`
          : `<span style="font-size:42px">${this._categoryEmoji(rental.itemCategory)}</span>`;

        card.innerHTML = `
          ${isOverdue ? '<div class="overdue-badge">Overdue</div>' : ''}
          <div class="card-img">${imgContent}</div>
          <div class="card-body">
            <h4>${rental.itemTitle}</h4>
            <div class="card-meta">
              <span class="card-price">Rp ${Number(rental.totalPrice).toLocaleString('id-ID')}</span>
              <span class="card-cat">${rental.duration} hari</span>
            </div>
            <div class="rent-dates">
              Kembali: ${returnDate.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' })}
            </div>
          </div>`;
        grid.appendChild(card);
      });

      // Update overdue stat badge
      if (overdueCount > 0) {
        this.els.statOverdue.classList.remove('hidden');
        this.els.statOverdue.querySelector('span').textContent = overdueCount;
      } else {
        this.els.statOverdue.classList.add('hidden');
      }
    },

    // ── Browse (all items) ──
    renderBrowse(items, currentUser) {
      const grid  = this.els.browseGrid;
      const empty = this.els.browseEmpty;
      grid.innerHTML = '';

      const available = items.filter(i => i.owner !== currentUser);

      if (available.length === 0) {
        empty.classList.remove('hidden');
        return;
      }

      empty.classList.add('hidden');

      available.forEach(item => {
        const card = document.createElement('article');
        card.className = 'product-card';
        card.dataset.id = item.id;

        const imgContent = item.photoB64
          ? `<img src="${item.photoB64}" alt="${item.title}" />`
          : `<span style="font-size:42px">${this._categoryEmoji(item.category)}</span>`;

        card.innerHTML = `
          <div class="card-img">${imgContent}</div>
          <div class="card-body">
            <h4>${item.title}</h4>
            <div class="card-meta">
              <span class="card-price">Rp ${Number(item.price).toLocaleString('id-ID')}<small>/hr</small></span>
              <span class="card-cat">${item.category || 'Lainnya'}</span>
            </div>
          </div>
          <div class="card-actions">
            <button data-action="open-rent" data-id="${item.id}">Sewa Sekarang</button>
          </div>`;
        grid.appendChild(card);
      });
    },

    // ── Tab toggle ──
    switchTab(name) {
      const tabListing = document.getElementById('tab-listing');
      const tabRent    = document.getElementById('tab-rent');
      const isListing  = name === 'listing';

      tabListing.classList.toggle('hidden', !isListing);
      tabRent.classList.toggle('hidden', isListing);

      document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === name);
      });
    },

    // ── Form population ──
    populateEditProfile(user) {
      document.getElementById('input-name').value     = user.username || '';
      document.getElementById('input-location').value = user.location || '';
      document.getElementById('input-desc').value     = user.desc || '';
    },

    async populateEditItem(item) {
      document.getElementById('edit-item-id').value = item.id;
      document.getElementById('edit-title').value   = item.title;
      document.getElementById('edit-price').value   = item.price;
      document.getElementById('edit-category').value = item.category || 'Lainnya';

      const preview = document.getElementById('edit-photo-preview');
      if (item.photoB64) {
        preview.innerHTML = `<img src="${item.photoB64}" alt="preview" />`;
      } else {
        preview.innerHTML = '<span>Klik untuk ganti foto</span>';
      }
    },

    populateRentPage(item) {
      document.getElementById('rent-item-id').value = item.id;
      const preview = document.getElementById('rent-item-preview');
      preview.innerHTML = `
        <div style="font-size:36px">${this._categoryEmoji(item.category)}</div>
        <div>
          <strong>${item.title}</strong>
          <p style="font-size:13px;color:var(--ink-muted)">${item.category || ''}</p>
          <p style="color:var(--accent);font-weight:600">Rp ${Number(item.price).toLocaleString('id-ID')}/hari</p>
        </div>`;

      // Bind live price calculator
      const durationInput = document.getElementById('rent-duration');
      const totalEl       = document.getElementById('rent-total');
      const calcTotal = () => {
        const d = parseInt(durationInput.value) || 1;
        totalEl.textContent = 'Rp ' + (d * item.price).toLocaleString('id-ID');
      };
      durationInput.oninput = calcTotal;
      calcTotal();

      // Set min date to today
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('rent-start').min   = today;
      document.getElementById('rent-start').value = today;
    },

    // ── Toast ──
    toast(msg, type = '') {
      const t = this.els.toast;
      t.textContent = msg;
      t.className   = `toast ${type}`;
      t.classList.remove('hidden');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
    },

    // ── Modal ──
    showModal(html) {
      this.els.modalContent.innerHTML = html;
      this.els.modalOverlay.classList.remove('hidden');
    },

    closeModal() {
      this.els.modalOverlay.classList.add('hidden');
      this.els.modalContent.innerHTML = '';
    },

    // ── Inline error ──
    showError(elementId, msg) {
      const el = document.getElementById(elementId);
      if (!el) return;
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 4000);
    },

    _categoryEmoji(cat) {
      const map = { 'Tenda':'⛺', 'Sleeping Bag':'🛌', 'Carrier':'🎒', 'Peralatan Masak':'🍳', 'Lainnya':'📦' };
      return map[cat] || '📦';
    }
  },

  /* ─────────────────────────────────────────
     EVENT BUS — CustomEvent communication
  ───────────────────────────────────────── */
  eventBus: {
    _handlers: {},

    on(event, handler) {
      if (!this._handlers[event]) this._handlers[event] = [];
      this._handlers[event].push(handler);
      window.addEventListener(event, handler);
    },

    emit(event, detail = {}) {
      window.dispatchEvent(new CustomEvent(event, { detail }));
    }
  },

  /* ─────────────────────────────────────────
     MEDIA HANDLER — FileReader / Base64
  ───────────────────────────────────────── */
  mediaHandler: {
    readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        if (!file) { reject('No file'); return; }
        // Validate: only PNG/JPG
        if (!['image/png', 'image/jpeg'].includes(file.type)) {
          reject('Hanya file PNG atau JPG yang didukung');
          return;
        }
        // Validate size: max 2MB
        if (file.size > 2 * 1024 * 1024) {
          reject('Ukuran file maksimal 2MB');
          return;
        }
        const reader = new FileReader();
        reader.onload  = (e) => resolve(e.target.result);
        reader.onerror = ()  => reject('Gagal membaca file');
        reader.readAsDataURL(file);
      });
    }
  },

  /* ─────────────────────────────────────────
     CSV MODULE — export & display
  ───────────────────────────────────────── */
  csvModule: {
    async exportItems(db, username) {
      const items = await db.getItemsByOwner(username);
      if (items.length === 0) throw new Error('Belum ada barang untuk diexport');

      const rows = [
        ['ID', 'Nama Barang', 'Harga/Hari', 'Kategori', 'Pemilik'],
        ...items.map(i => [i.id, i.title, i.price, i.category || 'Lainnya', i.owner])
      ];

      const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
      const url  = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href  = url;
      link.download = `Rentopia_${username}_${new Date().toISOString().slice(0,10)}.csv`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      return items.length;
    },

    // Parse CSV → display in modal (read CSV back for verification)
    parseCSV(text) {
      const lines  = text.trim().split('\n');
      const header = lines[0].split(',').map(h => h.replace(/"/g,'').trim());
      const data   = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.replace(/^"|"$/g,'').trim());
        return header.reduce((obj, key, i) => { obj[key] = vals[i] || ''; return obj; }, {});
      });
      return { header, data };
    }
  },

  /* ─────────────────────────────────────────
     SESSION — Cookie helpers
  ───────────────────────────────────────── */
  session: {
    set(username) {
      document.cookie = `user_session=${encodeURIComponent(username)}; max-age=3600; path=/; SameSite=Strict`;
    },

    get() {
      const pair = document.cookie.split('; ').find(r => r.startsWith('user_session='));
      return pair ? decodeURIComponent(pair.split('=')[1]) : null;
    },

    clear() {
      document.cookie = 'user_session=; max-age=0; path=/; SameSite=Strict';
    }
  },

  /* ─────────────────────────────────────────
     ROUTER — action handler map
  ───────────────────────────────────────── */
  _routes: {},

  _buildRoutes() {
    this._routes = {
      'do-login':       () => this.auth.login(),
      'do-signup':      () => this.auth.signup(),
      'go-login':       () => this.uiController.showPage('page-login'),
      'go-signup':      () => this.uiController.showPage('page-signup'),
      'go-profile':     () => this.uiController.showPage('page-profile'),
      'go-add':         () => this.uiController.showPage('page-add-listing'),
      'go-rent':        () => this._loadBrowsePage(),
      'open-edit':      () => this._openEditProfile(),
      'save-profile':   () => this._saveProfile(),
      'save-listing':   () => this._saveListing(),
      'update-listing': () => this._updateListing(),
      'export-csv':     () => this._exportCSV(),
      'close-modal':    () => this.uiController.closeModal(),
      'logout':         () => this.auth.logout(),
    };
  },

  /* ─────────────────────────────────────────
     AUTH CONTROLLER
  ───────────────────────────────────────── */
  auth: {
    async login() {
      const app  = Rentopia;
      const user = document.getElementById('login-user').value.trim();
      const pass = document.getElementById('login-pass').value;

      if (!user || !pass) {
        app.uiController.showError('login-error', 'Username dan password wajib diisi');
        return;
      }

      try {
        const account = await app.dbManager.getUser(user);

        if (account && account.password === pass) {
          // ── Write to Cookie (session) ──
          app.session.set(user);
          // ── Write to localStorage (lightweight meta) ──
          localStorage.setItem('last_login_time', new Date().toLocaleString('id-ID'));

          // ── Write to state (in-memory) ──
          app.stateManager.set('user', account);

          await app._loadDashboard(account);
        } else {
          app.uiController.showError('login-error', 'Username atau password salah');
        }
      } catch (err) {
        app.uiController.showError('login-error', err.message || 'Terjadi kesalahan');
      }
    },

    async signup() {
      const app  = Rentopia;
      const user = document.getElementById('reg-user').value.trim();
      const pass = document.getElementById('reg-pass').value;
      const loc  = document.getElementById('reg-location').value.trim() || 'Indonesia';

      if (!user || !pass) {
        app.uiController.showError('signup-error', 'Semua field wajib diisi');
        return;
      }

      try {
        // Check for duplicate before writing
        const existing = await app.dbManager.getUser(user);
        if (existing) {
          app.uiController.showError('signup-error', 'Username sudah digunakan');
          return;
        }

        // Write validated data to IndexedDB
        await app.dbManager.addUser({
          username: user,
          password: pass,
          location: loc,
          desc:     'Pengguna Rentopia',
          avatarB64: null,
          createdAt: new Date().toISOString()
        });

        app.uiController.toast('Akun berhasil dibuat! Silakan login.', 'success');
        app.uiController.showPage('page-login');
      } catch (err) {
        app.uiController.showError('signup-error', err.message || 'Gagal mendaftar');
      }
    },

    logout() {
      Rentopia.session.clear();
      Rentopia.stateManager.clear();
      localStorage.removeItem('last_login_time');
      location.reload();
    }
  },

  /* ─────────────────────────────────────────
     FEATURE ACTIONS
  ───────────────────────────────────────── */
  async _loadDashboard(user) {
    this.uiController.renderProfile(user);
    this.uiController.showPage('page-profile');
    this.uiController.switchTab('listing');

    const [items, rentals] = await Promise.all([
      this.dbManager.getItemsByOwner(user.username),
      this.dbManager.getRentalsByRenter(user.username)
    ]);

    this.uiController.renderListings(items, user.username);
    await this.uiController.renderRentals(rentals);
  },

  _openEditProfile() {
    const user = this.stateManager.get('user');
    if (!user) return;
    this.uiController.populateEditProfile(user);
    this.uiController.showPage('page-edit');
  },

  async _saveProfile() {
    const user = this.stateManager.get('user');
    if (!user) return;

    const name = document.getElementById('input-name').value.trim();
    const loc  = document.getElementById('input-location').value.trim();
    const desc = document.getElementById('input-desc').value.trim();

    if (!name) { this.uiController.toast('Nama tidak boleh kosong', 'error'); return; }

    const avatar    = this.stateManager.get('tempAvatarB64');
    const updatedUser = {
      ...user,
      username:  name,
      location:  loc  || user.location,
      desc:      desc || user.desc,
      avatarB64: avatar || user.avatarB64
    };

    try {
      // Write updated user to IndexedDB
      await this.dbManager.updateUser(updatedUser);
      this.stateManager.set('user', updatedUser);
      this.stateManager.set('tempAvatarB64', null);

      this.uiController.renderProfile(updatedUser);

      // Emit CustomEvent for any listeners
      this.eventBus.emit('profileUpdated', updatedUser);

      this.uiController.toast('Profil berhasil disimpan', 'success');
      this.uiController.showPage('page-profile');
    } catch (err) {
      this.uiController.toast(err.message, 'error');
    }
  },

  async _saveListing() {
    const user = this.stateManager.get('user');
    if (!user) return;

    const title    = document.getElementById('add-title').value.trim();
    const price    = parseInt(document.getElementById('add-price').value);
    const category = document.getElementById('add-category').value;
    const photo    = this.stateManager.get('tempItemPhotoB64');

    try {
      // Validation happens inside dbManager.addItem
      await this.dbManager.addItem({
        title, price, category,
        owner:    user.username,
        photoB64: photo || null,
        createdAt: new Date().toISOString()
      });

      this.stateManager.set('tempItemPhotoB64', null);
      document.getElementById('add-title').value  = '';
      document.getElementById('add-price').value  = '';
      document.getElementById('item-photo-preview').innerHTML = '<span>Klik untuk upload foto</span>';

      const items = await this.dbManager.getItemsByOwner(user.username);
      this.uiController.renderListings(items, user.username);

      this.uiController.toast('Barang berhasil dipublish!', 'success');
      this.uiController.showPage('page-profile');
      this.uiController.switchTab('listing');

      this.eventBus.emit('listingAdded', { item: { title, price } });
    } catch (err) {
      this.uiController.showError('add-error', err.message);
    }
  },

  async _openEditItem(id) {
    const numId = parseInt(id);
    const item  = await this.dbManager.getItem(numId);
    if (!item) return;

    this.stateManager.set('editItemId', numId);
    await this.uiController.populateEditItem(item);
    this.uiController.showPage('page-edit-item');
  },

  async _updateListing() {
    const id       = parseInt(document.getElementById('edit-item-id').value);
    const title    = document.getElementById('edit-title').value.trim();
    const price    = parseInt(document.getElementById('edit-price').value);
    const category = document.getElementById('edit-category').value;
    const photo    = this.stateManager.get('tempItemPhotoB64');

    try {
      const existing = await this.dbManager.getItem(id);
      if (!existing) throw new Error('Barang tidak ditemukan');

      await this.dbManager.updateItem({
        ...existing,
        title, price, category,
        photoB64: photo !== null ? photo : existing.photoB64
      });

      this.stateManager.set('tempItemPhotoB64', null);

      const user  = this.stateManager.get('user');
      const items = await this.dbManager.getItemsByOwner(user.username);
      this.uiController.renderListings(items, user.username);

      this.uiController.toast('Barang berhasil diupdate', 'success');
      this.uiController.showPage('page-profile');
      this.uiController.switchTab('listing');
    } catch (err) {
      this.uiController.toast(err.message, 'error');
    }
  },

  async _deleteItem(id) {
    const numId = parseInt(id);
    const confirmed = confirm('Hapus barang ini?');
    if (!confirmed) return;

    await this.dbManager.deleteItem(numId);

    const user  = this.stateManager.get('user');
    const items = await this.dbManager.getItemsByOwner(user.username);
    this.uiController.renderListings(items, user.username);
    this.uiController.toast('Barang dihapus', '');
  },

  async _openRentPage(id) {
    const numId = parseInt(id);
    const item  = await this.dbManager.getItem(numId);
    if (!item) return;

    this.stateManager.set('rentItemData', item);
    this.uiController.populateRentPage(item);
    this.uiController.showPage('page-rent-item');
  },

  async _confirmRent() {
    const user = this.stateManager.get('user');
    const item = this.stateManager.get('rentItemData');
    if (!user || !item) return;

    const startStr = document.getElementById('rent-start').value;
    const duration = parseInt(document.getElementById('rent-duration').value) || 1;

    if (!startStr) { this.uiController.toast('Pilih tanggal mulai sewa', 'error'); return; }

    const startDate  = new Date(startStr);
    const returnDate = new Date(startDate);
    returnDate.setDate(returnDate.getDate() + duration);

    try {
      await this.dbManager.addRental({
        itemId:       item.id,
        itemTitle:    item.title,
        itemCategory: item.category,
        itemPhotoB64: item.photoB64 || null,
        renter:       user.username,
        owner:        item.owner,
        startDate:    startDate.toISOString(),
        returnDate:   returnDate.toISOString(),
        duration,
        totalPrice:   duration * item.price,
        returned:     false,
        rentedAt:     new Date().toISOString()
      });

      this.stateManager.set('rentItemData', null);

      this.uiController.toast(`Berhasil menyewa "${item.title}" selama ${duration} hari!`, 'success');
      await this._loadDashboard(user);
      this.uiController.switchTab('rent');
    } catch (err) {
      this.uiController.toast(err.message, 'error');
    }
  },

  async _loadBrowsePage() {
    const user  = this.stateManager.get('user');
    const items = await this.dbManager.getAllItems();
    this.uiController.renderBrowse(items, user ? user.username : '');
    this.uiController.showPage('page-browse');
  },

  async _exportCSV() {
    const user = this.stateManager.get('user');
    if (!user) return;
    try {
      const count = await this.csvModule.exportItems(this.dbManager, user.username);
      this.uiController.toast(`${count} barang berhasil diexport ke CSV`, 'success');
    } catch (err) {
      this.uiController.toast(err.message, 'error');
    }
  },

  async _handleAvatarUpload(file) {
    try {
      const b64 = await this.mediaHandler.readFileAsBase64(file);
      this.stateManager.set('tempAvatarB64', b64);

      // Show preview immediately
      this.uiController.els.avatarImg.src = b64;
      this.uiController.els.avatarImg.classList.remove('hidden');
      this.uiController.els.avatarInitials.style.display = 'none';
      this.uiController.toast('Foto dipilih. Simpan profil untuk menyimpan.', '');
    } catch (err) {
      this.uiController.toast(err, 'error');
    }
  },

  async _handleItemPhotoUpload(file, previewId) {
    try {
      const b64 = await this.mediaHandler.readFileAsBase64(file);
      this.stateManager.set('tempItemPhotoB64', b64);
      const preview = document.getElementById(previewId);
      preview.innerHTML = `<img src="${b64}" alt="preview" />`;
    } catch (err) {
      this.uiController.toast(err, 'error');
    }
  },

  /* ─────────────────────────────────────────
     EVENT DELEGATION — single listener
  ───────────────────────────────────────── */
  _bindEvents() {
    // ONE click listener on app-root (Event Delegation)
    document.getElementById('app-root').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      const tab = e.target.closest('[data-tab]');

      if (tab) {
        this.uiController.switchTab(tab.dataset.tab);
        if (tab.dataset.tab === 'rent') {
          const user = this.stateManager.get('user');
          if (user) {
            this.dbManager.getRentalsByRenter(user.username)
              .then(r => this.uiController.renderRentals(r));
          }
        }
        return;
      }

      if (!btn) return;
      const action = btn.dataset.action;
      const id     = btn.dataset.id;

      // Dynamic actions with id
      if (action === 'edit-item'   && id) { this._openEditItem(id); return; }
      if (action === 'delete-item' && id) { this._deleteItem(id);   return; }
      if (action === 'open-rent'   && id) { this._openRentPage(id); return; }
      if (action === 'confirm-rent')      { this._confirmRent();    return; }

      // Overlay close on backdrop click
      if (e.target.id === 'modal-overlay') { this.uiController.closeModal(); return; }

      // Route table
      if (this._routes[action]) this._routes[action]();
    });

    // File input: avatar
    document.getElementById('avatar-file').addEventListener('change', (e) => {
      if (e.target.files[0]) this._handleAvatarUpload(e.target.files[0]);
    });

    // File input: add item photo
    document.getElementById('item-photo-file').addEventListener('change', (e) => {
      if (e.target.files[0]) this._handleItemPhotoUpload(e.target.files[0], 'item-photo-preview');
    });

    // File input: edit item photo
    document.getElementById('edit-photo-file').addEventListener('change', (e) => {
      if (e.target.files[0]) this._handleItemPhotoUpload(e.target.files[0], 'edit-photo-preview');
    });

    // Photo preview click triggers file input
    document.getElementById('item-photo-preview').addEventListener('click', () => {
      document.getElementById('item-photo-file').click();
    });
    document.getElementById('edit-photo-preview').addEventListener('click', () => {
      document.getElementById('edit-photo-file').click();
    });

    // SPA: browser back/forward
    window.onpopstate = (e) => {
      if (e.state) this.uiController.showPage(e.state.page, false);
    };
  },

  /* ─────────────────────────────────────────
     CHECK SESSION — on page load
  ───────────────────────────────────────── */
  async _checkSession() {
    const username = this.session.get();
    if (!username) {
      this.uiController.showPage('page-login', false);
      return;
    }

    try {
      const user = await this.dbManager.getUser(username);
      if (user) {
        this.stateManager.set('user', user);
        await this._loadDashboard(user);
      } else {
        // Cookie exists but user not found in IndexedDB
        this.session.clear();
        this.uiController.showPage('page-login', false);
      }
    } catch (err) {
      this.uiController.showPage('page-login', false);
    }
  },

  /* ─────────────────────────────────────────
     INIT
  ───────────────────────────────────────── */
  async init() {
    this.uiController.cacheSelectors();
    await this.dbManager.init();
    this._buildRoutes();
    this._bindEvents();

    // CustomEvent listeners (eventBus)
    this.eventBus.on('profileUpdated', (e) => {
      console.log('[eventBus] profileUpdated:', e.detail.username);
      // Could trigger cross-component updates here
    });

    this.eventBus.on('listingAdded', (e) => {
      console.log('[eventBus] listingAdded:', e.detail.item?.title);
    });

    await this._checkSession();
  }

};

// ── Entry point ──
document.addEventListener('DOMContentLoaded', () => Rentopia.init());
