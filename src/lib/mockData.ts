// Seed data for demo mode (see mockSupabaseClient.ts). Everything here is
// in-memory and mutable — the mock client reads and writes these arrays
// directly, so interacting with the app (creating a session, approving an
// edit, etc.) actually mutates this "database" for the rest of the session.
// Nothing here ever touches the network or a real Supabase project.

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()

// The person the demo is "logged in" as.
export const DEMO_AUTH_USER_ID = '00000000-0000-4000-8000-000000000001'
export const DEMO_USER_ID = 1

// Every seeded person is a real, logmin-able demo account (see
// mockSupabaseClient.ts's signInWithPassword) — not just Alex. Sign in with
// any of their emails below and any password to switch who you're testing
// as; useful for reviewing/approving an edit from the other side.
// Payment method handles are deliberately seeded unevenly — Alex has all
// four, a couple people have just one, and the rest have none — so demo
// mode shows every state the Members tab/pay modal can be in (full pay
// menu, a single link, and "no payment methods on file yet").
export const mockUsers = [
  { id: 1, created_at: daysAgo(120), username: 'alexchen', email: 'alex@demo.dues.app', first_name: 'Alex', last_name: 'Chen', auth_user_id: DEMO_AUTH_USER_ID, venmo_username: 'alex-chen-99', cashapp_cashtag: 'alexchen', paypal_username: 'alexchendemo', zelle_handle: 'alex@demo.dues.app' },
  { id: 2, created_at: daysAgo(118), username: 'jordanr', email: 'jordan@demo.dues.app', first_name: 'Jordan', last_name: 'Rivera', auth_user_id: '00000000-0000-4000-8000-000000000002', venmo_username: 'jordan-rivera', cashapp_cashtag: null, paypal_username: null, zelle_handle: null },
  { id: 3, created_at: daysAgo(117), username: 'sampatel', email: 'sam@demo.dues.app', first_name: 'Sam', last_name: 'Patel', auth_user_id: '00000000-0000-4000-8000-000000000003', venmo_username: null, cashapp_cashtag: 'sampatel', paypal_username: null, zelle_handle: null },
  { id: 4, created_at: daysAgo(115), username: 'morganlee', email: 'morgan@demo.dues.app', first_name: 'Morgan', last_name: 'Lee', auth_user_id: '00000000-0000-4000-8000-000000000004', venmo_username: null, cashapp_cashtag: null, paypal_username: null, zelle_handle: null },
  { id: 5, created_at: daysAgo(1), username: 'taylork', email: 'taylor@demo.dues.app', first_name: 'Taylor', last_name: 'Kim', auth_user_id: '00000000-0000-4000-8000-000000000005', venmo_username: null, cashapp_cashtag: null, paypal_username: null, zelle_handle: null },
  { id: 6, created_at: daysAgo(40), username: 'caseyn', email: 'casey@demo.dues.app', first_name: 'Casey', last_name: 'Nguyen', auth_user_id: '00000000-0000-4000-8000-000000000006', venmo_username: 'casey-nguyen', cashapp_cashtag: null, paypal_username: null, zelle_handle: 'casey@demo.dues.app' },
  { id: 7, created_at: daysAgo(38), username: 'rileyb', email: 'riley@demo.dues.app', first_name: 'Riley', last_name: 'Brooks', auth_user_id: '00000000-0000-4000-8000-000000000007', venmo_username: null, cashapp_cashtag: null, paypal_username: null, zelle_handle: null },
]

export const mockGroups = [
  { id: 1, created_at: daysAgo(90), name: 'Apartment 4B', created_by: 1, pin: '482913', description: 'Shared bills for 4B — rent split separately.', pin_enabled: true, deleted_at: null as string | null, banner_url: null as string | null },
  { id: 2, created_at: daysAgo(20), name: 'Cabin Trip', created_by: 6, pin: '119284', description: null as string | null, pin_enabled: true, deleted_at: null as string | null, banner_url: null as string | null },
]

export const mockGroupMembers = [
  { id: 1, user_id: 1, role: 'owner', status: 'active', created_at: daysAgo(90) },
  { id: 1, user_id: 2, role: 'member', status: 'active', created_at: daysAgo(89) },
  { id: 1, user_id: 3, role: 'member', status: 'active', created_at: daysAgo(89) },
  { id: 1, user_id: 4, role: 'member', status: 'active', created_at: daysAgo(85) },
  { id: 2, user_id: 6, role: 'owner', status: 'active', created_at: daysAgo(20) },
  { id: 2, user_id: 1, role: 'member', status: 'active', created_at: daysAgo(19) },
  { id: 2, user_id: 7, role: 'member', status: 'active', created_at: daysAgo(18) },
]

export const mockJoinRequests = [
  { id: 1, group_id: 1, user_id: 5, status: 'pending', created_at: daysAgo(1) },
]

export const mockInvites: Array<{ id: number; created_at: string; group_id: number; email: string; token: string; expires_at: string | null; accepted_at: string | null; invited_by: number | null }> = []

export const mockSessions = [
  { id: 101, created_at: daysAgo(12), group_id: 1, Description: 'Costco run', is_live: false, is_payment: false, created_by: 2, notes: 'Included the big pack of paper towels + laundry detergent. split the usual way.' },
  { id: 102, created_at: daysAgo(8), group_id: 1, Description: 'Electric bill. January', is_live: false, is_payment: false, created_by: 3, notes: null },
  { id: 103, created_at: daysAgo(8), group_id: 1, Description: 'Internet bill. January', is_live: false, is_payment: false, created_by: 1, notes: null },
  { id: 104, created_at: daysAgo(5), group_id: 1, Description: 'Payment from Jordan R. to Alex C.', is_live: false, is_payment: true, created_by: 2, notes: null },
  { id: 105, created_at: daysAgo(2), group_id: 1, Description: 'Weekend groceries', is_live: true, is_payment: false, created_by: 1, notes: null },
  { id: 106, created_at: daysAgo(6), group_id: 1, Description: 'Gas bill. January', is_live: false, is_payment: false, created_by: 4, notes: 'Recalculated after finding the actual bill. sorry for the mix-up!' },
  { id: 107, created_at: daysAgo(3), group_id: 1, Description: 'Streaming subscriptions', is_live: false, is_payment: false, created_by: 1, notes: null },
  { id: 108, created_at: daysAgo(4), group_id: 1, Description: 'Cleaning supplies', is_live: false, is_payment: false, created_by: 1, notes: null },
  { id: 201, created_at: daysAgo(15), group_id: 2, Description: 'Cabin rental', is_live: false, is_payment: false, created_by: 6, notes: null },
  { id: 202, created_at: daysAgo(14), group_id: 2, Description: 'Groceries + firewood', is_live: false, is_payment: false, created_by: 7, notes: null },
]

export const mockSessionPayments = [
  // 101 — Costco run, $180 / 4, Jordan paid
  { id: 1001, created_at: daysAgo(12), session_id: 101, user_id: 2, amount: 135 },
  { id: 1002, created_at: daysAgo(12), session_id: 101, user_id: 1, amount: -45 },
  { id: 1003, created_at: daysAgo(12), session_id: 101, user_id: 3, amount: -45 },
  { id: 1004, created_at: daysAgo(12), session_id: 101, user_id: 4, amount: -45 },
  // 102 — Electric, $200 / 4, Sam paid
  { id: 1005, created_at: daysAgo(8), session_id: 102, user_id: 3, amount: 150 },
  { id: 1006, created_at: daysAgo(8), session_id: 102, user_id: 1, amount: -50 },
  { id: 1007, created_at: daysAgo(8), session_id: 102, user_id: 2, amount: -50 },
  { id: 1008, created_at: daysAgo(8), session_id: 102, user_id: 4, amount: -50 },
  // 103 — Internet, $80 / 4, Alex (you) paid
  { id: 1009, created_at: daysAgo(8), session_id: 103, user_id: 1, amount: 60 },
  { id: 1010, created_at: daysAgo(8), session_id: 103, user_id: 2, amount: -20 },
  { id: 1011, created_at: daysAgo(8), session_id: 103, user_id: 3, amount: -20 },
  { id: 1012, created_at: daysAgo(8), session_id: 103, user_id: 4, amount: -20 },
  // 104 — settle-up payment, Jordan -> Alex, $40 (Jordan is the one handing
  // over money, so — same convention as any expense's "fronting" payer —
  // Jordan gets the positive entry and Alex, the recipient, gets the negative one)
  { id: 1013, created_at: daysAgo(5), session_id: 104, user_id: 2, amount: 40 },
  { id: 1014, created_at: daysAgo(5), session_id: 104, user_id: 1, amount: -40 },
  // 105 — live "Weekend groceries", still in progress (intentionally not zero-sum)
  { id: 1015, created_at: daysAgo(2), session_id: 105, user_id: 1, amount: -20 },
  { id: 1016, created_at: daysAgo(2), session_id: 105, user_id: 4, amount: 8 },
  // 106 — Gas bill, $96 / 4, Morgan paid (has a pending edit — see mockSessionEditApprovals)
  { id: 1017, created_at: daysAgo(6), session_id: 106, user_id: 4, amount: 72 },
  { id: 1018, created_at: daysAgo(6), session_id: 106, user_id: 1, amount: -24 },
  { id: 1019, created_at: daysAgo(6), session_id: 106, user_id: 2, amount: -24 },
  { id: 1020, created_at: daysAgo(6), session_id: 106, user_id: 3, amount: -24 },
  // 107 — Streaming, $40 / 4, Alex (you) paid (you have a pending edit out — see below)
  { id: 1021, created_at: daysAgo(3), session_id: 107, user_id: 1, amount: 30 },
  { id: 1022, created_at: daysAgo(3), session_id: 107, user_id: 2, amount: -10 },
  { id: 1023, created_at: daysAgo(3), session_id: 107, user_id: 3, amount: -10 },
  { id: 1024, created_at: daysAgo(3), session_id: 107, user_id: 4, amount: -10 },
  // 108 — Cleaning supplies, $24 / 4, Alex (you) paid (your edit here was rejected — see below)
  { id: 1025, created_at: daysAgo(4), session_id: 108, user_id: 1, amount: 18 },
  { id: 1026, created_at: daysAgo(4), session_id: 108, user_id: 2, amount: -6 },
  { id: 1027, created_at: daysAgo(4), session_id: 108, user_id: 3, amount: -6 },
  { id: 1028, created_at: daysAgo(4), session_id: 108, user_id: 4, amount: -6 },
  // 201 — Cabin rental, $450 / 3, Casey paid
  { id: 2001, created_at: daysAgo(15), session_id: 201, user_id: 6, amount: 300 },
  { id: 2002, created_at: daysAgo(15), session_id: 201, user_id: 1, amount: -150 },
  { id: 2003, created_at: daysAgo(15), session_id: 201, user_id: 7, amount: -150 },
  // 202 — Groceries + firewood, $90 / 3, Riley paid
  { id: 2004, created_at: daysAgo(14), session_id: 202, user_id: 7, amount: 60 },
  { id: 2005, created_at: daysAgo(14), session_id: 202, user_id: 6, amount: -30 },
  { id: 2006, created_at: daysAgo(14), session_id: 202, user_id: 1, amount: -30 },
]

export const mockSessionEditApprovals = [
  // Morgan (editor) proposed the gas bill was actually $120, not $96 — needs
  // you, Jordan, and Sam to sign off. You (Alex) haven't acted yet.
  { id: 5001, created_at: daysAgo(1), session_id: 106, editor_user_id: 4, approver_user_id: 1, status: 'pending', old_amount: -24, new_amount: -30, is_deletion: false, dismissed_at: null },
  { id: 5002, created_at: daysAgo(1), session_id: 106, editor_user_id: 4, approver_user_id: 2, status: 'pending', old_amount: -24, new_amount: -30, is_deletion: false, dismissed_at: null },
  { id: 5003, created_at: daysAgo(1), session_id: 106, editor_user_id: 4, approver_user_id: 3, status: 'pending', old_amount: -24, new_amount: -30, is_deletion: false, dismissed_at: null },
  { id: 5004, created_at: daysAgo(1), session_id: 106, editor_user_id: 4, approver_user_id: 4, status: 'approved', old_amount: 72, new_amount: 90, is_deletion: false, dismissed_at: null },
  // You (editor) proposed changing Sam's streaming share — waiting on Sam.
  { id: 5005, created_at: daysAgo(1), session_id: 107, editor_user_id: 1, approver_user_id: 3, status: 'pending', old_amount: -10, new_amount: -15, is_deletion: false, dismissed_at: null },
  { id: 5006, created_at: daysAgo(1), session_id: 107, editor_user_id: 1, approver_user_id: 1, status: 'approved', old_amount: 30, new_amount: 35, is_deletion: false, dismissed_at: null },
  // Your edit to the cleaning supplies split was rejected by Jordan.
  { id: 5007, created_at: daysAgo(1), session_id: 108, editor_user_id: 1, approver_user_id: 2, status: 'rejected', old_amount: -6, new_amount: -10, is_deletion: false, dismissed_at: null },
]

// Auto-increment counters, seeded past the highest id already in use above.
export const mockNextId: Record<string, number> = {
  User: 8,
  Group: 3,
  Session: 301,
  SessionPayment: 3001,
  SessionEditApproval: 6001,
  JoinRequest: 2,
  Invite: 1,
}
