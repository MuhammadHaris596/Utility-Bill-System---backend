const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const Bill = require('../models/Bill');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const cloudinary = require('../config/cloudinary');

// Multer in-memory storage (no files saved to local disk or uploads directory)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit per image
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

// Helper function to stream memory buffer directly to Cloudinary
const uploadToCloudinary = async (fileBuffer, mimetype = 'image/jpeg') => {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  const folderName = (process.env.CLOUDINARY_FOLDER || 'Bill-Management-System').trim();

  if (!cloudName || !apiKey || !apiSecret) {
    const missing = [
      !cloudName && 'CLOUDINARY_CLOUD_NAME',
      !apiKey && 'CLOUDINARY_API_KEY',
      !apiSecret && 'CLOUDINARY_API_SECRET',
    ].filter(Boolean).join(', ');
    const errMsg = `Cloudinary credentials missing in environment: ${missing}. Please configure them in your deployment environment variables or server.env.`;
    console.error(errMsg);
    const err = new Error(errMsg);
    err.status = 500;
    throw err;
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folderName,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) {
          const detail = error.message || error.error?.message || JSON.stringify(error);
          console.error(`Cloudinary upload failed (HTTP ${error.http_code || 403}):`, detail);

          const userFriendlyMsg = `Cloudinary upload error (${error.http_code}): ${detail}`;
          const uploadErr = new Error(userFriendlyMsg);
          uploadErr.status = error.http_code || 500;
          return reject(uploadErr);
        }

        if (!result || !result.secure_url) {
          return reject(new Error('Cloudinary response missing secure_url'));
        }

        resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
};

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
        $or: [{ userId: regex }, { phoneNumber: regex }],
      };
    }

    const bills = await Bill.find(queryFilter)
      .select('userId phoneNumber')
      .sort({ createdAt: -1 })
      .limit(20);

    const suggestionsMap = new Map();
    bills.forEach((item) => {
      const key = `${item.userId}_${item.phoneNumber}`;
      if (!suggestionsMap.has(key)) {
        suggestionsMap.set(key, {
          userId: item.userId,
          phoneNumber: item.phoneNumber,
        });
      }
    });

    res.json(Array.from(suggestionsMap.values()));
  })
);

// @route   GET /api/bills/due-today
// @desc    Get bills marked for notification (deduplicated by stable billId / order ID, repeats every 3 days while ON)
// @access  Private
router.get(
  '/due-today',
  asyncHandler(async (req, res) => {
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const now = new Date();

    const bills = await Bill.find({ notify: true }).sort({ updatedAt: -1, createdAt: -1 });

    // Deduplicate by stable order/bill ID so that an order only appears once in notifications
    const seenBillIds = new Set();
    const uniqueDueBills = [];

    for (const bill of bills) {
      const stableKey = bill.billId ? String(bill.billId).trim() : String(bill._id);
      if (!seenBillIds.has(stableKey)) {
        seenBillIds.add(stableKey);

        // 3-day recurring interval check:
        // If slider is ON and 3 days have elapsed since lastNotifiedAt,
        // trigger the next scheduled notification occurrence (reset isRead = false and advance lastNotifiedAt)
        const initialTime = bill.lastNotifiedAt || bill.createdAt || bill.updatedAt || now;
        const diffMs = now.getTime() - new Date(initialTime).getTime();

        if (diffMs >= THREE_DAYS_MS) {
          bill.isRead = false;
          bill.lastNotifiedAt = now;

          const updateFilter = bill.billId ? { billId: bill.billId } : { _id: bill._id };
          Bill.updateMany(updateFilter, { $set: { isRead: false, lastNotifiedAt: now } }).catch((err) => {
            console.error('Failed to update recurring notification schedule:', err);
          });
        }

        uniqueDueBills.push(bill);
      }
    }

    res.json(uniqueDueBills);
  })
);

// @route   POST /api/bills
// @desc    Create a new bill
// @access  Private
router.post(
  '/',
  upload.array('images'),
  asyncHandler(async (req, res) => {
    const {
      billId,
      billName,
      userId,
      phoneNumber,
      billEntryDate,
      billDueDate,
      amount,
      comment,
      notify,
    } = req.body;

    if (
      !billId ||
      !billName ||
      !userId ||
      !phoneNumber ||
      !billEntryDate
    ) {
      res.status(400);
      throw new Error('Please fill in all required fields');
    }

    const notifyValue = notify === true || notify === 'true';
    const cleanBillId = String(billId).trim();

    // Check if an existing notification already exists for this order/bill ID
    let isReadValue = false;
    let lastNotifiedAtValue = null;
    if (notifyValue) {
      lastNotifiedAtValue = new Date();
      const existingNotification = await Bill.findOne({ billId: cleanBillId, notify: true });
      if (existingNotification) {
        // Preserve read status and schedule from existing notification so duplicate unread count is not created
        isReadValue = Boolean(existingNotification.isRead);
        lastNotifiedAtValue = existingNotification.lastNotifiedAt || lastNotifiedAtValue;
      }
    }

    let imagePaths = [];
    if (req.files && req.files.length > 0) {
      imagePaths = await Promise.all(
        req.files.map((file) => uploadToCloudinary(file.buffer, file.mimetype))
      );
    }

    const bill = new Bill({
      billId: cleanBillId,
      billName: String(billName).trim(),
      userId: String(userId).trim(),
      phoneNumber: String(phoneNumber).trim(),
      billEntryDate: new Date(billEntryDate),
      billDueDate: billDueDate ? new Date(billDueDate) : undefined,
      amount: amount ? Number(amount) : 0,
      comment: comment ? String(comment).trim() : '',
      images: imagePaths,
      notify: notifyValue,
      isRead: isReadValue,
      lastNotifiedAt: lastNotifiedAtValue,
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
  upload.array('images'),
  asyncHandler(async (req, res) => {
    const bill = await Bill.findById(req.params.id);
    if (!bill) {
      res.status(404);
      throw new Error('Bill not found');
    }

    const {
      billId,
      billName,
      userId,
      phoneNumber,
      billEntryDate,
      billDueDate,
      amount,
      comment,
      existingImages,
      notify,
    } = req.body;

    if (billId) bill.billId = String(billId).trim();
    if (billName) bill.billName = String(billName).trim();

    if (userId) bill.userId = String(userId).trim();
    if (phoneNumber) bill.phoneNumber = String(phoneNumber).trim();
    if (billEntryDate) bill.billEntryDate = new Date(billEntryDate);
    if (billDueDate) bill.billDueDate = new Date(billDueDate);
    if (amount !== undefined) bill.amount = Number(amount);
    if (comment !== undefined) bill.comment = String(comment).trim();
    const prevNotify = Boolean(bill.notify);
    if (notify !== undefined) {
      const notifyVal = notify === true || notify === 'true';
      bill.notify = notifyVal;

      if (!prevNotify && notifyVal) {
        // Newly enabled notification: reset isRead so it becomes an active unread notification
        // and start the 3-day recurring notification schedule from now
        const now = new Date();
        bill.isRead = false;
        bill.lastNotifiedAt = now;
        if (bill.billId) {
          await Bill.updateMany(
            { billId: bill.billId },
            { $set: { notify: true, isRead: false, lastNotifiedAt: now } }
          );
        }
      } else if (!notifyVal) {
        // Turned OFF: stop future scheduled notifications immediately and remove from notifications
        if (bill.billId) {
          await Bill.updateMany(
            { billId: bill.billId, _id: { $ne: bill._id } },
            { $set: { notify: false } }
          );
        }
      } else {
        // Synchronize notify setting across any other records with the same billId to prevent duplicates
        if (!bill.lastNotifiedAt) {
          bill.lastNotifiedAt = bill.createdAt || new Date();
        }
        if (bill.billId) {
          await Bill.updateMany(
            { billId: bill.billId, _id: { $ne: bill._id } },
            { $set: { notify: notifyVal } }
          );
        }
      }
    }

    let finalImages = [];
    if (existingImages !== undefined) {
      finalImages = Array.isArray(existingImages) ? existingImages : [existingImages];
    } else {
      finalImages = bill.images || [];
    }

    if (req.files && req.files.length > 0) {
      const newImageUrls = await Promise.all(
        req.files.map((file) => uploadToCloudinary(file.buffer, file.mimetype))
      );
      finalImages = [...finalImages, ...newImageUrls];
    }

    bill.images = finalImages;

    const updatedBill = await bill.save();
    res.json(updatedBill);
  })
);

// @route   PUT /api/bills/:id/read
// @desc    Mark a bill notification as read
// @access  Private
router.put(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const bill = await Bill.findById(req.params.id);
    if (!bill) {
      res.status(404);
      throw new Error('Bill not found');
    }
    bill.isRead = true;
    await bill.save();
    if (bill.billId) {
      await Bill.updateMany(
        { billId: bill.billId },
        { $set: { isRead: true } }
      );
    }
    res.json({ success: true, billId: bill.billId, isRead: true });
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
