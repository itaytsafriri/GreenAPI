const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

// Logging setup
const logStream = fs.createWriteStream(path.join(__dirname, 'node_debug.log'), { flags: 'a' });
const log = (message) => {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] ${message}\n`;
    logStream.write(formattedMessage);
    console.log(`[${timestamp}] ${message}`);
};

log('=== WAload Node.js Service Starting ===');
log(`Node.js version: ${process.version}`);
log(`Script path: ${__dirname}`);

// Global state
let client = null;
let isMonitoring = false;
let selectedGroupId = null;
let lastQrTimestamp = 0;
let isFetchingGroups = false; // Flag to prevent multiple simultaneous group fetches
let isRefreshing = false; // Flag to prevent operations during page refresh

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

// Standalone mode functions
function showQRInTerminal(qr) {
    console.log('\n=== SCAN THIS QR CODE WITH YOUR PHONE ===');
    qrcode.generate(qr, { small: true });
    console.log('=== QR CODE ABOVE ===\n');
}

function createClient() {
    log('Creating WhatsApp client...');
    
    // Find Chromium executable
    let chromiumPath = path.join(__dirname, 'node_modules', 'puppeteer-core', '.local-chromium', 'win64-1045629', 'chrome-win', 'chrome.exe');
    
    if (!fs.existsSync(chromiumPath)) {
        const altPath = path.join(__dirname, 'chrome-win', 'chrome.exe');
        if (fs.existsSync(altPath)) {
            chromiumPath = altPath;
            log(`Using alternative Chromium path: ${chromiumPath}`);
        } else {
            log('Warning: Chromium not found, using system default');
            chromiumPath = undefined;
        }
    } else {
        log(`Using Chromium at: ${chromiumPath}`);
    }
    
    const client = new Client({
        puppeteer: {
            headless: true,
            executablePath: chromiumPath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ],
            timeout: 60000
        },
        authStrategy: new LocalAuth({
            clientId: 'waload-client',
            dataPath: path.join(__dirname, '.wwebjs_auth')
        }),
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        }
    });
    
    log('Client created successfully');
    return client;
}

async function waitForClientReady(client) {
    return new Promise(resolve => {
        if (client.info && client.info.wid) {
            log('Client already ready');
            resolve();
            return;
        }
        
        log('Waiting for client ready event...');
        client.once('ready', () => {
            log('Client ready event received');
            resolve();
        });
    });
}

async function dismissIntroPopup(page) {
    log('Checking for intro popup...');
    
    try {
        await page.waitForTimeout(2000);
        
        const selectors = [
            // New WhatsApp Web interface selectors
            'button:has-text("המשך")', // Hebrew "Continue" button
            'button:has-text("Continue")', // English "Continue" button
            'button[data-testid="intro-text"]',
            'button:has-text("Got it")',
            'button:has-text("OK")',
            '[data-testid="intro-text"]',
            '.intro-text button',
            // Additional selectors for new interface
            'div[role="dialog"] button',
            'div[data-testid="modal"] button',
            'button[aria-label*="Continue"]',
            'button[aria-label*="המשך"]'
        ];
        
        for (const selector of selectors) {
            try {
                const button = await page.$(selector);
                if (button) {
                    log(`Found button with selector: ${selector}`);
                    await button.click();
                    log('Intro popup dismissed');
                    return true;
                }
            } catch (e) {
                // Continue to next selector
            }
        }
        
        // Try to find any visible button in modal/popup
        try {
            const modalButtons = await page.$$('div[role="dialog"] button, div[data-testid="modal"] button, .modal button');
            for (const button of modalButtons) {
                const isVisible = await button.isVisible();
                if (isVisible) {
                    const buttonText = await button.textContent();
                    log(`Found visible modal button: "${buttonText}"`);
                    await button.click();
                    log('Modal popup dismissed');
                    return true;
                }
            }
        } catch (e) {
            // Continue to next method
        }
        
        log('No intro popup found');
        return false;
        
    } catch (error) {
        log(`Error checking for intro popup: ${error.message}`);
        return false;
    }
}

async function getChatsWithRetry(client, maxAttempts = 5) {
    const startTime = Date.now();
    log(`[${new Date().toISOString()}] Getting chats with improved retry logic...`);
    
    const page = client.pupPage;
    let refreshCounter = 0;
    
    // Wait for client to be fully ready before starting
    log(`[${new Date().toISOString()}] Waiting for client to be fully ready...`);
    await waitForClientReady(client);
    
    // Stabilization period: Wait 10 seconds for connection to stabilize
    log(`[${new Date().toISOString()}] Connection stabilized, waiting 10 seconds for WhatsApp Web to fully load...`);
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Skip proactive refresh - let WhatsApp Web load naturally to avoid execution context issues
    log(`[${new Date().toISOString()}] Skipping proactive refresh to prevent execution context destruction`);
    log(`[${new Date().toISOString()}] Allowing WhatsApp Web to load naturally...`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        log(`Attempt ${attempt} of ${maxAttempts}`);
        
        // Only refresh on the last attempt if all others failed (much less aggressive)
        if (attempt === maxAttempts && page && !isRefreshing) {
            isRefreshing = true;
            refreshCounter++;
            log(`Final attempt - refreshing page (refresh #${refreshCounter}) as last resort...`);
            try {
                // Cancel any pending operations before refresh
                log('Cancelling pending operations before refresh...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                await page.reload({ waitUntil: 'networkidle0' });
                log('Page refreshed, waiting for client ready...');
                await waitForClientReady(client);
                log('Client ready after refresh');
                
                // Longer wait after refresh to ensure stability
                log('Waiting 8 seconds after refresh for full stabilization...');
                await new Promise(resolve => setTimeout(resolve, 8000));
            } catch (refreshError) {
                log(`Refresh failed: ${refreshError.message}`);
                // Don't throw here, let the attempt continue
            } finally {
                isRefreshing = false;
            }
        }
        
        try {
            // Skip this attempt if page is being refreshed
            if (isRefreshing) {
                log('Page is being refreshed, skipping this attempt...');
                if (attempt < maxAttempts) {
                    log('Waiting 5 seconds for refresh to complete...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                continue;
            }
            
            // Check if client is still ready before attempting getChats
            if (!client.info || !client.info.wid) {
                log('Client not ready, waiting...');
                await waitForClientReady(client);
            }
            
            // Dismiss popups before attempting getChats (this might be blocking the API)
            if (page && attempt === 1) {
                try {
                    log('Dismissing any popups before getChats...');
                    await dismissIntroPopup(page);
                } catch (popupError) {
                    log(`Error dismissing popups: ${popupError.message}`);
                }
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
                           typeof chat.id === 'object' && 
                           chat.id._serialized &&
                           typeof chat.id._serialized === 'string' &&
                           chat.id._serialized.length > 0;
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
            } else if (error.message.includes('Page crashed!')) {
                log('Page crashed. Will attempt to re-initialize.');
                throw error;
            } else if (error.message.includes('Execution context was destroyed')) {
                log('Execution context destroyed during page refresh - this is expected, waiting for page to stabilize...');
                // Wait longer for page to fully reload and stabilize
                if (attempt < maxAttempts) {
                    log('Waiting 10 seconds for page refresh to complete...');
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            } else if (error.message.includes('Protocol error')) {
                log('Protocol error detected - likely due to page refresh, waiting for stabilization...');
                if (attempt < maxAttempts) {
                    log('Waiting 8 seconds for protocol to stabilize...');
                    await new Promise(resolve => setTimeout(resolve, 8000));
                }
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
            log('Page is being refreshed, skipping group fetch to prevent execution context issues');
            return;
        }
        
        isFetchingGroups = true;
        
        // Add a longer initial wait before first fetch
        log('Waiting 10 seconds to ensure WhatsApp Web is fully loaded...');
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
                .filter(chat => chat.isGroup)
                .map(chat => ({
                    id: chat.id._serialized,
                    name: chat.name || chat.formattedTitle || 'Unknown Group'
                }));
            log(`Found ${groups.length} groups from chats`);
        } else {
            log('No groups found in chats, trying alternative method...');
            try {
                // Try to get groups directly from the page
                if (client.pupPage) {
                    const pageGroups = await client.pupPage.evaluate(() => {
                        try {
                            if (window.Store && window.Store.Chat && window.Store.Chat.models) {
                                const allChats = Array.from(window.Store.Chat.models.values());
                                const groups = allChats.filter(chat => chat.isGroup);
                                return groups.map(group => ({
                                    id: group.id._serialized,
                                    name: group.name || group.formattedTitle || 'Unknown Group'
                                }));
                            }
                            return [];
                        } catch (e) {
                            console.error('Error getting groups from page:', e);
                            return [];
                        }
                    });
                    if (pageGroups && pageGroups.length > 0) {
                        log(`Found ${pageGroups.length} groups from page`);
                        groups = pageGroups;
                    } else {
                        log('No groups found from page fallback.');
                    }
                }
            } catch (error) {
                log(`Alternative group method failed: ${error.message}`);
            }
        }
        // Always try contacts fallback if no groups found
        if (groups.length === 0) {
            log('Still no groups, trying contacts fallback...');
            try {
                const contacts = await client.getContacts();
                const groupContacts = contacts.filter(contact => contact.isGroup);
                groups = groupContacts.map(contact => ({
                    id: contact.id._serialized,
                    name: contact.name || contact.pushname || 'Unknown Group'
                }));
                log(`Found ${groups.length} groups from contacts`);
            } catch (error) {
                log(`Contacts fallback failed: ${error.message}`);
            }
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

function setupEventListeners() {
    // QR Code event
    client.on('qr', (qr) => {
        const now = Date.now();
        if (now - lastQrTimestamp > 5000) {
            log('QR code received');
            showQRInTerminal(qr);
            sendToHost({ type: 'qr', qr });
            lastQrTimestamp = now;
        }
    });
    
    // Ready event
    client.on('ready', async () => {
        log('Client is ready!');
        const userName = client.info.pushname;
        const userPlatform = client.info.platform;
        log(`Logged in as ${userName} on ${userPlatform}`);
        
        // Dismiss any intro popups
        if (client.pupPage) {
            await dismissIntroPopup(client.pupPage);
        }
        
        sendToHost({ type: 'status', connected: true });
        sendToHost({ type: 'userName', name: userName });
    });
    
    // Disconnected event
    client.on('disconnected', (reason) => {
        log(`Client disconnected: ${reason}`);
        isMonitoring = false;
        selectedGroupId = null;
        sendToHost({ type: 'status', connected: false });
        sendToHost({ type: 'monitoringStatus', monitoring: false });
    });
    
    // Message events
    client.on('message', async (msg) => {
        if (!isMonitoring || !selectedGroupId) return;
        
        try {
            const chat = await msg.getChat();
            if (chat.id._serialized === selectedGroupId) {
                // Handle media messages
                if (msg.hasMedia) {
                    log('Media message received from monitored group');
                    
                    const media = await msg.downloadMedia();
                    if (media) {
                        const mediaType = media.mimetype.split('/')[0];
                        // Only process image, video, audio, and voice messages
                        if (['image', 'video', 'audio', 'voice'].includes(mediaType)) {
                            const contact = await msg.getContact();
                            const timestamp = new Date(msg.timestamp * 1000).toISOString()
                                .replace(/[-:]/g, '')
                                .split('.')[0]
                                .replace('T', '_');
                            const senderName = (contact.pushname || contact.name || contact.number || 'unknown')
                                .replace(/[<>:"/\\|?*]/g, '_') // Only remove truly problematic file system characters
                                .replace(/\s+/g, '_') // Replace spaces with underscores
                                .replace(/_{2,}/g, '_') // Replace multiple consecutive underscores with single
                                .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
                            const extension = media.mimetype.split('/')[1];
                            
                            log(`Sending media to host - Size: ${media.size}`);
                            sendToHost({
                                type: 'media',
                                Media: {
                                    Id: msg.id.id,
                                    From: msg.from,
                                    Author: msg.author,
                                    Type: media.mimetype,
                                    Timestamp: msg.timestamp,
                                    Filename: `${senderName}_${timestamp}.${extension}`,
                                    Data: media.data,
                                    Size: media.size,
                                    SenderName: contact.pushname || contact.name || contact.number,
                                    Body: msg.body || '' // Muli feature - Include message body/caption
                                }
                            });
                        }
                    }
                }
                // Handle text messages
                else if (msg.body && msg.body.trim()) {
                    log('Text message received from monitored group');
                    
                    const contact = await msg.getContact();
                    log(`Sending text message to host - Text: ${msg.body.substring(0, 100)}...`);
                    sendToHost({
                        type: 'text',
                        Text: {
                            Id: msg.id.id,
                            From: msg.from,
                            Author: msg.author,
                            Type: 'text',
                            Timestamp: msg.timestamp,
                            Text: msg.body,
                            SenderName: contact.pushname || contact.name || contact.number
                        }
                    });
                }
            }
        } catch (e) {
            log(`Error in message handler: ${e.message}`);
        }
    });
    
    // Update message_create handler with the same logic
    client.on('message_create', async (msg) => {
        if (!isMonitoring || !selectedGroupId) return;
        
        try {
            const chat = await msg.getChat();
            if (chat.id._serialized === selectedGroupId) {
                // Handle media messages
                if (msg.hasMedia) {
                    log('Media message received from monitored group (message_create)');
                    
                    const media = await msg.downloadMedia();
                    if (media) {
                        const mediaType = media.mimetype.split('/')[0];
                        // Only process image, video, audio, and voice messages
                        if (['image', 'video', 'audio', 'voice'].includes(mediaType)) {
                            const contact = await msg.getContact();
                            const timestamp = new Date(msg.timestamp * 1000).toISOString()
                                .replace(/[-:]/g, '')
                                .split('.')[0]
                                .replace('T', '_');
                            const senderName = (contact.pushname || contact.name || contact.number || 'unknown')
                                .replace(/[<>:"/\\|?*]/g, '_') // Only remove truly problematic file system characters
                                .replace(/\s+/g, '_') // Replace spaces with underscores
                                .replace(/_{2,}/g, '_') // Replace multiple consecutive underscores with single
                                .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
                            const extension = media.mimetype.split('/')[1];
                            
                            log(`Sending media to host (message_create) - Size: ${media.size}`);
                            sendToHost({
                                type: 'media',
                                Media: {
                                    Id: msg.id.id,
                                    From: msg.from,
                                    Author: msg.author,
                                    Type: media.mimetype,
                                    Timestamp: msg.timestamp,
                                    Filename: `${senderName}_${timestamp}.${extension}`,
                                    Data: media.data,
                                    Size: media.size,
                                    SenderName: contact.pushname || contact.name || contact.number,
                                    Body: msg.body || '' // Muli feature - Include message body/caption
                                }
                            });
                        }
                    }
                }
                // Handle text messages
                else if (msg.body && msg.body.trim()) {
                    log('Text message received from monitored group (message_create)');
                    
                    const contact = await msg.getContact();
                    log(`Sending text message to host (message_create) - Text: ${msg.body.substring(0, 100)}...`);
                    sendToHost({
                        type: 'text',
                        Text: {
                            Id: msg.id.id,
                            From: msg.from,
                            Author: msg.author,
                            Type: 'text',
                            Timestamp: msg.timestamp,
                            Text: msg.body,
                            SenderName: contact.pushname || contact.name || contact.number
                        }
                    });
                }
            }
        } catch (e) {
            log(`Error in message_create handler: ${e.message}`);
        }
    });
}

async function initialize() {
    log('Initializing WhatsApp client...');
    
    try {
        client = createClient();
        setupEventListeners();
        
        log('Starting client initialization...');
        await client.initialize();
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
            
            await client.destroy();
            log('Client destroyed');
            
        } catch (error) {
            log(`Error during logout: ${error.message}`);
        }
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