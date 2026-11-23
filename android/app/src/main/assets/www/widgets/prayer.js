import { DEFAULT_CFG, LOCALE, cfg, fmtDur, fmtHM, h, en, tp, tpv } from '../main.js';
import { W } from '../registry.js';

// ---------------------------------------------------------------- prayer times
// Computed on the phone from the weather location, with the usual astronomical formulas (sun declination and the
// equation of time). Nothing is fetched: no new outbound connection and nothing about the location leaves the phone.

// Twilight angles in degrees; a number for `isha` is an angle, `{ min }` is minutes after maghrib. `ihtiyat` is the
// safety margin some authorities add to every time (Kemenag publishes its tables with 2 minutes).
export const PRAYER_METHODS = {
  kemenag: { fajr: 20, isha: 18, ihtiyat: 2 },     // Kementerian Agama, Indonesia
  jakim: { fajr: 20, isha: 18, ihtiyat: 2 },       // JAKIM, Malaysia
  mwl: { fajr: 18, isha: 17, ihtiyat: 0 },         // Muslim World League
  isna: { fajr: 15, isha: 15, ihtiyat: 0 },        // Islamic Society of North America
  egypt: { fajr: 19.5, isha: 17.5, ihtiyat: 0 },   // Egyptian General Authority of Survey
  makkah: { fajr: 18.5, isha: { min: 90 }, ihtiyat: 0 }, // Umm al-Qura, Makkah
  karachi: { fajr: 18, isha: 18, ihtiyat: 0 },     // University of Islamic Sciences, Karachi
  diyanet: { fajr: 18, isha: 17, ihtiyat: 0 },     // Diyanet, Türkiye
};

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD), cos = (d) => Math.cos(d * RAD), tan = (d) => Math.tan(d * RAD);
const asin = (x) => Math.asin(x) / RAD, acos = (x) => Math.acos(x) / RAD, atan2 = (y, x) => Math.atan2(y, x) / RAD;
const fixAngle = (a) => a - 360 * Math.floor(a / 360), fixHour = (a) => a - 24 * Math.floor(a / 24);

// Sun declination and equation of time (hours) for a Julian date.
function sunPosition(jd) {
  const d = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * d), q = fixAngle(280.459 + 0.98564736 * d);
  const l = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g));
  const e = 23.439 - 0.00000036 * d;
  const ra = fixHour(atan2(cos(e) * sin(l), cos(l)) / 15);
  return { decl: asin(sin(e) * sin(l)), eqt: q / 15 - ra };
}

function julian(year, month, day) {
  if (month <= 2) { year -= 1; month += 12; }
  const a = Math.floor(year / 100), b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}

/**
 * Prayer times for one local calendar day, as Date objects (null where the sun never reaches the angle).
 * @param {Date} date any moment on the day wanted (the phone's local day)
 * @param {number} lat latitude in degrees
 * @param {number} lon longitude in degrees, east positive
 * @param {{ method?: string, asr?: 'shafi' | 'hanafi' }} [opts]
 */
export function prayerTimes(date, lat, lon, opts = {}) {
  const method = PRAYER_METHODS[opts.method] || PRAYER_METHODS.kemenag;
  const asrFactor = opts.asr === 'hanafi' ? 2 : 1;
  const y = date.getFullYear(), m = date.getMonth(), day = date.getDate();
  const noon = new Date(y, m, day, 12);
  const tz = -noon.getTimezoneOffset() / 60;
  const jd = julian(y, m + 1, day) - lon / (15 * 24);

  const midDay = (t) => fixHour(12 - sunPosition(jd + t / 24).eqt);
  const angleTime = (angle, t, ccw) => {
    const { decl } = sunPosition(jd + t / 24);
    const noonT = midDay(t);
    const x = (-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat));
    if (!(x >= -1 && x <= 1)) return NaN;
    const span = acos(x) / 15;
    return noonT + (ccw ? -span : span);
  };
  const asrTime = (t) => {
    const { decl } = sunPosition(jd + t / 24);
    const angle = -Math.atan(1 / (asrFactor + tan(Math.abs(lat - decl)))) / RAD;
    return angleTime(angle, t, false);
  };

  // Two passes: the first from rough guesses, the second at the times the first found (sun position moves in a day).
  let t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
  for (let pass = 0; pass < 2; pass++) {
    const f = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (Number.isFinite(v) ? v : 12)]));
    t = {
      fajr: angleTime(method.fajr, f.fajr, true),
      sunrise: angleTime(0.833, f.sunrise, true),
      dhuhr: midDay(f.dhuhr),
      asr: asrTime(f.asr),
      sunset: angleTime(0.833, f.sunset, false),
      isha: typeof method.isha === 'number' ? angleTime(method.isha, f.isha, false) : NaN,
    };
  }
  const shift = tz - lon / 15;
  for (const k of Object.keys(t)) t[k] += shift;

  // High latitudes: when the sun does not get low enough, use the share of the night the angle stands for.
  const night = Number.isFinite(t.sunset) && Number.isFinite(t.sunrise) ? fixHour(t.sunrise - t.sunset) : NaN;
  if (!Number.isFinite(t.fajr) && Number.isFinite(night)) t.fajr = t.sunrise - (method.fajr / 60) * night;
  if (typeof method.isha === 'number') {
    if (!Number.isFinite(t.isha) && Number.isFinite(night)) t.isha = t.sunset + (method.isha / 60) * night;
  } else if (Number.isFinite(t.sunset)) {
    t.isha = t.sunset + method.isha.min / 60;
  }

  const extra = method.ihtiyat / 60;
  const out = {
    imsak: t.fajr - 10 / 60 + extra,
    fajr: t.fajr + extra,
    sunrise: t.sunrise - extra,
    dhuhr: t.dhuhr + extra,
    asr: t.asr + extra,
    maghrib: t.sunset + extra,
    isha: t.isha + extra,
  };
  const at = (hours) => {
    if (!Number.isFinite(hours)) return null;
    // published tables round up to the next minute (sunrise down), so do the same
    const d = new Date(y, m, day, 0, 0, 0, 0);
    d.setTime(d.getTime() + Math.ceil(hours * 60 - 1e-6) * 60_000);
    return d;
  };
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, at(v)]));
}

const NAMES = { imsak: 'Imsak', fajr: 'Fajr', sunrise: 'Sunrise', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
// Sunrise and imsak are shown but are not prayers, so the "next" highlight skips them.
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

// The Hijri date in the panel language, when this WebView's Intl knows the Umm al-Qura calendar.
function hijri(date) {
  try {
    const s = date.toLocaleDateString(`${LOCALE}-u-ca-islamic-umalqura`, { day: 'numeric', month: 'long', year: 'numeric' });
    return /\d/.test(s) ? s : '';
  } catch (_) {
    return '';
  }
}

W.prayer = {
  needs: ['tick'],
  create(box, { o }) {
    const opts = { method: o.method || 'kemenag', asr: o.asr === 'hanafi' ? 'hanafi' : 'shafi' };
    const shown = o.imsak === false ? Object.keys(NAMES).filter((k) => k !== 'imsak') : Object.keys(NAMES);
    const city = h('span', 'w-sub');
    const nextName = h('b', 'pr-next-name'), nextTime = h('span', 'pr-next-time'), nextIn = h('small', 'pr-next-in');
    const list = h('div', 'pr-list'), date = h('div', 'pr-date');
    const rows = Object.fromEntries(shown.map((k) => {
      const time = h('span', 'pr-t', '—');
      const row = h('div', `pr-row pr-${k}`, h('span', 'pr-n', tp(NAMES[k])), time);
      list.append(row);
      return [k, { row, time }];
    }));
    box.append(h('div', 'w-title', en('Prayer times'), city), h('div', 'pr-next', nextName, nextTime, nextIn), list, date);

    let key = '', day = '', today = null, tomorrow = null;
    return {
      update() {
        const { city: name, lat, lon } = cfg.weather || DEFAULT_CFG.weather;
        if (city.textContent !== (name || '')) city.textContent = name || '';
        const now = new Date();
        const dayKey = `${now.toDateString()}|${lat},${lon}`;
        if (dayKey !== day) {
          day = dayKey;
          // parseFloat, not +x: an empty or null coordinate is missing, not 0° (the Gulf of Guinea)
          const la = parseFloat(lat), lo = parseFloat(lon);
          if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
            today = tomorrow = null;
          } else {
            today = prayerTimes(now, la, lo, opts);
            tomorrow = prayerTimes(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12), la, lo, opts);
          }
          for (const k of shown) rows[k].time.textContent = today?.[k] ? fmtHM(today[k]) : '—';
          const hd = hijri(now);
          date.textContent = hd;
          date.hidden = !hd;
        }
        const k = `${Math.floor(now / 30_000)}|${day}`;
        if (k === key) return;
        key = k;
        if (!today) {
          nextName.textContent = '—';
          nextTime.textContent = '';
          nextIn.textContent = tp('Set a location in the weather settings');
          return;
        }
        let next = PRAYERS.find((p) => today[p] && today[p] > now);
        const at = next ? today[next] : tomorrow?.fajr;
        if (!next) next = 'fajr';
        nextName.textContent = tp(NAMES[next]);
        nextTime.textContent = at ? fmtHM(at) : '—';
        nextIn.textContent = at ? tpv('in {dur}', { dur: fmtDur(at - now) }) : '';
        // the prayer whose time it is now (between its start and the next one) is marked, and the next one too
        const current = [...PRAYERS].reverse().find((p) => today[p] && today[p] <= now);
        for (const p of shown) {
          rows[p].row.classList.toggle('now', p === current);
          rows[p].row.classList.toggle('next', p === next && (today[p] > now));
        }
        box.classList.toggle('soon', !!at && at - now < 15 * 60_000);
      },
    };
  },
};
