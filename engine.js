/* Bordrom hesap motoru: Harcirah/Engine/*.swift dosyalarının birebir JavaScript karşılığı.
   Tarihler gün için "yyyy-MM-dd", görev saatleri için "yyyy-MM-ddTHH:mm" (Türkiye saati) metnidir.
   Değişiklikler Swift motoruyla aynı tutulmalı: web/tests/compare.mjs ikisini karşılaştırır. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BordromEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;

  // Swift `(x * 100).rounded() / 100`: yarımlar sıfırdan uzağa yuvarlanır
  const r2 = (x) => Math.sign(x) * Math.round(Math.abs(x) * 100) / 100;

  const numFmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2, roundingMode: 'halfEven' });
  const tlFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', roundingMode: 'halfEven' });
  const plain = (x) => numFmt.format(x);
  const tl = (x) => tlFmt.format(x);

  /** 2,67 yerine "2 2/3" gibi okunur gün metni */
  function dayText(x) {
    const whole = Math.trunc(x);
    const frac = x - whole;
    const thirds = Math.round(frac * 3);
    if (Math.abs(thirds / 3 - frac) > 0.001) return plain(x);
    if (thirds === 0) return String(whole);
    if (thirds === 3) return String(whole + 1);
    return whole === 0 ? `${thirds}/3` : `${whole} ${thirds}/3`;
  }

  // Gün numarası: 1970-01-01'den bu yana gün (Türkiye'de yaz saati yok, UTC ile aynı takvim)
  const dayOf = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS;
  const dayFromYMD = (y, m, d) => Date.UTC(y, m - 1, d) / DAY_MS;
  const keyOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
  /** 0 = Pazar … 6 = Cumartesi */
  const weekday = (day) => new Date(day * DAY_MS).getUTCDay();
  const isWeekend = (day) => { const w = weekday(day); return w === 0 || w === 6; };
  /** "yyyy-MM-ddTHH:mm" → dakika */
  const minutesOf = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16)) / 60000;

  const HALF_PARTS = {
    morning: { title: 'Sabah', hoursText: '08.00–12.00', hours: 4 },
    afternoon: { title: 'Öğleden sonra', hoursText: '13.00–17.30', hours: 4.5 },
  };
  const LEAVE_KINDS = { full: 'Tam gün', half: 'Yarım gün', hourly: 'Saatlik' };

  /** İzinli geçen saat */
  function leaveHours(l) {
    if (l.kind === 'full') return 8.5;
    if (l.kind === 'half') return l.part ? HALF_PARTS[l.part].hours : 4.25;
    return l.hours || 0;
  }
  function leaveTitle(l) {
    if (l.kind === 'half' && l.part) return `Yarım gün (${HALF_PARTS[l.part].title.toLowerCase()})`;
    return LEAVE_KINDS[l.kind];
  }

  const WORKER_TITLES = {
    isci: { title: 'İşçi', premiumRate: 0 },
    postaBasi: { title: 'Posta başı', premiumRate: 0.06 },
    sef: { title: 'Şef', premiumRate: 0.09 },
    ustaBasi: { title: 'Usta başı', premiumRate: 0.14 },
  };

  const COVERAGE = {
    none: { title: 'Karşılanmadı', factor: 1, lodging: false },
    lodging: { title: 'Yalnız konaklama', factor: 0.6, lodging: true },
    meal1: { title: 'Yalnız 1 öğün', factor: 0.9, lodging: false },
    meal2: { title: 'Yalnız 2 öğün', factor: 0.8, lodging: false },
    meal3: { title: 'Yalnız 3 öğün', factor: 0.7, lodging: false },
    lodgingMeal1: { title: 'Konaklama + 1 öğün', factor: 0.5, lodging: true },
    lodgingMeal2: { title: 'Konaklama + 2 öğün', factor: 0.4, lodging: true },
    lodgingMeal3: { title: 'Konaklama + 3 öğün', factor: 0.3, lodging: true },
    all: { title: 'Tüm masraflar', factor: 0, lodging: true },
  };

  const TRANSPORT_KINDS = { ucak: 'Uçak', otobus: 'Otobüs', tren: 'Tren', taksi: 'Taksi', ozelArac: 'Özel araç', diger: 'Diğer' };

  const DEFAULT_PAYROLL = {
    socialAid: 5551.84, clothingAid: 3899.69, minWageGross: 33030, sskCeiling: 297270, serviceCoef: 0.06413,
    unionHours: 4, sskEmployer: 0.2175, issEmployer: 0.02, bonusHours: 225, halfBonusHours: 97.5,
  };

  function createEngine(rates) {
    const pr = Object.assign({}, DEFAULT_PAYROLL, rates.payroll || {});
    const tax = rates.incomeTax;

    function hourlyWage(grade) {
      const list = rates.wageTable.hourly;
      return list[Math.min(Math.max(grade, 1), list.length) - 1];
    }

    // MARK: Vergi

    /** Vergi yılının tablosu: tam eşleşme yoksa son bilinen yıl (tahmin) */
    function taxTable(year) {
      const years = rates.taxYears;
      if (year == null || !years || !years.length) return { brackets: tax.brackets, minWageGross: pr.minWageGross, known: true };
      const exact = years.find((t) => t.year === year);
      if (exact) return { brackets: exact.brackets, minWageGross: exact.minWageGross, known: true };
      const sorted = years.slice().sort((a, b) => a.year - b.year);
      const before = sorted.filter((t) => t.year < year);
      const t = before.length ? before[before.length - 1] : sorted[0];
      return { brackets: t.brackets, minWageGross: t.minWageGross, known: false };
    }

    function cumulativeTax(x, year) {
      let total = 0, lower = 0;
      for (const b of taxTable(year).brackets) {
        const upper = b.upTo == null ? Infinity : b.upTo;
        if (x > lower) total += (Math.min(x, upper) - lower) * b.rate;
        if (x <= upper) break;
        lower = upper;
      }
      return total;
    }

    const taxOn = (amount, prior, year) => cumulativeTax(prior + amount, year) - cumulativeTax(prior, year);

    function bracketRate(cumulative, year) {
      const brackets = taxTable(year).brackets;
      for (const b of brackets) if (cumulative < (b.upTo == null ? Infinity : b.upTo)) return b.rate;
      return brackets.length ? brackets[brackets.length - 1].rate : 0.15;
    }

    /** Dilimin alt sınırı: web'de kümülatif matrah yerine son vergi dilimi sorulur */
    function bracketLower(rate, year) {
      let lower = 0;
      for (const b of taxTable(year).brackets) {
        if (b.rate === rate) return lower;
        lower = b.upTo == null ? lower : b.upTo;
      }
      return 0;
    }

    /** Asgari ücret gelir vergisi istisnası (ayın sırasına göre kümülatif) */
    function minWageTaxExemption(month, year) {
      const monthly = taxTable(year).minWageGross * (1 - tax.sgkEmployee - tax.unemployment);
      return r2(taxOn(monthly, Math.max(month - 1, 0) * monthly, year));
    }

    // MARK: Maaş

    function calculate(i) {
      const h = i.hourlyOverride != null ? i.hourlyOverride : hourlyWage(i.grade);
      const earnings = [];
      const add = (title, detail, amount) => {
        const a = r2(amount);
        if (a !== 0) earnings.push({ title, detail, amount: a });
      };
      const normalHours = i.workedHours + i.paidLeaveHours;
      add('Normal', `${plain(normalHours)} sa × ${tl(h)}`, normalHours * h);
      add('Tatil', `${plain(i.holidayHours)} sa`, i.holidayHours * h);
      add('Fazla süreli %35', `${plain(i.fsc35Hours)} sa`, i.fsc35Hours * h * 1.35);
      add('Fazla çalışma %80', `${plain(i.fsc80Hours)} sa`, i.fsc80Hours * h * 1.80);
      add('Hafta sonu yol (HGYOL)', `${plain(i.weekendTravelHours)} sa`, i.weekendTravelHours * h);
      const incentiveHours = i.workedHours + i.fsc35Hours + i.fsc80Hours + i.weekendTravelHours;
      add('Teşvik %23', `${plain(incentiveHours)} sa`, incentiveHours * h * 0.23);
      add('İdareci primi', `${plain(i.workedHours)} sa × %${Math.round(i.titlePremiumRate * 100)}`, i.workedHours * h * i.titlePremiumRate);
      add('Gece primi %20', `${plain(i.nightHours)} sa`, i.nightHours * h * 0.20);
      add('Galeri %10', `${plain(i.galleryHours)} sa`, i.galleryHours * h * 0.10);
      add('Sosyal yardım', '', i.socialAid);
      add('Hizmet zammı', `${i.serviceYears} yıl`, i.serviceYears * h * pr.serviceCoef);
      add('Fark', '', i.otherGross);
      const gross = r2(earnings.reduce((s, l) => s + l.amount, 0));

      // Vergi yılı ödeme yılıdır: Ocak maaşında kümülatif sıfırlanır, o yılın dilimleri kullanılır
      const ty = i.year;
      const table = taxTable(ty);
      const gvExemption = minWageTaxExemption(i.month, ty);
      let gvExemptionLeft = gvExemption;
      // Damga istisnası matrahtan düşülür: (matrah − asgari ücret) × ‰7,59
      let dvExemptBaseLeft = table.minWageGross;
      const bonusGross = r2(i.bonusHours * h);
      // Tam ikramiye maaşla aynı bordroda önce vergilenir; yarım ikramiye maaştan sonra yatar, SGK'sı sonraki aya kalır
      const deferred = bonusGross > 0 && i.bonusHours < pr.bonusHours;
      let bonusGV = 0, bonusDV = 0;
      const taxBonus = (prior) => {
        const raw = r2(taxOn(bonusGross, prior, ty));
        const used = Math.min(raw, gvExemptionLeft);
        bonusGV = r2(raw - used);
        gvExemptionLeft -= used;
        const usedBase = Math.min(bonusGross, dvExemptBaseLeft);
        bonusDV = r2((bonusGross - usedBase) * tax.stamp);
        dvExemptBaseLeft -= usedBase;
      };
      if (bonusGross > 0 && !deferred) taxBonus(i.priorCumulative);

      const carried = Math.max(0, i.deferredBonusSSKBase || 0);
      const sskBase = r2(Math.min(gross + i.clothingAid + (deferred ? 0 : bonusGross) + carried, pr.sskCeiling));
      const sskW = r2(sskBase * tax.sgkEmployee);
      const issW = r2(sskBase * tax.unemployment);
      const union = r2(h * pr.unionHours);
      const taxBase = r2(gross - sskW - issW - union);
      const gvMatrah = taxBase + i.clothingAid;
      const priorForSalary = i.priorCumulative + (deferred ? 0 : bonusGross);
      const rawGV = r2(taxOn(gvMatrah, priorForSalary, ty));
      const salaryExemption = Math.min(rawGV, gvExemptionLeft);
      const gv = r2(Math.max(0, rawGV - salaryExemption));
      gvExemptionLeft -= salaryExemption;
      const salaryDVBase = Math.min(gross + i.clothingAid, dvExemptBaseLeft);
      const dv = r2(Math.max(0, gross + i.clothingAid - salaryDVBase) * tax.stamp);
      dvExemptBaseLeft -= salaryDVBase;
      const net = r2(gross - sskW - issW - gv - dv - union - i.otherDeductions);
      if (deferred) taxBonus(priorForSalary + gvMatrah);
      const bonusNet = r2(bonusGross - bonusGV - bonusDV);
      const cumulativeAfter = r2(priorForSalary + gvMatrah + (deferred ? bonusGross : 0));

      const deductions = [
        { title: 'SSK işçi %14', detail: carried > 0 ? `matrah ${tl(sskBase)} · geçen ayın ikramiyesi ${tl(carried)} dahil` : `matrah ${tl(sskBase)}`, amount: sskW },
        { title: 'İşsizlik işçi %1', detail: '', amount: issW },
        { title: 'Gelir vergisi', detail: `matrah ${tl(r2(gvMatrah))} · dilim %${Math.trunc(bracketRate(priorForSalary + gvMatrah, ty) * 100)}`, amount: gv },
        { title: 'Damga vergisi', detail: '', amount: dv },
        { title: 'Sendika', detail: `${plain(pr.unionHours)} saatlik ücret`, amount: union },
      ];
      if (i.otherDeductions > 0) deductions.push({ title: 'Diğer kesintiler', detail: 'zimmet, avans vb.', amount: i.otherDeductions });
      const mealDays = mealReportDays(i);
      const mealDaily = i.mealReportDaily != null ? i.mealReportDaily : 328.07;
      const mealReportNet = r2(mealDays * mealDaily);
      return {
        hourly: h, earnings, deductions, gross, sskBase, taxBase, cumulativeAfter,
        incomeTax: gv, stampTax: dv, sskWorker: sskW, issWorker: issW, union,
        sskEmployer: r2(sskBase * pr.sskEmployer), issEmployer: r2(sskBase * pr.issEmployer),
        net, bonusGross, bonusIncomeTax: bonusGV, bonusStampTax: bonusDV, bonusNet,
        taskMealNet: i.taskMealNet, taskPrimNet: i.taskPrimNet,
        mealReportDays: mealDays, mealReportDaily: mealDaily, mealReportNet,
        deferredBonusSSKBase: carried, bonusDeferred: deferred, taxYearKnown: table.known,
        bracketRate: bracketRate(cumulativeAfter, ty),
        totalPaid: net + bonusNet + i.taskMealNet + i.taskPrimNet + mealReportNet,
      };
    }

    // MARK: Dönem

    /** Önceki ayın 15'i – bu ayın 14'ü (end hariç gün numarası) */
    function period(year, month) {
      return { start: dayFromYMD(year, month - 1, 15), end: dayFromYMD(year, month, 15) };
    }

    const toDays = (list) => (list == null ? null : list.map(dayOf));

    function isHoliday(day, holidays) {
      if (holidays != null) return holidays.includes(day);
      return (rates.holidays || []).includes(keyOf(day));
    }
    const isWorkday = (day, holidays) => !isWeekend(day) && !isHoliday(day, holidays);

    function isHalfHoliday(day, holidays) {
      if (isWeekend(day) || isHoliday(day, holidays)) return false;
      return (rates.halfHolidays || []).includes(keyOf(day));
    }

    function eachDay(year, month, fn) {
      const p = period(year, month);
      for (let d = p.start; d < p.end; d++) fn(d);
    }

    /** Dönemdeki hafta içi resmi tatil günleri */
    function officialHolidays(year, month) {
      const out = [];
      eachDay(year, month, (d) => { if (!isWeekend(d) && isHoliday(d, null)) out.push(keyOf(d)); });
      return out;
    }

    /** Dönemdeki arife günleri */
    function halfHolidays(year, month, holidayKeys) {
      const hol = toDays(holidayKeys);
      const out = [];
      eachDay(year, month, (d) => { if (isHalfHoliday(d, hol)) out.push(keyOf(d)); });
      return out;
    }

    /** Takvimden varsayılan saatler: iş günü × 8,5 çalışma; hafta sonu günü × 5 ve hafta içi bayram × 8,5 tatil */
    function defaultHoursDays(year, month, hol) {
      let worked = 0, holiday = 0;
      eachDay(year, month, (d) => {
        if (isWeekend(d)) holiday += 5;
        else if (isHoliday(d, hol)) holiday += 8.5;
        else if (isHalfHoliday(d, hol)) { worked += HALF_PARTS.morning.hours; holiday += HALF_PARTS.afternoon.hours; }
        else worked += 8.5;
      });
      return { worked, holiday };
    }
    const defaultHours = (year, month, holidayKeys) => defaultHoursDays(year, month, toDays(holidayKeys));

    /** İzin saatinden o güne gerçekten düşen kısım: tatilde 0; arifede yalnız sabah (en çok 4 sa) */
    function countedHoursDays(l, hol) {
      const day = dayOf(l.date);
      if (!isWorkday(day, hol)) return 0;
      if (!isHalfHoliday(day, hol)) return leaveHours(l);
      const morning = HALF_PARTS.morning.hours;
      if (l.kind === 'full') return morning;
      if (l.kind === 'half') return l.part === 'afternoon' ? 0 : morning;
      return Math.min(l.hours || 0, morning);
    }
    const countedHours = (l, holidayKeys) => countedHoursDays(l, toDays(holidayKeys));

    function leaveTotals(leaves, holidayKeys) {
      const hol = toDays(holidayKeys);
      let paid = 0, unpaid = 0;
      for (const l of leaves) {
        const h = countedHoursDays(l, hol);
        if (l.unpaid) unpaid += h; else paid += h;
      }
      return { paid, unpaid };
    }

    /** İzin ve rapor günlerine göre çalışma/izin saatlerini ve sosyal yardımı yeniden kurar */
    function applyAbsences(i) {
      const hol = toDays(i.holidayDays);
      const base = defaultHoursDays(i.year, i.month, hol);
      const leaves = i.leaves || [];
      const awayHours = leaves.reduce((s, l) => s + countedHoursDays(l, hol), 0);
      const unpaidHours = leaves.filter((l) => l.unpaid).reduce((s, l) => s + countedHoursDays(l, hol), 0);
      const sickWorkdays = (i.sickDays || []).filter((d) => isWorkday(dayOf(d), hol)).length;
      i.workedHours = Math.max(0, base.worked - awayHours - sickWorkdays * 8.5);
      i.paidLeaveHours = awayHours - unpaidHours;
      i.holidayHours = base.holiday;
      const unpaidDays = (i.sickDays || []).length + unpaidHours / 8.5;
      i.socialAid = r2(pr.socialAid * Math.max(0, 30 - unpaidDays) / 30);
      return i;
    }

    /** Yemek raporlu işçinin yemek ücreti alacağı gün */
    function mealReportDays(i) {
      if (i.mealReport !== true) return 0;
      if (i.mealReportDaysOverride != null) return Math.max(0, i.mealReportDaysOverride);
      const hol = toDays(i.holidayDays);
      const fullLeave = (i.leaves || []).filter((l) => l.kind === 'full').map((l) => dayOf(l.date));
      const away = new Set(fullLeave.concat((i.sickDays || []).map(dayOf), (i.tripDays || []).map(dayOf)));
      let days = 0;
      eachDay(i.year, i.month, (d) => { if (isWorkday(d, hol) && !away.has(d)) days += 1; });
      return days + Math.max(0, i.mealReportExtraDays || 0);
    }

    // MARK: Görev (harcırah)

    function tripDays(t) {
      return { s: minutesOf(t.start), e: minutesOf(t.end) };
    }
    const startDay = (m) => Math.floor(m / 1440);

    function nights(s, e) {
      if (!(e > s)) return 0;
      return Math.max(0, startDay(e) - startDay(s));
    }
    const taskDayCount = (s, e) => (e > s ? nights(s, e) + 1 : 0);

    /** Gündelik kesirleri (md. 39): son gün öğle (13:00) ve akşam (19:00) saatlerine göre 1/3 veya 2/3 */
    function domesticDayFractions(s, e) {
      if (!(e > s)) return [];
      const first = startDay(s), last = startDay(e);
      const dayCount = last - first + 1;
      const result = new Array(Math.max(dayCount - 1, 0)).fill(1);
      let meals = 0;
      for (const hour of [13, 19]) {
        const t = last * 1440 + hour * 60;
        if (t >= s && t <= e) meals += 1;
      }
      result.push(meals / 3);
      return result;
    }

    const roundTrip = (t) => t.roundTrip !== false;
    const stayedAtHotel = (t) => t.stayedAtHotel !== false;
    const clamp3 = (x) => Math.min(Math.max(x || 0, 0), 3);
    const nightCount = (t) => Math.max(t.nightCount || 0, 0);
    const extraWorkHours = (t) => Math.max(t.extraWorkHours || 0, 0);

    function nightOverlap(start, end) {
      const e = end <= start ? end + 24 : end;
      return [[0, 8], [20, 32], [44, 56]].reduce((sum, w) => sum + Math.max(0, Math.min(e, w[1]) - Math.max(start, w[0])), 0);
    }
    const nightHoursPerNight = (t) => (t.nightStartHour == null || t.nightEndHour == null ? 0 : nightOverlap(t.nightStartHour, t.nightEndHour));

    function hotelNights(t) {
      if (!stayedAtHotel(t)) return 0;
      const { s, e } = tripDays(t);
      const total = nights(s, e);
      return Math.min(Math.max(t.hotelNights != null ? t.hotelNights : total, 0), total);
    }

    function interiorWeekendDays(s, e) {
      if (!(e > s)) return { saturdays: 0, sundays: 0 };
      let sat = 0, sun = 0;
      const last = startDay(e);
      for (let d = startDay(s) + 1; d < last; d++) {
        const w = weekday(d);
        if (w === 6) sat += 1; else if (w === 0) sun += 1;
      }
      return { saturdays: sat, sundays: sun };
    }

    function weekendTravelDaysAuto(t) {
      const { s, e } = tripDays(t);
      if (!(e > s)) return 0;
      const sameDay = startDay(s) === startDay(e);
      let count = isWeekend(startDay(s)) ? 1 : 0;
      const returnCounts = t.destination !== 'domestic' || roundTrip(t);
      if (!sameDay && returnCounts && isWeekend(startDay(e))) count += 1;
      return count;
    }
    const weekendTravelDays = (t) => Math.min(Math.max(t.weekendTravelDays != null ? t.weekendTravelDays : weekendTravelDaysAuto(t), 0), 2);

    function saturdaysWorked(t) {
      const { s, e } = tripDays(t);
      const auto = interiorWeekendDays(s, e).saturdays;
      return Math.min(Math.max(t.saturdaysWorked != null ? t.saturdaysWorked : auto, 0), auto);
    }
    function sundaysWorked(t) {
      const { s, e } = tripDays(t);
      const auto = interiorWeekendDays(s, e).sundays;
      return Math.min(Math.max(t.sundaysWorked != null ? t.sundaysWorked : auto, 0), auto);
    }

    /** Yurt dışı/KKTC (md. 43): her 24 saat bir gün, artan kesir tam gün */
    function travelDays(s, e) {
      if (!(e > s)) return 0;
      return Math.max(1, Math.ceil((e - s) / 60 / 24));
    }

    const returnsOnWeekend = (t) => isWeekend(startDay(minutesOf(t.end)));

    function mealDays(days, weekendReturn) {
      if (days <= 0) return 0;
      if (days === 1) return 1;
      return weekendReturn ? days - 1 : days;
    }

    const taskMeal = (w) => Math.floor(w.normalMeal * w.mealMultiplier * 100 + 1e-9) / 100;

    function primAndMeal(w, days, t) {
      const weekendReturn = returnsOnWeekend(t);
      const mealDayCount = mealDays(days, weekendReturn);
      const prim = r2(w.prim * days);
      const meal = r2(taskMeal(w) * mealDayCount);
      const mealNote = days > 1 && weekendReturn ? ' · hafta sonu dönüş günü hariç' : '';
      return {
        prim, meal, lines: [
          { title: 'Geçici görev primi', detail: `${days} gün × ${tl(w.prim)} (yol dahil) · bordro`, amount: prim },
          { title: 'Görevde yemek ücreti', detail: `${mealDayCount} gün × ${tl(taskMeal(w))} (${tl(w.normalMeal)} × ${plain(w.mealMultiplier)})${mealNote} · bordro`, amount: meal },
        ],
      };
    }

    const travelExtra = (t) => clamp3(t.travelExtraOut) + (roundTrip(t) || t.destination !== 'domestic' ? clamp3(t.travelExtraBack) : 0);

    /** Görevin maaş pusulasına giden saatleri (FSÇ %35/%80, gece, HGYOL, Pazar) */
    function payrollHours(w, t) {
      const { s, e } = tripDays(t);
      const days = taskDayCount(s, e);
      if (days <= 0) return { fsc35: 0, fsc80: 0, night: 0, weekendTravel: 0, sundays: 0 };
      const hours = travelExtra(t) + saturdaysWorked(t) * 8.5 + extraWorkHours(t);
      const weeks = Math.max(1, Math.ceil(days / 7));
      const h35 = Math.min(hours, 2.5 * weeks);
      return {
        fsc35: h35, fsc80: hours - h35,
        night: nightCount(t) * nightHoursPerNight(t),
        weekendTravel: weekendTravelDays(t) * w.weekendTravelHours,
        sundays: sundaysWorked(t),
      };
    }

    function overtime(w, t, days) {
      const hourly = hourlyWage(w.wageGrade);
      const travelHours = travelExtra(t);
      const saturdays = saturdaysWorked(t);
      const sundays = sundaysWorked(t);
      const saturdayHours = saturdays * 8.5;
      const dailyWage = hourly * w.dailyWageHours;
      const workHours = extraWorkHours(t);
      const hours = travelHours + saturdayHours + workHours;
      const nightHours = nightCount(t) * nightHoursPerNight(t);
      const weekendTravel = weekendTravelDays(t);
      if (!((hours > 0 || sundays > 0 || nightHours > 0 || weekendTravel > 0) && days > 0)) return { net: 0, lines: [] };
      const weeks = Math.max(1, Math.ceil(days / 7));
      const h35 = Math.min(hours, 2.5 * weeks);
      const h80 = hours - h35;
      const weekdayGross = h35 * hourly * 1.35 + h80 * hourly * 1.80;
      const sundayGross = sundays * w.sundayExtraDays * dailyWage;
      const premiumRate = WORKER_TITLES[w.workerTitle].premiumRate;
      const premiumHours = hours + sundays * 8.5;
      const premiumGross = premiumHours * hourly * premiumRate;
      const nightGross = nightHours * hourly * w.nightRate;
      const weekendTravelGross = weekendTravel * w.weekendTravelHours * hourly;
      const gross = r2(weekdayGross + sundayGross + premiumGross + nightGross + weekendTravelGross);
      const sgk = gross * (tax.sgkEmployee + tax.unemployment);
      const incomeTax = (gross - sgk) * w.taxRate;
      const stamp = gross * tax.stamp;
      const deductions = r2(sgk + incomeTax + stamp);
      const net = r2(gross - deductions);
      const lines = [];
      if (hours > 0) {
        const parts = [];
        if (travelHours > 0) parts.push(`yol ${plain(travelHours)} sa`);
        if (saturdayHours > 0) parts.push(`${saturdays} Cumartesi ${plain(saturdayHours)} sa`);
        if (workHours > 0) parts.push(`görevde ${plain(workHours)} sa`);
        lines.push({ title: 'Fazla mesai (brüt)', detail: `${parts.join(' + ')} · ${w.wageGrade}. derece ${tl(hourly)}/sa · %35: ${plain(h35)} sa, %80: ${plain(h80)} sa`, amount: r2(weekdayGross) });
      }
      if (sundays > 0) lines.push({ title: 'Pazar çalışması (brüt)', detail: `${sundays} Pazar × ${plain(w.sundayExtraDays)} ilave gün × ${tl(dailyWage)} (${plain(w.dailyWageHours)} sa)`, amount: r2(sundayGross) });
      if (premiumGross > 0) lines.push({ title: 'İdareci primi (brüt)', detail: `${WORKER_TITLES[w.workerTitle].title} %${Math.round(premiumRate * 100)} · ${plain(premiumHours)} sa × ${tl(hourly)}`, amount: r2(premiumGross) });
      if (weekendTravelGross > 0) lines.push({ title: 'Hafta sonu yol (brüt)', detail: `${weekendTravel} gün × ${plain(w.weekendTravelHours)} sa × ${tl(hourly)}`, amount: r2(weekendTravelGross) });
      if (nightGross > 0) {
        const hh = (x) => String(x || 0).padStart(2, '0') + ':00';
        lines.push({ title: 'Gece çalışma primi (brüt)', detail: `${nightCount(t)} gün × ${plain(nightHoursPerNight(t))} sa (${hh(t.nightStartHour)}–${hh(t.nightEndHour)} arası 20–08'e düşen) × ${tl(hourly)} × %${Math.round(w.nightRate * 100)}`, amount: r2(nightGross) });
      }
      lines.push({ title: 'Kesintiler', detail: `SGK+işsizlik %15, gelir vergisi %${Math.trunc(w.taxRate * 100)}, damga ‰7,59`, amount: -deductions });
      return { net, lines };
    }

    function extraTransport(t) {
      const items = (t.transport || []).filter((x) => x.amount > 0);
      return {
        total: items.reduce((s, x) => s + x.amount, 0),
        lines: items.map((x) => ({ title: `Yol: ${TRANSPORT_KINDS[x.kind]}`, detail: '', amount: x.amount })),
      };
    }

    const busFare = (id) => (id == null ? null : rates.busFares.items.find((b) => b.id === id) || null);

    function result(dailyRate, currency, dayUnits, days, nightsCount, amounts, lines, notes, missingPlace) {
      const a = (k) => amounts[k] || 0;
      return {
        dailyRate, currency, dayUnits, taskDays: days, nights: nightsCount, amounts, lines, notes, missingPlace: !!missingPlace,
        allowanceTL: a('allowance'), primTL: a('prim'), mealTL: a('meal'), lodgingTL: a('lodging'), transportTL: a('transport'), overtimeTL: a('overtime'),
        totalTL: ['allowance', 'prim', 'meal', 'lodging', 'transport', 'overtime'].reduce((s, k) => s + a(k), 0),
        bordroTL: a('prim') + a('meal') + a('overtime'),
        bankaTL: a('allowance') + a('lodging') + a('transport'),
      };
    }

    function domestic(w, t) {
      const g = w.daily;
      const { s, e } = tripDays(t);
      const fractions = domesticDayFractions(s, e);
      // TİS uygulaması: birden fazla günlük görevde dönüş günü gündeliği tam ödenir
      if (fractions.length > 1) fractions[fractions.length - 1] = 1;
      let units = 0;
      const notes = [];
      fractions.forEach((f, idx) => {
        const day = idx + 1;
        if (day <= 90) units += f; else if (day <= 180) units += f * 2 / 3;
      });
      if (fractions.length > 90) notes.push("90 günü aşan süre için gündeliğin 2/3'ü, 180 günü aşan süre için gündelik ödenmez.");
      const allowance = r2(g * units);
      const days = fractions.length;
      const pm = primAndMeal(w, days, t);

      const nightCountH = hotelNights(t);
      let lodging = 0;
      if (nightCountH > 0) {
        for (let n = 1; n <= nightCountH; n++) {
          if (n <= 10) lodging += w.hotelNightly;
          else if (n <= 90) lodging += g * 0.5;
          else if (n <= 180) lodging += r2(g * 2 / 3 * 0.4);
        }
        lodging = r2(lodging);
        if (nightCountH > 10) notes.push(`11–90. gece otel ${tl(g * 0.5)}, 91–180. gece ${tl(r2(g * 2 / 3 * 0.4))} üzerinden hesaplanır.`);
      }

      let transport = 0;
      let lines = [{ title: 'Gündelik', detail: `${dayText(units)} gün × ${tl(g)}`, amount: allowance }].concat(pm.lines);
      if (lodging > 0) {
        lines.push({ title: 'Otel', detail: nightCountH <= 10 ? `${nightCountH} gece × ${tl(w.hotelNightly)}` : `${nightCountH} gece (ilk 10 gece × ${tl(w.hotelNightly)})`, amount: lodging });
      }
      const place = busFare(t.placeID);
      if (place) {
        const legs = roundTrip(t) ? 2 : 1;
        const bus = place.fare * legs;
        transport += bus;
        lines.push({ title: `Otobüs: ${rates.busFares.origin} – ${place.name}`, detail: `${roundTrip(t) ? 'Gidiş-dönüş' : 'Tek yön'} · ${tl(place.fare)} × ${legs}`, amount: bus });
      } else {
        lines.push({ title: 'Otobüs: görev yeri seçilmedi', detail: `Görev yerini seçince ${rates.busFares.origin} fiyat listesinden eklenir`, amount: 0 });
      }
      const ex = extraTransport(t);
      transport += ex.total;
      lines = lines.concat(ex.lines);
      const ot = overtime(w, t, days);
      lines = lines.concat(ot.lines);
      return result(g, 'TRY', units, days, nightCountH,
        { allowance, prim: pm.prim, meal: pm.meal, lodging, transport, overtime: ot.net }, lines, notes, !place);
    }

    const FOREIGN_COLUMN = 5;
    const KKTC_ROW = 4;

    function abroad(w, t) {
      const country = rates.foreign.find((c) => c.id === t.countryID);
      if (!country) return result(0, '', 0, 0, 0, {}, [], ['Ülke bulunamadı.']);
      const g = country.values[FOREIGN_COLUMN];
      const gUp = g * 1.5;
      const { s, e } = tripDays(t);
      const days = travelDays(s, e);
      const kur = t.exchangeRate || 0;
      const cov = COVERAGE[t.coverage || 'none'];
      const notes = [];
      let foreignAllowance = 0;
      for (let day = 1; day <= days; day++) {
        let amount = day <= 10 ? gUp : g;
        if (day > 180) amount *= 2.0 / 3.0;
        foreignAllowance += amount * cov.factor;
      }
      if ((t.coverage || 'none') !== 'none') notes.push(`Karşılanan masraflar nedeniyle gündeliğin %${Math.trunc(cov.factor * 100)}'i ödendi.`);
      const totalNights = cov.lodging ? 0 : hotelNights(t);
      const lodgingNights = Math.min(totalNights, 10);
      const nightCap = gUp * 0.7;
      const foreignLodging = nightCap * lodgingNights;
      if (lodgingNights > 0) notes.push(`Konaklama farkı azami tutardır; tamamı için gecelik otel faturası en az ${plain(r2(gUp * 0.4 + nightCap / 0.7))} ${country.currency} olmalı.`);
      if (totalNights > 10) notes.push('Yurt dışı konaklama farkı yalnız ilk 10 gece için ödenir.');
      if (kur <= 0) notes.push('Döviz kuru girilmediği için TL karşılıkları 0 gösteriliyor.');
      const allowance = r2(foreignAllowance * kur);
      const lodging = r2(foreignLodging * kur);
      const tdc = taskDayCount(s, e);
      const pm = primAndMeal(w, tdc, t);
      const ex = extraTransport(t);
      const cur = country.currency;
      let lines = [{ title: `Gündelik (${country.name})`, detail: `${days} gün × ${plain(g)} ${cur} (ilk 10 gün ×1,5) = ${plain(r2(foreignAllowance))} ${cur}`, amount: allowance }].concat(pm.lines);
      if (foreignLodging > 0) lines.push({ title: 'Konaklama farkı', detail: `${lodgingNights} gece × ${plain(r2(nightCap))} ${cur}`, amount: lodging });
      lines = lines.concat(ex.lines);
      const ot = overtime(w, t, tdc);
      lines = lines.concat(ot.lines);
      return result(g, cur, days, tdc, lodgingNights,
        { allowance, prim: pm.prim, meal: pm.meal, lodging, transport: ex.total, overtime: ot.net }, lines, notes);
    }

    function kktc(w, t) {
      const g = rates.kktc[KKTC_ROW];
      const { s, e } = tripDays(t);
      const days = travelDays(s, e);
      let units = 0;
      for (let day = 0; day < days; day++) units += (day + 1) > 180 ? 2.0 / 3.0 : 1;
      const allowance = r2(g * units);
      const totalNights = hotelNights(t);
      const lodgingNights = Math.min(totalNights, 10);
      const lodging = r2(g * 0.75 * lodgingNights);
      const notes = [];
      if (totalNights > 10) notes.push("KKTC'de konaklama yalnız ilk 10 gece için, gündeliğin %75'ine kadar ödenir.");
      const tdc = taskDayCount(s, e);
      const pm = primAndMeal(w, tdc, t);
      const ex = extraTransport(t);
      let lines = [{ title: 'Gündelik (KKTC)', detail: `${dayText(units)} gün × ${tl(g)}`, amount: allowance }].concat(pm.lines);
      if (lodging > 0) lines.push({ title: 'Konaklama', detail: `${lodgingNights} gece × ${tl(g * 0.75)}`, amount: lodging });
      lines = lines.concat(ex.lines);
      const ot = overtime(w, t, tdc);
      lines = lines.concat(ot.lines);
      return result(g, 'TRY', units, tdc, lodgingNights,
        { allowance, prim: pm.prim, meal: pm.meal, lodging, transport: ex.total, overtime: ot.net }, lines, notes);
    }

    function calculateTrip(w, t) {
      if (t.destination === 'abroad') return abroad(w, t);
      if (t.destination === 'kktc') return kktc(w, t);
      return domestic(w, t);
    }

    /** İşçinin görev tarifeleri (rates.worker) + derece, dilim ve unvan */
    function worker(grade, taxRate, title) {
      return Object.assign({
        daily: 860, prim: 570.90, normalMeal: 328.07, mealMultiplier: 2.5, hotelNightly: 1376,
        nightRate: 0.20, sundayExtraDays: 2, weekendTravelHours: 10.5, dailyWageHours: 7.5,
      }, rates.worker, { wageGrade: grade, taxRate, workerTitle: title || 'isci' });
    }

    /** Dönemdeki görevlerin maaşa giden saatleri, görev yemeği ve primi (SalaryWizard PayrollTripTotals) */
    function applyTrips(i, trips, w) {
      const hours = { fsc35: 0, fsc80: 0, night: 0, weekendTravel: 0, sundays: 0 };
      let meal = 0, prim = 0, harcirah = 0;
      const days = [];
      const results = [];
      for (const t of trips) {
        const h = payrollHours(w, t);
        hours.fsc35 += h.fsc35; hours.fsc80 += h.fsc80; hours.night += h.night;
        hours.weekendTravel += h.weekendTravel; hours.sundays += h.sundays;
        const r = calculateTrip(w, t);
        results.push(r);
        meal += r.mealTL; prim += r.primTL; harcirah += r.bankaTL;
        const { s, e } = tripDays(t);
        for (let d = startDay(s); d <= startDay(e); d++) days.push(keyOf(d));
      }
      i.fsc35Hours += hours.fsc35;
      i.fsc80Hours += hours.fsc80;
      i.nightHours += hours.night;
      i.weekendTravelHours += hours.weekendTravel;
      // TİS md. 53/c: Pazar çalışması için 2 günlük (2 × 7,5 sa) ilave ücret
      i.holidayHours += hours.sundays * w.sundayExtraDays * w.dailyWageHours;
      i.taskMealNet = meal;
      i.taskPrimNet = prim;
      i.tripDays = days;
      return { hours, meal, prim, harcirah, results };
    }

    /** Görev dönemde mi: bitişi dönemin içinde olan görevler o ayın maaşına girer */
    function tripInPeriod(t, year, month) {
      const p = period(year, month);
      const d = startDay(minutesOf(t.end));
      return d >= p.start && d < p.end;
    }

    return {
      rates, payroll: pr, hourlyWage, taxTable, bracketRate, bracketLower, minWageTaxExemption,
      calculate, period, officialHolidays, halfHolidays, defaultHours, countedHours, leaveTotals,
      applyAbsences, mealReportDays, isWorkday: (key, hol) => isWorkday(dayOf(key), toDays(hol)),
      isHalfHoliday: (key, hol) => isHalfHoliday(dayOf(key), toDays(hol)),
      calculateTrip, payrollHours, worker, applyTrips, tripInPeriod, taskMeal,
      saturdaysWorked, sundaysWorked, weekendTravelDays, hotelNights, nightHoursPerNight,
      tripNights: (t) => { const { s, e } = tripDays(t); return nights(s, e); },
      autoWeekend: (t) => { const { s, e } = tripDays(t); return Object.assign(interiorWeekendDays(s, e), { travel: weekendTravelDaysAuto(t) }); },
      keyOf, dayOf, weekday,
    };
  }

  return { createEngine, r2, tl, plain, dayText, leaveHours, leaveTitle, HALF_PARTS, LEAVE_KINDS, WORKER_TITLES, COVERAGE, TRANSPORT_KINDS };
});
