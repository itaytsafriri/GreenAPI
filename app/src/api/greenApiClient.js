const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

// Hardcoded GreenAPI credentials
const idInstance = '7103899702';
const apiTokenInstance = 'cf5010eda4fd493f99b6b6d367bfd911b56d9d43041b44f3b3';
const baseUrl = 'https://api.greenapi.com';

// Logging setup - exact same as whatsapp.js
const logStream = fs.createWriteStream(path.join(__dirname, 'node_debug.log'), { flags: 'a' });
const log = (message) => {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] ${message}\n`;
    logStream.write(formattedMessage);
    console.log(`[${timestamp}] ${message}`);
};

log('=== GreenAPI Node.js Service Starting ===');
log(`Node.js version: ${process.version}`);
log(`Script path: ${__dirname}`);

// Global state - exact same as whatsapp.js
let client = null;
let isMonitoring = false;
let selectedGroupId = null;
let lastQrTimestamp = 0;
let isFetchingGroups = false;
let isRefreshing = false;
let qrPollingInterval = null;
let notificationPollingInterval = null;
let isConnected = false;
let currentQr = null;
let qrShownOnce = false;

// Error handling - exact same as whatsapp.js
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

// Standalone mode functions - exact same as whatsapp.js
function showQRInTerminal(qr) {
    console.log('\n=== SCAN THIS QR CODE WITH YOUR PHONE ===');
    qrcode.generate(qr, { small: true });
    console.log('=== QR CODE ABOVE ===\n');
}

// GreenAPI HTTP request helper
async function makeApiRequest(endpoint, options = {}) {
    const url = `${baseUrl}/waInstance${idInstance}/${endpoint}/${apiTokenInstance}`;
    
    const defaultOptions = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    };

    try {
        const response = await fetch(url, { ...defaultOptions, ...options });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`${endpoint} failed: ${response.status} - ${errorText}`);
        }

        // Handle empty responses
        if (response.status === 204) {
            return null;
        }

        try {
            return await response.json();
        } catch (e) {
            // Some endpoints return empty responses
            return null;
        }
    } catch (error) {
        throw new Error(`API request failed for ${endpoint}: ${error.message}`);
    }
}

// GreenAPI Client class
class GreenApiClient {
    constructor() {
        this.idInstance = idInstance;
        this.apiTokenInstance = apiTokenInstance;
        this.baseUrl = baseUrl;
    }

    async getStateInstance() {
        return await makeApiRequest('getStateInstance');
    }

    async getQr() {
        return await makeApiRequest('qr');
    }

    async getChats() {
        return await makeApiRequest('getChats', {
            method: 'POST',
            body: JSON.stringify({})
        });
    }

    async receiveNotification() {
        try {
            return await makeApiRequest('receiveNotification');
        } catch (error) {
            if (error.message.includes('502') || error.message.includes('204')) {
                return null;
            }
            throw error;
        }
    }

    async deleteNotification(receiptId) {
        return await makeApiRequest(`deleteNotification/${receiptId}`, {
            method: 'DELETE'
        });
    }

    async downloadFile(idMessage, chatId) {
        return await makeApiRequest('downloadFile', {
            method: 'POST',
            body: JSON.stringify({ idMessage, chatId })
        });
    }

    async logout() {
        return await makeApiRequest('logout', {
            method: 'POST',
            body: JSON.stringify({})
        });
    }
}

function createClient() {
    log('Creating GreenAPI client...');
    const client = new GreenApiClient();
    log('Client created successfully');
    return client;
}

async function waitForClientReady(client) {
    return new Promise(async (resolve) => {
        if (isConnected) {
            log('Client already ready');
            resolve();
            return;
        }
        
        log('Waiting for client ready state...');
        
        // Poll for ready state
        const checkReady = async () => {
            try {
                const state = await client.getStateInstance();
                if (state && state.stateInstance === 'authorized') {
                    log('Client ready state achieved');
                    isConnected = true;
                    resolve();
                    return;
                }
            } catch (error) {
                // Continue polling
            }
            
            setTimeout(checkReady, 2000);
        };
        
        checkReady();
    });
}

// QR Code polling - mimics whatsapp.js QR events
async function startQrPolling() {
    log('Starting QR code polling...');
    
    const pollQr = async () => {
        try {
            // Add delay to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const state = await client.getStateInstance();
            log(`Connection state: ${state ? state.stateInstance : 'unknown'}`);
            
            if (state && state.stateInstance === 'authorized') {
                log('Instance is authorized, stopping QR polling');
                if (qrPollingInterval) {
                    clearInterval(qrPollingInterval);
                    qrPollingInterval = null;
                }
                isConnected = true;
                
                // Trigger ready event equivalent
                log('Client is ready!');
                sendToHost({ type: 'status', connected: true });
                sendToHost({ type: 'userName', name: 'GreenAPI User' });
                return;
            }
            
            if (state && state.stateInstance === 'notAuthorized') {
                try {
                    // Add delay before QR request
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    const qrData = await client.getQr();
                    if (qrData && qrData.message) {
                        const qr = qrData.message;
                        
                        // Only show QR once unless it changes or 60 seconds have passed
                        const now = Date.now();
                        if (!qrShownOnce || qr !== currentQr || (now - lastQrTimestamp > 60000)) {
                            log('QR code received');
                            showQRInTerminal(qr);
                            sendToHost({ type: 'qr', qr });
                            lastQrTimestamp = now;
                            currentQr = qr;
                            qrShownOnce = true;
                        }
                    }
                } catch (qrError) {
                    log(`Error getting QR: ${qrError.message}`);
                }
            }
        } catch (error) {
            log(`Error in QR polling: ${error.message}`);
        }
    };
    
    // Initial poll
    await pollQr();
    
    // Set up exactly 10-second interval polling as requested
    qrPollingInterval = setInterval(pollQr, 10000);
}

// Notification polling - mimics whatsapp.js message events
async function startNotificationPolling() {
    log('Starting notification polling...');
    
    const pollNotifications = async () => {
        if (!isConnected) {
            return;
        }
        
        try {
            const notification = await client.receiveNotification();
            
            if (notification && notification.body) {
                const messageData = notification.body;
                log(`Received notification: ${JSON.stringify(messageData, null, 2)}`);
                
                // Check if we're monitoring and if message is from monitored group
                if (isMonitoring && selectedGroupId && messageData.senderData && messageData.senderData.chatId === selectedGroupId) {
                    log(`Message from monitored group ${selectedGroupId}`);
                    await processMessage(messageData, notification.receiptId);
                } else if (messageData.senderData) {
                    log(`Message from ${messageData.senderData.chatId} - not monitoring this group`);
                }
                
                // Always delete the notification
                if (notification.receiptId) {
                    try {
                        await client.deleteNotification(notification.receiptId);
                    } catch (deleteError) {
                        log(`Error deleting notification: ${deleteError.message}`);
                    }
                }
            }
        } catch (error) {
            if (!error.message.includes('502') && !error.message.includes('204')) {
                log(`Error in notification polling: ${error.message}`);
            }
        }
    };
    
    // Set up 2-second interval polling to reduce rate limiting
    notificationPollingInterval = setInterval(pollNotifications, 2000);
}

async function processMessage(messageData, receiptId) {
    try {
        const messageType = messageData.typeMessage;
        const timestamp = messageData.timestamp;
        const senderName = messageData.senderData.senderName || messageData.senderData.sender || 'Unknown';
        const chatId = messageData.senderData.chatId;
        const author = messageData.senderData.sender;
        
        // Handle text messages
        if (messageType === 'textMessage' && messageData.textMessageData) {
            log('Text message received from monitored group');
            
            const messageText = messageData.textMessageData.textMessage;
            log(`Sending text message to host - Text: ${messageText.substring(0, 100)}...`);
            
            sendToHost({
                type: 'text',
                Text: {
                    Id: receiptId,
                    From: chatId,
                    Author: author,
                    Type: 'text',
                    Timestamp: timestamp,
                    Text: messageText,
                    SenderName: senderName
                }
            });
        }
        // Handle media messages (image, video, audio, document)
        else if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType)) {
            log('Media message received from monitored group');
            
            try {
                // Download the media file
                const downloadResult = await client.downloadFile(messageData.idMessage, chatId);
                
                if (downloadResult && downloadResult.downloadUrl) {
                    // Fetch the actual file data
                    const fileResponse = await fetch(downloadResult.downloadUrl);
                    const arrayBuffer = await fileResponse.arrayBuffer();
                    const base64Data = Buffer.from(arrayBuffer).toString('base64');
                    
                    // Determine media type and extension
                    let mediaType, extension, mimetype;
                    if (messageType === 'imageMessage') {
                        mediaType = 'image';
                        extension = 'jpg';
                        mimetype = 'image/jpeg';
                    } else if (messageType === 'videoMessage') {
                        mediaType = 'video';
                        extension = 'mp4';
                        mimetype = 'video/mp4';
                    } else if (messageType === 'audioMessage') {
                        mediaType = 'audio';
                        extension = 'ogg';
                        mimetype = 'audio/ogg';
                    } else if (messageType === 'documentMessage') {
                        mediaType = 'document';
                        extension = 'pdf';
                        mimetype = 'application/pdf';
                    }
                    
                    // Create filename with timestamp and sender name (same format as whatsapp.js)
                    const timestampFormatted = new Date(timestamp * 1000).toISOString()
                        .replace(/[-:]/g, '')
                        .split('.')[0]
                        .replace('T', '_');
                    const senderNameFormatted = senderName
                        .replace(/[<>:"/\\|?*]/g, '_')
                        .replace(/\s+/g, '_')
                        .replace(/_{2,}/g, '_')
                        .replace(/^_|_$/g, '');
                    
                    const filename = `${senderNameFormatted}_${timestampFormatted}.${extension}`;
                    
                    log(`Sending media to host - Size: ${base64Data.length}`);
                    sendToHost({
                        type: 'media',
                        Media: {
                            Id: receiptId,
                            From: chatId,
                            Author: author,
                            Type: mimetype,
                            Timestamp: timestamp,
                            Filename: filename,
                            Data: base64Data,
                            Size: base64Data.length,
                            SenderName: senderName,
                            Body: messageData.textMessageData ? messageData.textMessageData.textMessage : ''
                        }
                    });
                }
            } catch (mediaError) {
                log(`Error processing media message: ${mediaError.message}`);
            }
        }
    } catch (error) {
        log(`Error processing message: ${error.message}`);
    }
}

async function getChatsWithRetry(client, maxAttempts = 5) {
    const startTime = Date.now();
    log(`[${new Date().toISOString()}] Getting chats with improved retry logic...`);
    
    // Wait for client to be fully ready before starting
    log(`[${new Date().toISOString()}] Waiting for client to be fully ready...`);
    await waitForClientReady(client);
    
    // Stabilization period: Wait 10 seconds for connection to stabilize
    log(`[${new Date().toISOString()}] Connection stabilized, waiting 10 seconds for GreenAPI to fully load...`);
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        log(`Attempt ${attempt} of ${maxAttempts}`);
        
        try {
            // Check if client is still ready before attempting getChats
            if (!isConnected) {
                log('Client not ready, waiting...');
                await waitForClientReady(client);
            }
            
            // Set a timeout for this attempt
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Timeout')), 30000); // 30 second timeout
            });
            
            log('Calling client.getChats()...');
            const getChatsPromise = client.getChats();
            
            const chats = await Promise.race([getChatsPromise, timeoutPromise]);
            
            if (!chats || chats.length === 0) {
                log(`Attempt ${attempt} returned no chats`);
                if (attempt < maxAttempts) {
                    log('Waiting 3 seconds before next attempt...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
                continue;
            }
            
            // Validate chats more thoroughly
            const validChats = chats.filter(chat => {
                try {
                    return chat && 
                           chat.id && 
                           typeof chat.id === 'string' &&
                           chat.id.length > 0;
                } catch (e) {
                    return false;
                }
            });
            
            const invalidChats = chats.length - validChats.length;
            if (invalidChats > 0) {
                log(`Filtered out ${invalidChats} invalid chat entries.`);
            }
            
            if (validChats.length > 0) {
                log(`Success on attempt ${attempt}. Found ${validChats.length} valid chats.`);
                return validChats;
            } else {
                log(`Attempt ${attempt} resulted in 0 valid chats.`);
                if (attempt < maxAttempts) {
                    log('Waiting 3 seconds before next attempt...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
            
        } catch (error) {
            log(`Error on attempt ${attempt}: ${error.message}`);
            if (error.message.includes('Timeout')) {
                log('getChats() call timed out.');
            } else {
                // Generic error handling
                if (attempt < maxAttempts) {
                    log('Waiting 3 seconds before retrying...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
        }
    }
    
    log('All attempts failed to get chats');
    return [];
}

async function fetchAndSendGroups() {
    log('Fetching groups...');
    try {
        // Check if already fetching to prevent multiple simultaneous fetches
        if (isFetchingGroups) {
            log('Group fetch already in progress, skipping duplicate request');
            return;
        }
        
        // Check if page is being refreshed
        if (isRefreshing) {
            log('Service is being refreshed, skipping group fetch to prevent issues');
            return;
        }
        
        isFetchingGroups = true;
        
        // Add a longer initial wait before first fetch
        log('Waiting 10 seconds to ensure GreenAPI is fully ready...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Add a timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Group fetch timeout after 60 seconds')), 60000);
        });
        
        const fetchPromise = getChatsWithRetry(client);
        let chats = [];
        try {
            chats = await Promise.race([fetchPromise, timeoutPromise]);
        } catch (err) {
            log(`getChatsWithRetry failed: ${err.message}`);
        }
        
        let groups = [];
        if (chats && chats.length > 0) {
            groups = chats
                .filter(chat => chat.id && chat.id.includes('@g.us'))
                .map(chat => ({
                    id: chat.id,
                    name: chat.name || 'Unknown Group'
                }));
            log(`Found ${groups.length} groups from chats`);
        } else {
            log('No groups found in chats');
        }
        
        log(`Final result: Found ${groups.length} groups`);
        sendToHost({ type: 'groups', groups });
    } catch (error) {
        log(`Error fetching groups: ${error.message}`);
        sendToHost({ type: 'groups', groups: [], error: error.message });
    } finally {
        // Always reset the flag when done
        isFetchingGroups = false;
        log('Group fetch completed, flag reset');
    }
}

async function initialize() {
    log('Initializing GreenAPI client...');
    
    try {
        client = createClient();
        
        log('Starting client initialization...');
        
        // Start QR polling
        await startQrPolling();
        
        // Start notification polling
        startNotificationPolling();
        
        log('Client initialization completed');
        
    } catch (error) {
        log(`!!!!!! CLIENT INITIALIZATION FAILED: ${error.message}`);
        log(`!!!!!! Stack: ${error.stack}`);
        sendToHost({ type: 'error', message: `Client initialization failed: ${error.message}` });
        process.exit(1);
    }
}

async function handleLogout() {
    log('Processing logout command');
    
    if (client) {
        try {
            log('Initiating logout...');
            await client.logout();
            log('Logout completed');
            
        } catch (error) {
            log(`Error during logout: ${error.message}`);
        }
    }
    
    // Clear intervals
    if (qrPollingInterval) {
        clearInterval(qrPollingInterval);
        qrPollingInterval = null;
    }
    if (notificationPollingInterval) {
        clearInterval(notificationPollingInterval);
        notificationPollingInterval = null;
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
            log(`Monitoring state - isMonitoring: ${isMonitoring}, selectedGroupId: ${selectedGroupId}, isConnected: ${isConnected}`);
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
            process.stdin.on('data', (data) => {
                const command = data.toString().trim();
                if (command === 'quit') {
                    log('Exiting...');
                    process.exit(0);
                } else if (command === 'get_groups') {
                    fetchAndSendGroups().catch(err => log(`Error: ${err.message}`));
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

if (require.main === module) {
    main();
}
