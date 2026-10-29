import type { Key, T } from '@/lib/i18n';

/** Labels for PlanForm (a client component), translated on the server. */
export const planLabels = (t: T, submit: Key) => ({
  phone: t('phone'), firstName: t('firstName'), lastName: t('lastName'), batch: t('batch'), days: t('planType'), all: t('days_all'),
  weekdays: t('days_weekdays'), weekends: t('days_weekends'), custom: t('days_custom'), wallet: t('wallet'), walletHint: t('walletStaffHint'),
  sessions: t('sessions'), topUpSessions: t('topUpSessions'), wholeMonth: t('wholeMonth'),
  startsOn: t('startsOn'), endsOn: t('endsOn'), note: t('paymentNote'), amount: t('amountPaid'), submit: t(submit),
});

/** Short day names, index 0 = Sunday. */
export const dayNames = (t: T) => [0, 1, 2, 3, 4, 5, 6].map((d) => t(`d${d}` as Key));
