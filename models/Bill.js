const mongoose = require('mongoose');

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
    username: {
      type: String,
      required: [true, 'Please add a username'],
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
    billDueDate: {
      type: Date,
      required: [true, 'Please add a bill due date'],
    },
    amount: {
      type: Number,
      default: 0,
    },
    comment: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Bill', billSchema);
