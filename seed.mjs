const BASE = 'http://localhost:8787'

// 1. Create a home
const home = await fetch(`${BASE}/api/homes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Flat 4B' }),
}).then((r) => r.json())
console.log('Home:', home)

// 2. Add members
const names = ['Asha', 'Ben', 'Chitra']
const members = []
for (const name of names) {
  const m = await fetch(`${BASE}/api/homes/${home.id}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then((r) => r.json())
  members.push(m)
  console.log('Member:', m)
}

// 3. Create a bill (1000 cents = $10, splits as 334/333/333)
const bill = await fetch(`${BASE}/api/homes/${home.id}/bills`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Rent', totalCents: 1000 }),
}).then((r) => r.json())
console.log('Bill:', JSON.stringify(bill, null, 2))

console.log('\n--- Copy this into web/.env ---')
console.log(`VITE_HOME_ID=${home.id}`)
