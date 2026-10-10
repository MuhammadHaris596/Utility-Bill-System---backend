const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const dns = require("node:dns");

// Load environment variables from root .env file
dotenv.config({ path: path.resolve(__dirname, 'server.env') });

dns.setServers(["1.1.1.1", "8.8.8.8"]);
const connectDB = require('./config/db');
const Admin = require('./models/Admin');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// Ensure DB connection (and one-time admin seed) before every request
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
    next(error);
  }
});

app.get('/',(req,res)=>{

  return  res.send("Backend is running.");
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});
})

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bills', require('./routes/bills'));

// Centralized error-handling middleware
app.use(errorHandler);

// Only run a local server when NOT on Vercel (local dev)
if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export app for Vercel's serverless runtime
module.exports = app;



