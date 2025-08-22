const fetch = require('node-fetch');

// Green API Configuration
const idInstance = '7103899702';
const apiTokenInstance = 'cf5010eda4fd493f99b6b6d367bfd911b56d9d43041b44f3b3';
const baseUrl = 'https://api.greenapi.com';

async function testNotifications() {
    console.log('Testing Green API notifications...\n');
    
    try {
        // 1. Check instance state
        console.log('1. Checking instance state...');
        const stateResponse = await fetch(`${baseUrl}/waInstance${idInstance}/getStateInstance/${apiTokenInstance}`);
        const state = await stateResponse.json();
        console.log(`State: ${JSON.stringify(state)}`);
        
        if (state.stateInstance !== 'authorized') {
            console.log('Instance not authorized, cannot test notifications');
            return;
        }
        
        // 2. Test receiving notifications
        console.log('\n2. Testing receiveNotification...');
        const notificationResponse = await fetch(`${baseUrl}/waInstance${idInstance}/receiveNotification/${apiTokenInstance}`);
        const notification = await notificationResponse.json();
        console.log(`Notification: ${JSON.stringify(notification, null, 2)}`);
        
        // 3. If there's a notification, try to delete it
        if (notification && notification.receiptId) {
            console.log('\n3. Testing deleteNotification...');
            const deleteResponse = await fetch(`${baseUrl}/waInstance${idInstance}/deleteNotification/${apiTokenInstance}/${notification.receiptId}`, {
                method: 'DELETE'
            });
            console.log(`Delete response: ${deleteResponse.status}`);
        }
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testNotifications();
