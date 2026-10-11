const errorHandler = (err, req, res, next) => {
  // Log full details to server logs only
  console.error('[SERVER ERROR HANDLER]:', {
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
  });

  // Determine appropriate HTTP status code
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  if (err.statusCode) {
    statusCode = err.statusCode;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
  } else if (err.name === 'CastError') {
    statusCode = 400;
  } else if (err.code === 11000) {
    statusCode = 400;
  }

  const responseMessage =
    statusCode === 500
      ? 'An unexpected server error occurred. Please try again later.'
      : err.message || 'Request failed';

  res.status(statusCode).json({
    message: responseMessage,
    // TEMPORARY DEBUG: masla fix hone ke baad ye 2 lines hata dena
    debug: err.message,
    name: err.name,
  });
};

module.exports = errorHandler;
