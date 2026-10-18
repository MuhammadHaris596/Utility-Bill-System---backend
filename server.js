const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, 'server.env') });

const express = require('express');
const cors = require('cors');
const dns = require('node:dns');

// Local-only setup (Vercel uses environment variables from project settings)
if (!process.env.VERCEL) {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
}

const connectDB = require('./config/db');
const Admin = require('./models/Admin');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health routes: DB middleware se PEHLE, taake DB fail hone par bhi test ho sakein
app.get('/', (req, res) => res.send('Backend is running.'));
app.get('/health', (req, res) => res.json({ status: 'ok', message: 'Backend is running' }));


// Seed default admin ONLY if the Admin collection is completely empty
const seedAdmin = async () => {
  try {
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0) {
      const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@brand.com';
      const password = process.env.DEFAULT_ADMIN_PASSWORD || 'AdminPassword123!';

      await Admin.create({
        name: 'Super Admin',
        email: email.toLowerCase(),
        password,
      });
      console.log('Default Admin account created successfully.');
    }
  } catch (error) {
    console.error('Error seeding admin:', error.message);
  }
};

// Ensure DB connection (and one-time admin seed) before API requests
let seeded = false;
app.use(async (req, res, next) => {
  try {
    await connectDB();
    if (!seeded) {
      seeded = true;
      await seedAdmin();
    }
    next();
  } catch (error) {
    console.error('DB CONNECT ERROR:', error);
    next(error);
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bills', require('./routes/bills'));

// Centralized error-handling middleware
app.use(errorHandler);

// Local server only (Vercel par nahi chalega)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export app for Vercel's serverless runtime
module.exports = app;