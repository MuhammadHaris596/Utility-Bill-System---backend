const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from server.env
dotenv.config({ path: path.resolve(__dirname, '../server.env') });

const cloudinary = require('../config/cloudinary');

async function testCloudinary() {
  console.log('Testing Cloudinary Ping...');
  console.log('Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME ? process.env.CLOUDINARY_CLOUD_NAME.trim() : '(not set)');
  console.log('API Key:', process.env.CLOUDINARY_API_KEY ? `${process.env.CLOUDINARY_API_KEY.slice(0, 4)}...` : '(not set)');

  try {
    const pingResult = await cloudinary.api.ping();
    console.log('Ping Result:', JSON.stringify(pingResult, null, 2));

    console.log('\nPing succeeded. Now testing a real image upload (1x1 pixel PNG)...');
    const folder = (process.env.CLOUDINARY_FOLDER || 'Bill-Management-System').trim();
    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const uploadResult = await cloudinary.uploader.upload(sampleBase64, {
      folder: folder,
      resource_type: 'image',
    });

    console.log('Upload Success!');
    console.log('Public ID:', uploadResult.public_id);
    console.log('Secure URL:', uploadResult.secure_url);
    return { success: true, pingResult, uploadResult };
  } catch (error) {
    console.error('Cloudinary Error:');
    console.error('Message:', error.message || (error.error && error.error.message) || error);
    if (error.http_code) {
      console.error('HTTP Code:', error.http_code);
    }
    return { success: false, error };
  }
}

testCloudinary();
