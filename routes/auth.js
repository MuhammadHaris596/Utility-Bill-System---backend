const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { loginLimiter } = require('../middleware/rateLimiter');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @route   POST /api/auth/login
// @desc    Authenticate admin & get token
// @access  Public (Rate-limited)
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    let { email, password } = req.body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      res.status(400);
      throw new Error('Please provide a valid email and password');
    }

    email = email.trim().toLowerCase();

    const admin = await Admin.findOne({ email });

    if (admin && (await admin.matchPassword(password))) {
      res.json({
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        token: generateToken(admin._id),
      });
    } else {
      res.status(401);
      throw new Error('Invalid email or password');
    }
  })
);

// @route   GET /api/auth/admins
// @desc    Get list of all registered admins
// @access  Private (Admin only)
router.get(
  '/admins',
  protect,
  asyncHandler(async (req, res) => {
    const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
    res.json(admins);
  })
);

// @route   POST /api/auth/register-admin
// @desc    Register a new admin (Admin-only action)
// @access  Private (Admin only)
router.post(
  '/register-admin',
  protect,
  asyncHandler(async (req, res) => {
    let { name, email, password } = req.body;

    if (!name || !email || !password) {
      res.status(400);
      throw new Error('Please provide name, email, and password');
    }

    name = String(name).trim();
    email = String(email).trim().toLowerCase();
    password = String(password);

    if (name.length < 2) {
      res.status(400);
      throw new Error('Name must be at least 2 characters long');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400);
      throw new Error('Please provide a valid email address');
    }

    if (password.length < 6) {
      res.status(400);
      throw new Error('Password must be at least 6 characters long');
    }

    const adminExists = await Admin.findOne({ email });

    if (adminExists) {
      res.status(400);
      throw new Error('Admin with this email already exists');
    }

    const admin = await Admin.create({
      name,
      email,
      password,
    });

    if (admin) {
      res.status(201).json({
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        createdAt: admin.createdAt,
        message: 'New admin created successfully',
      });
    } else {
      res.status(400);
      throw new Error('Invalid admin data');
    }
  })
);

// @route   GET /api/auth/me
// @desc    Get current admin profile
// @access  Private
router.get(
  '/me',
  protect,
  asyncHandler(async (req, res) => {
    res.json({
      _id: req.admin._id,
      name: req.admin.name,
      email: req.admin.email,
    });
  })
);

module.exports = router;
