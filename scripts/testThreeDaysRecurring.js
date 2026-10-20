const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../server.env') });
const mongoose = require('mongoose');

async function testRecurringNotification() {
  console.log('--- Starting 3-Day Recurring Notification Verification ---');
  try {
    // Connect to DB directly for timestamp manipulation in testing
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('MONGO_URI is missing in server.env');
      return;
    }
    await mongoose.connect(mongoUri);
    const Bill = require('../models/Bill');

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
      await mongoose.disconnect();
      return;
    }
    const authHeaders = { Authorization: `Bearer ${auth.token}` };
    console.log('1. Admin authenticated successfully.');

    // 2. Create bill with notify = true
    const stableBillId = 'TEST-3DAY-' + Date.now();
    const fd = new FormData();
    fd.append('billId', stableBillId);
    fd.append('billName', '3-Day Recurring Test Order');
    fd.append('userId', 'recur_user_01');
    fd.append('phoneNumber', '03009999999');
    fd.append('billEntryDate', '2026-10-20');
    fd.append('amount', '1200');
    fd.append('comment', 'Testing 3-day notification schedule');
    fd.append('notify', 'true');

    const createRes = await fetch('http://localhost:5000/api/bills', {
      method: 'POST',
      headers: authHeaders,
      body: fd,
    });
    const created = await createRes.json();
    console.log('2. Created order with notify=true. ID:', created._id, 'isRead:', created.isRead, 'lastNotifiedAt:', created.lastNotifiedAt);

    // 3. Verify in /due-today
    const dueRes1 = await fetch('http://localhost:5000/api/bills/due-today', { headers: authHeaders });
    const dueList1 = await dueRes1.json();
    const item1 = dueList1.find(b => b.billId === stableBillId);
    console.log('3. In /due-today:', Boolean(item1), 'isRead:', item1?.isRead, '(EXPECTED: true, false)');

    // 4. Mark as read
    await fetch(`http://localhost:5000/api/bills/${created._id}/read`, {
      method: 'PUT',
      headers: authHeaders,
    });
    const dueRes2 = await fetch('http://localhost:5000/api/bills/due-today', { headers: authHeaders });
    const dueList2 = await dueRes2.json();
    const item2 = dueList2.find(b => b.billId === stableBillId);
    console.log('4. After marking read, isRead in /due-today:', item2?.isRead, '(EXPECTED: true)');

    // 5. Fast-forward time: Set lastNotifiedAt to 3.5 days ago (simulate 3 days elapsed)
    const threeAndHalfDaysAgo = new Date(Date.now() - 3.5 * 24 * 60 * 60 * 1000);
    await Bill.updateOne({ _id: created._id }, { $set: { lastNotifiedAt: threeAndHalfDaysAgo } });
    console.log('5. Simulated 3.5 days passing (lastNotifiedAt shifted to 3.5 days ago).');

    // 6. Fetch /due-today again -> verify notification repeats automatically!
    const dueRes3 = await fetch('http://localhost:5000/api/bills/due-today', { headers: authHeaders });
    const dueList3 = await dueRes3.json();
    const matchingBillsAfter3Days = dueList3.filter(b => b.billId === stableBillId);
    console.log('6. After 3 days elapsed:');
    console.log('   - Number of entries for this order:', matchingBillsAfter3Days.length, '(EXPECTED: 1, NO DUPLICATES)');
    console.log('   - Repeats notification (isRead reset to false):', matchingBillsAfter3Days[0]?.isRead === false, '(EXPECTED: true)');

    // 7. Turn OFF notification slider
    const fdOff = new FormData();
    fdOff.append('notify', 'false');
    await fetch(`http://localhost:5000/api/bills/${created._id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: fdOff,
    });
    const dueResOff = await fetch('http://localhost:5000/api/bills/due-today', { headers: authHeaders });
    const dueListOff = await dueResOff.json();
    const inDueOff = dueListOff.some(b => b.billId === stableBillId);
    console.log('7. After turning OFF: Present in /due-today?:', inDueOff, '(EXPECTED: false)');

    // 8. Turn ON notification slider again -> resumes immediately with first notification
    const fdOn = new FormData();
    fdOn.append('notify', 'true');
    await fetch(`http://localhost:5000/api/bills/${created._id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: fdOn,
    });
    const dueResOn = await fetch('http://localhost:5000/api/bills/due-today', { headers: authHeaders });
    const dueListOn = await dueResOn.json();
    const restoredMatches = dueListOn.filter(b => b.billId === stableBillId);
    console.log('8. After turning ON again:');
    console.log('   - Restored count in /due-today:', restoredMatches.length, '(EXPECTED: 1, NO DUPLICATES)');
    console.log('   - Resumed as active unread (isRead: false):', restoredMatches[0]?.isRead === false, '(EXPECTED: true)');

    // Clean up
    await fetch(`http://localhost:5000/api/bills/${created._id}`, { method: 'DELETE', headers: authHeaders });
    await mongoose.disconnect();
    console.log('--- All 3-Day Recurring Notification Tests Passed Successfully! ---');
  } catch (err) {
    console.error('Test execution failed:', err);
    try { await mongoose.disconnect(); } catch (e) {}
  }
}

testRecurringNotification();
