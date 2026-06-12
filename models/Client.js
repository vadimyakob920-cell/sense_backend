const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
    name: { type: String },
    email: { type: String },
    ip: { type: String, required: true, unique: true },
    company: { type: String },
    testUri: { type: String },
    owner: { type: String },
    hadRun: { type: Boolean, default: false },
    password: { type: String },
    createdAt: {
        type: Date,
        default: () => new Date(new Date().toISOString()) // Always GMT
    },
    passwords: { type: [String], default: [] },
    macPasswords: { type: [String], default: [] },
    meetingname: { type: String },
    meetingemail: { type: String },
    blocked: { type: Boolean, default: false },
    img: {
        data: Buffer,
        contentType: String
    }
});

module.exports = mongoose.model('Client', clientSchema);