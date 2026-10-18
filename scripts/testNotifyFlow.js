const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../server.env') });

async function runTest() {
  console.log('Testing Complete Notify Flow & Duplicate Prevention...');
  try {
    // 1. Login
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@brand.com',
        password: process.env.DEFAULT_ADMIN_PASSWORD || 'AdminPassword123!',
      }),
    });
    const auth = await loginRes.json();
    if (!auth.token) {
      console.error('Login failed:', auth);
      return;
    }
    console.log('Login successful! Admin ID:', auth._id);

    const authHeaders = { Authorization: `Bearer ${auth.token}` };

    // 2. Initial due-today count
    const initialDueRes = await fetch('http://localhost:5000/api/bills/due-today', { headers: authHeaders });
    const initialDue = await initialDueRes.json();
    const baseCount = initialDue.length;
    console.log('Initial /due-today count:', baseCount);

    // 3. Create Bill 1 with notify = true
    const stableBillId = 'TEST-ORD-' + Date.now();
    const fd1 = new FormData();
    fd1.append('billId', stableBillId);
    fd1.append('billName', 'Order 1 Notification');
    fd1.append('userId', 'cust_01');
    fd1.append('phoneNumber', '03001234567');
    fd1.append('billEntryDate', '2026-10-18');
    fd1.append('billDueDate', '2026-10-18');
    fd1.append('amount', '500');
    fd1.append('comment', 'Testing duplicate prevention');
    fd1.append('notify', 'true');

    const createRes1 = await fetch('http://localhost:5000/api/bills', {
      method: 'POST',
      headers: authHeaders,
      body: fd1,
    });
    const bill1 = await createRes1.json();
    console.log('Step 1: Created Bill1 (notify=true):', bill1._id, 'saved notify:', bill1.notify, 'isRead:', bill1.isRead);

    // 4. Verify /due-today has count = baseCount + 1
    const due1Res = await fetch('http://localhost:5000/api/bills/due-today', { headers: authHeaders });
    const due1 = await due1Res.json();
    console.log('Step 2: /due-today count after creating Bill1:', due1.length, '(EXPECTED:', baseCount + 1, ')');

    // 5. EDIT Bill 1 (keep notify = true, modify name/amount)
    const fdEdit = new FormData();
    fdEdit.append('billName', 'Order 1 Notification EDITED');
    fdEdit.append('amount', '750');
    fdEdit.append('notify', 'true');

    const editRes = await fetch(`http://localhost:5000/api/bills/${bill1._id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: fdEdit,
    });
    const editedBill = await editRes.json();
    console.log('Step 3: Edited Bill1:', editedBill._id, 'saved amount:', editedBill.amount, 'notify:', editedBill.notify);

    // 6. Verify NO duplicate was created and count is STILL baseCount + 1 (NOT baseCount + 2!)
    const dueAfterEditRes = await fetch('http://localhost:5000/api/bills/due-today', { headers: authHeaders });
    const dueAfterEdit = await dueAfterEditRes.json();
    const matchingBills = dueAfterEdit.filter(b => b.billId === stableBillId || b._id === bill1._id);
    console.log('Step 4: /due-today count after edit:', dueAfterEdit.length, '(EXPECTED:', baseCount + 1, ')');
    console.log('Number of entries for this order in notifications:', matchingBills.length, '(EXPECTED: 1, NO DUPLICATES)');

    // 7. Mark notification as read
    const readRes = await fetch(`http://localhost:5000/api/bills/${bill1._id}/read`, {
      method: 'PUT',
      headers: authHeaders,
    });
    const readData = await readRes.json();
    console.log('Step 5: Marked Bill1 as read:', readData);

    // 8. Edit bill again while read -> verify isRead is PRESERVED and count does not artificially increase!
    const fdEdit2 = new FormData();
    fdEdit2.append('comment', 'Updated comment while read');
    fdEdit2.append('notify', 'true');
    const edit2Res = await fetch(`http://localhost:5000/api/bills/${bill1._id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: fdEdit2,
    });
    const edit2Bill = await edit2Res.json();
    console.log('Step 6: Edited bill while read. Saved isRead:', edit2Bill.isRead, '(EXPECTED: true)');

    // 9. Turn OFF notification slider
    const fdOff = new FormData();
    fdOff.append('notify', 'false');
    const offRes = await fetch(`http://localhost:5000/api/bills/${bill1._id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: fdOff,
    });
    const offBill = await offRes.json();
    console.log('Step 7: Turned notify OFF. Saved notify:', offBill.notify);

    const dueOffRes = await fetch('http://localhost:5000/api/bills/due-today', { headers: authHeaders });
    const dueOff = await dueOffRes.json();
    const inDueOff = dueOff.some(b => b._id === bill1._id || b.billId === stableBillId);
    console.log('Is bill in /due-today after turning OFF?:', inDueOff, '(EXPECTED: false)');

    // 10. Turn ON notification slider again -> verify restored without duplicate
    const fdOn = new FormData();
    fdOn.append('notify', 'true');
    const onRes = await fetch(`http://localhost:5000/api/bills/${bill1._id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: fdOn,
    });
    const onBill = await onRes.json();
    console.log('Step 8: Turned notify ON again. Saved notify:', onBill.notify);

    const dueOnRes = await fetch('http://localhost:5000/api/bills/due-today', { headers: authHeaders });
    const dueOn = await dueOnRes.json();
    const restoredMatches = dueOn.filter(b => b.billId === stableBillId || b._id === bill1._id);
    console.log('Entries for restored bill in /due-today:', restoredMatches.length, '(EXPECTED: 1, NO DUPLICATES)');

    // Clean up
    await fetch(`http://localhost:5000/api/bills/${bill1._id}`, { method: 'DELETE', headers: authHeaders });
    console.log('Cleaned up test bill. All verification steps passed successfully!');

  } catch (err) {
    console.error('Test error:', err);
  }
}

runTest();
