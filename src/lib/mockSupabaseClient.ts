// A mock of just enough of the Supabase JS client's surface for this app to
// run against in-memory data instead of the network. Every page component
// calls supabase.from(...)/rpc(...)/auth.* exactly as it would against the
// real client — this file is the only thing that knows it's fake. See
// src/lib/supabase.ts for how it gets swapped in (NEXT_PUBLIC_DEMO_MODE).

import {
  DEMO_AUTH_USER_ID,
  mockGroupMembers,
  mockGroups,
  mockInvites,
  mockJoinRequests,
  mockNextId,
  mockSessionEditApprovals,
  mockSessionPayments,
  mockSessions,
  mockUsers,
} from './mockData'

type Row = Record<string, any>

const tables: Record<string, Row[]> = {
  User: mockUsers,
  Group: mockGroups,
  GroupMember: mockGroupMembers,
  Session: mockSessions,
  SessionPayment: mockSessionPayments,
  SessionEditApproval: mockSessionEditApprovals,
  JoinRequest: mockJoinRequests,
  Invite: mockInvites,
}

type Filter = { type: 'eq' | 'neq' | 'in' | 'is'; col: string; val: any }

function matchesFilters(row: Row, filters: Filter[]) {
  return filters.every((f) => {
    const cell = row[f.col]
    switch (f.type) {
      case 'eq': return cell === f.val
      case 'neq': return cell !== f.val
      case 'in': return Array.isArray(f.val) && f.val.includes(cell)
      case 'is': return cell === f.val // used for null checks in this app
      default: return true
    }
  })
}

function attachEmbeds(table: string, select: string | undefined, row: Row): Row {
  if (!select) return row
  const out = { ...row }
  if (table === 'SessionEditApproval' && select.includes('Session!inner')) {
    const session = mockSessions.find((s) => s.id === row.session_id)
    if (!session) return null as unknown as Row // inner join: exclude if missing
    out.Session = { id: session.id, Description: session.Description, group_id: session.group_id }
  }
  if (table === 'GroupMember' && select.includes('Group(')) {
    out.Group = mockGroups.find((g) => g.id === row.id) || null
  }
  return out
}

class MockQueryBuilder {
  private table: string
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private filters: Filter[] = []
  private selectStr: string | undefined
  private orderCol: string | undefined
  private orderAsc = true
  private mode: 'list' | 'single' | 'maybeSingle' = 'list'
  private payload: Row | Row[] | undefined

  constructor(table: string) {
    this.table = table
  }

  select(cols?: string) {
    this.selectStr = cols
    return this
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert'
    this.payload = rows
    return this
  }
  update(patch: Row) {
    this.op = 'update'
    this.payload = patch
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(col: string, val: any) {
    this.filters.push({ type: 'eq', col, val })
    return this
  }
  neq(col: string, val: any) {
    this.filters.push({ type: 'neq', col, val })
    return this
  }
  in(col: string, val: any[]) {
    this.filters.push({ type: 'in', col, val })
    return this
  }
  is(col: string, val: any) {
    this.filters.push({ type: 'is', col, val })
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col
    this.orderAsc = opts?.ascending !== false
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybeSingle'
    return this
  }

  // Makes the builder awaitable, same as the real client.
  then(resolve: (v: { data: any; error: any }) => void, reject?: (e: any) => void) {
    try {
      resolve(this.execute())
    } catch (e) {
      if (reject) reject(e)
      else resolve({ data: null, error: e })
    }
  }

  private execute(): { data: any; error: any } {
    const store = tables[this.table]
    if (!store) return { data: null, error: { message: `Mock: unknown table "${this.table}"` } }

    if (this.op === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      const inserted = rows.map((r) => {
        const row: Row = { ...r }
        if (this.table === 'GroupMember') {
          // GroupMember's "id" IS the group id, passed explicitly — never auto-generated.
          if (row.status === undefined) row.status = 'active'
        } else if (row.id === undefined) {
          row.id = mockNextId[this.table] ?? 1
          mockNextId[this.table] = row.id + 1
        }
        if (row.created_at === undefined) row.created_at = new Date().toISOString()
        store.push(row)
        return row
      })
      return this.shape(inserted)
    }

    if (this.op === 'update') {
      const matched = store.filter((r) => matchesFilters(r, this.filters))
      matched.forEach((r) => Object.assign(r, this.payload))
      return this.shape(matched)
    }

    if (this.op === 'delete') {
      const matched = store.filter((r) => matchesFilters(r, this.filters))
      const matchedSet = new Set(matched)
      for (let i = store.length - 1; i >= 0; i--) {
        if (matchedSet.has(store[i])) store.splice(i, 1)
      }
      return this.shape(matched)
    }

    // select
    let rows = store.filter((r) => matchesFilters(r, this.filters))
    if (this.orderCol) {
      const col = this.orderCol
      rows = [...rows].sort((a, b) => {
        const av = a[col]
        const bv = b[col]
        if (av === bv) return 0
        return (av > bv ? 1 : -1) * (this.orderAsc ? 1 : -1)
      })
    }
    const withEmbeds = rows.map((r) => attachEmbeds(this.table, this.selectStr, r)).filter(Boolean)
    return this.shape(withEmbeds)
  }

  private shape(rows: Row[]): { data: any; error: any } {
    if (this.mode === 'single') {
      if (rows.length === 0) return { data: null, error: { code: 'PGRST116', message: 'No rows found' } }
      return { data: rows[0], error: null }
    }
    if (this.mode === 'maybeSingle') {
      return { data: rows[0] ?? null, error: null }
    }
    return { data: rows, error: null }
  }
}

// --- RPC handlers -----------------------------------------------------

function rpc(name: string, params: Row) {
  switch (name) {
    case 'find_group_by_pin': {
      const match = mockGroups.filter((g) => g.pin === params.input_pin).map((g) => ({ id: g.id, name: g.name }))
      return { data: match, error: null }
    }
    case 'find_invite_by_token': {
      const inv = mockInvites.find((i) => i.token === params.input_token)
      if (!inv) return { data: [], error: null }
      const group = mockGroups.find((g) => g.id === inv.group_id)
      return {
        data: [{
          id: inv.id,
          group_id: inv.group_id,
          email: inv.email,
          expires_at: inv.expires_at,
          accepted_at: inv.accepted_at,
          group_name: group?.name ?? null,
        }],
        error: null,
      }
    }
    case 'approve_join_request': {
      const req = mockJoinRequests.find((r) => r.id === params.request_id && r.status === 'pending')
      if (!req) return { data: null, error: { message: 'Join request not found or already resolved' } }
      const existing = mockGroupMembers.find((m) => m.id === req.group_id && m.user_id === req.user_id)
      if (existing) existing.status = 'active'
      else mockGroupMembers.push({ id: req.group_id, user_id: req.user_id, role: 'member', status: 'active', created_at: new Date().toISOString() })
      const idx = mockJoinRequests.indexOf(req)
      mockJoinRequests.splice(idx, 1)
      return { data: null, error: null }
    }
    case 'reject_join_request': {
      const req = mockJoinRequests.find((r) => r.id === params.request_id && r.status === 'pending')
      if (!req) return { data: null, error: { message: 'Join request not found or already resolved' } }
      const idx = mockJoinRequests.indexOf(req)
      mockJoinRequests.splice(idx, 1)
      return { data: null, error: null }
    }
    case 'remove_group_member': {
      const member = mockGroupMembers.find((m) => m.id === params.target_group_id && m.user_id === params.target_user_id && m.status === 'active')
      if (!member) return { data: null, error: { message: 'That person is not an active member of this group' } }
      if (member.role === 'owner') return { data: null, error: { message: 'The group owner cannot be removed' } }
      const sessionIds = mockSessions.filter((s) => s.group_id === params.target_group_id).map((s) => s.id)
      const balance = mockSessionPayments
        .filter((p) => p.user_id === params.target_user_id && sessionIds.includes(p.session_id))
        .reduce((sum, p) => sum + p.amount, 0)
      if (Math.abs(balance) > 0.01) {
        return { data: null, error: { message: `This member's balance must be $0.00 before they can be removed (currently $${balance.toFixed(2)})` } }
      }
      member.status = 'removed'
      return { data: null, error: null }
    }
    case 'update_session_notes': {
      const session = mockSessions.find((s: any) => s.id === params.target_session_id) as Row | undefined
      if (!session) return { data: null, error: { message: 'Session not found' } }
      const caller = mockUsers.find((u) => u.auth_user_id === currentAuthUserId)
      if (!caller) return { data: null, error: { message: 'Not authorized' } }
      if (session.created_by != null && session.created_by !== caller.id) {
        return { data: null, error: { message: 'Only the person who created this session can edit its notes' } }
      }
      session.notes = params.new_notes
      return { data: null, error: null }
    }
    default:
      return { data: null, error: { message: `Mock: unknown RPC "${name}"` } }
  }
}

// --- Auth mock ------------------------------------------------------------
// Any seeded person can be "logged in as" — signInWithPassword looks the
// email up among mockUsers and switches identity to them. Password is never
// actually checked (there's nothing real to check it against); only the
// email has to match one of the seeded accounts.

function buildAuthUser(mockUser: Row) {
  return {
    id: mockUser.auth_user_id,
    email: mockUser.email,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: mockUser.created_at,
  }
}

let demoSignedIn = true
let currentAuthUserId: string = DEMO_AUTH_USER_ID
type AuthListener = (event: string, session: any) => void
const authListeners: AuthListener[] = []

function currentSession() {
  if (!demoSignedIn) return null
  const mockUser = mockUsers.find((u) => u.auth_user_id === currentAuthUserId)
  if (!mockUser) return null
  return { user: buildAuthUser(mockUser), access_token: 'mock-token' }
}

function notifyAuthListeners(event: string) {
  const session = currentSession()
  authListeners.forEach((cb) => cb(event, session))
}

function signInAsEmail(email: string) {
  const mockUser = mockUsers.find((u) => u.email.toLowerCase() === (email || '').trim().toLowerCase())
  if (!mockUser) {
    return {
      data: { session: null, user: null },
      error: { message: 'No demo account with that email. See README-DEMO.md for the list of demo accounts — any password works.' },
    }
  }
  currentAuthUserId = mockUser.auth_user_id
  demoSignedIn = true
  notifyAuthListeners('SIGNED_IN')
  return { data: { session: currentSession(), user: buildAuthUser(mockUser) }, error: null }
}

export const mockSupabase = {
  from(table: string) {
    return new MockQueryBuilder(table)
  },
  rpc(name: string, params: Row = {}) {
    return Promise.resolve(rpc(name, params))
  },
  auth: {
    async getSession() {
      return { data: { session: currentSession() }, error: null }
    },
    onAuthStateChange(callback: AuthListener) {
      authListeners.push(callback)
      // Mimic the real client firing an initial event once subscribed.
      setTimeout(() => callback(demoSignedIn ? 'SIGNED_IN' : 'SIGNED_OUT', currentSession()), 0)
      return {
        data: {
          subscription: {
            unsubscribe() {
              const i = authListeners.indexOf(callback)
              if (i >= 0) authListeners.splice(i, 1)
            },
          },
        },
      }
    },
    async signInWithPassword({ email }: { email: string; password: string }) {
      return signInAsEmail(email)
    },
    async signUp({ email }: { email: string; password: string; options?: any }) {
      // Demo mode doesn't create new accounts — signing "up" with a seeded
      // email just signs you in as them, same as signing in.
      return signInAsEmail(email)
    },
    async signInWithOAuth() {
      currentAuthUserId = DEMO_AUTH_USER_ID
      demoSignedIn = true
      notifyAuthListeners('SIGNED_IN')
      return { data: {}, error: null }
    },
    async signOut() {
      demoSignedIn = false
      notifyAuthListeners('SIGNED_OUT')
      return { error: null }
    },
  },
}
