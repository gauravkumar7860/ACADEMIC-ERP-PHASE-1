require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('./config/db');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render sits behind a proxy; needed for secure cookies + real client IPs
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/healthz', (req, res) => res.json({ ok: true })); // handy for Render health checks / keep-alive pings

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/student', require('./routes/student.routes'));
app.use('/api/faculty', require('./routes/faculty.routes'));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Express 5 forwards async errors here. Users never see technical details.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Unable to complete this request. Please try again.' });
});

const PORT = process.env.PORT || 3000;
db.init()
  .then(() => app.listen(PORT, () => console.log(`Academic ERP listening on port ${PORT}`)))
  .catch((e) => { console.error('Database initialisation failed:', e.message); process.exit(1); });
