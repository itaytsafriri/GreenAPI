const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const qrcode = require('qrcode-terminal');
const jsQR = require('jsqr');
const sharp = require('sharp');

// Logging setup
const logStream = fs.createWriteStream(path.join(__dirname, 'green_api_debug.log'), { flags: 'a' });
const log = (message) => {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] ${message}\n`;
    logStream.write(formattedMessage);
    console.log(`[${timestamp}] ${message}`);
};

log('=== Green API Service Starting ===');
log(`Node.js version: ${process.version}`);
log(`Script path: ${__dirname}`);
log('Note: Green API sessions persist between runs (unlike whatsapp-web.js LocalAuth)');
log('Use logout command to unlink phone and start fresh');

// Green API Configuration (same as React project)
const idInstance = '7103899702';
const apiTokenInstance = 'cf5010eda4fd493f99b6b6d367bfd911b56d9d43041b44f3b3';
const baseUrl = 'https://api.greenapi.com';

// Global state
let client = null;
let isMonitoring = false;
let selectedGroupId = null;
let isConnected = false;
let lastQrTimestamp = 0;
let qrAttempts = 0;
let qrPollingInterval = null;
let notificationPollingInterval = null;
let isFetchingGroups = false;

// Error handling
process.on('uncaughtException', (err) => {
    log(`!!! UNCAUGHT EXCEPTION: ${err.message}`);
    log(`Stack: ${err.stack}`);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(JSON.stringify(reason));
    log(`!!! UNHANDLED REJECTION: ${err.message}`);
    log(`Stack: ${err.stack}`);
    process.exit(1);
});

function sendToHost(message) {
    // Ensure proper UTF-8 encoding for Hebrew and other Unicode characters
    const jsonString = JSON.stringify(message, null, 0);
    console.log(jsonString);
}

// Green API Client Class
class GreenApiClient {
    constructor(idInstance, apiTokenInstance) {
        this.idInstance = idInstance;
        this.apiTokenInstance = apiTokenInstance;
        this.baseUrl = 'https://api.greenapi.com';
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        const config = {
            method: options.method || 'GET',
            headers,
            ...options
        };

        if (options.body) {
            config.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            log(`API request failed: ${error.message}`);
            throw error;
        }
    }

    async getStateInstance() {
        return this.request(`/waInstance${this.idInstance}/getStateInstance/${this.apiTokenInstance}`);
    }

    async getQr() {
        return this.request(`/waInstance${this.idInstance}/qr/${this.apiTokenInstance}`);
    }

    async getGroups() {
        return this.request(`/waInstance${this.idInstance}/getChats/${this.apiTokenInstance}`);
    }

    async getChatHistory(chatId, count = 100) {
        return this.request(`/waInstance${this.idInstance}/getChatHistory/${this.apiTokenInstance}`, {
            method: 'POST',
            body: {
                chatId: chatId,
                count: count
            }
        });
    }

    async sendMessage(chatId, message) {
        return this.request(`/waInstance${this.idInstance}/sendMessage/${this.apiTokenInstance}`, {
            method: 'POST',
            body: {
                chatId: chatId,
                message: message
            }
        });
    }

    async receiveNotification() {
        return this.request(`/waInstance${this.idInstance}/receiveNotification/${this.apiTokenInstance}`);
    }

    async deleteNotification(receiptId) {
        return this.request(`/waInstance${this.idInstance}/deleteNotification/${this.apiTokenInstance}/${receiptId}`, {
            method: 'DELETE'
        });
    }

    async downloadFile(fileId) {
        try {
            // First get the download URL
            const downloadUrlResponse = await this.request(`/waInstance${this.idInstance}/downloadFile/${this.apiTokenInstance}`, {
                method: 'POST',
                body: {
                    fileId: fileId
                }
            });
            
            if (downloadUrlResponse && downloadUrlResponse.url) {
                // Download the actual file data
                const fileResponse = await fetch(downloadUrlResponse.url);
                if (!fileResponse.ok) {
                    throw new Error(`Failed to download file: ${fileResponse.status}`);
                }
                
                const arrayBuffer = await fileResponse.arrayBuffer();
                return {
                    data: Buffer.from(arrayBuffer),
                    url: downloadUrlResponse.url
                };
            } else {
                throw new Error('No download URL received');
            }
        } catch (error) {
            log(`Download file error: ${error.message}`);
            throw error;
        }
    }

    async logout() {
        // Try logout first, then reboot if logout doesn't work
        try {
            log('Attempting logout with GET request...');
            const logoutResult = await this.request(`/waInstance${this.idInstance}/logout/${this.apiTokenInstance}`);
            log(`Logout response: ${JSON.stringify(logoutResult)}`);
            
            if (logoutResult && logoutResult.isLogout) {
                log('Logout successful - phone should be unlinked');
                return logoutResult;
            } else {
                log('Logout did not return isLogout=true, trying reboot...');
                const rebootResult = await this.request(`/waInstance${this.idInstance}/reboot/${this.apiTokenInstance}`);
                log(`Reboot response: ${JSON.stringify(rebootResult)}`);
                return rebootResult;
            }
        } catch (error) {
            log(`Logout/reboot failed: ${error.message}`);
            throw error;
        }
    }
    
    async reboot() {
        try {
            log('Attempting to reboot instance...');
            const rebootResult = await this.request(`/waInstance${this.idInstance}/reboot/${this.apiTokenInstance}`);
            log(`Reboot response: ${JSON.stringify(rebootResult)}`);
            return rebootResult;
        } catch (error) {
            log(`Reboot failed: ${error.message}`);
            throw error;
        }
    }
}

// Create Green API client instance
client = new GreenApiClient(idInstance, apiTokenInstance);

// Standalone mode functions

async function showQRInTerminal(qr) {
    console.log('\n=== SCAN THIS QR CODE WITH YOUR PHONE ===');
    
    // Check if qr is base64 image data (from Green API)
    if (qr && qr.length > 1000 && qr.includes('iVBORw0KGgo')) {
        try {
            log('Processing base64 QR image data...');
            // Decode the base64 image and extract QR code data
            const buffer = Buffer.from(qr, 'base64');
            
            // Use sharp to convert PNG to raw image data
            const { data, info } = await sharp(buffer)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            
            log(`Image decoded: ${info.width}x${info.height} pixels`);
            
            // Use jsQR to decode the QR code
            const code = jsQR(data, info.width, info.height);
            
            if (code) {
                log(`QR code data extracted: ${code.data.substring(0, 50)}...`);
                // Display QR code in terminal exactly like whatsapp.js
                qrcode.generate(code.data, { small: true });
            } else {
                throw new Error('Could not decode QR code from image');
            }
            
        } catch (error) {
            log(`Error decoding QR code from image: ${error.message}`);
            // Try alternative approach - save as HTML file temporarily
            try {
                log('Trying alternative QR display method...');
                const htmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>QR Code</title>
                        <style>
                            body { 
                                display: flex; 
                                justify-content: center; 
                                align-items: center; 
                                height: 100vh; 
                                margin: 0; 
                                background: white; 
                            }
                            img { max-width: 300px; }
                        </style>
                    </head>
                    <body>
                        <img src="data:image/png;base64,${qr}" alt="QR Code">
                    </body>
                    </html>
                `;
                const tempFile = path.join(__dirname, 'qr_code.html');
                fs.writeFileSync(tempFile, htmlContent);
                console.log(`\n=== QR CODE SAVED TO: ${tempFile} ===`);
                console.log('Open this file in your browser to scan the QR code');
                console.log('=== QR CODE ABOVE ===\n');
                
                // Clean up after 30 seconds
                setTimeout(() => {
                    try {
                        fs.unlinkSync(tempFile);
                        log('Temporary QR file cleaned up');
                    } catch (cleanupError) {
                        log(`Failed to cleanup QR file: ${cleanupError.message}`);
                    }
                }, 30000);
            } catch (htmlError) {
                log(`Failed to create HTML QR file: ${htmlError.message}`);
                console.log('QR Code received as image data (unable to decode for terminal display)');
                console.log('The QR code is available but cannot be displayed in terminal.');
            }
        }
    } else {
        // Try to generate QR code from text (fallback for direct QR data)
        try {
            log('Processing direct QR text data...');
            log(`QR data length: ${qr?.length || 0}`);
            qrcode.generate(qr, { small: true });
        } catch (error) {
            console.log('Error generating QR code:', error.message);
            console.log('QR data:', qr);
        }
    }
    
    console.log('=== QR CODE ABOVE ===\n');
}

async function checkConnectionStatus() {
    try {
        const state = await client.getStateInstance();
        log(`Connection state: ${state.stateInstance}`);
        
        if (state.stateInstance === 'authorized') {
            if (!isConnected) {
                isConnected = true;
                log('Client is ready!');
                sendToHost({ type: 'status', connected: true });
                sendToHost({ type: 'userName', name: 'Green API User' });
            }
        } else if (state.stateInstance === 'notAuthorized') {
            if (isConnected) {
                isConnected = false;
                log('Client disconnected');
                sendToHost({ type: 'status', connected: false });
                sendToHost({ type: 'monitoringStatus', monitoring: false });
            }
        }
        
        return state.stateInstance;
    } catch (error) {
        log(`Error checking connection status: ${error.message}`);
        
        // Don't change connection status on rate limit errors
        if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
            log('Rate limited during connection check, keeping current status');
            return isConnected ? 'authorized' : 'notAuthorized';
        }
        
        return 'error';
    }
}

async function fetchAndSendGroups() {
    log('Fetching groups...');
    try {
        // Remove internal flag check - let the caller handle it
        
        // Add initial delay to avoid immediate rate limiting
        log('Waiting 2 seconds before making API calls to avoid rate limits...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Skip connection check to avoid rate limiting - assume we're authorized
        log('Skipping connection check to avoid rate limits, proceeding with group fetch...');

        // Retry logic for rate limiting
        let groups = [];
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                log(`Attempt ${retryCount + 1} of ${maxRetries} to fetch groups`);
                
                // Add a timeout to prevent hanging
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Group fetch timeout after 30 seconds')), 30000);
                });
                
                const fetchPromise = client.getGroups();
                const response = await Promise.race([fetchPromise, timeoutPromise]);
                
                if (response && Array.isArray(response)) {
                    // Filter for groups (chats with @g.us in ID) - like React version
                    groups = response
                        .filter(chat => chat.id && chat.id.includes('@g.us'))
                        .map(group => ({
                            id: group.id,
                            name: group.name || group.subject || 'Unknown Group'
                        }));
                    log(`Found ${groups.length} groups out of ${response.length} total chats`);
                    
                    // Debug: Show first few groups
                    if (groups.length > 0) {
                        log(`First 5 groups:`);
                        groups.slice(0, 5).forEach((group, index) => {
                            log(`  ${index + 1}. ${group.name} (${group.id})`);
                        });
                    }
                    break; // Success, exit retry loop
                } else {
                    log('No chats found in response');
                    break; // No chats but no error, exit retry loop
                }
            } catch (err) {
                retryCount++;
                log(`getGroups attempt ${retryCount} failed: ${err.message}`);
                
                if (err.message.includes('429') || err.message.includes('Too Many Requests')) {
                    if (retryCount < maxRetries) {
                        const waitTime = retryCount * 2000; // Exponential backoff: 2s, 4s, 6s
                        log(`Rate limited, waiting ${waitTime}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    } else {
                        log('Max retries reached for rate limiting');
                        sendToHost({ type: 'groups', groups: [], error: 'Rate limited - try again later' });
                        return;
                    }
                } else {
                    // Non-rate-limit error, don't retry
                    log(`Non-retryable error: ${err.message}`);
                    break;
                }
            }
        }
        
        log(`Final result: Found ${groups.length} groups`);
        sendToHost({ type: 'groups', groups });
    } catch (error) {
        log(`Error fetching groups: ${error.message}`);
        sendToHost({ type: 'groups', groups: [], error: error.message });
    }
    // Flag management moved to caller
}

async function startNotificationPolling() {
    log('Starting notification polling...');
    
    // Clear any existing interval
    if (notificationPollingInterval) {
        clearInterval(notificationPollingInterval);
    }
    
    const pollNotifications = async () => {
        try {
            // Remove connection check - poll regardless of connection state like React example
            const notifications = await client.receiveNotification();
            
            if (notifications && notifications.body) {
                log(`📨 Notification received - type: ${notifications.body.typeWebhook}, chatId: ${notifications.body.senderData?.chatId}`);
                
                // Debug: Log if this is a message from monitored group
                if (notifications.body.typeWebhook === 'incomingMessageReceived' && 
                    notifications.body.senderData?.chatId === selectedGroupId) {
                    log(`🎯 MESSAGE FROM MONITORED GROUP! Group: ${selectedGroupId}`);
                    log(`📝 Message type: ${notifications.body.messageData?.typeMessage}`);
                    if (notifications.body.messageData?.typeMessage === 'textMessage') {
                        log(`💬 Text: ${notifications.body.messageData.textMessageData?.textMessage}`);
                    }
                }
                
                // Process the notification
                await processNotification(notifications);
                
                // Delete the notification after processing
                if (notifications.receiptId) {
                    try {
                        await client.deleteNotification(notifications.receiptId);
                        log(`Deleted notification: ${notifications.receiptId}`);
                    } catch (deleteError) {
                        log(`Failed to delete notification: ${deleteError.message}`);
                    }
                }
            }
            // Remove "No notifications received" log to reduce spam
        } catch (error) {
            if (error.message.includes('429')) {
                log('Rate limit hit, slowing down polling...');
                // Slow down polling on rate limit
                if (notificationPollingInterval) {
                    clearInterval(notificationPollingInterval);
                    notificationPollingInterval = setInterval(pollNotifications, 5000); // 5 seconds instead of 30
                }
            } else if (error.message.includes('500') || error.message.includes('504')) {
                log('Server error, waiting before retry...');
                // Wait longer on server errors
                if (notificationPollingInterval) {
                    clearInterval(notificationPollingInterval);
                    notificationPollingInterval = setInterval(pollNotifications, 10000); // 10 seconds instead of 60
                }
            } else {
                log(`Notification polling error: ${error.message}`);
            }
        }
    };
    
    // Poll every 500ms like the working React example
    notificationPollingInterval = setInterval(pollNotifications, 500);
    log('Notification polling started - checking every 500ms (like React example)');
}

async function processNotification(notification) {
    try {
        if (!notification.body) {
            return;
        }
        
        const { typeWebhook, senderData, messageData } = notification.body;
        
        // Handle state changes (like React example)
        if (typeWebhook === 'stateInstanceChanged') {
            const newState = notification.body.stateInstance || notification.body?.stateAfter || notification.body?.statusInstance;
            if (newState) {
                log(`State changed to: ${newState}`);
                if (newState === 'authorized' && !isConnected) {
                    isConnected = true;
                    sendToHost({ type: 'status', connected: true });
                } else if (newState === 'notAuthorized' && isConnected) {
                    isConnected = false;
                    sendToHost({ type: 'status', connected: false });
                }
            }
            return;
        }
        
        // Only process message notifications
        if (typeWebhook !== 'incomingMessageReceived') {
            return;
        }
        
        // Check if we're monitoring and if this message is from the monitored group
        if (!isMonitoring || !selectedGroupId) {
            return;
        }
        
        if (senderData && senderData.chatId === selectedGroupId) {
            log(`Message received from monitored group: ${selectedGroupId}`);
            
            if (messageData && messageData.typeMessage === 'textMessage') {
                // Handle text message
                const textData = messageData.textMessageData;
                if (textData && textData.textMessage) {
                    log(`Text message: ${textData.textMessage.substring(0, 100)}...`);
                    sendToHost({
                        type: 'text',
                        Text: {
                            Id: messageData.idMessage || 'unknown',
                            From: senderData.chatId,
                            Author: senderData.sender || senderData.chatId,
                            Type: 'text',
                            Timestamp: Math.floor(Date.now() / 1000),
                            Text: textData.textMessage,
                            SenderName: senderData.senderName || 'Unknown'
                        }
                    });
                }
            } else if (messageData && messageData.typeMessage === 'imageMessage') {
                // Handle image message
                log('Image message received, downloading...');
                try {
                    const mediaData = messageData.imageMessage;
                    const downloadResult = await client.downloadFile(mediaData.downloadUrl);
                    
                    if (downloadResult && downloadResult.data) {
                        // Convert to base64
                        const base64Data = Buffer.from(downloadResult.data).toString('base64');
                        
                        const timestamp = new Date().toISOString()
                            .replace(/[-:]/g, '')
                            .split('.')[0]
                            .replace('T', '_');
                        
                        log(`Sending image to host - Size: ${downloadResult.data.length} bytes`);
                        sendToHost({
                            type: 'media',
                            Media: {
                                Id: messageData.idMessage || 'unknown',
                                From: senderData.chatId,
                                Author: senderData.sender || senderData.chatId,
                                Type: 'image/jpeg',
                                Timestamp: Math.floor(Date.now() / 1000),
                                Filename: `${senderData.senderName || 'unknown'}_${timestamp}.jpg`,
                                Data: base64Data,
                                Size: downloadResult.data.length,
                                SenderName: senderData.senderName || 'Unknown',
                                Body: mediaData.caption || ''
                            }
                        });
                    }
                } catch (mediaError) {
                    log(`Error downloading image: ${mediaError.message}`);
                }
            } else if (messageData && messageData.typeMessage === 'videoMessage') {
                // Handle video message
                log('Video message received, downloading...');
                try {
                    const mediaData = messageData.videoMessage;
                    const downloadResult = await client.downloadFile(mediaData.downloadUrl);
                    
                    if (downloadResult && downloadResult.data) {
                        const base64Data = Buffer.from(downloadResult.data).toString('base64');
                        
                        const timestamp = new Date().toISOString()
                            .replace(/[-:]/g, '')
                            .split('.')[0]
                            .replace('T', '_');
                        
                        log(`Sending video to host - Size: ${downloadResult.data.length} bytes`);
                        sendToHost({
                            type: 'media',
                            Media: {
                                Id: messageData.idMessage || 'unknown',
                                From: senderData.chatId,
                                Author: senderData.sender || senderData.chatId,
                                Type: 'video/mp4',
                                Timestamp: Math.floor(Date.now() / 1000),
                                Filename: `${senderData.senderName || 'unknown'}_${timestamp}.mp4`,
                                Data: base64Data,
                                Size: downloadResult.data.length,
                                SenderName: senderData.senderName || 'Unknown',
                                Body: mediaData.caption || ''
                            }
                        });
                    }
                } catch (mediaError) {
                    log(`Error downloading video: ${mediaError.message}`);
                }
            } else {
                log(`Unhandled message type: ${messageData?.typeMessage}`);
            }
        } else {
            log(`Message not from monitored group - senderData.chatId: ${senderData?.chatId}, selectedGroupId: ${selectedGroupId}`);
        }
    } catch (error) {
        log(`Error processing notification: ${error.message}`);
        log(`Error stack: ${error.stack}`);
    }
}

async function initialize() {
    log('Initializing Green API client...');
    
    try {
        // Check initial connection status
        const state = await checkConnectionStatus();
        
        if (state === 'authorized') {
            log('Already authorized, starting notification polling');
            isConnected = true;
            sendToHost({ type: 'status', connected: true });
            await startNotificationPolling();
        } else if (state === 'notAuthorized' || state === 'starting') {
            log(`State: ${state}, starting QR code polling`);
            await startQRCodePolling();
        } else {
            log(`Unknown state: ${state}, starting QR code polling anyway`);
            await startQRCodePolling();
        }
        
        // Start periodic connection status checking
        setInterval(async () => {
            const currentState = await checkConnectionStatus();
            if (currentState === 'authorized' && !isConnected) {
                log('Connection detected, starting notification polling');
                isConnected = true;
                sendToHost({ type: 'status', connected: true });
                await startNotificationPolling();
            } else if (currentState === 'notAuthorized' && isConnected) {
                log('Connection lost, stopping notification polling');
                isConnected = false;
                sendToHost({ type: 'status', connected: false });
                if (notificationPollingInterval) {
                    clearInterval(notificationPollingInterval);
                    notificationPollingInterval = null;
                }
                await startQRCodePolling();
            }
        }, 30000); // Check every 30 seconds to avoid rate limits
        
    } catch (error) {
        log(`!!!!!! CLIENT INITIALIZATION FAILED: ${error.message}`);
        log(`!!!!!! Stack: ${error.stack}`);
        sendToHost({ type: 'error', message: `Client initialization failed: ${error.message}` });
        process.exit(1);
    }
}

async function startQRCodePolling() {
    log('Starting QR code polling...');
    
    // Clear any existing interval
    if (qrPollingInterval) {
        clearInterval(qrPollingInterval);
    }
    
    qrAttempts = 0;
    lastQrTimestamp = 0;
    
    const pollQR = async () => {
        try {
            const state = await client.getStateInstance();
            
            if (state.stateInstance === 'authorized') {
                log('Instance is authorized, stopping QR polling');
                if (qrPollingInterval) {
                    clearInterval(qrPollingInterval);
                    qrPollingInterval = null;
                }
                isConnected = true;
                sendToHost({ type: 'status', connected: true });
                return;
            }
            
            if (state.stateInstance === 'notAuthorized' || state.stateInstance === 'starting') {
                qrAttempts++;
                log(`QR attempt ${qrAttempts}/unlimited`);
                
                try {
                    const qrResponse = await client.getQr();
                    const now = Date.now();
                    
                    if (qrResponse && qrResponse.qr) {
                        if (now - lastQrTimestamp > 5000) {
                            log('QR code received in qr field');
                            await showQRInTerminal(qrResponse.qr);
                            // Don't send QR to host - just display in terminal like original
                            lastQrTimestamp = now;
                            qrAttempts = 0; // Reset attempts on success
                        }
                    } else if (qrResponse && qrResponse.type === 'qrCode' && qrResponse.message) {
                        if (now - lastQrTimestamp > 5000) {
                            log('QR code received in message field (base64)');
                            // The message field contains base64 encoded QR code
                            await showQRInTerminal(qrResponse.message);
                            // Don't send QR to host - just display in terminal like original
                            lastQrTimestamp = now;
                            qrAttempts = 0; // Reset attempts on success
                        }
                    } else {
                        log('No QR code in response, will retry');
                    }
                } catch (qrError) {
                    log(`QR fetch error: ${qrError.message}`);
                    // Don't increment attempts on network errors, only on no QR response
                }
                
                // Auto-reboot after many failed attempts (like original whatsapp.js behavior)
                if (qrAttempts > 10) {
                    log('Too many QR attempts, rebooting instance...');
                    try {
                        await client.reboot();
                        log('Instance rebooted, waiting 10 seconds...');
                        await new Promise(resolve => setTimeout(resolve, 10000));
                        qrAttempts = 0; // Reset attempts after reboot
                    } catch (rebootError) {
                        log(`Reboot failed: ${rebootError.message}`);
                    }
                }
            }
        } catch (error) {
            log(`QR polling error: ${error.message}`);
        }
    };
    
    // Poll immediately
    await pollQR();
    
    // Then poll every 3 seconds (like original whatsapp.js QR refresh behavior)
    qrPollingInterval = setInterval(pollQR, 3000);
}

async function handleLogout() {
    log('Processing logout command');
    
    try {
        // Stop monitoring
        isMonitoring = false;
        selectedGroupId = null;
        
        // Stop polling
        if (notificationPollingInterval) {
            clearInterval(notificationPollingInterval);
            notificationPollingInterval = null;
        }
        
        // Stop QR polling
        if (qrPollingInterval) {
            clearInterval(qrPollingInterval);
            qrPollingInterval = null;
        }
        
        // Logout from Green API (this will unlink the phone)
        try {
            log('Logging out from Green API...');
            const logoutResult = await client.logout();
            log(`Green API logout successful: ${JSON.stringify(logoutResult)}`);
            
            // Check instance state after logout
            try {
                const stateAfterLogout = await client.getStateInstance();
                log(`Instance state after logout: ${stateAfterLogout.stateInstance}`);
            } catch (stateError) {
                log(`Could not check state after logout: ${stateError.message}`);
            }
        } catch (logoutError) {
            log(`Green API logout error: ${logoutError.message}`);
        }
        
        log('Logout completed');
        
    } catch (error) {
        log(`Error during logout: ${error.message}`);
    }
    
    log('Exiting process after logout');
    process.exit(0);
}

function handleCommand(data) {
    const dataStr = data.toString().trim();
    log(`Command received: "${dataStr}"`);
    
    // Skip empty data
    if (!dataStr) {
        log('Empty command received, skipping');
        return;
    }
    
    let command;
    try {
        command = JSON.parse(dataStr);
        log(`Successfully parsed command: ${command.type}`);
    } catch (e) {
        log(`Error parsing command: ${e.message} for data: "${dataStr}"`);
        return;
    }
    
    switch (command.type) {
        case 'get_groups':
            log('Processing get_groups command');
            if (isFetchingGroups) {
                log('Group fetch already in progress, skipping duplicate request');
                return;
            }
            fetchAndSendGroups()
                .finally(() => {
                    isFetchingGroups = false;
                })
                .catch(err => log(`Error in fetchAndSendGroups: ${err.message}`));
            break;
            
        case 'monitor_group':
            log(`Processing monitor_group command for group ID: ${command.groupId}`);
            selectedGroupId = command.groupId;
            isMonitoring = true;
            log(`Monitoring started - selectedGroupId: ${selectedGroupId}, isMonitoring: ${isMonitoring}`);
            sendToHost({ type: 'monitoringStatus', monitoring: true });
            break;
            
        case 'stop_monitoring':
            log('Processing stop_monitoring command');
            isMonitoring = false;
            selectedGroupId = null;
            sendToHost({ type: 'monitoringStatus', monitoring: false });
            break;
            
        case 'logout':
            handleLogout().catch(err => log(`Error in logout: ${err.message}`));
            break;
            
        default:
            log(`Unknown command type: ${command.type}`);
    }
}

async function main() {
    log('Starting main function...');
    
    try {
        await initialize();
        log('Main initialization complete');
        
        // Send initial status
        sendToHost({ type: 'status', connected: false });
        
        // Check if running in standalone mode (no stdin redirection)
        if (process.stdin.isTTY) {
                         log('Running in standalone mode - use these commands:');
             log('  get_groups - Fetch all groups');
             log('  monitor <group_id> - Start monitoring a group');
             log('  stop_monitoring - Stop monitoring');
             log('  logout - Logout and exit');
             log('  quit - Exit without logout');
            log('Type a command and press Enter:');
            
            // Set up manual command input
            process.stdin.setEncoding('utf8');
                         process.stdin.on('data', async (data) => {
                 const command = data.toString().trim();
                 if (command === 'quit') {
                     log('Exiting...');
                     process.exit(0);
                 } else if (command === 'get_groups') {
                    if (isFetchingGroups) {
                        log('Group fetch already in progress, skipping duplicate request');
                    } else {
                        isFetchingGroups = true;
                        fetchAndSendGroups()
                            .finally(() => {
                                isFetchingGroups = false;
                            })
                            .catch(err => log(`Error: ${err.message}`));
                    }
                                 } else if (command.startsWith('monitor ')) {
                    const groupId = command.substring(8);
                    selectedGroupId = groupId;
                    isMonitoring = true;
                    log(`Started monitoring group: ${groupId}`);
                    log(`Monitoring state - isMonitoring: ${isMonitoring}, selectedGroupId: ${selectedGroupId}, isConnected: ${isConnected}`);
                 } else if (command === 'stop_monitoring') {
                     isMonitoring = false;
                     selectedGroupId = null;
                     log('Stopped monitoring');
                                   } else if (command === 'logout') {
                     handleLogout().catch(err => log(`Error: ${err.message}`));
                 } else if (command) {
                     log(`Unknown command: ${command}`);
                 }
             });
        } else {
            // Set up command handling for C# integration
            log('Setting up stdin listener...');
            process.stdin.on('data', handleCommand);
            process.stdin.on('error', (error) => {
                log(`Stdin error: ${error.message}`);
            });
            process.stdin.on('end', () => {
                log('Stdin ended');
            });
            log('Stdin listener set up');
        }
        
                 // Handle graceful shutdown
         process.on('SIGINT', async () => {
             log('SIGINT received, shutting down gracefully');
             if (client) {
                 await handleLogout();
             } else {
                 process.exit(0);
             }
         });
        
    } catch (error) {
        log(`Fatal error in main function: ${error.message}`);
        log(`Stack: ${error.stack}`);
        sendToHost({ type: 'error', message: `Fatal error: ${error.message}` });
        process.exit(1);
    }
}

main();
