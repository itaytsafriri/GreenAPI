const fetch = require('node-fetch');

// Green API Configuration
const idInstance = '7103899702';
const apiTokenInstance = 'cf5010eda4fd493f99b6b6d367bfd911b56d9d43041b44f3b3';
const baseUrl = 'https://api.greenapi.com';

async function debugNotifications() {
    console.log('🔍 Debugging Green API notifications...\n');
    
    try {
        // 1. Check instance state
        console.log('1. Checking instance state...');
        const stateResponse = await fetch(`${baseUrl}/waInstance${idInstance}/getStateInstance/${apiTokenInstance}`);
        const state = await stateResponse.json();
        console.log(`State: ${JSON.stringify(state, null, 2)}`);
        
        if (state.stateInstance !== 'authorized') {
            console.log('❌ Instance not authorized, cannot test notifications');
            return;
        }
        
        console.log('✅ Instance is authorized, testing notifications...\n');
        
        // 2. Poll for notifications 10 times
        console.log('2. Polling for notifications (10 attempts)...');
        for (let i = 1; i <= 10; i++) {
            console.log(`\n--- Attempt ${i}/10 ---`);
            
            try {
                const notifResponse = await fetch(`${baseUrl}/waInstance${idInstance}/receiveNotification/${apiTokenInstance}`);
                console.log(`Status: ${notifResponse.status}`);
                
                if (notifResponse.ok) {
                    const notification = await notifResponse.json();
                    
                    if (notification && notification.body) {
                        console.log('🎉 NOTIFICATION RECEIVED!');
                        console.log('Full structure:');
                        console.log(JSON.stringify(notification, null, 2));
                        
                        // Extract key info
                        const { typeWebhook, senderData, messageData } = notification.body;
                        console.log(`\n📋 Key Info:`);
                        console.log(`- Type: ${typeWebhook}`);
                        console.log(`- Chat ID: ${senderData?.chatId}`);
                        console.log(`- Message Type: ${messageData?.typeMessage}`);
                        
                        if (messageData?.typeMessage === 'textMessage') {
                            console.log(`- Text: ${messageData.textMessageData?.textMessage}`);
                        }
                        
                        // Delete notification
                        if (notification.receiptId) {
                            console.log(`\n🗑️ Deleting notification: ${notification.receiptId}`);
                            const deleteResponse = await fetch(`${baseUrl}/waInstance${idInstance}/deleteNotification/${apiTokenInstance}/${notification.receiptId}`, {
                                method: 'DELETE'
                            });
                            console.log(`Delete status: ${deleteResponse.status}`);
                        }
                        
                        break; // Stop after finding one notification
                    } else {
                        console.log('No notification body');
                    }
                } else {
                    const errorText = await notifResponse.text();
                    console.log(`Error: ${errorText}`);
                }
            } catch (error) {
                console.log(`Error: ${error.message}`);
            }
            
            // Wait 1 second between attempts
            if (i < 10) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log('\n✅ Notification debugging complete');
        
    } catch (error) {
        console.error('❌ Debug error:', error.message);
    }
}

debugNotifications();

