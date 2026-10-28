/* Bordrom web: ana sayfadan maaş ya da görev seçilir, sorular tek tek sorulur, sonuç gösterilir, PDF alınır. Hiçbir şey saklanmaz. */
(function () {
  'use strict';

  const E = window.BordromEngine;
  const rates = window.BORDROM_RATES;
  const engine = E.createEngine(rates);
  const { tl, plain, r2, leaveHours, leaveTitle, WORKER_TITLES, COVERAGE, TRANSPORT_KINDS } = E;
  const RATE_YEAR = rates.year;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : 0; };
  const optNum = (v) => (v === '' || v == null ? null : num(v));
  const moneyFmt = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2, roundingMode: 'halfEven' });
  const money = (x) => moneyFmt.format(x);
  const pad = (n) => String(n).padStart(2, '0');

  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' });
  const shortFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const tileFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' });
  const dateOfKey = (k) => new Date(engine.dayOf(k) * 86400000);
  const longDay = (k) => dayFmt.format(dateOfKey(k));
  const shortDay = (k) => shortFmt.format(dateOfKey(k));
  const dotted = (k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;
  const hh = (h) => `${pad(h)}:00`;
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mondayIndex = (y, m, d) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;

  /** Bugünün Türkiye tarihi */
  function todayParts() {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return { y: +p.slice(0, 4), m: +p.slice(5, 7), d: +p.slice(8, 10), key: p };
  }

  /** Maaş her ayın 14'ünde yatar: 14'ünden sonra sıradaki aya geçilir */
  function currentPayMonth() {
    const t = todayParts();
    let y = t.y, m = t.m;
    if (t.d > 14) { m += 1; if (m > 12) { m = 1; y += 1; } }
    if (y < RATE_YEAR) return 1;
    if (y > RATE_YEAR) return 12;
    return m;
  }

  // MARK: Durum (yalnız bellekte)

  let tripSeq = 0;

  function newTrip() {
    return {
      id: ++tripSeq, destination: 'domestic', placeID: '', countryID: rates.foreign[0].id, exchangeRate: '', coverage: 'none',
      start: '', end: '', roundTrip: true, stayedAtHotel: true, hotelNights: '', transport: [],
      travelExtraOut: '', travelExtraBack: '', saturdaysWorked: '', sundaysWorked: '', weekendTravelDays: '',
      extraWorkHours: '', nightStartHour: '', nightEndHour: '', nightCount: '',
      // Tarih seçici (uygulamadaki gibi önce gidiş, sonra dönüş)
      phase: 'start', view: null, startTime: '08:00', endTime: '17:30',
    };
  }

  function freshState() {
    return {
      month: currentPayMonth(),
      grade: '', years: '', title: 'isci',
      taxMode: 'bracket', rate: null, cumulative: '',
      holidayOff: new Set(), extraHolidays: [],
      leaveYes: false, leaves: [], leaveUnpaid: false, leaveKind: 'full', leavePart: 'morning', hourlyDate: '', hourlyHours: 2,
      sick: [],
      meal: 'none', mealDays: 0, mealExtra: 0,
      trips: [],
      fsc35: 0, fsc80: 0, night: 0, gallery: 0,
      bonus: 0, carried: false, clothing: false, otherGross: 0, deductions: 0,
      // Tek görev hesabı (Görev hesapla)
      solo: Object.assign(newTrip(), { destination: null, extraYes: null, extraDaily: 2, extraDays: 1, nightYes: null, nightStartHour: 22, nightEndHour: 6, nightCount: 1 }),
      placeQuery: '',
    };
  }

  let state = freshState();
  let flow = null;      // 'maas' | 'gorev'
  let stepIndex = 0;
  let lastCalc = null;  // PDF dosya adı için

  const period = () => engine.period(RATE_YEAR, state.month);
  const periodKeys = () => { const p = period(); return { first: engine.keyOf(p.start), last: engine.keyOf(p.end - 1) }; };
  const inPeriod = (k) => { const d = engine.dayOf(k), p = period(); return d >= p.start && d < p.end; };
  const official = () => engine.officialHolidays(RATE_YEAR, state.month);
  function holidayDays() {
    const list = official().filter((k) => !state.holidayOff.has(k));
    for (const k of state.extraHolidays) if (!list.includes(k)) list.push(k);
    return list.sort();
  }
  const isJanuary = () => flow === 'maas' && state.month === 1;
  const taxBrackets = () => engine.taxTable(RATE_YEAR).brackets;
  const pct = (rate) => Math.round(rate * 100);
  const cumulative = () => num(state.cumulative);

  /** Vergi dilimi: seçilen dilim ya da elle girilen kümülatif matrahtan bulunan dilim */
  function taxRate() {
    if (isJanuary()) return taxBrackets()[0].rate;
    if (state.taxMode === 'manual') return cumulative() > 0 ? engine.bracketRate(cumulative(), RATE_YEAR) : null;
    return state.rate;
  }

  /** Bu aydan önceki kümülatif matrah: elle girildiyse o; dilim seçildiyse dilimin alt sınırı */
  function priorCumulative(rate) {
    if (isJanuary()) return 0;
    if (state.taxMode === 'manual') return cumulative();
    return engine.bracketLower(rate, RATE_YEAR);
  }

  const leavesInUse = () => (state.leaveYes ? state.leaves : []);

  function applyMonthDefaults() {
    state.bonus = state.month === 5 || state.month === 9 ? engine.payroll.bonusHours : 0;
    state.clothing = state.month === 10;
    state.holidayOff = new Set();
    state.extraHolidays = [];
  }

  // MARK: Simgeler

  const svg = (d, size = 20, w = 2.2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const iconTrash = svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 18);
  const iconPrev = svg('<path d="M15 6l-6 6 6 6"/>', 18, 2.6);
  const iconNext = svg('<path d="M9 6l6 6-6 6"/>', 18, 2.6);
  const iconClock = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 18);
  const TITLE_ICONS = {
    isci: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    postaBasi: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M17 14.5c2.4 0 4 1.5 4.6 4"/>',
    sef: '<path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    ustaBasi: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z"/>',
  };
  const DEST_ICONS = {
    domestic: '<path d="M4 17V8l8-5 8 5v9"/><path d="M4 17h16"/><path d="M9 17v-5h6v5"/>',
    abroad: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9S14.5 18.2 12 21c-2.5-2.8-3.8-5.8-3.8-9S9.5 5.8 12 3z"/>',
    kktc: '<path d="M2 19c3 0 3-2 6-2s3 2 6 2 3-2 6-2"/><path d="M5 14l3-8 4 5 3-3 4 6"/>',
  };

  // MARK: Sabit alanlar

  function fillStatic() {
    $$('[data-fill="version"]').forEach((el) => { el.textContent = rates.version; });
    $$('[data-fill="origin"]').forEach((el) => { el.textContent = rates.busFares.origin; });
    $$('[data-fill="clothing"]').forEach((el) => { el.textContent = `${tl(engine.payroll.clothingAid)} · genelde Ekim maaşında`; });

    $('#f-months').innerHTML = MONTHS.map((name, idx) => {
      const pp = engine.period(RATE_YEAR, idx + 1);
      return `<button type="button" class="month" role="radio" aria-checked="false" data-month="${idx + 1}"><b>14 ${name}</b><small>${esc(shortDay(engine.keyOf(pp.start)))} – ${esc(shortDay(engine.keyOf(pp.end - 1)))}</small></button>`;
    }).join('');

    // Gizlilik: derece seçiminde saat ücreti gösterilmez
    const gradeCount = rates.wageTable.hourly.length;
    let g = '<option value="">Derece seç</option>';
    for (let k = 1; k <= gradeCount; k++) g += `<option value="${k}">${k}. derece</option>`;
    $('#f-grade').innerHTML = g;
    $('#g-grade').innerHTML = g;

    const titles = ['isci', 'postaBasi', 'sef', 'ustaBasi'].map((id) => {
      const t = WORKER_TITLES[id];
      return `<button type="button" class="opt" role="radio" aria-checked="false" data-title="${id}"><span class="o-ico">${svg(TITLE_ICONS[id])}</span>
        <span class="txt"><b>${t.title}</b><small>${t.premiumRate ? `%${pct(t.premiumRate)} idareci primi` : 'İdareci primi yok'}</small></span></button>`;
    }).join('');
    $('#f-titles').innerHTML = titles;
    $('#g-titles').innerHTML = titles;

    const dests = [
      ['domestic', 'Yurt içi', `${rates.busFares.origin}'den otobüs fiyat listesi`],
      ['abroad', 'Yurt dışı', 'Ülkeye göre döviz gündeliği'],
      ['kktc', 'KKTC', 'Sabit gündelik'],
    ];
    $('#g-dests').innerHTML = dests.map(([id, title, sub]) =>
      `<button type="button" class="opt" role="radio" aria-checked="false" data-dest="${id}"><span class="o-ico">${svg(DEST_ICONS[id])}</span>
        <span class="txt"><b>${title}</b><small>${esc(sub)}</small></span></button>`).join('');

    $('#g-country').innerHTML = rates.foreign.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.currency)}</option>`).join('');
    $('#g-coverage').innerHTML = Object.entries(COVERAGE).map(([id, c]) => `<option value="${id}">${esc(c.title)}</option>`).join('');
    const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${hh(h)}</option>`).join('');
    $('#g-nstart').innerHTML = hours;
    $('#g-nend').innerHTML = hours;
  }

  function syncInputs() {
    $('#f-grade').value = String(state.grade);
    $('#g-grade').value = String(state.grade);
    $('#f-years').value = state.years;
    $('#f-fsc35').value = state.fsc35;
    $('#f-fsc80').value = state.fsc80;
    $('#f-night').value = state.night;
    $('#f-gallery').value = state.gallery;
    $('#f-carried').checked = state.carried;
    $('#f-clothing').checked = state.clothing;
    $('#f-other-gross').value = state.otherGross;
    $('#f-deductions').value = state.deductions;
    $('#f-meal-days').value = state.mealDays;
    $('#f-meal-extra').value = state.mealExtra;
    const s = state.solo;
    $('#g-country').value = s.countryID;
    $('#g-rate').value = s.exchangeRate;
    $('#g-coverage').value = s.coverage;
    $('#g-stayed').checked = s.stayedAtHotel;
    $('#g-round').checked = s.roundTrip;
    $('#g-out').value = s.travelExtraOut;
    $('#g-back').value = s.travelExtraBack;
    $('#g-sat').value = s.saturdaysWorked;
    $('#g-sun').value = s.sundaysWorked;
    $('#g-wtravel').value = s.weekendTravelDays;
    $('#g-extra-daily').value = s.extraDaily;
    $('#g-extra-days').value = s.extraDays;
    $('#g-nstart').value = String(s.nightStartHour);
    $('#g-nend').value = String(s.nightEndHour);
    $('#g-ncount').value = s.nightCount;
    $('#g-search').value = state.placeQuery;
  }

  // MARK: Takvim

  /** Ödeme dönemi takvimi: önceki ayın 15'i – bu ayın 14'ü, iki ay bloğu */
  function periodCalendar(kind, dayClass) {
    const p = period();
    const first = engine.keyOf(p.start), last = engine.keyOf(p.end - 1);
    const today = todayParts().key;
    const block = (y, m, from, to) => {
      let cells = WEEKDAYS.map((w) => `<span class="cal-wd">${w}</span>`).join('');
      cells += '<span></span>'.repeat(mondayIndex(y, m, from));
      for (let d = from; d <= to; d++) {
        const k = ymd(y, m, d);
        const cls = dayClass(k);
        const we = mondayIndex(y, m, d) >= 5 ? ' we' : '';
        cells += `<button type="button" class="day${we}${k === today ? ' today' : ''} ${cls}" data-cal="${kind}" data-key="${k}" aria-pressed="${/\bsel\b/.test(cls)}" aria-label="${esc(longDay(k))}">${d}</button>`;
      }
      return `<div class="cal-month"><div class="cal-title">${MONTHS[m - 1]} ${y}</div><div class="cal-grid">${cells}</div></div>`;
    };
    const y1 = +first.slice(0, 4), m1 = +first.slice(5, 7), y2 = +last.slice(0, 4), m2 = +last.slice(5, 7);
    return `<div class="cal">${block(y1, m1, 15, daysIn(y1, m1))}${block(y2, m2, 1, 14)}</div>`;
  }

  function holidayMarks(k, hol, half) {
    if (half.includes(k)) return ' half';
    return hol.includes(k) ? ' hol' : '';
  }

  // MARK: Maaş bölümleri

  function renderMonths() {
    $$('#f-months .month').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.month === state.month)));
    const k = periodKeys();
    $('#period-text').textContent = `Dönem: ${shortDay(k.first)} – ${shortDay(k.last)}`;
  }

  function renderTitles() {
    $$('[data-title]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.title === state.title)));
  }

  /** İki seçenek: dilimi seç ya da bordrodaki kümülatif matrahı elle gir */
  function renderTax() {
    $$('[data-tax-box]').forEach((box) => {
      const which = box.dataset.taxBox;
      if (which === 'm' && isJanuary()) {
        box.innerHTML = '<div class="infos"><p>Ocak maaşında yeni vergi yılı başlar; matrah sıfırlanır ve %15 diliminden hesaplanır. Bu soruyu geçebilirsin.</p></div>';
        return;
      }
      const manual = state.taxMode === 'manual';
      const modes = `<div class="seg" role="radiogroup" aria-label="Vergi dilimi nasıl girilsin">
          <button type="button" role="radio" aria-checked="${!manual}" data-tax-mode="bracket">Dilimi seç</button>
          <button type="button" role="radio" aria-checked="${manual}" data-tax-mode="manual">Elle gir</button></div>`;
      const body = manual
        ? `<div><label for="cum-${which}">Kümülatif vergi matrahı (₺)</label>
            <input id="cum-${which}" data-cum type="number" inputmode="decimal" min="0" step="0.01" placeholder="Ör. 245000" value="${esc(state.cumulative)}"></div>
           <p class="hint">Bir önceki ayın bordrosunda “KÜM. VRG. MATRAHI” satırındaki tutar. Dilimin bu tutardan bulunur ve vergi buradan devam ederek hesaplanır.</p>
           <div class="tax-result" data-cum-result></div>`
        : `<div class="seg five big" role="radiogroup" aria-label="Vergi dilimi">${taxBrackets().map((b) =>
            `<button type="button" role="radio" aria-checked="${state.rate === b.rate}" data-rate="${b.rate}">%${pct(b.rate)}</button>`).join('')}</div>
           <p class="hint">Bordronda vergi dilimi ya da gelir vergisi oranı olarak geçen yüzde. Bilmiyorsan “Elle gir”i seçip bordrondaki matrahı yaz.</p>`;
      box.innerHTML = modes + body;
    });
    renderCumResult();
  }

  function renderCumResult() {
    $$('[data-cum-result]').forEach((el) => {
      const c = cumulative();
      el.hidden = !(c > 0);
      if (c > 0) {
        const r = engine.bracketRate(c, RATE_YEAR);
        el.innerHTML = `<b>%${pct(r)}</b><span>${tl(c)} matrah %${pct(r)} dilimine denk geliyor.</span>`;
      }
    });
  }

  function renderHolidays() {
    const hol = holidayDays();
    const half = engine.halfHolidays(RATE_YEAR, state.month, hol);
    $('#holiday-cal').innerHTML = periodCalendar('holiday', (k) => (hol.includes(k) ? 'sel' : '') + (half.includes(k) ? ' half' : '')) +
      '<div class="cal-legend" style="margin-top: 10px"><span><i style="background: var(--acc)"></i>Tatil</span><span><i style="border: 1.5px solid #FFC56B; border-radius: 99px"></i>Arife (öğleden sonra tatil)</span></div>';
    const weekday = hol.filter((k) => mondayIndex(+k.slice(0, 4), +k.slice(5, 7), +k.slice(8, 10)) < 5);
    const h = engine.defaultHours(RATE_YEAR, state.month, hol);
    const info = [weekday.length
      ? `${weekday.length} hafta içi tatil günü · çalışma ${plain(h.worked)} sa, tatil ${plain(h.holiday)} sa`
      : 'Bu dönemde hafta içine denk gelen tatil yok.'];
    if (half.length) info.push(`Arife (${half.map(shortDay).join(', ')}): sabah 08.00–12.00 çalışılır, öğleden sonra 13.00–17.30 tatildir. İdari izinle tam gün tatil olduysa günü takvimden işaretle.`);
    $('#holiday-info').innerHTML = info.map((t) => `<p>${esc(t)}</p>`).join('');
  }

  function toggleHoliday(k) {
    if (official().includes(k)) {
      if (state.holidayOff.has(k)) state.holidayOff.delete(k); else state.holidayOff.add(k);
    } else if (state.extraHolidays.includes(k)) state.extraHolidays = state.extraHolidays.filter((x) => x !== k);
    else state.extraHolidays.push(k);
    renderHolidays();
  }

  /** "1 gün ücretli izin" / "12,5 saat ücretsiz izin" (uygulamadaki HomeView.leaveText) */
  function leaveText(hours, unpaid) {
    const days = hours / 8.5;
    const label = unpaid ? 'ücretsiz izin' : 'ücretli izin';
    return Math.abs(days * 2 - Math.round(days * 2)) < 0.01 ? `${plain(days)} gün ${label}` : `${plain(hours)} saat ${label}`;
  }

  /** Uygulamadaki daysBinding: takvim seçili türdeki (ücret, süre, yarım) izinleri gösterir */
  const leaveMatches = (l) => l.kind === state.leaveKind && !!l.unpaid === state.leaveUnpaid &&
    (state.leaveKind !== 'half' || (l.part || 'morning') === state.leavePart);

  function toggleLeaveDay(k) {
    const exists = state.leaves.some((l) => l.date === k && leaveMatches(l));
    if (exists) {
      state.leaves = state.leaves.filter((l) => !(l.date === k && leaveMatches(l)));
    } else {
      // Aynı gün başka türde girildiyse yenisi geçerli olur
      state.leaves = state.leaves.filter((l) => !(l.date === k && l.kind !== 'hourly'));
      const l = { id: Date.now() + Math.random(), date: k, kind: state.leaveKind, unpaid: state.leaveUnpaid };
      if (state.leaveKind === 'half') l.part = state.leavePart;
      state.leaves.push(l);
    }
  }

  function renderLeaveStep() {
    $$('[data-yes="leave"]').forEach((b) => b.setAttribute('aria-checked', String(state.leaveYes === (b.dataset.value === '1'))));
    $('#leave-box').hidden = !state.leaveYes;
    if (!state.leaveYes) return;
    $$('[data-leave-paid]').forEach((b) => b.setAttribute('aria-checked', String(state.leaveUnpaid === (b.dataset.leavePaid === '1'))));
    $$('[data-leave-kind]').forEach((b) => b.setAttribute('aria-checked', String(state.leaveKind === b.dataset.leaveKind)));
    $$('[data-leave-part]').forEach((b) => b.setAttribute('aria-checked', String(state.leavePart === b.dataset.leavePart)));
    const hourly = state.leaveKind === 'hourly';
    $('#leave-part').hidden = state.leaveKind !== 'half';
    $('#leave-hourly').hidden = !hourly;
    $('#leave-hours').textContent = `${plain(state.hourlyHours)} saat`;
    $('#leave-cal-hint').textContent = hourly
      ? 'İzin gününe dokun, süreyi seç ve ekle.'
      : 'İzinli olduğun günlere dokun; tekrar dokunursan kaldırılır. Çerçeveli günlerde başka türde izin var.';
    const hol = holidayDays();
    const half = engine.halfHolidays(RATE_YEAR, state.month, hol);
    $('#leave-cal').innerHTML = periodCalendar('leave', (k) => {
      const sel = hourly ? k === state.hourlyDate : state.leaves.some((l) => l.date === k && leaveMatches(l));
      const has = !sel && state.leaves.some((l) => l.date === k);
      return (sel ? 'sel' : '') + (has ? ' has' : '') + holidayMarks(k, hol, half);
    });
    renderLeaves();
  }

  function renderLeaves() {
    const hol = holidayDays();
    const box = $('#leave-list');
    if (!state.leaves.length) { box.innerHTML = '<p class="hint">Henüz izin günü seçilmedi.</p>'; return; }
    const sorted = state.leaves.slice().sort((a, b) => a.date.localeCompare(b.date));
    const rows = sorted.map((l) => {
      const counted = engine.countedHours(l, hol);
      let note = '';
      if (counted === 0 && !engine.isWorkday(l.date, hol)) note = 'tatil günü, sayılmaz';
      else if (engine.isHalfHoliday(l.date, hol)) note = counted === 0 ? 'arife öğleden sonrası zaten tatil, sayılmaz' : `arife, ${plain(counted)} sa sayılır`;
      return `<div class="row">
        <span class="info"><span class="when">${esc(longDay(l.date))}</span>
        <span class="what">${esc(leaveTitle(l))} · ${plain(leaveHours(l))} sa${note ? `<small>${esc(note)}</small>` : ''}</span></span>
        <button type="button" class="paid-tag${l.unpaid ? ' unpaid' : ''}" data-action="toggle-paid" data-id="${l.id}" aria-label="${l.unpaid ? 'Ücretsiz' : 'Ücretli'}; değiştirmek için dokun">${l.unpaid ? 'Ücretsiz' : 'Ücretli'}</button>
        <button type="button" class="icon-btn" data-action="remove-leave" data-id="${l.id}" aria-label="${esc(shortDay(l.date))} iznini sil">${iconTrash}</button>
      </div>`;
    });
    const t = engine.leaveTotals(state.leaves, hol);
    box.innerHTML = `<div class="list">${rows.join('')}</div>
      <div class="totals"><span>Ücretli izin <strong>${plain(t.paid)} sa</strong></span>${t.unpaid ? `<span>Ücretsiz izin <strong>${plain(t.unpaid)} sa</strong></span>` : ''}<span>Etikete dokunarak ücretli/ücretsiz değiştirebilirsin.</span></div>`;
  }

  function renderSick() {
    const hol = holidayDays();
    const half = engine.halfHolidays(RATE_YEAR, state.month, hol);
    $('#sick-cal').innerHTML = periodCalendar('sick', (k) => (state.sick.includes(k) ? 'sel' : '') + holidayMarks(k, hol, half));
    $('#sick-info').textContent = state.sick.length ? `${state.sick.length} gün rapor` : '';
  }

  function renderMeal() {
    $$('#f-meal .opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.meal === state.meal)));
    $('#meal-fields').hidden = state.meal === 'none';
    $('#meal-days-wrap').hidden = state.meal !== 'custom';
  }

  function renderBonus() {
    $$('#f-bonus .opt').forEach((b) => b.setAttribute('aria-checked', String(num(b.dataset.bonus) === state.bonus)));
  }

  // MARK: Görev tarih seçici (uygulamadaki gibi: gidiş gününe dokun, ardından dönüş sorulur)

  const tripByKey = (key) => (key === 'solo' ? state.solo : state.trips.find((x) => String(x.id) === String(key)));
  const datePart = (s) => (s ? s.slice(0, 10) : '');
  const timePart = (s, fallback) => (s ? s.slice(11, 16) : fallback);

  function addHour(s) {
    const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13) + 1, +s.slice(14, 16)));
    return `${ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }

  function defaultView(t) {
    if (t.view) return t.view;
    const base = datePart(t.phase === 'end' ? t.end || t.start : t.start);
    if (base) return base.slice(0, 7);
    const today = todayParts().key;
    if (t === state.solo) return today.slice(0, 7);
    // Maaştaki görev: bugün dönemin içindeyse bu ay, değilse dönemin son ayı
    const k = periodKeys();
    return (today >= k.first && today <= k.last ? today : k.last).slice(0, 7);
  }

  function pickTripDay(t, key, k) {
    if (t.phase === 'start') {
      t.start = `${k}T${t.startTime}`;
      if (!t.end || t.end <= t.start) t.end = `${k}T${t.endTime}`;
      if (t.end <= t.start) t.end = addHour(t.start);
      t.hotelNights = '';
      rerenderDates(key);
      setTimeout(() => { if (t.phase === 'start') { t.phase = 'end'; t.view = k.slice(0, 7); rerenderDates(key); } }, 250);
    } else {
      const merged = `${k}T${t.endTime}`;
      t.end = merged > t.start ? merged : addHour(t.start);
      t.hotelNights = '';
      rerenderDates(key);
    }
  }

  function setTripTime(t, part, value) {
    const field = t.phase === 'start' ? 'startTime' : 'endTime';
    const cur = t[field].split(':');
    if (part === 'h') cur[0] = pad(value); else cur[1] = pad(value);
    t[field] = cur.join(':');
    const dt = t.phase === 'start' ? t.start : t.end;
    if (dt) t[t.phase] = `${datePart(dt)}T${t[field]}`;
  }

  function datePickerHTML(t, key) {
    const view = defaultView(t);
    const y = +view.slice(0, 4), m = +view.slice(5, 7);
    const sd = datePart(t.start), ed = datePart(t.end);
    const today = todayParts().key;
    let cells = WEEKDAYS.map((w) => `<span class="cal-wd">${w}</span>`).join('');
    cells += '<span></span>'.repeat(mondayIndex(y, m, 1));
    for (let d = 1; d <= daysIn(y, m); d++) {
      const k = ymd(y, m, d);
      let cls = mondayIndex(y, m, d) >= 5 ? ' we' : '';
      if (k === today) cls += ' today';
      if (k === sd) cls += ' start';
      else if (k === ed) cls += ' end';
      else if (sd && ed && k > sd && k < ed) cls += ' in-range';
      const dis = t.phase === 'end' && sd && k < sd;
      if (dis) cls += ' dis';
      cells += `<button type="button" class="day${cls}" data-tday="${k}" data-tkey="${key}"${dis ? ' disabled' : ''} aria-label="${esc(longDay(k))}">${d}</button>`;
    }
    const tile = (phase, label, dt, fallback) => `<button type="button" class="dtile${t.phase === phase ? ' on' : ''}" data-tphase="${phase}" data-tkey="${key}" aria-pressed="${t.phase === phase}">
        <small>${label}</small><b>${dt ? esc(tileFmt.format(dateOfKey(datePart(dt)))) : 'Seç'}</b><span>${esc(timePart(dt, fallback))}</span></button>`;
    const time = t.phase === 'start' ? t.startTime : t.endTime;
    const [th, tm] = time.split(':').map(Number);
    const mins = [0, 15, 30, 45];
    if (!mins.includes(tm)) mins.push(tm);
    const hourSel = Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === th ? ' selected' : ''}>${pad(h)}</option>`).join('');
    const minSel = mins.sort((a, b) => a - b).map((mm) => `<option value="${mm}"${mm === tm ? ' selected' : ''}>${pad(mm)}</option>`).join('');
    let pills = '';
    if (validDates(t)) {
      const days = engine.calculateTrip(engine.worker(1, 0.15, 'isci'), tripModel(t)).taskDays;
      pills = `<div class="pills"><span>☀︎ ${days} görev günü</span><span>☾ ${engine.tripNights(tripModel(t))} gece</span></div>`;
    }
    return `<div class="datepick">
      <div class="dtiles">${tile('start', 'GİDİŞ', t.start, t.startTime)}${tile('end', 'DÖNÜŞ', t.end, t.endTime)}</div>
      <div class="cal"><div class="cal-month">
        <div class="cal-title"><button type="button" class="cal-nav" data-tnav="-1" data-tkey="${key}" aria-label="Önceki ay">${iconPrev}</button>
          <span>${MONTHS[m - 1]} ${y}</span>
          <button type="button" class="cal-nav" data-tnav="1" data-tkey="${key}" aria-label="Sonraki ay">${iconNext}</button></div>
        <div class="cal-grid">${cells}</div></div></div>
      <div class="time-row"><span class="tl">${iconClock}${t.phase === 'start' ? 'Hareket saati' : 'Dönüş saati'}</span>
        <select data-ttime="h" data-tkey="${key}" aria-label="Saat">${hourSel}</select>
        <select data-ttime="m" data-tkey="${key}" aria-label="Dakika">${minSel}</select></div>
      ${pills}
    </div>`;
  }

  function rerenderDates(key) {
    if (key === 'solo') renderSoloDates();
    else { const t = tripByKey(key); if (t) rerenderTrip(t); }
  }

  // MARK: Maaştaki görevler

  const sortedPlaces = rates.busFares.items.slice().sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  /** Formdaki görev → motorun görev modeli */
  function tripModel(t) {
    return {
      destination: t.destination, start: t.start, end: t.end,
      placeID: t.destination === 'domestic' && t.placeID ? t.placeID : null,
      countryID: t.countryID, exchangeRate: num(t.exchangeRate), coverage: t.coverage,
      roundTrip: t.roundTrip, stayedAtHotel: t.stayedAtHotel, hotelNights: optNum(t.hotelNights),
      transport: t.transport.map((x) => ({ kind: x.kind, amount: num(x.amount) })),
      travelExtraOut: num(t.travelExtraOut), travelExtraBack: num(t.travelExtraBack),
      saturdaysWorked: optNum(t.saturdaysWorked), sundaysWorked: optNum(t.sundaysWorked),
      weekendTravelDays: optNum(t.weekendTravelDays), extraWorkHours: num(t.extraWorkHours),
      nightStartHour: t.nightStartHour === '' ? null : +t.nightStartHour,
      nightEndHour: t.nightEndHour === '' ? null : +t.nightEndHour,
      nightCount: num(t.nightCount),
    };
  }

  const validDates = (t) => /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(t.start) && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(t.end) && t.end > t.start;

  function tripProblems(t) {
    const out = [];
    if (!t.start || !t.end) out.push('gidiş ve dönüş gününü seç');
    else if (!validDates(t)) out.push('dönüş, gidişten sonra olmalı');
    else if (!engine.tripInPeriod(tripModel(t), RATE_YEAR, state.month)) out.push('dönüşü bu ödeme dönemi içinde olmalı');
    if (t.destination === 'abroad' && !(num(t.exchangeRate) > 0)) out.push('döviz kurunu gir');
    return out;
  }

  const hourOptions = (sel) => '<option value="">Seç</option>' + Array.from({ length: 24 }, (_, h) => `<option value="${h}"${String(sel) === String(h) ? ' selected' : ''}>${hh(h)}</option>`).join('');

  function tripCard(t, index) {
    const sel = (v, cur) => (String(v) === String(cur) ? ' selected' : '');
    const f = (field, label, attrs = '', value = t[field]) =>
      `<div><label for="t${t.id}-${field}">${label}</label><input id="t${t.id}-${field}" data-trip="${t.id}" data-field="${field}" value="${esc(value)}" ${attrs}></div>`;
    let dest = '';
    if (t.destination === 'domestic') {
      dest = `<div><label for="t${t.id}-placeID">Görev yeri</label><select id="t${t.id}-placeID" data-trip="${t.id}" data-field="placeID">
        <option value="">Seç (otobüs ücreti için)</option>${sortedPlaces.map((p) => `<option value="${p.id}"${sel(p.id, t.placeID)}>${esc(p.name)}</option>`).join('')}</select></div>`;
    } else if (t.destination === 'abroad') {
      const c = rates.foreign.find((x) => x.id === t.countryID) || rates.foreign[0];
      dest = `<div><label for="t${t.id}-countryID">Ülke</label><select id="t${t.id}-countryID" data-trip="${t.id}" data-field="countryID">
        ${rates.foreign.map((x) => `<option value="${x.id}"${sel(x.id, t.countryID)}>${esc(x.name)}</option>`).join('')}</select></div>
        ${f('exchangeRate', `Kur (1 ${esc(c.currency)} = ? ₺)`, 'type="number" inputmode="decimal" min="0" step="0.0001" placeholder="TCMB döviz satış"')}
        <div><label for="t${t.id}-coverage">Karşılanan masraf</label><select id="t${t.id}-coverage" data-trip="${t.id}" data-field="coverage">
        ${Object.entries(COVERAGE).map(([id, cv]) => `<option value="${id}"${sel(id, t.coverage)}>${esc(cv.title)}</option>`).join('')}</select></div>`;
    }
    const auto = validDates(t) ? engine.autoWeekend(tripModel(t)) : null;
    const nightsTotal = validDates(t) ? engine.tripNights(tripModel(t)) : null;
    const transport = t.transport.map((x, xi) => `<div class="transport-row">
        <div><label for="t${t.id}-tk${xi}">Ek yol gideri</label><select id="t${t.id}-tk${xi}" data-trip="${t.id}" data-transport="${xi}" data-key="kind">
          ${Object.entries(TRANSPORT_KINDS).map(([id, name]) => `<option value="${id}"${sel(id, x.kind)}>${name}</option>`).join('')}</select></div>
        <div><label for="t${t.id}-ta${xi}">Tutar (₺)</label><input id="t${t.id}-ta${xi}" type="number" inputmode="decimal" min="0" step="0.01" data-trip="${t.id}" data-transport="${xi}" data-key="amount" value="${esc(x.amount)}"></div>
        <button type="button" class="icon-btn" data-action="remove-transport" data-trip="${t.id}" data-index="${xi}" aria-label="Ek yol giderini sil">${iconTrash}</button>
      </div>`).join('');
    return `<article class="trip" data-card="${t.id}">
      <div class="trip-head"><h3>Görev ${index + 1}</h3>
        <button type="button" class="icon-btn" data-action="remove-trip" data-trip="${t.id}" aria-label="Görev ${index + 1}'i sil">${iconTrash}</button></div>
      <div class="seg three" role="radiogroup" aria-label="Görev yeri türü">
        ${['domestic', 'abroad', 'kktc'].map((d) => `<button type="button" role="radio" aria-checked="${t.destination === d}" data-action="trip-dest" data-trip="${t.id}" data-dest-trip="${d}">${{ domestic: 'Yurt içi', abroad: 'Yurt dışı', kktc: 'KKTC' }[d]}</button>`).join('')}
      </div>
      ${dest ? `<div class="row2">${dest}</div>` : ''}
      <p class="hint">${t.phase === 'start' ? 'Gidiş gününe dokun; ardından dönüş günü sorulur.' : 'Şimdi dönüş gününe dokun.'}</p>
      ${datePickerHTML(t, t.id)}
      <div class="row2">
        ${t.destination === 'domestic' ? `<label class="check"><input type="checkbox" data-trip="${t.id}" data-field="roundTrip"${t.roundTrip ? ' checked' : ''}><span>Gidiş-dönüş yol ücreti</span></label>` : ''}
        <label class="check"><input type="checkbox" data-trip="${t.id}" data-field="stayedAtHotel"${t.stayedAtHotel ? ' checked' : ''}><span>Otelde kaldım</span></label>
        ${t.stayedAtHotel ? f('hotelNights', 'Otel gecesi', `type="number" inputmode="numeric" min="0" step="1" placeholder="${nightsTotal == null ? 'Tüm geceler' : `Tüm geceler: ${nightsTotal}`}"`) : ''}
      </div>
      ${transport}
      <button type="button" class="btn line" data-action="add-transport" data-trip="${t.id}">+ Ek yol gideri (taksi, uçak…)</button>
      <details${t.open ? ' open' : ''} data-trip-details="${t.id}">
        <summary>Fazla mesai, hafta sonu ve gece çalışması</summary>
        <div class="row2">
          ${f('travelExtraOut', 'Gidişte mesai dışı yol (sa, en çok 3)', 'type="number" inputmode="decimal" min="0" max="3" step="0.5" placeholder="0"')}
          ${t.destination !== 'domestic' || t.roundTrip ? f('travelExtraBack', 'Dönüşte mesai dışı yol (sa, en çok 3)', 'type="number" inputmode="decimal" min="0" max="3" step="0.5" placeholder="0"') : ''}
          ${f('saturdaysWorked', 'Çalışılan Cumartesi', `type="number" inputmode="numeric" min="0" step="1" placeholder="${auto ? `Otomatik: ${auto.saturdays}` : 'Otomatik'}"`)}
          ${f('sundaysWorked', 'Çalışılan Pazar', `type="number" inputmode="numeric" min="0" step="1" placeholder="${auto ? `Otomatik: ${auto.sundays}` : 'Otomatik'}"`)}
          ${f('weekendTravelDays', 'Hafta sonuna denk gelen yol günü', `type="number" inputmode="numeric" min="0" max="2" step="1" placeholder="${auto ? `Otomatik: ${auto.travel}` : 'Otomatik'}"`)}
          ${f('extraWorkHours', 'Görevde fazla mesai (toplam sa)', 'type="number" inputmode="decimal" min="0" step="0.5" placeholder="0"')}
          <div><label for="t${t.id}-nightStartHour">Gece çalışması başlangıç</label><select id="t${t.id}-nightStartHour" data-trip="${t.id}" data-field="nightStartHour">${hourOptions(t.nightStartHour)}</select></div>
          <div><label for="t${t.id}-nightEndHour">Gece çalışması bitiş</label><select id="t${t.id}-nightEndHour" data-trip="${t.id}" data-field="nightEndHour">${hourOptions(t.nightEndHour)}</select></div>
          ${f('nightCount', 'Gece çalışılan gün', 'type="number" inputmode="numeric" min="0" step="1" placeholder="0"')}
        </div>
        <p class="hint" style="margin-top: 10px">Cumartesi ve yol fazla süresi haftada 2,5 saate kadar %35, üstü %80 ödenir. Pazar çalışmasına 2 günlük ilave ücret eklenir.</p>
      </details>
      <p class="hint" data-trip-preview="${t.id}" aria-live="polite"></p>
    </article>`;
  }

  function renderTrips() {
    $('#trip-list').innerHTML = state.trips.map(tripCard).join('');
    state.trips.forEach(updateTripPreview);
  }

  function rerenderTrip(t) {
    const card = $(`[data-card="${t.id}"]`);
    if (!card) return;
    const focusId = document.activeElement && document.activeElement.id;
    const tmp = document.createElement('div');
    tmp.innerHTML = tripCard(t, state.trips.indexOf(t));
    card.replaceWith(tmp.firstElementChild);
    updateTripPreview(t);
    if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
  }

  function updateTripPreview(t) {
    const el = $(`[data-trip-preview="${t.id}"]`);
    if (!el) return;
    const problems = tripProblems(t);
    if (problems.length) {
      el.className = 'hint' + (t.start && t.end ? ' warn' : '');
      el.textContent = t.start && t.end ? `Görev hesaplanamadı: ${problems.join(', ')}.` : 'Tarihleri seçince harcırah burada görünür.';
      return;
    }
    const w = engine.worker(+state.grade || 1, taxRate() || 0.15, state.title);
    const r = engine.calculateTrip(w, tripModel(t));
    el.className = 'hint';
    el.textContent = `${r.taskDays} gün · banka ile ${tl(r.bankaTL)} (gündelik, otel, yol) · bordroya ${tl(r.primTL + r.mealTL)} (prim, yemek)` +
      (r.missingPlace ? ' · görev yeri seçilmediği için otobüs ücreti yok' : '');
  }

  // MARK: Tek görev (Görev hesapla)

  const SOLO_FIELDS = {
    'g-country': 'countryID', 'g-rate': 'exchangeRate', 'g-coverage': 'coverage',
    'g-stayed': 'stayedAtHotel', 'g-round': 'roundTrip', 'g-out': 'travelExtraOut', 'g-back': 'travelExtraBack',
    'g-sat': 'saturdaysWorked', 'g-sun': 'sundaysWorked', 'g-wtravel': 'weekendTravelDays',
    'g-extra-daily': 'extraDaily', 'g-extra-days': 'extraDays', 'g-nstart': 'nightStartHour', 'g-nend': 'nightEndHour', 'g-ncount': 'nightCount',
  };

  /** Sihirbazdaki tek görev → motorun görev modeli */
  function soloModel() {
    const s = state.solo;
    const m = tripModel(s);
    m.extraWorkHours = s.extraYes ? r2(num(s.extraDaily) * num(s.extraDays)) : 0;
    if (!s.nightYes) { m.nightStartHour = null; m.nightEndHour = null; m.nightCount = 0; }
    return m;
  }

  function placeName(m) {
    if (m.destination === 'abroad') return (rates.foreign.find((c) => c.id === m.countryID) || {}).name || 'Yurt dışı';
    if (m.destination === 'kktc') return 'KKTC';
    return (rates.busFares.items.find((b) => b.id === m.placeID) || {}).name || 'Yurt içi';
  }

  function renderDests() {
    $$('#g-dests .opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.dest === state.solo.destination)));
  }

  function renderPlace() {
    const s = state.solo;
    const abroad = s.destination === 'abroad';
    $('#g-domestic').hidden = abroad;
    $('#g-abroad').hidden = !abroad;
    $('#g-place-title').textContent = abroad ? 'Hangi ülke?' : 'Görev yeri neresi?';
    $('#g-place-sub').textContent = abroad
      ? 'Yurt dışı gündelik cetvelindeki ülkeler. Kuru TCMB döviz satış kurundan gir.'
      : `${rates.busFares.origin}'den otobüs ücreti bu listeden alınır.`;
    if (abroad) {
      const c = rates.foreign.find((x) => x.id === s.countryID) || rates.foreign[0];
      $('#g-rate-label').textContent = `Kur (1 ${c.currency} = ? ₺)`;
      return;
    }
    const q = state.placeQuery.trim().toLocaleLowerCase('tr');
    const list = q ? sortedPlaces.filter((p) => p.name.toLocaleLowerCase('tr').includes(q)) : sortedPlaces;
    $('#g-places').innerHTML = list.length
      ? list.map((p) => `<button type="button" class="place" role="radio" aria-checked="${p.id === s.placeID}" data-place="${p.id}"><span>${esc(p.name)}</span>${p.fare != null ? `<small>${tl(p.fare)}</small>` : ''}</button>`).join('')
      : '<p class="hint">Bu adla yer bulunamadı.</p>';
  }

  function renderSoloDates() {
    const s = state.solo;
    $('#g-dates-sub').textContent = s.phase === 'start' ? 'Gidiş gününe dokun; ardından dönüş günü sorulur.' : 'Şimdi dönüş gününe dokun.';
    $('#g-datepicker').innerHTML = datePickerHTML(s, 'solo');
  }

  function renderHotel() {
    const s = state.solo;
    const total = validDates(s) ? engine.tripNights(soloModel()) : 0;
    $('#g-hotel-sub').textContent = `Görevde toplam ${total} gece var. Yolda (otobüste) geçen geceleri düşün.`;
    $('#g-nights-wrap').hidden = !s.stayedAtHotel;
    const n = s.hotelNights === '' ? total : Math.min(num(s.hotelNights), total);
    $('#g-nights').textContent = `${n} gece`;
    $('[data-action="nights"][data-delta="-1"]').disabled = n <= 0;
    $('[data-action="nights"][data-delta="1"]').disabled = n >= total;
  }

  function renderTravel() {
    const s = state.solo;
    const domestic = s.destination === 'domestic';
    $('#g-round-wrap').hidden = !domestic;
    const fare = domestic ? sortedPlaces.find((p) => p.id === s.placeID) : null;
    $('#g-round-hint').textContent = fare && fare.fare != null ? `${fare.name}: tek yön ${tl(fare.fare)}` : 'Görev yeri seçilmediyse otobüs ücreti eklenmez';
    $('#g-back-wrap').hidden = domestic && !s.roundTrip;
    const auto = validDates(s) ? engine.autoWeekend(soloModel()) : null;
    $('#g-sat').placeholder = auto ? `Otomatik: ${auto.saturdays}` : 'Otomatik';
    $('#g-sun').placeholder = auto ? `Otomatik: ${auto.sundays}` : 'Otomatik';
    $('#g-wtravel').placeholder = auto ? `Otomatik: ${auto.travel}` : 'Otomatik';
    const sel = (v, cur) => (String(v) === String(cur) ? ' selected' : '');
    $('#g-transport').innerHTML = s.transport.map((x, xi) => `<div class="transport-row">
        <div><label for="g-tk${xi}">Ek yol gideri</label><select id="g-tk${xi}" data-gtransport="${xi}" data-key="kind">
          ${Object.entries(TRANSPORT_KINDS).map(([id, name]) => `<option value="${id}"${sel(id, x.kind)}>${name}</option>`).join('')}</select></div>
        <div><label for="g-ta${xi}">Tutar (₺)</label><input id="g-ta${xi}" type="number" inputmode="decimal" min="0" step="0.01" data-gtransport="${xi}" data-key="amount" value="${esc(x.amount)}"></div>
        <button type="button" class="icon-btn" data-action="g-remove-transport" data-index="${xi}" aria-label="Ek yol giderini sil">${iconTrash}</button>
      </div>`).join('');
  }

  function renderYes() {
    const s = state.solo;
    $$('[data-yes="extra"], [data-yes="night"]').forEach((b) => {
      const v = b.dataset.yes === 'extra' ? s.extraYes : s.nightYes;
      b.setAttribute('aria-checked', String(v != null && v === (b.dataset.value === '1')));
    });
    $('#g-extra-fields').hidden = !s.extraYes;
    $('#g-extra-total').textContent = s.extraYes ? `Toplam ${plain(r2(num(s.extraDaily) * num(s.extraDays)))} saat · net fazla mesai olarak eklenir` : '';
    $('#g-night-fields').hidden = !s.nightYes;
    const w = engine.worker(1, 0.15, state.title);
    $('#g-night-sub').textContent = `Çalışma başlangıç ve bitiş saatini seç; 20:00–08:00 arasına düşen saatler gece çalışması sayılır ve her saat için saat ücretinin %${pct(w.nightRate)}'si prim ödenir. Ör. 14:00–24:00 → 4 saat.`;
    if (s.nightYes) {
      const per = engine.nightHoursPerNight({ nightStartHour: +s.nightStartHour, nightEndHour: +s.nightEndHour });
      $('#g-night-total').textContent = `Günde ${plain(per)} saat · toplam ${plain(per * num(s.nightCount))} saat gece çalışması`;
    } else $('#g-night-total').textContent = '';
  }

  // MARK: Sihirbaz

  const FLOWS = {
    maas: { label: 'Maaş hesabı', steps: ['m-welcome', 'm-month', 'm-grade', 'm-bracket', 'm-holidays', 'm-leave', 'm-sick', 'm-meal', 'm-trips', 'm-overtime', 'm-extras'] },
    gorev: { label: 'Görev hesabı', steps: ['g-welcome', 'g-title', 'g-grade', 'g-dest', 'g-place', 'g-dates', 'g-hotel', 'g-travel', 'g-extra', 'g-night'] },
  };

  /** Atlanacak sorular */
  const SKIP = {
    'g-place': () => state.solo.destination === 'kktc',
  };

  /** Her sorunun girişte yenilenen kısmı */
  const ENTER = {
    'm-month': renderMonths,
    'm-grade': renderTitles,
    'm-bracket': renderTax,
    'm-holidays': renderHolidays,
    'm-leave': renderLeaveStep,
    'm-sick': renderSick,
    'm-meal': renderMeal,
    'm-trips': renderTrips,
    'm-extras': () => { syncInputs(); renderBonus(); },
    'g-title': renderTitles,
    'g-grade': renderTax,
    'g-dest': renderDests,
    'g-place': renderPlace,
    'g-dates': renderSoloDates,
    'g-hotel': renderHotel,
    'g-travel': renderTravel,
    'g-extra': renderYes,
    'g-night': renderYes,
  };

  const taxProblem = () => (taxRate() == null
    ? [{ el: $(state.taxMode === 'manual' ? '[data-cum]' : '[data-tax-box] [data-rate]'), msg: state.taxMode === 'manual' ? 'Kümülatif vergi matrahını yaz.' : 'Vergi dilimini seç.' }]
    : []);

  /** Sorudan çıkmadan önce denetim: sorun varsa { el, msg } */
  const CHECK = {
    'm-grade': () => {
      const out = [];
      if (!state.grade) out.push({ el: $('#f-grade'), msg: 'Ücret dereceni seç.' });
      const y = state.years === '' ? NaN : num(state.years);
      if (!(y >= 0 && y <= 45) || !Number.isInteger(y)) out.push({ el: $('#f-years'), msg: 'Hizmet yılını tam sayı olarak gir.' });
      return out;
    },
    'm-bracket': taxProblem,
    'm-trips': () => state.trips.flatMap((t, idx) => {
      const p = tripProblems(t);
      return p.length ? [{ el: $(`[data-card="${t.id}"] .dtile`), msg: `Görev ${idx + 1}: ${p.join(', ')}.` }] : [];
    }),
    'g-grade': () => (state.grade ? [] : [{ el: $('#g-grade'), msg: 'Ücret dereceni seç.' }]).concat(taxProblem()),
    'g-dest': () => (state.solo.destination ? [] : [{ el: $('#g-dests .opt'), msg: 'Görev yerinin türünü seç.' }]),
    'g-place': () => {
      const s = state.solo;
      if (s.destination === 'abroad') return num(s.exchangeRate) > 0 ? [] : [{ el: $('#g-rate'), msg: 'Döviz kurunu gir.' }];
      return s.placeID ? [] : [{ el: $('#g-search'), msg: 'Listeden görev yerini seç.' }];
    },
    'g-dates': () => {
      const s = state.solo;
      if (!s.start || !s.end) return [{ el: $('#g-datepicker .dtile'), msg: 'Gidiş ve dönüş gününü seç.' }];
      return validDates(s) ? [] : [{ el: $('#g-datepicker .dtile'), msg: 'Dönüş, gidişten sonra olmalı.' }];
    },
    'g-extra': () => {
      const s = state.solo;
      if (s.extraYes == null) return [{ el: $('[data-yes="extra"]'), msg: 'Hayır ya da Evet seç.' }];
      if (s.extraYes && !(num(s.extraDaily) > 0 && num(s.extraDays) >= 1)) return [{ el: $('#g-extra-daily'), msg: 'Saat ve gün sayısını gir.' }];
      return [];
    },
    'g-night': () => {
      const s = state.solo;
      if (s.nightYes == null) return [{ el: $('[data-yes="night"]'), msg: 'Hayır ya da Evet seç.' }];
      if (s.nightYes && !(num(s.nightCount) >= 1)) return [{ el: $('#g-ncount'), msg: 'Gece çalışılan gün sayısını gir.' }];
      return [];
    },
  };

  const steps = () => FLOWS[flow].steps;
  const currentStep = () => steps()[stepIndex];

  function showStep(back = false) {
    const id = currentStep();
    $$('#form .q').forEach((q) => { q.hidden = q.dataset.step !== id; });
    const q = $(`#form .q[data-step="${id}"]`);
    q.classList.toggle('back', back);
    q.style.animation = 'none'; void q.offsetWidth; q.style.animation = '';
    if (ENTER[id]) ENTER[id]();
    const total = steps().length - 1;
    $('#wiz-flow').textContent = FLOWS[flow].label;
    $('#wiz-count').textContent = stepIndex === 0 ? 'Hoş geldin' : `Soru ${stepIndex} / ${total}`;
    $('#wiz-arc').setAttribute('stroke-dasharray', `${(stepIndex / total) * 100} 100`);
    const last = stepIndex === steps().length - 1;
    $('#wiz-next-label').textContent = stepIndex === 0 ? 'Başlayalım' : last ? (flow === 'maas' ? 'Maaşımı hesapla' : 'Harcırahı hesapla') : 'Devam';
    showError('#form-error', '');
    window.scrollTo(0, 0);
    $('.q-title', q).focus({ preventScroll: true });
  }

  function move(dir) {
    let i = stepIndex + dir;
    while (i > 0 && i < steps().length && SKIP[steps()[i]] && SKIP[steps()[i]]()) i += dir;
    if (i < 0) { goHome(); return; }
    if (i >= steps().length) { finish(); return; }
    stepIndex = i;
    showStep(dir < 0);
  }

  function next() {
    const check = CHECK[currentStep()];
    const problems = check ? check() : [];
    $$('#form [aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
    if (problems.length) {
      problems.forEach((p) => { if (p.el && p.el.matches('input, select')) p.el.setAttribute('aria-invalid', 'true'); });
      showError('#form-error', problems.map((p) => p.msg).join(' '));
      if (problems[0].el) problems[0].el.focus();
      return;
    }
    move(1);
  }

  /** Uygulamadaki BuildingView: halka dolar, satırlar tek tek işaretlenir */
  function finish() {
    const c = flow === 'maas' ? compute() : computeSolo();
    const lines = flow === 'maas' ? buildLines(c) : soloBuildLines(c);
    $('#form').hidden = true;
    $('.wiz-top').hidden = true;
    const b = $('#building');
    b.hidden = false;
    $('#build-title').textContent = flow === 'maas' ? 'Maaşın hesaplanıyor' : 'Harcırahın hesaplanıyor';
    $('#build-lines').innerHTML = lines.map((l) => `<li>${esc(l)}</li>`).join('');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 200 : 1500;
    const t0 = performance.now();
    const items = $$('#build-lines li');
    function frame(now) {
      const p = Math.min(1, (now - t0) / duration);
      $('#build-arc').setAttribute('stroke-dasharray', `${p * 100} 100`);
      $('#build-pct').textContent = `${Math.round(p * 100)}%`;
      items.forEach((li, k) => li.classList.toggle('on', p >= (k + 1) / (items.length + 1)));
      if (p < 1) requestAnimationFrame(frame);
      else setTimeout(() => {
        b.hidden = true;
        $('#form').hidden = false;
        $('.wiz-top').hidden = false;
        if (flow === 'maas') { renderResult(c); renderPrint(c); } else { renderSoloResult(c); renderSoloPrint(c); }
        lastCalc = c;
        showView('result');
      }, reduced ? 0 : 350);
    }
    requestAnimationFrame(frame);
  }

  function buildLines(c) {
    const out = [`Çalışma ${plain(c.absences.worked)} sa · tatil ${plain(c.i.holidayHours)} sa`];
    if (c.absences.paidLeave > 0) out.push(`İzin ${plain(c.absences.paidLeave)} sa`);
    if (c.leaveTotals.unpaid > 0) out.push(`Ücretsiz izin ${plain(c.leaveTotals.unpaid)} sa (ödenmez)`);
    if (state.sick.length) out.push(`Rapor ${state.sick.length} gün`);
    if (c.models.length) out.push(`${c.models.length} görev aktarıldı`);
    out.push('SSK, gelir ve damga vergisi');
    return out;
  }

  function soloBuildLines(c) {
    const r = c.r;
    const out = [`${r.taskDays} gün gündelik`];
    if (r.nights) out.push(`${r.nights} gece otel`);
    out.push('Yol ve görev primi');
    if (r.overtimeTL) out.push('Fazla mesai, vergi ve SGK');
    return out;
  }

  // MARK: Görünümler

  function showView(view) {
    $('#home').hidden = view !== 'home';
    $('#wizard').hidden = view !== 'wizard';
    $('#app-result').hidden = view !== 'result';
    $('#nav-home').hidden = view !== 'home';
    $('#nav-wizard').hidden = view !== 'wizard';
    $('#nav-result').hidden = view !== 'result';
    $('#wizard').classList.toggle('coral', flow === 'gorev');
    $('#app-result').classList.toggle('coral', flow === 'gorev');
    window.scrollTo(0, 0);
    if (view === 'result') $('#app-result').focus({ preventScroll: true });
  }

  function startFlow(name) {
    state = freshState();
    flow = name;
    stepIndex = 0;
    applyMonthDefaults();
    syncInputs();
    showView('wizard');
    showStep();
    if (location.hash !== `#${name}`) history.pushState(null, '', `#${name}`);
  }

  function goHome() {
    flow = null;
    showView('home');
    if (location.hash) history.pushState(null, '', location.pathname + location.search);
  }

  /** Sonuçtan geri: cevaplar korunur, ilk sorudan başlanır */
  function editAnswers() {
    stepIndex = 1;
    showView('wizard');
    showStep(true);
  }

  // MARK: Olaylar

  function onInput(e) {
    const el = e.target;
    if (el.dataset.ttime) {
      if (e.type !== 'change') return;
      const t = tripByKey(el.dataset.tkey);
      setTripTime(t, el.dataset.ttime, +el.value);
      rerenderDates(el.dataset.tkey);
      return;
    }
    if (el.dataset.trip) {
      const t = state.trips.find((x) => x.id === +el.dataset.trip);
      if (!t) return;
      if (el.dataset.transport != null) {
        t.transport[+el.dataset.transport][el.dataset.key] = el.value;
      } else if (el.type === 'checkbox') {
        t[el.dataset.field] = el.checked;
        if (e.type === 'change') rerenderTrip(t);
      } else {
        t[el.dataset.field] = el.value;
        if (e.type === 'change' && el.dataset.field === 'countryID') rerenderTrip(t);
      }
      updateTripPreview(t);
      return;
    }
    if (el.dataset.gtransport != null) {
      state.solo.transport[+el.dataset.gtransport][el.dataset.key] = el.value;
      return;
    }
    if (el.hasAttribute('data-cum')) {
      state.cumulative = el.value;
      el.removeAttribute('aria-invalid');
      renderCumResult();
      return;
    }
    if (el.getAttribute('aria-invalid') === 'true') el.removeAttribute('aria-invalid');
    if (SOLO_FIELDS[el.id]) {
      const s = state.solo;
      s[SOLO_FIELDS[el.id]] = el.type === 'checkbox' ? el.checked : el.value;
      if (el.id === 'g-stayed') renderHotel();
      if (el.id === 'g-round') renderTravel();
      if (el.id === 'g-country') renderPlace();
      if (['g-extra-daily', 'g-extra-days', 'g-nstart', 'g-nend', 'g-ncount'].includes(el.id)) renderYes();
      return;
    }
    switch (el.id) {
      case 'g-search': state.placeQuery = el.value; renderPlace(); break;
      case 'f-grade': case 'g-grade': state.grade = el.value; break;
      case 'f-years': state.years = el.value; break;
      case 'f-fsc35': state.fsc35 = num(el.value); break;
      case 'f-fsc80': state.fsc80 = num(el.value); break;
      case 'f-night': state.night = num(el.value); break;
      case 'f-gallery': state.gallery = num(el.value); break;
      case 'f-carried': state.carried = el.checked; break;
      case 'f-clothing': state.clothing = el.checked; break;
      case 'f-other-gross': state.otherGross = num(el.value); break;
      case 'f-deductions': state.deductions = num(el.value); break;
      case 'f-meal-days': state.mealDays = num(el.value); break;
      case 'f-meal-extra': state.mealExtra = num(el.value); break;
      default: break;
    }
  }

  /** Ay değişince yeni dönemin dışında kalan izin ve raporlar çıkarılır */
  function dropOutsidePeriod() {
    const before = state.leaves.length + state.sick.length;
    state.leaves = state.leaves.filter((l) => inPeriod(l.date));
    state.sick = state.sick.filter(inPeriod);
    state.hourlyDate = '';
    const removed = before - state.leaves.length - state.sick.length;
    showError('#form-error', removed ? `Yeni dönemin dışında kalan ${removed} izin/rapor günü çıkarıldı.` : '');
  }

  function showError(sel, msg) {
    const el = $(sel);
    el.textContent = msg;
    el.hidden = !msg;
  }

  function addHourly() {
    if (!state.hourlyDate) return showError('#leave-error', 'Önce takvimden izin gününe dokun.');
    showError('#leave-error', '');
    state.leaves.push({ id: Date.now() + Math.random(), date: state.hourlyDate, kind: 'hourly', hours: state.hourlyHours, unpaid: state.leaveUnpaid });
    state.hourlyDate = '';
    renderLeaveStep();
  }

  function onClick(e) {
    const btn = e.target.closest('[data-action], [data-rate], [data-meal], [data-bonus], [data-month], [data-title], [data-dest], [data-place], [data-yes], [data-tax-mode], [data-cal], [data-leave-paid], [data-leave-kind], [data-leave-part], [data-tday], [data-tphase], [data-tnav]');
    if (!btn || btn.disabled) return;
    const s = state.solo;
    const d = btn.dataset;
    if (d.rate) { state.rate = num(d.rate); renderTax(); $(`[data-tax-box] [data-rate="${d.rate}"]`).focus(); return; }
    if (d.taxMode) { state.taxMode = d.taxMode; renderTax(); const f = $(d.taxMode === 'manual' ? '[data-cum]' : `[data-tax-mode="${d.taxMode}"]`); if (f) f.focus(); return; }
    if (d.meal) { state.meal = d.meal; renderMeal(); return; }
    if (d.bonus) { state.bonus = num(d.bonus); renderBonus(); return; }
    if (d.month) {
      state.month = +d.month;
      applyMonthDefaults();
      dropOutsidePeriod();
      renderMonths();
      return;
    }
    if (d.title) { state.title = d.title; renderTitles(); return; }
    if (d.dest) { s.destination = d.dest; renderDests(); return; }
    if (d.place) { s.placeID = d.place; renderPlace(); $(`[data-place="${d.place}"]`).focus(); return; }
    if (d.yes) {
      const yes = d.value === '1';
      if (d.yes === 'leave') { state.leaveYes = yes; renderLeaveStep(); return; }
      if (d.yes === 'extra') s.extraYes = yes; else s.nightYes = yes;
      renderYes();
      return;
    }
    if (d.leavePaid) { state.leaveUnpaid = d.leavePaid === '1'; renderLeaveStep(); return; }
    if (d.leaveKind) { state.leaveKind = d.leaveKind; renderLeaveStep(); return; }
    if (d.leavePart) { state.leavePart = d.leavePart; renderLeaveStep(); return; }
    if (d.cal) {
      const k = d.key;
      if (d.cal === 'holiday') toggleHoliday(k);
      else if (d.cal === 'sick') { state.sick = state.sick.includes(k) ? state.sick.filter((x) => x !== k) : state.sick.concat(k); renderSick(); }
      else if (d.cal === 'leave') {
        showError('#leave-error', '');
        if (state.leaveKind === 'hourly') state.hourlyDate = state.hourlyDate === k ? '' : k; else toggleLeaveDay(k);
        renderLeaveStep();
      }
      const again = $(`[data-cal="${d.cal}"][data-key="${k}"]`);
      if (again) again.focus();
      return;
    }
    if (d.tday) { pickTripDay(tripByKey(d.tkey), d.tkey, d.tday); return; }
    if (d.tphase) { const t = tripByKey(d.tkey); t.phase = d.tphase; t.view = null; rerenderDates(d.tkey); return; }
    if (d.tnav) {
      const t = tripByKey(d.tkey);
      const v = defaultView(t);
      let y = +v.slice(0, 4), m = +v.slice(5, 7) + num(d.tnav);
      if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
      t.view = `${y}-${pad(m)}`;
      rerenderDates(d.tkey);
      const nav = $(`[data-tnav="${d.tnav}"][data-tkey="${d.tkey}"]`);
      if (nav) nav.focus();
      return;
    }
    const trip = d.trip ? state.trips.find((x) => x.id === +d.trip) : null;
    switch (d.action) {
      case 'home': e.preventDefault(); goHome(); break;
      case 'scroll': e.preventDefault(); $(btn.getAttribute('href')).scrollIntoView({ behavior: 'smooth' }); break;
      case 'start': startFlow(d.flow); break;
      case 'prev': move(-1); break;
      case 'remove-leave': state.leaves = state.leaves.filter((l) => String(l.id) !== d.id); renderLeaveStep(); break;
      case 'toggle-paid': { const l = state.leaves.find((x) => String(x.id) === d.id); if (l) { l.unpaid = !l.unpaid; renderLeaveStep(); } break; }
      case 'hourly': state.hourlyHours = Math.min(8, Math.max(0.5, state.hourlyHours + num(d.delta))); renderLeaveStep(); break;
      case 'add-hourly': addHourly(); break;
      case 'add-trip': { const t = newTrip(); state.trips.push(t); renderTrips(); $(`#t${t.id}-placeID`).focus(); break; }
      case 'remove-trip': state.trips = state.trips.filter((x) => x !== trip); renderTrips(); break;
      case 'trip-dest': trip.destination = d.destTrip; rerenderTrip(trip); break;
      case 'add-transport': trip.transport.push({ kind: 'taksi', amount: '' }); rerenderTrip(trip); break;
      case 'remove-transport': trip.transport.splice(+d.index, 1); rerenderTrip(trip); break;
      case 'g-add-transport': s.transport.push({ kind: 'taksi', amount: '' }); renderTravel(); $(`#g-ta${s.transport.length - 1}`).focus(); break;
      case 'g-remove-transport': s.transport.splice(+d.index, 1); renderTravel(); break;
      case 'nights': {
        const total = engine.tripNights(soloModel());
        const cur = s.hotelNights === '' ? total : num(s.hotelNights);
        s.hotelNights = String(Math.min(Math.max(cur + num(d.delta), 0), total));
        renderHotel(); break;
      }
      case 'edit': editAnswers(); break;
      case 'pdf': printPdf(); break;
      default: break;
    }
  }

  // MARK: Hesap

  function compute() {
    const year = RATE_YEAR, month = state.month;
    const grade = +state.grade;
    const hourly = engine.hourlyWage(grade);
    const rate = taxRate();
    const w = engine.worker(grade, rate, state.title);
    const hol = holidayDays();
    const leaves = leavesInUse();
    const i = {
      year, month, grade, serviceYears: num(state.years), titlePremiumRate: WORKER_TITLES[state.title].premiumRate,
      priorCumulative: priorCumulative(rate),
      holidayDays: hol, leaves: leaves.map((l) => ({ date: l.date, kind: l.kind, hours: l.hours || 0, part: l.part || null, unpaid: !!l.unpaid })),
      sickDays: state.sick.slice(),
      mealReport: state.meal !== 'none', mealReportDaily: w.normalMeal,
      mealReportDaysOverride: state.meal === 'custom' ? state.mealDays : null, mealReportExtraDays: state.mealExtra,
      fsc35Hours: state.fsc35, fsc80Hours: state.fsc80, nightHours: state.night, galleryHours: state.gallery, weekendTravelHours: 0,
      bonusHours: state.bonus, clothingAid: state.clothing ? engine.payroll.clothingAid : 0,
      deferredBonusSSKBase: state.carried ? r2(engine.payroll.halfBonusHours * hourly) : 0,
      otherDeductions: state.deductions, otherGross: state.otherGross, taskMealNet: 0, taskPrimNet: 0,
    };
    engine.applyAbsences(i);
    const absences = { worked: i.workedHours, paidLeave: i.paidLeaveHours, holiday: i.holidayHours };
    const models = state.trips.map(tripModel);
    const trips = engine.applyTrips(i, models, w);
    const r = engine.calculate(i);
    const places = models.map(placeName);
    return { kind: 'maas', year, month, grade, hourly, rate, w, hol, i, r, absences, trips, models, places, leaveTotals: engine.leaveTotals(i.leaves, hol) };
  }

  function computeSolo() {
    const grade = +state.grade;
    const rate = taxRate();
    const w = engine.worker(grade, rate, state.title);
    const m = soloModel();
    const r = engine.calculateTrip(w, m);
    return { kind: 'gorev', grade, rate, w, m, r, place: placeName(m) };
  }

  function onSubmit(e) {
    e.preventDefault();
    next();
  }

  // MARK: Sonuç

  const splitTL = (x) => { const s = tl(x); const k = s.lastIndexOf(','); return k < 0 ? [s, ''] : [s.slice(0, k), s.slice(k)]; };
  const sumAmounts = (lines) => r2(lines.reduce((s, l) => s + l.amount, 0));

  function lineHTML(l, cls = '') {
    return `<div class="line"><span><span class="t">${esc(l.title)}</span>${l.detail ? `<span class="d">${esc(l.detail)}</span>` : ''}</span><span class="a ${cls}">${tl(l.amount)}</span></div>`;
  }

  /** Logodaki kadran: parçalar tutarla orantılı yaylar */
  function dialSVG(parts) {
    const list = parts.filter((p) => p.v > 0);
    const gap = list.length > 1 ? 16 : 0;
    const total = list.reduce((s, p) => s + p.v, 0) || 1;
    const free = 360 - gap * list.length;
    let start = 6;
    const arcs = list.map((p, k) => {
      const len = Math.max(4, (p.v / total) * free);
      const a = `<circle cx="90" cy="90" r="72" pathLength="360" class="${p.cls}" stroke-dasharray="${len.toFixed(2)} 360" stroke-dashoffset="${(-start).toFixed(2)}" style="animation-delay: ${k * 0.18}s"/>`;
      start += len + gap;
      return a;
    }).join('');
    return `<div class="res-dial" aria-hidden="true"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="72" class="rt"/><g transform="rotate(-90 90 90)">${arcs}</g>
      <text x="90" y="104" text-anchor="middle" font-family="Sora, sans-serif" font-size="40" font-weight="700" fill="#DDF3EA">₺</text></svg></div>`;
  }

  function tripRange(m) {
    const s = m.start.slice(0, 10), e = m.end.slice(0, 10);
    return s === e ? shortDay(s) : `${shortDay(s)} – ${shortDay(e)}`;
  }

  function facts(c) {
    const out = [`${plain(c.absences.worked + c.absences.paidLeave)} sa normal`, `${plain(c.i.holidayHours)} sa tatil`];
    if (c.leaveTotals.paid) out.push(leaveText(c.leaveTotals.paid, false));
    if (c.leaveTotals.unpaid) out.push(leaveText(c.leaveTotals.unpaid, true));
    if (state.sick.length) out.push(`${state.sick.length} gün rapor`);
    if (c.models.length) out.push(`${c.models.length} görev`);
    const fsc = c.i.fsc35Hours + c.i.fsc80Hours;
    if (fsc) out.push(`${plain(fsc)} sa fazla mesai`);
    return out;
  }

  function resultNotes(c) {
    const notes = [];
    if (!isJanuary()) {
      notes.push(state.taxMode === 'manual'
        ? `Gelir vergisi, girdiğin ${tl(cumulative())} kümülatif matrahtan devam ederek hesaplandı.`
        : `Gelir vergisi, %${pct(c.rate)} diliminin başından hesaplandı. Yıl içinde biriken matrahın dilim sınırına yakınsa vergi biraz daha yüksek çıkabilir; kesin sonuç için matrahı elle gir.`);
      if (c.r.bracketRate > c.rate) notes.push(`Bu ayla birlikte %${pct(c.r.bracketRate)} dilimine geçiyorsun.`);
    }
    if (!c.r.taxYearKnown) notes.push(`${c.year} vergi dilimleri henüz açıklanmadı; son bilinen yılın dilimleriyle tahmin edildi.`);
    if (c.r.bonusDeferred) notes.push('Yarım ikramiye maaştan sonra yatar; SGK ve işsizlik kesintisi gelecek ayın maaşından yapılır.');
    c.trips.results.forEach((t, k) => t.notes.forEach((n) => notes.push(`Görev ${k + 1}: ${n}`)));
    return notes;
  }

  const resultActions = `<section class="notice">
        <p>Bu sonuç yalnızca bu sekmede duruyor. Sayfayı kapatınca silinir; saklamak için PDF indir.</p>
        <div class="result-actions">
          <button type="button" class="btn glass sm" data-action="home">Ana sayfa</button>
          <button type="button" class="btn glass sm" data-action="edit">Cevapları düzenle</button>
          <button type="button" class="btn white sm" data-action="pdf">PDF olarak indir</button>
        </div>
      </section>`;

  const tileHTML = (dot, label, amount) => `<div class="tile"><span><i class="d ${dot}"></i>${label}</span><strong>${tl(amount)}</strong></div>`;

  function renderResult(c) {
    const p = period();
    const harcirah = c.trips.harcirah;
    const total = c.r.totalPaid + harcirah;
    const [whole, cents] = splitTL(total);
    const dedTotal = sumAmounts(c.r.deductions);
    const extrasNet = r2(c.r.totalPaid - c.r.net);
    const tiles = [tileHTML('w', 'Net maaş', c.r.net)];
    if (c.r.bonusNet) tiles.push(tileHTML('g', 'İkramiye (net)', c.r.bonusNet));
    if (c.r.taskMealNet + c.r.taskPrimNet) tiles.push(tileHTML('g', 'Görev yemek + prim', c.r.taskMealNet + c.r.taskPrimNet));
    if (c.r.mealReportNet) tiles.push(tileHTML('g', 'Yemek raporu', c.r.mealReportNet));
    if (harcirah) tiles.push(tileHTML('g', 'Harcırah (banka)', harcirah));
    tiles.push(tileHTML('c', 'Toplam kesinti', dedTotal));

    let extras = '';
    if (c.r.bonusGross) {
      extras += `<section class="card"><h2 class="table-title">İkramiye · ${plain(state.bonus)} saat</h2>
        ${lineHTML({ title: 'Brüt ikramiye', detail: `${plain(state.bonus)} saat`, amount: c.r.bonusGross })}
        ${lineHTML({ title: 'Gelir vergisi', detail: '', amount: c.r.bonusIncomeTax }, 'minus')}
        ${lineHTML({ title: 'Damga vergisi', detail: '', amount: c.r.bonusStampTax }, 'minus')}
        <div class="line total"><span class="t">Net ikramiye</span><span class="a plus">${tl(c.r.bonusNet)}</span></div></section>`;
    }
    if (c.r.taskMealNet + c.r.taskPrimNet + c.r.mealReportNet > 0) {
      extras += `<section class="card"><h2 class="table-title">Bordroya eklenen kesintisiz ödemeler</h2>
        ${c.r.taskMealNet ? lineHTML({ title: 'Görevde yemek', detail: 'görevlerden', amount: c.r.taskMealNet }) : ''}
        ${c.r.taskPrimNet ? lineHTML({ title: 'Geçici görev primi', detail: 'görevlerden', amount: c.r.taskPrimNet }) : ''}
        ${c.r.mealReportNet ? lineHTML({ title: 'Yemek raporu', detail: `${plain(c.r.mealReportDays)} gün × ${tl(c.r.mealReportDaily)}`, amount: c.r.mealReportNet }) : ''}
      </section>`;
    }

    const tripsHTML = c.trips.results.map((t, k) => {
      const m = c.models[k];
      const tile = (label, amount, where) => amount ? `<div class="trip-tile"><span>${label}</span><strong>${tl(amount)}</strong><small>${where}</small></div>` : '';
      return `<section class="card" style="gap: 16px">
        <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; align-items: baseline">
          <h2 class="table-title" style="margin: 0">Görev ${k + 1} · ${esc(c.places[k])} · ${esc(tripRange(m))}</h2>
          <span class="hint">${t.taskDays} gün${t.nights ? ` · ${t.nights} gece otel` : ''}</span></div>
        <div class="trip-grid">
          ${tile('Gündelik', t.allowanceTL, 'banka')}${tile('Otel', t.lodgingTL, 'banka')}${tile('Yol', t.transportTL, 'banka')}
          ${tile('Görevde yemek', t.mealTL, 'bordro')}${tile('Görev primi', t.primTL, 'bordro')}
        </div>
        <details><summary class="hint" style="cursor: pointer; min-height: 44px; display: flex; align-items: center">Hesap ayrıntısı</summary>
          ${t.lines.map((l) => lineHTML(l, l.amount < 0 ? 'minus' : '')).join('')}
          <p class="hint" style="margin-top: 10px">Görevdeki fazla mesai, Pazar, gece ve hafta sonu yol saatleri maaşın kazançlarına eklendi.</p>
        </details>
      </section>`;
    }).join('');

    const notes = resultNotes(c);
    $('#app-result').innerHTML = `
      <section class="hero-res">
        ${dialSVG([{ v: c.r.net, cls: 'rw' }, { v: dedTotal, cls: 'rc' }, { v: extrasNet + harcirah, cls: 'rg' }])}
        <div class="res-text">
          <span class="label-top">14 ${MONTHS[c.month - 1]} ${c.year} · dönem ${esc(shortDay(engine.keyOf(p.start)))} – ${esc(shortDay(engine.keyOf(p.end - 1)))}</span>
          <span class="label-mid">Maaş tahminin hazır · bu ay hesabına geçecek</span>
          <span class="amount">${esc(whole)}<span>${esc(cents)}</span></span>
          <span class="meta">${c.grade}. derece · ${num(state.years)} yıl · ${esc(WORKER_TITLES[state.title].title)} · vergi dilimi %${pct(c.rate)}</span>
        </div>
      </section>
      <div class="tiles">${tiles.join('')}</div>
      <section class="facts">${facts(c).map((f) => `<span class="fact">${esc(f)}</span>`).join('')}</section>
      <div class="split">
        <section class="card"><h2 class="table-title">Kazançlar</h2>
          ${c.r.earnings.map((l) => lineHTML(l)).join('')}
          <div class="line total"><span class="t">Brüt</span><span class="a plus">${tl(c.r.gross)}</span></div></section>
        <section class="card"><h2 class="table-title">Kesintiler</h2>
          ${c.r.deductions.map((l) => lineHTML(l)).join('')}
          <div class="line total"><span class="t">Toplam kesinti</span><span class="a minus">${tl(dedTotal)}</span></div>
          <div class="line total" style="padding-top: 6px"><span class="t">Net maaş</span><span class="a plus">${tl(c.r.net)}</span></div></section>
      </div>
      ${extras}
      ${tripsHTML}
      ${notes.length ? `<section class="card side"><h2>Notlar</h2><ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
      ${resultActions}`;
  }

  function soloRange(m) {
    const s = m.start.slice(0, 10), e = m.end.slice(0, 10);
    const t = (x) => x.slice(11, 16);
    return s === e ? `${shortDay(s)} ${t(m.start)}–${t(m.end)}` : `${shortDay(s)} ${t(m.start)} – ${shortDay(e)} ${t(m.end)}`;
  }

  function renderSoloResult(c) {
    const r = c.r;
    const [whole, cents] = splitTL(r.totalTL);
    const tile = (label, amount, where) => amount ? `<div class="trip-tile"><span>${label}</span><strong>${tl(amount)}</strong><small>${where}</small></div>` : '';
    const notes = r.notes.slice();
    if (r.missingPlace) notes.push('Görev yeri seçilmediği için otobüs ücreti eklenmedi.');
    $('#app-result').innerHTML = `
      <section class="hero-res">
        ${dialSVG([{ v: r.bankaTL, cls: 'rw' }, { v: r.primTL + r.mealTL, cls: 'rc' }, { v: r.overtimeTL, cls: 'rg' }])}
        <div class="res-text">
          <span class="label-top">${esc(c.place)} görevi · ${esc(soloRange(c.m))}</span>
          <span class="label-mid">Harcırahın hazır · toplam</span>
          <span class="amount">${esc(whole)}<span>${esc(cents)}</span></span>
          <span class="meta">${r.taskDays} gün${r.nights ? ` · ${r.nights} gece otel` : ''} · ${c.grade}. derece · ${esc(WORKER_TITLES[state.title].title)}</span>
        </div>
      </section>
      <div class="tiles">
        ${tileHTML('w', 'Banka ile ödenen', r.bankaTL)}
        ${tileHTML('c', 'Bordroya eklenen', r.bordroTL)}
      </div>
      <section class="card" style="gap: 14px">
        <h2 class="table-title" style="margin: 0">Kalemler</h2>
        <div class="trip-grid">
          ${tile('Gündelik', r.allowanceTL, 'banka')}${tile('Otel', r.lodgingTL, 'banka')}${tile('Yol', r.transportTL, 'banka')}
          ${tile('Görevde yemek', r.mealTL, 'bordro')}${tile('Görev primi', r.primTL, 'bordro')}${tile('Fazla mesai (net)', r.overtimeTL, 'bordro')}
        </div>
      </section>
      <section class="card">
        <h2 class="table-title">Hesap ayrıntısı</h2>
        ${r.lines.map((l) => lineHTML(l, l.amount < 0 ? 'minus' : '')).join('')}
        <div class="line total"><span class="t">Toplam</span><span class="a plus">${tl(r.totalTL)}</span></div>
      </section>
      ${notes.length ? `<section class="card side"><h2>Notlar</h2><ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
      <section class="card side"><h2>Maaşına etkisi</h2><p>Görev primi, görevde yemek ve fazla mesai, dönüşün düştüğü ayın maaşıyla bordrodan ödenir. Gündelik, otel ve yol banka ile ayrıca yatar. Bu görevle birlikte maaşını görmek için ana sayfadan Maaş hesapla'yı seç.</p></section>
      ${resultActions}`;
  }

  // MARK: PDF (tarayıcının yazdır → PDF olarak kaydet)

  const pdBrand = (title) => `<div class="pd-brand"><img src="img/app-icon-96.png" width="38" height="38" alt="">
      <div><div class="pd-title">${title}</div><div class="pd-sub">Bordrom</div></div></div>`;
  const pdCredit = 'Bu Uygulama Savunma Sanayi İşçileri için Geliştirilmiştir. · Özgür Yılmaz';
  const pdFoot = (extra) => `<div class="pd-foot">Bu belge Bordrom ile girilen bilgilere göre hazırlanmış bir tahmindir; resmî bordronun yerine geçmez. Tarife sürümü ${esc(rates.version)}. ${extra}Girilen bilgiler hiçbir yerde saklanmaz.<br>${pdCredit}</div>`;
  const pl = (l) => `<div class="pd-line"><span>${esc(l.title)}${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</span><span>${money(l.amount)}</span></div>`;

  function renderPrint(c) {
    const p = period();
    const t = todayParts();
    const leaves = [c.leaveTotals.paid ? leaveText(c.leaveTotals.paid, false) : '', c.leaveTotals.unpaid ? leaveText(c.leaveTotals.unpaid, true) : ''].filter(Boolean).join(', ') || 'yok';
    let extra = '';
    if (c.r.bonusGross) {
      extra += `<div class="pd-sec"><div class="pd-h">İkramiye · ${plain(state.bonus)} saat</div>
        ${pl({ title: 'Brüt', detail: '', amount: c.r.bonusGross })}${pl({ title: 'Gelir vergisi', detail: '', amount: c.r.bonusIncomeTax })}
        ${pl({ title: 'Damga vergisi', detail: '', amount: c.r.bonusStampTax })}<div class="pd-line total"><span>Net ikramiye</span><span>${money(c.r.bonusNet)}</span></div></div>`;
    }
    if (c.r.mealReportNet) extra += `<div class="pd-sec"><div class="pd-h">Yemek raporu</div>${pl({ title: `${plain(c.r.mealReportDays)} gün × ${tl(c.r.mealReportDaily)}`, detail: '', amount: c.r.mealReportNet })}</div>`;
    const trips = c.trips.results.map((r, k) => `<div class="pd-sec"><div class="pd-h">Görev ${k + 1} · ${esc(c.places[k])} · ${esc(tripRange(c.models[k]))}</div>
      ${r.lines.filter((l) => l.amount !== 0).map(pl).join('')}</div>`).join('');
    const harcirah = c.trips.harcirah;
    const taxNote = isJanuary() ? '' : state.taxMode === 'manual'
      ? `Gelir vergisi ${tl(cumulative())} kümülatif matrahtan devam ederek hesaplanmıştır. `
      : `Gelir vergisi %${pct(c.rate)} diliminin başından hesaplanmıştır. `;
    $('#print-doc').innerHTML = `
      <div class="pd-head">
        ${pdBrand('Maaş tahmini')}
        <div class="pd-dates"><div><strong>14 ${MONTHS[c.month - 1]} ${c.year}</strong></div>
          <div>Dönem ${dotted(engine.keyOf(p.start))} – ${dotted(engine.keyOf(p.end - 1))}</div><div>Oluşturma ${dotted(t.key)}</div></div>
      </div>
      <div class="pd-info">
        <div><span>Derece</span><b>${c.grade}. derece</b></div>
        <div><span>Hizmet yılı · unvan</span><b>${num(state.years)} · ${esc(WORKER_TITLES[state.title].title)}</b></div>
        <div><span>Vergi dilimi</span><b>%${pct(c.rate)}</b></div>
        <div><span>İzin</span><b>${esc(leaves)}</b></div>
      </div>
      <div class="pd-cols">
        <div class="pd-sec" style="margin-top: 0"><div class="pd-h">Kazançlar</div>${c.r.earnings.map(pl).join('')}
          <div class="pd-line total"><span>Brüt</span><span>${money(c.r.gross)}</span></div></div>
        <div class="pd-sec" style="margin-top: 0"><div class="pd-h">Kesintiler</div>${c.r.deductions.map(pl).join('')}
          <div class="pd-line total"><span>Toplam</span><span>${money(sumAmounts(c.r.deductions))}</span></div></div>
      </div>
      ${extra}${trips}
      <div class="pd-band">
        <div><span>Net maaş</span><b>${tl(c.r.net)}</b></div>
        <div><span>Bordroya yatan</span><b>${tl(c.r.totalPaid)}</b></div>
        <div class="grand"><span>${harcirah ? 'Toplam (harcırah dahil)' : 'Toplam'}</span><b>${tl(c.r.totalPaid + harcirah)}</b></div>
      </div>
      ${pdFoot(taxNote)}`;
  }

  function renderSoloPrint(c) {
    const r = c.r;
    const t = todayParts();
    $('#print-doc').innerHTML = `
      <div class="pd-head">
        ${pdBrand('Görev harcırahı')}
        <div class="pd-dates"><div><strong>${esc(c.place)}</strong></div><div>${esc(soloRange(c.m))}</div><div>Oluşturma ${dotted(t.key)}</div></div>
      </div>
      <div class="pd-info">
        <div><span>Derece</span><b>${c.grade}. derece</b></div>
        <div><span>Unvan</span><b>${esc(WORKER_TITLES[state.title].title)}</b></div>
        <div><span>Süre</span><b>${r.taskDays} gün · ${r.nights} gece otel</b></div>
        <div><span>Vergi dilimi</span><b>%${pct(c.rate)}</b></div>
      </div>
      <div class="pd-sec" style="margin-top: 0"><div class="pd-h">Hesap ayrıntısı</div>${r.lines.map(pl).join('')}
        <div class="pd-line total"><span>Toplam</span><span>${money(r.totalTL)}</span></div></div>
      ${r.notes.length ? `<div class="pd-sec"><div class="pd-h">Notlar</div>${r.notes.map((n) => `<div class="pd-line"><span>${esc(n)}</span></div>`).join('')}</div>` : ''}
      <div class="pd-band">
        <div><span>Banka ile</span><b>${tl(r.bankaTL)}</b></div>
        <div><span>Bordroya</span><b>${tl(r.bordroTL)}</b></div>
        <div class="grand"><span>Toplam harcırah</span><b>${tl(r.totalTL)}</b></div>
      </div>
      ${pdFoot('')}`;
  }

  function printPdf() {
    const old = document.title;
    document.title = lastCalc && lastCalc.kind === 'gorev'
      ? `Bordrom-gorev-${lastCalc.m.start.slice(0, 10)}`
      : `Bordrom-maas-${RATE_YEAR}-${pad(state.month)}`;
    window.addEventListener('afterprint', () => { document.title = old; }, { once: true });
    window.print();
  }

  // MARK: Başlangıç

  function route() {
    const h = location.hash.slice(1);
    if (h === 'maas' || h === 'gorev') { if (flow !== h) startFlow(h); }
    else if (flow) { flow = null; showView('home'); }
  }

  fillStatic();
  const form = $('#form');
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);
  form.addEventListener('submit', onSubmit);
  // Arama ve görev kartı alanlarında Enter bir sonraki soruya geçirmesin
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('[data-no-enter], .trip')) e.preventDefault();
  });
  document.addEventListener('click', onClick);
  form.addEventListener('toggle', (e) => {
    const id = e.target.dataset && e.target.dataset.tripDetails;
    if (id) { const t = state.trips.find((x) => x.id === +id); if (t) t.open = e.target.open; }
  }, true);
  window.addEventListener('popstate', route);
  route();
})();
