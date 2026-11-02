require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const twilio = require('twilio');
const multer = require('multer');
const fs = require('fs');

const app = express();
const db = new Database(path.join(__dirname, 'northride.sqlite'));

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS admins(
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  trip_type TEXT NOT NULL,
  car_category TEXT NOT NULL,
  pickup TEXT NOT NULL,
  dropoff TEXT NOT NULL,
  pickup_date TEXT NOT NULL,
  pickup_time TEXT NOT NULL,
  notes TEXT,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cars(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oneway_fares(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route TEXT NOT NULL UNIQUE,
  fare INTEGER NOT NULL CHECK(fare >= 0),
  active INTEGER NOT NULL DEFAULT 1
);

/* Customer ratings */
CREATE TABLE IF NOT EXISTS ratings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO oneway_fares(route, fare) VALUES
('Chandigarh to Delhi', 3199),
('Chandigarh to Noida', 3799),
('Chandigarh to Ghaziabad', 3699),
('Chandigarh to Gurugram', 3799),
('Chandigarh to Patiala', 2199),
('Chandigarh to Ludhiana', 2199),
('Chandigarh to Amritsar', 3199),
('Chandigarh to Haridwar', 0);
`);

/* Admin account */
const adminUser = process.env.ADMIN_USERNAME || 'admin';
const adminPass =
  process.env.ADMIN_PASSWORD || 'ChangeThis-Immediately-123!';

if (!db.prepare('SELECT id FROM admins WHERE username=?').get(adminUser)) {
  db.prepare(
    'INSERT INTO admins(username,password_hash) VALUES(?,?)'
  ).run(adminUser, bcrypt.hashSync(adminPass, 12));
}

/* Default cars and payment options */
if (!db.prepare('SELECT id FROM cars LIMIT 1').get()) {
  const insert = db.prepare(
    'INSERT INTO cars(name,category,description,image_url) VALUES(?,?,?,?)'
  );

  [
    [
      'Comfort Sedan',
      'Sedan',
      'Ideal for city rides and airport transfers',
      'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1000&q=85'
    ],
    [
      'Premium SUV',
      'SUV',
      'Extra room for families and luggage',
      'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&w=1000&q=85'
    ],
    [
      'Family MUV',
      'MUV',
      'Comfortable group travel across North India',
      'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1000&q=85'
    ]
  ].forEach(car => insert.run(...car));

  const paymentInsert = db.prepare(
    'INSERT INTO payments(name,details) VALUES(?,?)'
  );

  [
    ['Cash', 'Pay the driver directly'],
    ['UPI', 'Ask the admin for the verified UPI QR/details'],
    ['Online payment', 'Payment link will be shared after confirmation']
  ].forEach(payment => paymentInsert.run(...payment));

  db.prepare(
    'INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)'
  ).run(
    'announcement',
    'Airport transfers, Chandigarh local rides & All India tours'
  );
}

/* Basic security and middleware */
app.disable('x-powered-by');

app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.json({ limit: '100kb' }));

app.use(express.urlencoded({
  extended: false,
  limit: '100kb'
}));

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: __dirname
  }),
  secret:
    process.env.SESSION_SECRET ||
    'development-only-change-this-secret-before-deploying',
  resave: false,
  saveUninitialized: false,
  name: 'northride.sid',
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use(
  '/api/admin/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(express.static(path.join(__dirname, 'public')));

/* Admin authentication */
const requireAdmin = (req, res, next) =>
  req.session.admin
    ? next()
    : res.status(401).json({
        error: 'Please sign in as admin.'
      });

/* Shared input helpers */
const clean = (value, max = 250) =>
  String(value ?? '').trim().slice(0, max);

const phoneOk = value =>
  /^\+?[0-9\s()-]{8,20}$/.test(value);

/* Rating summary */
function getRatingSummary() {
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(ROUND(AVG(stars), 1), 0) AS average
    FROM ratings
  `).get();

  return {
    total: Number(summary.total),
    average: Number(summary.average)
  };
}

/* Car image upload */
const carUploadDir = path.join(
  __dirname,
  'public',
  'uploads',
  'cars'
);

fs.mkdirSync(carUploadDir, { recursive: true });

const carImageTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

const carImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) =>
      cb(null, carUploadDir),

    filename: (req, file, cb) =>
      cb(
        null,
        crypto.randomUUID() + '.' + carImageTypes[file.mimetype]
      )
  }),

  limits: {
    fileSize: 5 * 1024 * 1024
  },

  fileFilter: (req, file, cb) =>
    carImageTypes[file.mimetype]
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG, or WEBP images are allowed.'))
});

app.post('/api/admin/car-image', requireAdmin, (req, res) => {
  carImageUpload.single('image')(req, res, err => {
    if (err) {
      return res.status(400).json({
        error:
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Image must be 5 MB or smaller.'
            : err.message
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'Choose an image file to upload.'
      });
    }

    res.json({
      imageUrl: '/uploads/cars/' + req.file.filename
    });
  });
});

/* SMS helpers */
const smsClient = () =>
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN
    ? twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      )
    : null;

async function sendSms(to, body) {
  const client = smsClient();

  if (
    !client ||
    !process.env.TWILIO_PHONE_NUMBER ||
    !to
  ) {
    return false;
  }

  try {
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
      body
    });

    return true;
  } catch (err) {
    console.error('SMS delivery failed:', err.message);
    return false;
  }
}

/* Public website data */
app.get('/api/public-data', (req, res) => {
  const cars = db.prepare(`
    SELECT id,name,category,description,image_url
    FROM cars
    WHERE active=1
    ORDER BY id DESC
  `).all();

  const payments = db.prepare(`
    SELECT id,name,details
    FROM payments
    WHERE active=1
    ORDER BY id
  `).all();

  const settings = Object.fromEntries(
    db.prepare('SELECT key,value FROM settings')
      .all()
      .map(item => [item.key, item.value])
  );

  const fares = db.prepare(`
    SELECT id,route,fare
    FROM oneway_fares
    WHERE active=1
    ORDER BY id
  `).all();

  const ratingSummary = getRatingSummary();

  res.json({
    cars,
    payments,
    settings,
    fares,
    ratingSummary,
    phones: [
      '+91 9872347745',
      '+91 9988758566'
    ]
  });
});

/* Submit customer rating */
app.post(
  '/api/ratings',
  rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false
  }),
  (req, res) => {
    const stars = Number(req.body.stars);
    const comment = clean(req.body.comment, 500);

    if (
      !Number.isInteger(stars) ||
      stars < 1 ||
      stars > 5
    ) {
      return res.status(400).json({
        error: 'Please select a rating from 1 to 5 stars.'
      });
    }

    try {
      db.prepare(`
        INSERT INTO ratings(stars,comment,created_at)
        VALUES(?,?,?)
      `).run(
        stars,
        comment,
        new Date().toISOString()
      );

      res.status(201).json({
        message: 'Thank you for your rating!',
        ratingSummary: getRatingSummary()
      });
    } catch (err) {
      console.error('Rating save failed:', err.message);

      res.status(500).json({
        error: 'Could not save your rating. Please try again.'
      });
    }
  }
);

/* Customer booking */
app.post(
  '/api/bookings',
  rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false
  }),
  async (req, res) => {
    const b = {
      name: clean(req.body.name, 100),
      phone: clean(req.body.phone, 25),
      tripType: clean(req.body.tripType, 50),
      carCategory: clean(req.body.carCategory, 50),
      pickup: clean(req.body.pickup, 180),
      dropoff: clean(req.body.dropoff, 180),
      pickupDate: clean(req.body.pickupDate, 10),
      pickupTime: clean(req.body.pickupTime, 5),
      notes: clean(req.body.notes, 1200),
      paymentMethod: clean(req.body.paymentMethod, 80)
    };

    if (
      !b.name ||
      !phoneOk(b.phone) ||
      !b.tripType ||
      !b.carCategory ||
      !b.pickup ||
      !b.dropoff ||
      !b.pickupDate ||
      !b.pickupTime ||
      !b.paymentMethod
    ) {
      return res.status(400).json({
        error:
          'Please complete all required fields and enter a valid phone number.'
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.pickupDate)) {
      return res.status(400).json({
        error: 'Please choose a valid pickup date.'
      });
    }

    const now = new Date();

    if (new Date(`${b.pickupDate}T${b.pickupTime}:00`) < now) {
      return res.status(400).json({
        error: 'Pickup date and time must be in the future.'
      });
    }

    const method = db.prepare(`
      SELECT name
      FROM payments
      WHERE active=1 AND name=?
    `).get(b.paymentMethod);

    if (!method) {
      return res.status(400).json({
        error:
          'That payment option is no longer available. Refresh and try again.'
      });
    }

    const normalized = b.phone.replace(/[\s()-]/g, '');

    let user = db.prepare(
      'SELECT id FROM users WHERE phone=?'
    ).get(normalized);

    if (!user) {
      user = {
        id: 'NR-' + crypto.randomBytes(4).toString('hex').toUpperCase()
      };

      db.prepare(`
        INSERT INTO users(id,name,phone,created_at)
        VALUES(?,?,?,?)
      `).run(
        user.id,
        b.name,
        normalized,
        new Date().toISOString()
      );
    } else {
      db.prepare(
        'UPDATE users SET name=? WHERE id=?'
      ).run(b.name, user.id);
    }

    const reference =
      'NRC-' +
      Date.now().toString(36).toUpperCase() +
      '-' +
      crypto.randomBytes(2).toString('hex').toUpperCase();

    db.prepare(`
      INSERT INTO bookings(
        reference,
        user_id,
        trip_type,
        car_category,
        pickup,
        dropoff,
        pickup_date,
        pickup_time,
        notes,
        payment_method,
        created_at
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      reference,
      user.id,
      b.tripType,
      b.carCategory,
      b.pickup,
      b.dropoff,
      b.pickupDate,
      b.pickupTime,
      b.notes,
      b.paymentMethod,
      new Date().toISOString()
    );

    const alert =
      `New NorthRide booking ${reference}\n` +
      `${b.name} (${normalized})\n` +
      `${b.tripType}: ${b.pickup} to ${b.dropoff}\n` +
      `${b.pickupDate} ${b.pickupTime}\n` +
      `Car: ${b.carCategory}`;

    await Promise.all([
      sendSms(process.env.ADMIN_ALERT_PHONE, alert),

      sendSms(
        normalized,
        `NorthRide Cabs received your booking request (${reference}). It is pending confirmation. We will contact you shortly.`
      )
    ]);

    res.status(201).json({
      message: 'Booking request received!',
      reference,
      userId: user.id
    });
  }
);

/* Admin login */
app.post('/api/admin/login', async (req, res) => {
  const username = clean(req.body.username, 80);
  const password = String(req.body.password || '');

  const row = db.prepare(
    'SELECT * FROM admins WHERE username=?'
  ).get(username);

  if (
    !row ||
    !bcrypt.compareSync(password, row.password_hash)
  ) {
    return res.status(401).json({
      error: 'Incorrect username or password.'
    });
  }

  req.session.regenerate(err => {
    if (err) {
      return res.status(500).json({
        error: 'Could not start secure session.'
      });
    }

    req.session.admin = {
      id: row.id,
      username: row.username
    };

    res.json({
      username: row.username
    });
  });
});

/* Admin logout and session */
app.post('/api/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/me', (req, res) => {
  res.json({
    loggedIn: !!req.session.admin,
    username: req.session.admin?.username || null
  });
});

/* Admin bookings */
app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  res.json(
    db.prepare(`
      SELECT b.*,u.name,u.phone
      FROM bookings b
      JOIN users u ON u.id=b.user_id
      ORDER BY b.id DESC
      LIMIT 500
    `).all()
  );
});

app.post(
  '/api/admin/bookings/:id/status',
  requireAdmin,
  async (req, res) => {
    const status = clean(req.body.status, 30);

    if (
      !['Pending', 'Confirmed', 'Cancelled', 'Completed'].includes(status)
    ) {
      return res.status(400).json({
        error: 'Invalid booking status.'
      });
    }

    const booking = db.prepare(`
      SELECT b.*,u.name,u.phone
      FROM bookings b
      JOIN users u ON u.id=b.user_id
      WHERE b.id=?
    `).get(Number(req.params.id));

    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found.'
      });
    }

    db.prepare(
      'UPDATE bookings SET status=? WHERE id=?'
    ).run(status, booking.id);

    if (status === 'Confirmed') {
      await sendSms(
        booking.phone,
        `Your NorthRide Cabs booking ${booking.reference} is CONFIRMED. Pickup: ${booking.pickup}, ${booking.pickup_date} at ${booking.pickup_time}. For help call +91 9872347745.`
      );
    }

    res.json({
      ok: true,
      smsConfigured:
        !!smsClient() && !!process.env.TWILIO_PHONE_NUMBER
    });
  }
);

/* Admin users */
app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(
    db.prepare(`
      SELECT
        u.id,
        u.name,
        u.phone,
        u.created_at,
        COUNT(b.id) AS rides
      FROM users u
      LEFT JOIN bookings b ON b.user_id=u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all()
  );
});

/* Admin password change */
app.post('/api/admin/password', requireAdmin, (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');

  if (next.length < 12) {
    return res.status(400).json({
      error: 'New password must be at least 12 characters.'
    });
  }

  const row = db.prepare(
    'SELECT password_hash FROM admins WHERE id=?'
  ).get(req.session.admin.id);

  if (!bcrypt.compareSync(current, row.password_hash)) {
    return res.status(400).json({
      error: 'Current password is incorrect.'
    });
  }

  db.prepare(
    'UPDATE admins SET password_hash=? WHERE id=?'
  ).run(
    bcrypt.hashSync(next, 12),
    req.session.admin.id
  );

  res.json({ ok: true });
});

/* Admin cars */
app.post('/api/admin/cars', requireAdmin, (req, res) => {
  const id = Number(req.body.id) || 0;
  const name = clean(req.body.name, 100);
  const category = clean(req.body.category, 50);
  const description = clean(req.body.description, 240);
  const image_url = clean(req.body.image_url, 1000);
  const active = req.body.active === false ? 0 : 1;

  const imageOk =
    /^https:\/\//i.test(image_url) ||
    /^\/uploads\/cars\/[a-f0-9-]+\.(jpg|png|webp)$/i.test(image_url);

  if (!name || !category || !image_url || !imageOk) {
    return res.status(400).json({
      error:
        'Enter a name, category and valid HTTPS or uploaded image.'
    });
  }

  if (id) {
    db.prepare(`
      UPDATE cars
      SET name=?,category=?,description=?,image_url=?,active=?
      WHERE id=?
    `).run(name, category, description, image_url, active, id);
  } else {
    db.prepare(`
      INSERT INTO cars(name,category,description,image_url,active)
      VALUES(?,?,?,?,?)
    `).run(name, category, description, image_url, active);
  }

  res.json({ ok: true });
});

app.delete('/api/admin/cars/:id', requireAdmin, (req, res) => {
  db.prepare(
    'DELETE FROM cars WHERE id=?'
  ).run(Number(req.params.id));

  res.json({ ok: true });
});

/* Admin fares */
app.get('/api/admin/fares', requireAdmin, (req, res) => {
  res.json(
    db.prepare(`
      SELECT id,route,fare,active
      FROM oneway_fares
      ORDER BY id
    `).all()
  );
});

app.post('/api/admin/fares', requireAdmin, (req, res) => {
  const id = Number(req.body.id) || 0;
  const route = clean(req.body.route, 120);
  const fare = Number(req.body.fare);
  const active = req.body.active === false ? 0 : 1;

  if (!route || !Number.isInteger(fare) || fare < 0) {
    return res.status(400).json({
      error: 'Enter a route and a valid fare (0 or greater).'
    });
  }

  try {
    if (id) {
      db.prepare(`
        UPDATE oneway_fares
        SET route=?,fare=?,active=?
        WHERE id=?
      `).run(route, fare, active, id);
    } else {
      db.prepare(`
        INSERT INTO oneway_fares(route,fare,active)
        VALUES(?,?,?)
      `).run(route, fare, active);
    }

    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({
        error: 'This route already exists.'
      });
    }

    res.status(500).json({
      error: 'Could not save fare.'
    });
  }
});

app.delete('/api/admin/fares/:id', requireAdmin, (req, res) => {
  db.prepare(
    'DELETE FROM oneway_fares WHERE id=?'
  ).run(Number(req.params.id));

  res.json({ ok: true });
});

/* Admin payment methods */
app.post('/api/admin/payments', requireAdmin, (req, res) => {
  const id = Number(req.body.id) || 0;
  const name = clean(req.body.name, 80);
  const details = clean(req.body.details, 300);
  const active = req.body.active === false ? 0 : 1;

  if (!name) {
    return res.status(400).json({
      error: 'Payment method name is required.'
    });
  }

  if (id) {
    db.prepare(`
      UPDATE payments
      SET name=?,details=?,active=?
      WHERE id=?
    `).run(name, details, active, id);
  } else {
    db.prepare(`
      INSERT INTO payments(name,details,active)
      VALUES(?,?,?)
    `).run(name, details, active);
  }

  res.json({ ok: true });
});

app.delete('/api/admin/payments/:id', requireAdmin, (req, res) => {
  db.prepare(
    'DELETE FROM payments WHERE id=?'
  ).run(Number(req.params.id));

  res.json({ ok: true });
});

/* Admin announcement */
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const announcement = clean(req.body.announcement, 300);

  db.prepare(`
    INSERT INTO settings(key,value)
    VALUES(?,?)
    ON CONFLICT(key)
    DO UPDATE SET value=excluded.value
  `).run('announcement', announcement);

  res.json({ ok: true });
});

/* Start server */
const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`NorthRide Cabs running at http://localhost:${port}`);
});