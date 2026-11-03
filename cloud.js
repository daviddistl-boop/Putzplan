/*
 * Putzplan – Konto, Haushalte und Abgleich über Supabase.
 *
 * Nur Netzwerk-Zugriffe, keine Oberfläche. Die Abgleich-Regeln stehen in sync.js,
 * die Datenbank (Tabellen, Zugriffsregeln, Funktionen) in supabase/migrations/.
 */
(function (root) {
  'use strict';

  const cfg = root.PutzplanShared;
  const Cap = root.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const PULL_OVERLAP_MS = 2 * 60 * 1000; // überlappend holen – Zeitstempel können sich knapp überholen
  const PAGE = 1000;
  const CHUNK = 300;

  let client = null;
  function sb() {
    if (!client) {
      if (!root.supabase) throw new Error('offline');
      client = root.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isNative, flowType: 'pkce', storageKey: 'putzplan.auth' },
      });
    }
    return client;
  }

  const available = () => !!root.supabase;

  // Fehlermeldungen der Datenbank-Funktionen und von Supabase Auth → verständlicher Text.
  const MESSAGES = {
    invalid_code: 'Dieser Code ist ungültig oder abgelaufen.',
    too_many_attempts: 'Zu viele falsche Codes – bitte in einer Stunde nochmal versuchen.',
    not_owner: 'Das darf nur, wer den Haushalt angelegt hat.',
    not_member: 'Du bist nicht (mehr) Mitglied dieses Haushalts.',
    not_authenticated: 'Bitte melde dich zuerst an.',
  };
  function friendly(error) {
    if (!error) return 'Unbekannter Fehler';
    const msg = String(error.message || error);
    for (const k of Object.keys(MESSAGES)) if (msg.includes(k)) return MESSAGES[k];
    if (/token has expired|invalid.*otp|otp.*invalid/i.test(msg)) return 'Der Code ist falsch oder abgelaufen.';
    if (/rate limit|too many|security purposes/i.test(msg)) return 'Zu viele Versuche – bitte kurz warten.';
    if (/fetch|network|load failed|offline/i.test(msg)) return 'Keine Verbindung zum Server.';
    return msg;
  }
  function check({ data, error }) {
    if (error) throw new Error(friendly(error));
    return data;
  }

  // ------------------------------------------------------------ Anmeldung

  async function session() {
    if (!available()) return null;
    const { data } = await sb().auth.getSession();
    return data.session;
  }

  function onAuth(cb) {
    if (!available()) return;
    sb().auth.onAuthStateChange((event, s) => setTimeout(() => cb(event, s), 0));
  }

  async function sendCode(email) {
    check(await sb().auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
  }

  async function verifyCode(email, token) {
    return check(await sb().auth.verifyOtp({ email, token: String(token).trim(), type: 'email' })).session;
  }

  const googleReady = () => !!cfg.GOOGLE_WEB_CLIENT_ID;

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Anmelden mit Google. In der App über das Google-Auswahlfenster des Handys
   * (Credential Manager), im Browser über die Weiterleitung zu Google.
   */
  async function googleSignIn() {
    if (!isNative) {
      check(await sb().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: root.location.href.split('#')[0].split('?')[0] },
      }));
      return null; // Die Seite wird zu Google weitergeleitet.
    }
    const plugin = Cap.Plugins.SocialLogin;
    if (!plugin) throw new Error('Google-Anmeldung ist in dieser App-Version nicht verfügbar.');
    await plugin.initialize({ google: { webClientId: cfg.GOOGLE_WEB_CLIENT_ID, skipAuthOnlyAuthorizationAfterSignIn: true } });
    // Der Nonce schützt davor, dass ein abgefangener Google-Nachweis wiederverwendet wird.
    const nonce = crypto.getRandomValues(new Uint32Array(4)).join('-');
    const res = await plugin.login({ provider: 'google', options: { nonce: await sha256Hex(nonce) } });
    const idToken = res && res.result && res.result.idToken;
    if (!idToken) throw new Error('Google hat keine Anmeldung zurückgegeben.');
    return check(await sb().auth.signInWithIdToken({ provider: 'google', token: idToken, nonce })).session;
  }

  async function signOut() {
    if (isNative && Cap.Plugins.SocialLogin) Cap.Plugins.SocialLogin.logout({ provider: 'google' }).catch(() => {});
    await sb().auth.signOut().catch(() => {});
  }

  async function updateName(name) {
    check(await sb().auth.updateUser({ data: { name } }));
  }

  // ------------------------------------------------------------ Haushalte

  async function households(userId) {
    const rows = check(await sb().from('household_members')
      .select('household_id, role, member_id, display_name, joined_at, households(name, icon)')
      .eq('user_id', userId)
      .order('joined_at'));
    return rows.filter((r) => r.households).map((r) => ({
      id: r.household_id, name: r.households.name, icon: r.households.icon, role: r.role, memberId: r.member_id,
    }));
  }

  async function members(householdId) {
    return check(await sb().from('household_members')
      .select('user_id, role, member_id, display_name, joined_at')
      .eq('household_id', householdId)
      .order('joined_at'));
  }

  const rpc = async (fn, args) => check(await sb().rpc(fn, args));
  const createHousehold = (name, icon, memberId, displayName) =>
    rpc('create_household', { p_name: name, p_icon: icon, p_member_id: memberId, p_display_name: displayName });
  const invite = (h) => rpc('create_invite', { p_household: h });
  const join = (code, displayName) => rpc('join_household', { p_code: code, p_display_name: displayName });
  const leave = (h) => rpc('leave_household', { p_household: h });
  const removeMember = (h, userId) => rpc('remove_member', { p_household: h, p_user: userId });
  const deleteHousehold = (h) => rpc('delete_household', { p_household: h });
  const deleteAccount = () => rpc('delete_my_account', {});

  async function renameHousehold(h, name, icon) {
    check(await sb().from('households').update({ name, icon }).eq('id', h));
  }

  async function setMyMember(h, userId, memberId, displayName) {
    check(await sb().from('household_members').update({ member_id: memberId, display_name: displayName })
      .eq('household_id', h).eq('user_id', userId));
  }

  // ------------------------------------------------------------ Datensätze

  /** Alle Datensätze, die sich seit `since` (ISO-Zeit, null = alle) geändert haben. */
  async function pull(h, since) {
    const out = [];
    const from = since ? new Date(Date.parse(since) - PULL_OVERLAP_MS).toISOString() : null;
    for (let page = 0; ; page++) {
      let q = sb().from('records').select('kind, id, data, deleted, updated_at').eq('household_id', h);
      if (from) q = q.gt('updated_at', from);
      const rows = check(await q.order('updated_at').order('kind').order('id').range(page * PAGE, page * PAGE + PAGE - 1));
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async function push(h, rows) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({ household_id: h, kind: r.kind, id: r.id, data: r.data, deleted: r.deleted }));
      check(await sb().from('records').upsert(chunk, { onConflict: 'household_id,kind,id' }));
    }
  }

  /** Live-Änderungen eines Haushalts. Gibt eine Funktion zum Abmelden zurück. */
  function subscribe(h, onChange) {
    const channel = sb().channel(`haushalt-${h}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `household_id=eq.${h}` }, () => onChange('records'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_members', filter: `household_id=eq.${h}` }, () => onChange('members'))
      .subscribe();
    return () => { sb().removeChannel(channel); };
  }

  root.PutzplanCloud = {
    isNative, available, friendly, session, onAuth, sendCode, verifyCode, googleReady, googleSignIn, signOut, updateName,
    households, members, createHousehold, renameHousehold, invite, join, leave, removeMember, deleteHousehold, deleteAccount,
    setMyMember, pull, push, subscribe,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
