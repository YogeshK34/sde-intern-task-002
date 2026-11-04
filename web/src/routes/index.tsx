import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useState } from 'react'

export const Route = createFileRoute('/')({
  component: HomeView,
})

type Share = {
  id: string
  memberId: string
  memberName?: string
  amountCents: number
  paidAt: string | null
}

type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

type MemberRow = { id: string; homeId: string; name: string }

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function HomeView() {
  const [homeId, setHomeId] = useState('')
  const [homeName, setHomeName] = useState('')
  const [homeLoaded, setHomeLoaded] = useState(false)

  const [homeNameInput, setHomeNameInput] = useState('')
  const [creatingHome, setCreatingHome] = useState(false)
  const [createHomeError, setCreateHomeError] = useState<string | null>(null)

  const [memberNameInput, setMemberNameInput] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  const [copied, setCopied] = useState<string | null>(null)

  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payingShareId, setPayingShareId] = useState<string | null>(null)
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({})

  const [newBillTitle, setNewBillTitle] = useState('')
  const [newBillAmount, setNewBillAmount] = useState('')
  const [creatingBill, setCreatingBill] = useState(false)
  const [billError, setBillError] = useState<string | null>(null)

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  const fetchData = useCallback(async (targetHomeId: string) => {
    if (!targetHomeId.trim()) {
      setError('Please enter or configure a Home ID.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    const start = Date.now()

    try {
      const [billsRes, balancesRes, membersRes] = await Promise.all([
        fetch(`/api/homes/${targetHomeId}/bills`),
        fetch(`/api/homes/${targetHomeId}/balances`),
        fetch(`/api/homes/${targetHomeId}/members`),
      ])

      if (!billsRes.ok) {
        const errorJson = (await billsRes.json().catch(() => null)) as { error?: string } | null
        throw new Error(errorJson?.error || `Failed to fetch bills (HTTP ${billsRes.status})`)
      }

      if (!balancesRes.ok) {
        const errorJson = (await balancesRes.json().catch(() => null)) as { error?: string } | null
        throw new Error(errorJson?.error || `Failed to fetch balances (HTTP ${balancesRes.status})`)
      }

      if (!membersRes.ok) {
        const errorJson = (await membersRes.json().catch(() => null)) as { error?: string } | null
        throw new Error(errorJson?.error || `Failed to fetch members (HTTP ${membersRes.status})`)
      }

      const billsData = (await billsRes.json()) as { bills: Bill[] }
      const balancesData = (await balancesRes.json()) as { balances: Balance[] }
      const membersData = (await membersRes.json()) as { members: MemberRow[] }

      setHomeId(targetHomeId)
      setBills(billsData.bills || [])
      setBalances(balancesData.balances || [])
      setMembers(membersData.members || [])
      setHomeLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred while fetching data.')
    } finally {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, 600 - elapsed)
      await new Promise((resolve) => setTimeout(resolve, remaining))
      setLoading(false)
    }
  }, [])

  const createHome = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!homeNameInput.trim()) {
      setCreateHomeError('Home name is required')
      return
    }

    setCreatingHome(true)
    setCreateHomeError(null)

    try {
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: homeNameInput.trim() }),
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(errJson?.error || `Failed to create home (HTTP ${res.status})`)
      }

      const data = (await res.json()) as { id: string; name: string }
      setHomeId(data.id)
      setHomeName(data.name)
      setHomeNameInput('')
      await fetchData(data.id)
    } catch (err) {
      setCreateHomeError(err instanceof Error ? err.message : 'Failed to create home')
    } finally {
      setCreatingHome(false)
    }
  }

  const addMember = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!memberNameInput.trim()) {
      setMemberError('Name is required')
      return
    }

    setAddingMember(true)
    setMemberError(null)

    try {
      const res = await fetch(`/api/homes/${homeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: memberNameInput.trim() }),
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(errJson?.error || `Failed to add member (HTTP ${res.status})`)
      }

      setMemberNameInput('')

      const membersRes = await fetch(`/api/homes/${homeId}/members`)
      if (!membersRes.ok) {
        const errJson = (await membersRes.json().catch(() => null)) as { error?: string } | null
        throw new Error(errJson?.error || `Failed to fetch members (HTTP ${membersRes.status})`)
      }

      const data = (await membersRes.json()) as { members: MemberRow[] }
      setMembers(data.members || [])
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  const handlePay = async (billId: string, shareId: string) => {
    setPayingShareId(shareId)
    setPaymentErrors((prev) => {
      const next = { ...prev }
      delete next[shareId]
      return next
    })

    try {
      const key = crypto.randomUUID()
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': key,
        },
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(errJson?.error || `Payment failed with status ${res.status}`)
      }

      const updated = (await res.json()) as Share

      setBills((prevBills) =>
        prevBills.map((bill) =>
          bill.id === billId
            ? {
                ...bill,
                shares: bill.shares.map((share) =>
                  share.id === shareId ? { ...share, paidAt: updated.paidAt } : share,
                ),
              }
            : bill,
        ),
      )

      fetch(`/api/homes/${homeId}/balances`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { balances: Balance[] } | null) => {
          if (data?.balances) setBalances(data.balances)
        })
        .catch(() => {})
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      setPaymentErrors((prev) => ({ ...prev, [shareId]: msg }))
    } finally {
      setPayingShareId(null)
    }
  }

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newBillTitle.trim()) {
      setBillError('Title is required')
      return
    }

    const dollars = Number.parseFloat(newBillAmount)
    if (Number.isNaN(dollars) || dollars <= 0) {
      setBillError('Enter a positive dollar amount')
      return
    }

    const totalCents = Math.round(dollars * 100)
    setCreatingBill(true)
    setBillError(null)

    try {
      const res = await fetch(`/api/homes/${homeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newBillTitle.trim(), totalCents }),
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(errJson?.error || `Failed to create bill (HTTP ${res.status})`)
      }

      setNewBillTitle('')
      setNewBillAmount('')
      await fetchData(homeId)
    } catch (err) {
      setBillError(err instanceof Error ? err.message : 'Failed to create bill')
    } finally {
      setCreatingBill(false)
    }
  }

  const memberNameMap = new Map<string, string>()
  for (const m of members) {
    memberNameMap.set(m.id, m.name)
  }
  for (const b of balances) {
    memberNameMap.set(b.memberId, b.name)
  }

  return (
    <main className="min-h-screen bg-[#F5F5F0] p-8">
      <div className="max-w-4xl mx-auto">
        {/* Page header */}
        <div className="mb-10">
          <h1 className="text-4xl font-black tracking-[-0.04em] uppercase">BILL SPLITTER</h1>
          {homeLoaded && (
            <p className="font-mono text-sm text-[#0A0A0A] font-bold mt-1 uppercase tracking-wide">
              {homeName || 'HOME'}
            </p>
          )}
          {!homeLoaded && (
            <p className="font-mono text-sm text-[#555] mt-1">shared home expenses, split fairly</p>
          )}
          {homeLoaded && (
            <div className="flex items-center gap-3 mt-2">
              <span className="font-mono text-xs text-[#555]">HOME ID</span>
              <button
                type="button"
                onClick={() => copyId(homeId)}
                className="border-2 border-[#0A0A0A] px-3 py-1 text-xs font-bold uppercase bg-[#F5F5F0] shadow-[2px_2px_0px_#0A0A0A] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_#0A0A0A] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all duration-100"
              >
                COPY ID
              </button>
              {copied === homeId && (
                <span className="font-mono text-xs text-[#00C853] font-bold">COPIED!</span>
              )}
            </div>
          )}
          <hr className="border-t-2 border-[#0A0A0A] mt-4" />
        </div>

        {/* Mode 1 — No home loaded (initial state) */}
        {!homeLoaded && (
          <div className="border-2 border-[#0A0A0A] bg-white shadow-[4px_4px_0px_#0A0A0A] p-6 mb-8">
            <h2 className="text-lg font-black uppercase tracking-tight mb-4">
              Create or Load Home
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 items-center">
              {/* Left — Create new home */}
              <div>
                <label
                  htmlFor="home-name-input"
                  className="block font-bold text-xs uppercase tracking-wide mb-2"
                >
                  Create New Home
                </label>
                <div className="flex gap-2">
                  <input
                    id="home-name-input"
                    type="text"
                    value={homeNameInput}
                    onChange={(e) => setHomeNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createHome()}
                    placeholder="Home name"
                    disabled={creatingHome || loading}
                    className="border-2 border-[#0A0A0A] bg-[#F5F5F0] px-3 py-2 text-sm font-mono flex-1 focus:outline-none focus:bg-[#FFDD00] transition-colors duration-100"
                  />
                  <button
                    type="button"
                    onClick={() => createHome()}
                    disabled={creatingHome || loading}
                    className="bg-[#0A0A0A] text-[#F5F5F0] border-2 border-[#0A0A0A] px-4 py-2 font-bold text-xs uppercase tracking-wide shadow-[4px_4px_0px_#0A0A0A] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_#0A0A0A] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all duration-100 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {creatingHome ? 'CREATING...' : 'CREATE HOME'}
                  </button>
                </div>
                {createHomeError && (
                  <p className="font-mono text-xs text-[#FF2D2D] font-bold mt-2">
                    {createHomeError}
                  </p>
                )}
              </div>

              {/* Divider between them */}
              <div className="flex items-center justify-center font-black text-sm">OR</div>

              {/* Right — Load existing home */}
              <div>
                <label
                  htmlFor="home-id-input"
                  className="block font-bold text-xs uppercase tracking-wide mb-2"
                >
                  Load Existing Home
                </label>
                <div className="flex gap-2">
                  <input
                    id="home-id-input"
                    type="text"
                    value={homeId}
                    onChange={(e) => setHomeId(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchData(homeId)}
                    placeholder="Enter home UUID"
                    disabled={loading}
                    className="border-2 border-[#0A0A0A] bg-[#F5F5F0] px-3 py-2 text-sm font-mono flex-1 focus:outline-none focus:bg-[#FFDD00] transition-colors duration-100"
                  />
                  <button
                    type="button"
                    onClick={() => fetchData(homeId)}
                    disabled={loading}
                    className="bg-[#0A0A0A] text-[#F5F5F0] border-2 border-[#0A0A0A] px-4 py-2 font-bold text-xs uppercase tracking-wide shadow-[4px_4px_0px_#0A0A0A] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_#0A0A0A] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all duration-100 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {loading ? 'LOADING...' : 'LOAD HOME'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mode 2 — Home loaded */}
        {homeLoaded && (
          <>
            {/* 2. Add Member section */}
            <div className="border-2 border-[#0A0A0A] bg-white shadow-[4px_4px_0px_#0A0A0A] p-6 mb-8">
              <h2 className="text-lg font-black uppercase tracking-tight mb-4">ADD MEMBER</h2>
              <form onSubmit={addMember} className="flex gap-3">
                <input
                  placeholder="Member name"
                  value={memberNameInput}
                  onChange={(e) => setMemberNameInput(e.target.value)}
                  disabled={addingMember}
                  className="border-2 border-[#0A0A0A] bg-[#F5F5F0] px-3 py-2 text-sm font-mono flex-1 focus:outline-none focus:bg-[#FFDD00] transition-colors duration-100"
                />
                <button
                  type="submit"
                  disabled={addingMember}
                  className="bg-[#0A0A0A] text-[#F5F5F0] border-2 border-[#0A0A0A] px-4 py-2 font-bold text-sm uppercase tracking-wide shadow-[4px_4px_0px_#0A0A0A] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_#0A0A0A] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all duration-100 disabled:opacity-40 disabled:pointer-events-none"
                >
                  {addingMember ? 'ADDING...' : 'ADD MEMBER'}
                </button>
              </form>
              {memberError && (
                <p className="font-mono text-xs text-[#FF2D2D] font-bold mt-2">{memberError}</p>
              )}
            </div>

            {/* 3. Members list */}
            <div className="border-2 border-[#0A0A0A] bg-white shadow-[4px_4px_0px_#0A0A0A] p-6 mb-8">
              <h2 className="text-lg font-black uppercase tracking-tight mb-4">Members</h2>
              {members.length === 0 ? (
                <p className="font-mono text-sm text-[#555]">no members yet — add them via API</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {members.map((m, i) => (
                    <span
                      key={m.id}
                      className="border-2 border-[#0A0A0A] px-3 py-1 text-sm font-bold bg-[#F5F5F0]"
                    >
                      {i + 1}. {m.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Balances section */}
            {bills.length > 0 && balances.length > 0 && (
              <div className="border-2 border-[#0A0A0A] bg-white shadow-[4px_4px_0px_#0A0A0A] p-6 mb-8">
                <h2 className="text-lg font-black uppercase tracking-tight mb-4">Balances</h2>
                <div className="divide-y-2 divide-[#0A0A0A]">
                  {balances.map((b) => (
                    <div key={b.memberId} className="flex justify-between items-center py-3">
                      <span className="font-bold">{b.name}</span>
                      <span
                        className={`font-mono font-bold text-sm px-3 py-1 border-2 border-[#0A0A0A] ${
                          b.outstandingCents === 0
                            ? 'bg-[#00C853] text-[#0A0A0A]'
                            : 'bg-[#FFDD00] text-[#0A0A0A]'
                        }`}
                      >
                        {b.outstandingCents === 0 ? 'SETTLED' : formatCents(b.outstandingCents)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. Add a Bill form */}
            <div className="border-2 border-[#0A0A0A] bg-white shadow-[4px_4px_0px_#0A0A0A] p-6 mb-8">
              <h2 className="text-lg font-black uppercase tracking-tight mb-4">Add a Bill</h2>
              <form onSubmit={handleCreateBill} className="flex flex-wrap gap-3 items-center">
                <input
                  type="text"
                  placeholder="Bill Title (e.g. Electricity)"
                  value={newBillTitle}
                  onChange={(e) => setNewBillTitle(e.target.value)}
                  disabled={creatingBill || loading}
                  className="border-2 border-[#0A0A0A] bg-[#F5F5F0] px-3 py-2 text-sm font-mono flex-1 min-w-[200px] focus:outline-none focus:bg-[#FFDD00] transition-colors duration-100"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Amount ($)"
                  value={newBillAmount}
                  onChange={(e) => setNewBillAmount(e.target.value)}
                  disabled={creatingBill || loading}
                  className="border-2 border-[#0A0A0A] bg-[#F5F5F0] px-3 py-2 text-sm font-mono w-36 focus:outline-none focus:bg-[#FFDD00] transition-colors duration-100"
                />
                <button
                  type="submit"
                  disabled={creatingBill || loading}
                  className="bg-[#0A0A0A] text-[#F5F5F0] border-2 border-[#0A0A0A] px-4 py-2 font-bold text-sm uppercase tracking-wide shadow-[4px_4px_0px_#0A0A0A] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_#0A0A0A] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all duration-100 disabled:opacity-40 disabled:pointer-events-none"
                >
                  {creatingBill ? 'ADDING...' : 'ADD BILL'}
                </button>
              </form>
              {billError && (
                <p className="text-[#FF2D2D] text-xs font-mono font-bold mt-3">{billError}</p>
              )}
            </div>

            {/* 6. Bills list */}
            {!loading && !error && bills.length === 0 && (
              <div className="border-2 border-[#0A0A0A] border-dashed p-12 text-center">
                <p className="font-mono text-sm text-[#555]">no bills yet — add one above</p>
              </div>
            )}

            {!loading && !error && bills.length > 0 && (
              <div className="space-y-4">
                {bills.map((bill) => (
                  <article
                    key={bill.id}
                    className="border-2 border-[#0A0A0A] bg-white shadow-[4px_4px_0px_#0A0A0A] mb-4"
                  >
                    {/* Bill header (black bar) */}
                    <div className="bg-[#0A0A0A] text-[#F5F5F0] px-6 py-3 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <h3 className="font-black uppercase tracking-tight">{bill.title}</h3>
                        <button
                          type="button"
                          onClick={() => copyId(bill.id)}
                          className="border-2 border-[#0A0A0A] px-2 py-0.5 text-xs font-bold uppercase bg-[#F5F5F0] text-[#0A0A0A] shadow-[2px_2px_0px_#0A0A0A] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_#0A0A0A] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all duration-100"
                        >
                          COPY ID
                        </button>
                        {copied === bill.id && (
                          <span className="font-mono text-xs text-[#00C853] font-bold">
                            COPIED!
                          </span>
                        )}
                      </div>
                      <span className="font-mono font-bold">{formatCents(bill.totalCents)}</span>
                    </div>

                    {/* Shares list */}
                    <div className="divide-y-2 divide-[#0A0A0A]">
                      {bill.shares.map((share) => {
                        const memberName =
                          share.memberName || memberNameMap.get(share.memberId) || share.memberId
                        const isPaid = share.paidAt !== null
                        const isPaying = payingShareId === share.id
                        const inlineError = paymentErrors[share.id]

                        return (
                          <div
                            key={share.id}
                            className={`px-6 py-3 ${share.paidAt ? 'bg-[#F5F5F0]' : 'bg-white'}`}
                          >
                            <div className="flex items-center justify-between">
                              {/* Left side — member name + amount */}
                              <div className="flex items-center">
                                <span className="font-bold text-sm">{memberName}</span>
                                {!isPaid && (
                                  <button
                                    type="button"
                                    onClick={() => copyId(share.id)}
                                    className="ml-2 border-2 border-[#0A0A0A] px-2 py-0.5 text-[10px] font-bold uppercase bg-[#F5F5F0] shadow-[2px_2px_0px_#0A0A0A] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_#0A0A0A] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all duration-100"
                                  >
                                    {copied === share.id ? 'COPIED!' : 'COPY ID'}
                                  </button>
                                )}
                                <span className="font-mono text-sm ml-3 text-[#555]">
                                  {formatCents(share.amountCents)}
                                </span>
                              </div>

                              {/* Right side — paid badge or pay button */}
                              <div className="flex items-center gap-2">
                                {isPaid ? (
                                  <>
                                    <span className="bg-[#00C853] text-[#0A0A0A] border-2 border-[#0A0A0A] px-3 py-1 text-xs font-black uppercase tracking-wide">
                                      PAID
                                    </span>
                                    {share.paidAt && (
                                      <span className="font-mono text-xs text-[#555] ml-2">
                                        {formatDate(share.paidAt)}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handlePay(bill.id, share.id)}
                                    disabled={isPaying}
                                    className="bg-[#FFDD00] text-[#0A0A0A] border-2 border-[#0A0A0A] px-4 py-1.5 text-xs font-black uppercase tracking-wide shadow-[4px_4px_0px_#0A0A0A] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_#0A0A0A] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all duration-100 disabled:opacity-40 disabled:pointer-events-none"
                                  >
                                    {isPaying ? 'PAYING...' : 'PAY'}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Inline payment error */}
                            {inlineError && (
                              <div className="mt-2">
                                <span className="text-[#FF2D2D] text-xs font-mono font-bold">
                                  {inlineError}
                                </span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {/* Loading state */}
        {loading && (
          <div className="border-2 border-[#0A0A0A] bg-[#FFDD00] shadow-[4px_4px_0px_#0A0A0A] p-8 text-center mb-6">
            <p className="font-black uppercase tracking-tight">Loading...</p>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="border-2 border-[#0A0A0A] border-l-[6px] border-l-[#FF2D2D] bg-white shadow-[4px_4px_0px_#0A0A0A] p-4 mb-6">
            <p className="font-black uppercase text-[#FF2D2D] text-sm mb-1">Error</p>
            <p className="font-mono text-sm">{error}</p>
            <button
              type="button"
              onClick={() => fetchData(homeId)}
              className="mt-3 bg-[#FF2D2D] text-white border-2 border-[#0A0A0A] px-3 py-1 text-xs font-black uppercase shadow-[4px_4px_0px_#0A0A0A] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_#0A0A0A] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all duration-100"
            >
              RETRY
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
