// Translation to English with Chrome's built-in Translator and LanguageDetector, shared by the CSV
// export and invoices.

// Translations stay around while the page is open, so a second export does not translate the
// same project names again.
const translationCache = new Map<string, string>();

async function detectLanguage(detector: LanguageDetectorInstance, text: string) {
  const results = await detector.detect(text);
  const top = results.at(0);
  if (!top) {
    return null;
  }

  const language = top.detectedLanguage;
  if (language === 'en') {
    return null;
  }
  if (language === 'und') {
    return null;
  }

  // Short Latin-only text such as "API fix" is often misdetected, so we only trust it when the
  // detector is very sure.
  const minimum = /^\p{ASCII}*$/u.test(text) ? 0.8 : 0.3;
  if (top.confidence < minimum) {
    return null;
  }
  return language;
}

async function translateGroupUnsafe(api: TranslatorStatic, language: string, texts: string[], translations: Map<string, string>, report: (message: string) => void) {
  const availability = await api.availability({ sourceLanguage: language, targetLanguage: 'en' });
  if (availability === 'unavailable') {
    return false;
  }

  const translator = await api.create({
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', function onDownloadProgress(event) {
        report(`Загрузка модели перевода ${language}→en: ${Math.round(event.loaded * 100)}%`);
      });
    },
    sourceLanguage: language,
    targetLanguage: 'en'
  });

  report(`Перевод с ${language}…`);
  for (const text of texts) {
    const translated = await translator.translate(text);
    translationCache.set(text, translated);
    translations.set(text, translated);
  }
  translator.destroy();
  return true;
}

/**
 * Translates every text in one language. Returns false when this language could not be
 * translated, so the texts stay as they are.
 */
async function translateGroup(api: TranslatorStatic, language: string, texts: string[], translations: Map<string, string>, report: (message: string) => void) {
  try {
    const translated = await translateGroupUnsafe(api, language, texts, translations, report);
    return translated;
  } catch (error) {
    // Chrome refuses to download a model without a fresh click. That one the person can fix, so
    // we let it reach them instead of quietly skipping the language.
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw error;
    }
    console.warn('Translation failed', language, error);
    return false;
  }
}

/**
 * Translates texts to English with Chrome's on-device models. Returns null when this Chrome has
 * no translation support. Texts already in English, or in a language we could not tell, are left
 * out of the result.
 *
 * @param report gets progress messages to show the person
 */
export async function toEnglish(texts: string[], report: (message: string) => void) {
  const detectorApi = window.LanguageDetector;
  if (!detectorApi) {
    return null;
  }
  const translatorApi = window.Translator;
  if (!translatorApi) {
    return null;
  }

  const translations = new Map<string, string>();
  const failedLanguages: string[] = [];
  const pending: string[] = [];
  for (const text of new Set(texts)) {
    if (!/\p{L}/u.test(text)) {
      continue;
    }
    const cached = translationCache.get(text);
    if (cached === undefined) {
      pending.push(text);
    } else {
      translations.set(text, cached);
    }
  }
  if (pending.length === 0) {
    return { failedLanguages, translations };
  }

  report('Определение языка…');
  const detector = await detectorApi.create();
  const byLanguage = new Map<string, string[]>();
  for (const text of pending) {
    const language = await detectLanguage(detector, text);
    if (language === null) {
      continue;
    }
    const group = byLanguage.get(language);
    if (group) {
      group.push(text);
    } else {
      byLanguage.set(language, [text]);
    }
  }
  detector.destroy();

  for (const group of byLanguage.entries()) {
    const translated = await translateGroup(translatorApi, group[0], group[1], translations, report);
    if (!translated) {
      failedLanguages.push(group[0]);
    }
  }
  return { failedLanguages, translations };
}
