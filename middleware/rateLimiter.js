const loginAttempts = new Map();

// Clean up expired IP entries every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (now > record.resetTime) {
      loginAttempts.delete(ip);
    }
  }
}, 10 * 60 * 1000);

const loginLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 10; // Max attempts per window

  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, {
      count: 1,
      resetTime: now + windowMs,
    });
    return next();
  }

  const record = loginAttempts.get(ip);

  if (now > record.resetTime) {
    // Window expired, reset counter
    record.count = 1;
    record.resetTime = now + windowMs;
    return next();
  }

  record.count += 1;

  if (record.count > maxAttempts) {
    const minutesLeft = Math.ceil((record.resetTime - now) / 60000);
    return res.status(429).json({
      message: `Too many login attempts. Please try again in ${minutesLeft} minute(s).`,
    });
  }

  next();
};

module.exports = { loginLimiter };
