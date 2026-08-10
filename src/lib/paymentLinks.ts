// Builds outbound links to real payment apps from the handles a user saves
// on their profile (see the payment method columns added in
// db/policies/add_payment_methods.sql). Dues never moves money itself —
// these just hand off to Venmo/Cash App/PayPal with the recipient (and,
// where the app's URL scheme supports it, the amount) pre-filled so
// settling up outside the app takes one less step.

export interface PaymentMethods {
  venmo_username?: string | null
  cashapp_cashtag?: string | null
  paypal_username?: string | null
  zelle_handle?: string | null
}

// Strips whatever leading punctuation people naturally type into the field
// ("@username", "$cashtag") — the handle needs to be bare inside the URL.
const stripLeading = (handle: string, char: string) =>
  handle.startsWith(char) ? handle.slice(1) : handle

export function venmoLink(handle: string, amount?: number, note?: string): string {
  const user = encodeURIComponent(stripLeading(handle.trim(), '@'))
  const params = new URLSearchParams({ txn: 'pay' })
  if (amount && amount > 0) params.set('amount', amount.toFixed(2))
  if (note) params.set('note', note)
  return `https://venmo.com/${user}?${params.toString()}`
}

export function cashAppLink(handle: string, amount?: number): string {
  const tag = encodeURIComponent(stripLeading(handle.trim(), '$'))
  const suffix = amount && amount > 0 ? `/${amount.toFixed(2)}` : ''
  return `https://cash.app/$${tag}${suffix}`
}

export function paypalLink(handle: string, amount?: number): string {
  const user = encodeURIComponent(stripLeading(handle.trim(), '@'))
  const suffix = amount && amount > 0 ? `/${amount.toFixed(2)}` : ''
  return `https://paypal.me/${user}${suffix}`
}

export interface PayLinkOption {
  key: 'venmo' | 'cashapp' | 'paypal'
  label: string
  url: string
}

// Quick-pay links for whichever apps this person has set up. Zelle is
// deliberately excluded here — it has no public deep link (payments are
// brokered bank-to-bank), so callers should show zelle_handle as
// copy-to-clipboard text instead of a link.
export function getPayLinks(methods: PaymentMethods, amount?: number, note?: string): PayLinkOption[] {
  const links: PayLinkOption[] = []
  if (methods.venmo_username) {
    links.push({ key: 'venmo', label: 'Venmo', url: venmoLink(methods.venmo_username, amount, note) })
  }
  if (methods.cashapp_cashtag) {
    links.push({ key: 'cashapp', label: 'Cash App', url: cashAppLink(methods.cashapp_cashtag, amount) })
  }
  if (methods.paypal_username) {
    links.push({ key: 'paypal', label: 'PayPal', url: paypalLink(methods.paypal_username, amount) })
  }
  return links
}

export function hasAnyPaymentMethod(methods: PaymentMethods): boolean {
  return !!(methods.venmo_username || methods.cashapp_cashtag || methods.paypal_username || methods.zelle_handle)
}
