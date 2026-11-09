// Chrome's built-in on-device AI APIs, available in Chrome 138+ on desktop. TypeScript's DOM lib
// does not include them yet, and they are missing in other browsers and older Chrome versions.

type AIAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface AIDownloadProgressEvent extends Event {
  /**
   * Share of the model downloaded so far, from 0 to 1.
   */
  loaded: number;
}

interface AICreateMonitor extends EventTarget {
  addEventListener(type: 'downloadprogress', listener: (event: AIDownloadProgressEvent) => void): void;
}

interface LanguageDetectionResult {
  /**
   * From 0 to 1.
   */
  confidence: number;

  /**
   * A BCP 47 language code, or "und" when the language could not be told.
   */
  detectedLanguage: string;
}

interface LanguageDetectorInstance {
  destroy(): void;

  /**
   * Candidate languages, the most likely first.
   */
  detect(input: string): Promise<LanguageDetectionResult[]>;
}

interface LanguageDetectorStatic {
  create(): Promise<LanguageDetectorInstance>;
}

interface TranslatorOptions {
  monitor?: (monitor: AICreateMonitor) => void;

  sourceLanguage: string;

  targetLanguage: string;
}

interface TranslatorInstance {
  destroy(): void;

  translate(input: string): Promise<string>;
}

interface TranslatorStatic {
  availability(options: TranslatorOptions): Promise<AIAvailability>;

  /**
   * Downloading a model needs a recent user gesture, so call this from a click handler.
   */
  create(options: TranslatorOptions): Promise<TranslatorInstance>;
}

interface Window {
  /**
   * @see https://developer.chrome.com/docs/ai/language-detection
   */
  LanguageDetector?: LanguageDetectorStatic;

  /**
   * @see https://developer.chrome.com/docs/ai/translator-api
   */
  Translator?: TranslatorStatic;
}
