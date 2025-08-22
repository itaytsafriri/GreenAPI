const fetch = require('node-fetch');

const idInstance = '7103899702';
const apiTokenInstance = 'cf5010eda4fd493f99b6b6d367bfd911b56d9d43041b44f3b3';
const baseUrl = 'https://api.greenapi.com';

async function testGreenAPI() {
    console.log('Testing Green API endpoints...');
    
    try {
        // Test 1: Get State Instance
        console.log('\n1. Testing getStateInstance...');
        const stateResponse = await fetch(`${baseUrl}/waInstance${idInstance}/getStateInstance/${apiTokenInstance}`);
        console.log(`Status: ${stateResponse.status}`);
        if (stateResponse.ok) {
            const stateData = await stateResponse.json();
            console.log('State:', stateData);
        } else {
            console.log('Error:', await stateResponse.text());
        }
        
        // Wait 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Test 2: Reboot instance first
        console.log('\n2. Testing reboot...');
        const rebootResponse = await fetch(`${baseUrl}/waInstance${idInstance}/reboot/${apiTokenInstance}`);
        console.log(`Reboot Status: ${rebootResponse.status}`);
        if (rebootResponse.ok) {
            const rebootData = await rebootResponse.json();
            console.log('Reboot Response:', rebootData);
        } else {
            console.log('Reboot Error:', await rebootResponse.text());
        }
        
        // Wait 10 seconds for reboot
        console.log('Waiting 10 seconds for instance to reboot...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Test 3: Get QR Code after reboot
        console.log('\n3. Testing getQr after reboot...');
        const qrResponse = await fetch(`${baseUrl}/waInstance${idInstance}/getQr/${apiTokenInstance}`, {
            timeout: 10000 // 10 second timeout
        });
        console.log(`QR Status: ${qrResponse.status}`);
        if (qrResponse.ok) {
            const qrData = await qrResponse.json();
            console.log('QR Response type:', qrData.type);
            if (qrData.qr) {
                console.log('QR data length:', qrData.qr.length);
                console.log('QR data preview:', qrData.qr.substring(0, 100) + '...');
            } else if (qrData.message) {
                console.log('QR message length:', qrData.message.length);
                console.log('QR message preview:', qrData.message.substring(0, 100) + '...');
            }
        } else {
            console.log('QR Error:', await qrResponse.text());
        }
        
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testGreenAPI();
