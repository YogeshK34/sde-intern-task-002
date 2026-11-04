import { Hono } from 'hono'

export type HomeRow = {
  id: string
  name: string
}

export type MemberRow = {
  id: string
  home_id: string
  name: string
  order_index: number
}

export type BillRow = {
  id: string
  home_id: string
  title: string
  total_cents: number
}

export type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

export type BalanceRow = {
  memberId: string
  name: string
  outstandingCents: number
}

type CountRow = {
  count: number
}

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req.json<{ name?: string }>().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM members WHERE home_id = ?')
    .bind(homeId)
    .first<CountRow>()

  const orderIndex = countRow?.count ?? 0
  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name, order_index) VALUES (?, ?, ?, ?)')
    .bind(id, homeId, name, orderIndex)
    .run()

  return c.json({ id, homeId, name }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json<{ title?: unknown; totalCents?: unknown }>().catch(() => null)
  if (!body || typeof body.title !== 'string' || body.title.trim().length === 0) {
    return c.json({ error: 'Title is required' }, 400)
  }

  const totalCents = body.totalCents
  if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'totalCents must be a positive integer' }, 422)
  }

  const membersResult = await c.env.DB.prepare(
    'SELECT id, home_id, name, order_index FROM members WHERE home_id = ? ORDER BY order_index ASC',
  )
    .bind(homeId)
    .all<MemberRow>()

  const members = membersResult.results
  if (!members || members.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const base = Math.floor(totalCents / members.length)
  const remainder = totalCents % members.length

  const billId = crypto.randomUUID()
  const title = body.title.trim()

  const shares = members.map((member, i) => {
    const amountCents = base + (i < remainder ? 1 : 0)
    return {
      id: crypto.randomUUID(),
      memberId: member.id,
      amountCents,
      paidAt: null,
    }
  })

  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents, null, null),
    ),
  ]

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares,
    },
    201,
  )
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  type BillWithSharesRow = {
    bill_id: string
    bill_home_id: string
    bill_title: string
    bill_total_cents: number
    share_id: string | null
    share_member_id: string | null
    share_member_name: string | null
    share_amount_cents: number | null
    share_paid_at: string | null
  }

  const query = `
    SELECT 
      b.id as bill_id,
      b.home_id as bill_home_id,
      b.title as bill_title,
      b.total_cents as bill_total_cents,
      s.id as share_id,
      s.member_id as share_member_id,
      m.name as share_member_name,
      s.amount_cents as share_amount_cents,
      s.paid_at as share_paid_at
    FROM bills b
    LEFT JOIN shares s ON s.bill_id = b.id
    LEFT JOIN members m ON m.id = s.member_id
    WHERE b.home_id = ?
    ORDER BY b.rowid ASC, m.order_index ASC
  `

  const rows = await c.env.DB.prepare(query).bind(homeId).all<BillWithSharesRow>()

  const billsMap = new Map<
    string,
    {
      id: string
      homeId: string
      title: string
      totalCents: number
      shares: Array<{
        id: string
        memberId: string
        memberName?: string
        amountCents: number
        paidAt: string | null
      }>
    }
  >()

  for (const row of rows.results) {
    let bill = billsMap.get(row.bill_id)
    if (!bill) {
      bill = {
        id: row.bill_id,
        homeId: row.bill_home_id,
        title: row.bill_title,
        totalCents: row.bill_total_cents,
        shares: [],
      }
      billsMap.set(row.bill_id, bill)
    }

    if (row.share_id && row.share_member_id && row.share_amount_cents !== null) {
      bill.shares.push({
        id: row.share_id,
        memberId: row.share_member_id,
        memberName: row.share_member_name ?? undefined,
        amountCents: row.share_amount_cents,
        paidAt: row.share_paid_at,
      })
    }
  }

  return c.json({ bills: Array.from(billsMap.values()) }, 200)
});

app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<Pick<HomeRow, 'id'>>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, name FROM members WHERE home_id = ? ORDER BY order_index ASC'
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string }>()

  return c.json({ members: result.results }, 200)
});

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')
  if (!key || key.trim().length === 0) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<Pick<BillRow, 'id'>>()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (share.idempotency_key === key) {
    return c.json(
      {
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: share.paid_at,
      },
      200,
    )
  }

  if (share.paid_at !== null && share.idempotency_key !== key) {
    return c.json({ error: 'Share already paid with a different key' }, 409)
  }

  const paidAt = new Date().toISOString()
  try {
    const updateResult = await c.env.DB.prepare(
      'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL',
    )
      .bind(paidAt, key, shareId)
      .run()

    if (updateResult.meta.changes === 0) {
      const currentShare = await c.env.DB.prepare(
        'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
      )
        .bind(shareId)
        .first<ShareRow>()

      if (currentShare?.idempotency_key === key) {
        return c.json(
          {
            id: currentShare.id,
            memberId: currentShare.member_id,
            amountCents: currentShare.amount_cents,
            paidAt: currentShare.paid_at,
          },
          200,
        )
      }

      return c.json({ error: 'Share already paid with a different key' }, 409)
    }

    return c.json(
      {
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt,
      },
      200,
    )
  } catch (_e) {
    return c.json({ error: 'Share already paid with a different key' }, 409)
  }
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT 
       m.id as memberId,
       m.name,
       COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0) as outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id
     LEFT JOIN bills b ON b.id = s.bill_id AND b.home_id = ?
     WHERE m.home_id = ?
     GROUP BY m.id, m.name, m.order_index
     ORDER BY m.order_index ASC`,
  )
    .bind(homeId, homeId)
    .all<BalanceRow>()

  return c.json({ balances: result.results }, 200)
})

export default app
