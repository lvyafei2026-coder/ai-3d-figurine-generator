// English-only interface. Keep the translation dictionary so visible copy stays centralized.
const MARKER = '/ai-3d-figurine-generator';

function getBase() {
  const p = window.location.pathname;
  const idx = p.indexOf(MARKER);
  return idx !== -1 ? p.slice(0, idx + MARKER.length) : '';
}

async function initPage() {
  const base = getBase();
  window.__i18n = { t: {}, lang: 'en', base };
  try {
    const res = await fetch(base + '/locales/en.json');
    if (!res.ok) throw new Error('Failed to load English locale');
    const translations = await res.json();
    document.documentElement.lang = 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (translations[key] === undefined) return;
      if (key === 'disclaimer' || key === 'faq8a') el.innerHTML = translations[key];
      else el.textContent = translations[key];
    });
    window.__i18n = { t: translations, lang: 'en', base };
  } catch (err) {
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', initPage);
