
const path = require('path');
const dns = require('node:dns');

// Load local environment variables only outside Vercel.
// On Vercel, configure environment variables in project settings.
if (!process.env.VERCEL) {
  require('dotenv').config({
    path: path.resolve(__dirname, 'server.env'),
  });

  dns.setServers(['1.1.1.1', '8.8.8.8']);
}

const express = require('express');
const cors = require('cors');

const connectDB = require('./config/db');
const Admin = require('./models/Admin');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health routes
app.get('/', (req, res) => res.send('Backend is running.'));
app.get('/health', (req, res) =>
  res.json({ status: 'ok', message: 'Backend is running' })
);

// Static uploads only for local development.
// Vercel's filesystem is not persistent for uploaded files.
if (!process.env.VERCEL) {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
}

// Seed default admin only if the Admin collection is empty
const seedAdmin = async () => {
  try {
    const adminCount = await Admin.countDocuments();

    if (adminCount === 0) {
      const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@brand.com';
      const password =
        process.env.DEFAULT_ADMIN_PASSWORD || 'AdminPassword123!';

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

// Ensure DB connection before API requests
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

// Centralized error handler
app.use(errorHandler);

// Local server only; Vercel uses its serverless runtime
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
