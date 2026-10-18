const mongoose = require('mongoose');
const Counter = require('./Counter');

const billSchema = new mongoose.Schema(
  {
    billId: {
      type: String,
      required: [true, 'Please add a bill ID'],
      index: true, // Non-unique index explicitly allowed as per requirements
    },
    billName: {
      type: String,
      required: [true, 'Please add a bill name'],
    },
    userId: {
      type: String,
      required: [true, 'Please add a user ID'],
      index: true,
    },
    phoneNumber: {
      type: String,
      required: [true, 'Please add a phone number'],
      index: true,
    },
    images: [
      {
        type: String,
      },
    ],
    billEntryDate: {
      type: Date,
      required: [true, 'Please add a bill entry date'],
    },
    // Due date is now optional; retain for backward compatibility
    billDueDate: {
      type: Date,
      required: false,
    },
    amount: {
      type: Number,
      default: 0,
    },
    comment: {
      type: String,
      default: '',
    },
    notify: {
      type: Boolean,
      default: false,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Add auto-incrementing recordNumber for display purposes
billSchema.add({
  recordNumber: { type: Number, unique: true, sparse: true },
});

billSchema.pre('save', async function () {
  if (!this.recordNumber) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: 'billRecordNumber' },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', upsert: true }
      );
      this.recordNumber = counter ? counter.seq : 1;
    } catch (err) {
      console.error('Error generating recordNumber:', err);
      // Fallback: estimate from count or timestamp to avoid failing bill creation
      try {
        const count = await mongoose.model('Bill').countDocuments();
        this.recordNumber = count + 1;
      } catch (countErr) {
        this.recordNumber = Date.now() % 1000;
      }
    }
  }
});

module.exports = mongoose.model('Bill', billSchema);
