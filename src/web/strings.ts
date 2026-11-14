// Every Hebrew UI string in one place.
import type { AgeGroup, Gender } from '../engine/types';

export const AGE_LABEL: Record<AgeGroup, string> = { sen: 'בוגרים', jun: "ג'וניורים", cad: 'קדטים' };
export const GENDER_LABEL: Record<Gender, string> = { m: 'גברים', f: 'נשים' };

/** 2026-11-16 -> 16.11.2026 */
export const formatDate = (d: string) => (d && d.length >= 10 ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : d);

export const S = {
  appTitle: "מחשבון דירוג ג'ודו",
  appSubtitle: 'הדירוג העולמי אחרי תחרויות שעוד לא נכנסו לרשמי',
  loading: 'טוען נתונים…',
  loadError: 'לא הצלחנו לטעון את הנתונים. נסו לרענן את הדף.',
  retry: 'נסו שוב',
  updated: (when: string) => `עודכן: ${when}`,
  validation: (pct: string) => `התאמה לרשמי: ${pct}%`,
  gaps: (n: number) => (n === 1 ? 'פער אחד' : `${n.toLocaleString('he-IL')} פערים`),
  warnings: 'אזהרות מהעדכון הלילי',

  ageLegend: 'קבוצת גיל',
  genderLegend: 'מגדר',
  weightLegend: 'קטגוריית משקל',
  kg: 'ק"ג',

  addTitle: 'הוספת תחרות',
  linkPlaceholder: 'הדבק קישור JudoTV',
  linkLabel: 'קישור JudoTV לתחרות',
  add: 'הוסף',
  adding: 'מחפש…',
  notJudoTv: 'זה לא קישור של JudoTV',
  noCode: 'לא מצאנו בקישור קוד תחרות (‎…/competitions/<קוד>‎)',
  notFound: 'התחרות לא נמצאה',
  noPoints: 'התחרות הזו לא מעניקה נקודות דירוג',
  network: 'לא הצלחנו להתחבר ל-IJF. נסו שוב בעוד רגע.',
  alreadyOfficial: (name: string) => `${name} כבר כלולה בדירוג הרשמי`,
  alreadyAdded: (name: string) => `${name} כבר נוספה`,
  addedOk: (name: string) => `נוספה: ${name}`,
  switchedAge: (name: string, age: AgeGroup) => `${name} היא תחרות ${AGE_LABEL[age]}, לכן עברנו לדירוג ${AGE_LABEL[age]}`,

  pendingTitle: 'תחרויות שעוד לא נכנסו לדירוג הרשמי',
  pendingEmpty: 'אין כרגע תחרויות עם תוצאות שעוד לא נכנסו לדירוג הרשמי.',
  inProgress: 'בתהליך',
  categoriesDone: (finished: number, total: number) => `${finished} מתוך ${total} קטגוריות הסתיימו`,
  noResultsYet: 'אין עדיין תוצאות',
  liveLoading: 'מושך מה-IJF…',
  liveFresh: 'עדכני מה-IJF',
  liveFallback: 'לא הצלחנו למשוך את התחרות מה-IJF — מוצגים נתוני הלילה',
  liveFailedNoData: 'לא הצלחנו למשוך את התחרות מה-IJF, ואין לה נתוני לילה',
  unknownCompetition: (id: number) => `תחרות ${id} לא נמצאה`,
  resolving: 'מחפש את התחרות…',
  remove: 'הסר',
  juniorWorlds: "אליפות עולם לג'וניורים · נספרת גם לבוגרים",

  dateTitle: 'תאריך הדירוג',
  dateAuto: 'ברירת מחדל: יום שני שאחרי התחרות האחרונה שנוספה',
  dateOfficial: (d: string) => `הדירוג הרשמי: ${formatDate(d)}`,
  dateReset: 'חזרה לברירת המחדל',

  tableTitle: 'דירוג משוער',
  computing: 'מחשב…',
  ageLoading: 'טוען את נתוני הדירוג…',
  noEntries: 'אין ספורטאים בקטגוריה הזו.',
  colPlace: 'מקום',
  colName: 'שם',
  colPoints: 'נקודות',
  colDelta: 'שינוי',
  showAll: (n: number) => `הצג את כל ${n.toLocaleString('he-IL')}`,
  officialWas: (p: number | null) => (p === null ? 'חדש בדירוג' : `רשמי: ${p}`),
  notVerified: 'לא מאומת',
};
