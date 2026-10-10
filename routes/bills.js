const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Bill = require('../models/Bill');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage setup
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    cb(
      null,
      `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`
    );
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit per image
  fileFilter(req, file, cb) {
    const filetypes = /jpg|jpeg|png|webp|pdf/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Images only! (JPEG, JPG, PNG, WEBP, PDF)'));
  },
});

// All bill routes are protected by admin auth
router.use(protect);

// @route   GET /api/bills/suggest
// @desc    Autocomplete suggestions for userId or phoneNumber
// @access  Private
router.get(
  '/suggest',
  asyncHandler(async (req, res) => {
    const { field, q } = req.query;
    if (!q || typeof q !== 'string' || q.trim() === '') {
      return res.json([]);
    }

    const cleanQ = q.trim();
    // Escape regex special chars for security
    const sanitizedQ = cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(sanitizedQ, 'i');
    let queryFilter = {};

    if (field === 'userId') {
      queryFilter = { userId: regex };
    } else if (field === 'phone' || field === 'phoneNumber') {
      queryFilter = { phoneNumber: regex };
    } else {
      queryFilter = {
        $or: [{ userId: regex }, { phoneNumber: regex }, { username: regex }],
      };
    }

    const bills = await Bill.find(queryFilter)
      .select('userId username phoneNumber')
      .sort({ createdAt: -1 })
      .limit(20);

    const suggestionsMap = new Map();
    bills.forEach((item) => {
      const key = `${item.userId}_${item.phoneNumber}`;
      if (!suggestionsMap.has(key)) {
        suggestionsMap.set(key, {
          userId: item.userId,
          username: item.username,
          phoneNumber: item.phoneNumber,
        });
      }
    });

    res.json(Array.from(suggestionsMap.values()));
  })
);

// @route   GET /api/bills/due-today
// @desc    Get today's due bills strictly for notification badge/panel
// @access  Private
router.get(
  '/due-today',
  asyncHandler(async (req, res) => {
    const now = new Date();

    // Start & End of today in Local calendar date
    const startOfLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // Start & End of today in UTC calendar date
    const startOfUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    const endOfUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));

    const dueBills = await Bill.find({
      $or: [
        { billDueDate: { $gte: startOfLocal, $lte: endOfLocal } },
        { billDueDate: { $gte: startOfUtc, $lte: endOfUtc } },
      ],
    }).sort({ createdAt: -1 });

    res.json(dueBills);
  })
);

// @route   POST /api/bills
// @desc    Create a new bill
// @access  Private
router.post(
  '/',
  upload.array('images', 5),
  asyncHandler(async (req, res) => {
    const {
      billId,
      billName,
      username,
      userId,
      phoneNumber,
      billEntryDate,
      billDueDate,
      amount,
      comment,
    } = req.body;

    if (
      !billId ||
      !billName ||
      !username ||
      !userId ||
      !phoneNumber ||
      !billEntryDate ||
      !billDueDate
    ) {
      res.status(400);
      throw new Error('Please fill in all required fields');
    }

    const imagePaths = req.files
      ? req.files.map((file) => `/uploads/${file.filename}`)
      : [];

    const bill = new Bill({
      billId: String(billId).trim(),
      billName: String(billName).trim(),
      username: String(username).trim(),
      userId: String(userId).trim(),
      phoneNumber: String(phoneNumber).trim(),
      billEntryDate: new Date(billEntryDate),
      billDueDate: new Date(billDueDate),
      amount: amount ? Number(amount) : 0,
      comment: comment ? String(comment).trim() : '',
      images: imagePaths,
    });

    const createdBill = await bill.save();
    res.status(201).json(createdBill);
  })
);

// @route   GET /api/bills
// @desc    Get all bills (supports searching & pagination/sorting)
// @access  Private
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search, page, limit } = req.query;
    let query = {};

    if (search && typeof search === 'string' && search.trim() !== '') {
      const sanitized = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(sanitized, 'i');
      query = {
        $or: [
          { billId: regex },
          { billName: regex },
          { username: regex },
          { userId: regex },
          { phoneNumber: regex },
          { comment: regex },
        ],
      };
    }

    const totalBills = await Bill.countDocuments(query);

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 10);
      const skip = (pageNum - 1) * limitNum;

      const bills = await Bill.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);

      const totalPages = Math.ceil(totalBills / limitNum) || 1;

      return res.json({
        bills,
        totalBills,
        totalPages,
        currentPage: pageNum,
        limit: limitNum,
      });
    }

    const bills = await Bill.find(query).sort({ createdAt: -1 });
    res.json({
      bills,
      totalBills,
      totalPages: 1,
      currentPage: 1,
      limit: totalBills,
    });
  })
);

// @route   GET /api/bills/:id
// @desc    Get single bill by ID
// @access  Private
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const bill = await Bill.findById(req.params.id);
    if (!bill) {
      res.status(404);
      throw new Error('Bill not found');
    }
    res.json(bill);
  })
);

// @route   PUT /api/bills/:id
// @desc    Update an existing bill
// @access  Private
router.put(
  '/:id',
  upload.array('images', 5),
  asyncHandler(async (req, res) => {
    const bill = await Bill.findById(req.params.id);
    if (!bill) {
      res.status(404);
      throw new Error('Bill not found');
    }

    const {
      billId,
      billName,
      username,
      userId,
      phoneNumber,
      billEntryDate,
      billDueDate,
      amount,
      comment,
      existingImages,
    } = req.body;

    if (billId) bill.billId = String(billId).trim();
    if (billName) bill.billName = String(billName).trim();
    if (username) bill.username = String(username).trim();
    if (userId) bill.userId = String(userId).trim();
    if (phoneNumber) bill.phoneNumber = String(phoneNumber).trim();
    if (billEntryDate) bill.billEntryDate = new Date(billEntryDate);
    if (billDueDate) bill.billDueDate = new Date(billDueDate);
    if (amount !== undefined) bill.amount = Number(amount);
    if (comment !== undefined) bill.comment = String(comment).trim();

    let finalImages = [];
    if (existingImages) {
      finalImages = Array.isArray(existingImages) ? existingImages : [existingImages];
    } else if (req.body.keepExistingImages === 'true' || req.body.keepExistingImages === true) {
      finalImages = bill.images || [];
    }

    if (req.files && req.files.length > 0) {
      const newImagePaths = req.files.map((file) => `/uploads/${file.filename}`);
      finalImages = [...finalImages, ...newImagePaths];
    }

    bill.images = finalImages;

    const updatedBill = await bill.save();
    res.json(updatedBill);
  })
);

// @route   DELETE /api/bills/:id
// @desc    Delete a bill
// @access  Private
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const bill = await Bill.findById(req.params.id);
    if (!bill) {
      res.status(404);
      throw new Error('Bill not found');
    }
    await bill.deleteOne();
    res.json({ message: 'Bill deleted successfully' });
  })
);

module.exports = router;
