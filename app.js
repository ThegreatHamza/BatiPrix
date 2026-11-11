import { sb, $, $$, e, djf, fmtDate, waLink, toast, errMsg, state, loadSession, ensureProfile,
  route, go, render, startRouter, formData, busy, authPage, paymentPage, adminPayments } from './lib.js';

const DISTRICTS = ['Centre-ville', 'Boulaos', 'Arhiba', 'Ambouli', 'Balbala', 'PK12', 'Haramous', 'Gabode', 'Salines', 'Héron',
  'Plateau du Serpent', 'Cité Hodan', 'Zone industrielle', 'Arta', 'Tadjourah', 'Obock', 'Ali Sabieh', 'Dikhil'];
const PRODUCTS = {
  credits_10: { label: '10 crédits demandes de devis', price: 5000 },
  credits_30: { label: '30 crédits demandes de devis', price: 12000 },
  pro_month: { label: 'Fournisseur Pro — 30 jours', price: 20000 }
};

async function refresh() { await loadSession('bati_profiles'); paintNav(); }
function paintNav() {
  $('#nav').innerHTML = `
    <a href="#/">Prix du jour</a>
    <a href="#/fournisseurs">Fournisseurs</a>
    ${state.user ? `<a href="#/espace">Espace fournisseur</a>${state.profile?.is_admin ? '<a href="#/admin">Admin</a>' : ''}<a href="#" id="logout">Sortir</a>`
                 : '<a href="#/login">Je suis fournisseur</a>'}
    <a class="cta" href="#/devis">Demander un devis</a>`;
  const lo = $('#logout'); if (lo) lo.onclick = async ev => { ev.preventDefault(); await sb.auth.signOut(); await refresh(); go('/'); };
}
const isPro = p => p && p.plan === 'pro' && p.plan_until >= new Date().toISOString().slice(0, 10);

// ---------- Public price board ----------
route('/', async view => {
  const { data, error } = await sb.from('bati_price_board').select('*').order('sort');
  if (error) throw error;
  const cats = [...new Set(data.map(r => r.category))];
  const priced = data.filter(r => r.supplier_count > 0).length;
  view.innerHTML = `
  <section class="hero">
    <h1>Le prix des matériaux à Djibouti, chaque jour</h1>
    <p>Ciment, fer, parpaings, sable… Comparez les prix des quincailleries et recevez jusqu'à 5 devis gratuitement.</p>
    <a class="btn accent" href="#/devis">Demander des devis gratuits</a>
    <input id="filter" placeholder="Rechercher un matériau…" style="max-width:320px;margin-left:.5rem;display:inline-block">
  </section>
  ${priced === 0 ? '<div class="card small">Les fournisseurs commencent à publier leurs prix. Revenez bientôt ou <a href="#/devis">demandez un devis</a>.</div>' : ''}
  ${cats.map(c => `<div class="card cat"><h3>${e(c)}</h3><div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Matériau</th><th>Unité</th><th>Prix min.</th><th>Prix moyen</th><th>Fournisseurs</th><th>Mis à jour</th></tr></thead><tbody>
    ${data.filter(r => r.category === c).map(r => `<tr class="mrow" data-name="${e(r.name.toLowerCase())}">
      <td><a href="#/m/${r.material_id}">${e(r.name)}</a></td><td>${e(r.unit)}</td>
      <td><b>${djf(r.min_price)}</b></td><td>${djf(r.avg_price)}</td><td>${r.supplier_count}</td><td class="muted small">${fmtDate(r.last_update)}</td></tr>`).join('')}
    </tbody></table></div></div>`).join('')}`;
  $('#filter').oninput = ev => {
    const q = ev.target.value.toLowerCase();
    $$('.mrow').forEach(r => r.classList.toggle('hidden', q && !r.dataset.name.includes(q)));
  };
});

// ---------- Offers for one material ----------
route('/m/:id', async (view, { id }) => {
  const [{ data: m }, { data: offers, error }] = await Promise.all([
    sb.from('bati_materials').select('*').eq('id', id).single(),
    sb.from('bati_offers').select('*').eq('material_id', id).order('is_pro', { ascending: false }).order('price_djf')
  ]);
  if (error) throw error;
  view.innerHTML = `<a href="#/" class="muted">← Tous les prix</a>
  <div class="card" style="margin-top:.6rem"><h2>${e(m.name)}</h2><p class="muted">Prix par ${e(m.unit)} · ${offers.length} offre(s)</p>
  ${offers.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fournisseur</th><th>Quartier</th><th>Prix</th><th>Stock</th><th>Mis à jour</th><th></th></tr></thead><tbody>
  ${offers.map(o => `<tr><td><b>${e(o.company_name)}</b> ${o.is_pro ? '<span class="badge pro">PRO</span>' : ''}</td><td>${e(o.district)}</td>
    <td><b>${djf(o.price_djf)}</b></td><td>${o.in_stock ? '<span class="badge active">en stock</span>' : '<span class="badge rejected">rupture</span>'}</td>
    <td class="small muted">${fmtDate(o.updated_at)}</td>
    <td>${o.whatsapp ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${waLink(o.whatsapp, `Bonjour, vu sur BatiPrix : ${m.name} à ${o.price_djf} FDJ. Est-ce disponible ?`)}">WhatsApp</a>` : ''}</td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">Aucune offre récente. <a href="#/devis">Demandez un devis</a>.</p>'}</div>`;
});

// ---------- Supplier directory ----------
route('/fournisseurs', async view => {
  const { data, error } = await sb.from('bati_profiles').select('id, company_name, district, description, categories, whatsapp, plan, plan_until').eq('verified', true);
  if (error) throw error;
  data.sort((a, b) => isPro(b) - isPro(a));
  view.innerHTML = `<h2>Fournisseurs vérifiés</h2>${data.length ? `<div class="grid">${data.map(s => `<div class="card">
    <h3 style="margin:0">${e(s.company_name)} ${isPro(s) ? '<span class="badge pro">PRO</span>' : ''}</h3>
    <p class="muted small">${e(s.district)} · ${e(s.categories.join(', '))}</p><p class="small">${e(s.description)}</p>
    ${s.whatsapp ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${waLink(s.whatsapp, 'Bonjour, je vous ai trouvé sur BatiPrix.')}">WhatsApp</a>` : ''}</div>`).join('')}</div>`
    : '<div class="card empty">Les premiers fournisseurs arrivent. <a href="#/login">Inscrivez votre quincaillerie</a>.</div>'}`;
});

// ---------- Buyer: request quotes (no account needed) ----------
route('/devis', async view => {
  view.innerHTML = `<div class="card narrow" style="max-width:640px">
    <h2>Demande de devis gratuite</h2>
    <p class="muted">Décrivez vos besoins. Jusqu'à 5 fournisseurs vérifiés vous contactent avec leur meilleur prix.</p>
    <form id="rfq">
      <div class="row"><label>Votre nom<input name="name" required minlength="2"></label><label>Téléphone / WhatsApp<input name="phone" required minlength="6" type="tel"></label></div>
      <div class="row"><label>Quartier de livraison<select name="district" required><option value="">—</option>${DISTRICTS.map(d => `<option>${e(d)}</option>`).join('')}</select></label>
        <label>Type de projet<select name="project_type"><option>Construction neuve</option><option>Rénovation</option><option>Extension</option><option>Clôture / mur</option><option>Chantier entreprise</option><option>Autre</option></select></label></div>
      <label>Liste des matériaux et quantités<textarea name="items" required minlength="5" rows="6" placeholder="ex.&#10;- Ciment CEM II 42.5 : 120 sacs&#10;- Fer HA 10 : 60 barres&#10;- Parpaing 15 : 1500 unités"></textarea></label>
      <div class="row"><label>Besoin pour le<input name="needed_by" type="date"></label>
        <label>Livraison<select name="delivery"><option value="true">Oui, livrer sur chantier</option><option value="false">Non, je récupère</option></select></label></div>
      <label>Email (optionnel)<input name="email" type="email"></label>
      <button class="btn primary" type="submit">Envoyer ma demande</button>
    </form></div>`;
  $('#rfq').onsubmit = async ev => {
    ev.preventDefault();
    const btn = $('#rfq button'); busy(btn, true);
    const f = formData(ev.target);
    const { error } = await sb.rpc('bati_create_rfq', {
      p_name: f.name, p_phone: f.phone, p_email: f.email || '', p_district: f.district, p_project_type: f.project_type,
      p_items: f.items, p_needed_by: f.needed_by || null, p_delivery: f.delivery === 'true'
    });
    busy(btn, false);
    if (error) return toast(errMsg(error), 'err');
    view.innerHTML = `<div class="card narrow"><h2>✔ Demande envoyée</h2><p>Les fournisseurs vont vous contacter au <b>${e(f.phone)}</b>. Comparez les offres avant de payer quoi que ce soit.</p><a class="btn ghost" href="#/">Voir les prix du jour</a></div>`;
  };
});

// ---------- Supplier auth ----------
route('/login', async view => {
  if (state.user) return go('/espace');
  authPage(view, {
    title: 'Espace fournisseurs (quincailleries, dépôts)',
    extraSignup: `<label>Nom de l'entreprise<input name="company_name"></label>`,
    onDone: async f => {
      await refresh();
      if (!state.profile) await ensureProfile('bati_profiles', { company_name: f.company_name || '', contact_name: f.full_name || '', phone: f.phone || '', whatsapp: f.phone || '' });
      await refresh(); go('/espace');
    }
  });
});

// ---------- Supplier dashboard ----------
route('/espace', async (view, _, q) => {
  if (!state.user) return go('/login');
  if (!state.profile) {
    const md = state.user.user_metadata || {};
    await ensureProfile('bati_profiles', { company_name: md.company_name || '', contact_name: md.full_name || '', phone: md.phone || '', whatsapp: md.phone || '' });
    await refresh();
  }
  const p = state.profile;
  const tab = q.t || 'rfq';
  view.innerHTML = `<div class="card">
    <div class="row" style="align-items:center"><div><h2 style="margin:0">${e(p.company_name || 'Mon entreprise')}</h2>
      <span class="muted small">${p.verified ? '<span class="badge active">Vérifié</span>' : '<span class="badge pending">En attente de vérification</span>'}
      ${isPro(p) ? ` <span class="badge pro">PRO</span> jusqu'au ${fmtDate(p.plan_until)}` : ` · ${p.credits} crédit(s)`}</span></div>
      <div style="text-align:right"><a class="btn accent" href="#/tarifs">Acheter des crédits / Pro</a></div></div>
    ${p.verified ? '' : '<p class="small">Complétez votre profil. Nous vous appelons pour vérifier votre activité (registre de commerce / magasin), puis vos prix apparaissent publiquement.</p>'}
    <div class="tabs" style="margin-top:1rem">
      <a class="tab ${tab === 'rfq' ? 'active' : ''}" href="#/espace?t=rfq">Demandes de devis</a>
      <a class="tab ${tab === 'prix' ? 'active' : ''}" href="#/espace?t=prix">Mes prix</a>
      <a class="tab ${tab === 'profil' ? 'active' : ''}" href="#/espace?t=profil">Profil</a>
      <a class="tab ${tab === 'paie' ? 'active' : ''}" href="#/espace?t=paie">Paiements</a>
    </div><div id="pane"></div></div>`;
  const pane = $('#pane');
  if (tab === 'rfq') return rfqPane(pane, p);
  if (tab === 'prix') return pricesPane(pane, p);
  if (tab === 'paie') {
    const { data } = await sb.from('bati_payments').select('*').eq('user_id', p.id).order('created_at', { ascending: false });
    pane.innerHTML = data.length ? `<table class="tbl"><tbody>${data.map(x => `<tr><td>${fmtDate(x.created_at)}</td><td>${e(PRODUCTS[x.product].label)}</td><td>${djf(x.amount_djf)}</td><td><span class="badge ${x.status}">${x.status}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucun paiement.</p>';
    return;
  }
  const CATS = ['Ciment & liants', 'Granulats', 'Acier', 'Maçonnerie', 'Bois & coffrage', 'Couverture', 'Finitions', 'Plomberie', 'Électricité'];
  pane.innerHTML = `<form id="pf" style="max-width:600px">
    <div class="row"><label>Entreprise<input name="company_name" required value="${e(p.company_name)}"></label><label>Contact<input name="contact_name" value="${e(p.contact_name)}"></label></div>
    <div class="row"><label>Téléphone<input name="phone" required value="${e(p.phone)}"></label><label>WhatsApp<input name="whatsapp" value="${e(p.whatsapp)}"></label></div>
    <label>Quartier<select name="district"><option value="">—</option>${DISTRICTS.map(d => `<option ${p.district === d ? 'selected' : ''}>${e(d)}</option>`).join('')}</select></label>
    <label>Catégories vendues</label><div class="checks">${CATS.map(c => `<label><input type="checkbox" name="categories" value="${e(c)}" ${p.categories.includes(c) ? 'checked' : ''}> ${e(c)}</label>`).join('')}</div>
    <label>Description<textarea name="description" maxlength="600">${e(p.description)}</textarea></label>
    <button class="btn primary">Enregistrer</button></form>`;
  $('#pf').onsubmit = async ev => {
    ev.preventDefault();
    const f = formData(ev.target); f.categories = [].concat(f.categories || []);
    try { await ensureProfile('bati_profiles', f); toast('Profil enregistré'); }
    catch (err) { toast(errMsg(err), 'err'); }
  };
});

async function rfqPane(pane, p) {
  const [{ data: rfqs, error }, { data: unlocks }] = await Promise.all([
    sb.from('bati_rfqs').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(50),
    sb.from('bati_unlocks').select('rfq_id').eq('supplier_id', p.id)
  ]);
  if (error) throw error;
  const mine = new Set(unlocks.map(u => u.rfq_id));
  pane.innerHTML = `<p class="muted small">Chaque demande peut être débloquée par 5 fournisseurs maximum. Débloquer = 1 crédit (illimité en Pro).</p>
    ${rfqs.map(r => `<div class="card" style="box-shadow:none;border:1px solid var(--line)">
      <div class="row"><div style="flex:3"><b>${e(r.project_type)}</b> · ${e(r.district)} · ${r.delivery ? 'livraison' : 'retrait'}
        ${r.needed_by ? ` · pour le ${fmtDate(r.needed_by)}` : ''}<br><span class="muted small">${fmtDate(r.created_at)} · ${r.unlock_count}/5 fournisseurs</span>
        <pre class="items">${e(r.items)}</pre><div class="contact" id="c-${r.id}"></div></div>
      <div style="flex:1;text-align:right">${mine.has(r.id) ? `<button class="btn sm primary" data-un="${r.id}">Voir le contact</button>`
        : r.unlock_count >= 5 ? '<span class="badge closed">Complet</span>' : `<button class="btn sm accent" data-un="${r.id}">Débloquer le contact</button>`}</div></div></div>`).join('')
    || '<p class="empty">Aucune demande ouverte pour le moment.</p>'}`;
  $$('[data-un]', pane).forEach(b => b.onclick = async () => {
    busy(b, true);
    const { data, error } = await sb.rpc('bati_unlock_rfq', { p_rfq: b.dataset.un });
    busy(b, false);
    if (error) {
      if (error.message.includes('NO_CREDITS')) { toast(errMsg(error), 'warn'); return go('/tarifs'); }
      return toast(errMsg(error), 'err');
    }
    const c = data[0];
    $('#c-' + b.dataset.un).innerHTML = `<p>📞 <b>${e(c.buyer_name)}</b> — <a href="tel:${e(c.phone)}">${e(c.phone)}</a>
      · <a class="btn sm wa" target="_blank" rel="noopener" href="${waLink(c.phone, `Bonjour ${c.buyer_name}, suite à votre demande de devis sur BatiPrix, voici notre offre :`)}">WhatsApp</a>
      ${c.email ? ` · ${e(c.email)}` : ''}</p>`;
    b.remove();
    await refresh();
  });
}

async function pricesPane(pane, p) {
  const [{ data: mats }, { data: mine }] = await Promise.all([
    sb.from('bati_materials').select('*').order('sort'),
    sb.from('bati_prices').select('*').eq('supplier_id', p.id)
  ]);
  const byId = Object.fromEntries(mine.map(x => [x.material_id, x]));
  pane.innerHTML = `<p class="muted small">Laissez vide ce que vous ne vendez pas. Les prix de plus de 45 jours sont masqués : pensez à cliquer « Enregistrer » chaque semaine.</p>
    <form id="prices"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Matériau</th><th>Unité</th><th>Prix (FDJ)</th><th>En stock</th><th>Mis à jour</th></tr></thead><tbody>
    ${mats.map(m => { const x = byId[m.id]; return `<tr><td>${e(m.name)}</td><td>${e(m.unit)}</td>
      <td><input type="number" min="1" name="p_${m.id}" value="${x ? x.price_djf : ''}" style="max-width:130px"></td>
      <td><input type="checkbox" name="s_${m.id}" ${!x || x.in_stock ? 'checked' : ''} style="width:auto"></td>
      <td class="small muted">${x ? fmtDate(x.updated_at) : ''}</td></tr>`; }).join('')}
    </tbody></table></div><button class="btn primary" style="margin-top:1rem">Enregistrer mes prix</button></form>`;
  $('#prices').onsubmit = async ev => {
    ev.preventDefault();
    const btn = $('#prices button'); busy(btn, true);
    const f = formData(ev.target);
    const rows = mats.filter(m => f['p_' + m.id]).map(m => ({ supplier_id: p.id, material_id: m.id, price_djf: Number(f['p_' + m.id]), in_stock: !!f['s_' + m.id] }));
    const removed = mats.filter(m => !f['p_' + m.id] && byId[m.id]).map(m => m.id);
    let { error } = rows.length ? await sb.from('bati_prices').upsert(rows) : { error: null };
    if (!error && removed.length) ({ error } = await sb.from('bati_prices').delete().eq('supplier_id', p.id).in('material_id', removed));
    busy(btn, false);
    error ? toast(errMsg(error), 'err') : (toast(`${rows.length} prix enregistrés`), render());
  };
}

// ---------- Pricing ----------
route('/tarifs', async view => {
  view.innerHTML = `<div class="card"><h2>Offres fournisseurs</h2>
  <p class="muted">Chaque demande de devis est un client prêt à acheter. Payez uniquement les contacts qui vous intéressent.</p>
  <div class="plans">
    <div class="plan"><h3>Démarrage</h3><p class="price-big">Gratuit</p><ul><li>Fiche fournisseur + prix publics</li><li>3 crédits offerts</li></ul></div>
    <div class="plan"><h3>10 crédits</h3><p class="price-big">5 000 FDJ</p><ul><li>10 contacts clients</li><li>500 FDJ / contact</li></ul><a class="btn accent" href="#/pay?product=credits_10">Acheter</a></div>
    <div class="plan"><h3>30 crédits</h3><p class="price-big">12 000 FDJ</p><ul><li>30 contacts clients</li><li>400 FDJ / contact</li></ul><a class="btn accent" href="#/pay?product=credits_30">Acheter</a></div>
    <div class="plan best"><h3>Pro</h3><p class="price-big">20 000 FDJ <small class="muted">/ mois</small></p><ul><li>Contacts illimités</li><li>Badge PRO, classé en 1er</li><li>Mis en avant dans l'annuaire</li></ul><a class="btn primary" href="#/pay?product=pro_month">Devenir Pro</a></div>
  </div></div>`;
});
route('/pay', async (view, _, q) => {
  if (!state.user) return go('/login');
  const prod = PRODUCTS[q.product];
  if (!prod) return go('/tarifs');
  paymentPage(view, { table: 'bati_payments', product: q.product, label: prod.label, amount: prod.price, back: '#/espace?t=paie' });
});

// ---------- Admin ----------
route('/admin', async (view, _, q) => {
  if (!state.profile?.is_admin) { view.innerHTML = '<div class="card">Accès réservé.</div>'; return; }
  const t = q.t || 'sup';
  view.innerHTML = `<div class="card"><h2>Administration</h2><div class="tabs">
    <a class="tab ${t === 'sup' ? 'active' : ''}" href="#/admin?t=sup">Fournisseurs</a>
    <a class="tab ${t === 'pay' ? 'active' : ''}" href="#/admin?t=pay">Paiements</a>
    <a class="tab ${t === 'rfq' ? 'active' : ''}" href="#/admin?t=rfq">Demandes</a></div><div id="adm"></div></div>`;
  const el = $('#adm');
  if (t === 'pay') return adminPayments(el, 'bati_payments', Object.fromEntries(Object.entries(PRODUCTS).map(([k, v]) => [k, v.label])));
  if (t === 'rfq') {
    const { data } = await sb.from('bati_rfqs').select('*, bati_rfq_contacts(*)').order('created_at', { ascending: false }).limit(100);
    el.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Client</th><th>Quartier</th><th>Débloqué</th><th>Statut</th><th></th></tr></thead><tbody>
      ${data.map(r => `<tr><td>${fmtDate(r.created_at)}</td><td>${e(r.bati_rfq_contacts?.buyer_name)}<br><span class="small">${e(r.bati_rfq_contacts?.phone)}</span></td><td>${e(r.district)}</td><td>${r.unlock_count}/5</td>
      <td><span class="badge ${r.status}">${r.status}</span></td><td>${r.status === 'open' ? `<button class="btn sm ghost" data-close="${r.id}">Fermer</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-close]', el).forEach(b => b.onclick = async () => { await sb.from('bati_rfqs').update({ status: 'closed' }).eq('id', b.dataset.close); render(); });
    return;
  }
  const { data } = await sb.from('bati_profiles').select('*').order('created_at', { ascending: false });
  el.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Entreprise</th><th>Contact</th><th>Quartier</th><th>Crédits / plan</th><th>Vérifié</th></tr></thead><tbody>
    ${data.map(s => `<tr><td><b>${e(s.company_name)}</b><br><span class="small muted">${e(s.categories.join(', '))}</span></td>
      <td>${e(s.contact_name)}<br><a href="tel:${e(s.phone)}">${e(s.phone)}</a></td><td>${e(s.district)}</td>
      <td>${s.credits} · ${isPro(s) ? 'PRO' : 'gratuit'}</td>
      <td><button class="btn sm ${s.verified ? 'ghost' : 'primary'}" data-ver="${s.id}" data-v="${!s.verified}">${s.verified ? 'Retirer' : 'Vérifier'}</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-ver]', el).forEach(b => b.onclick = async () => {
    const { error } = await sb.from('bati_profiles').update({ verified: b.dataset.v === 'true' }).eq('id', b.dataset.ver);
    error ? toast(errMsg(error), 'err') : render();
  });
});

sb.auth.onAuthStateChange(async ev => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') await refresh(); });
await refresh();
startRouter();
