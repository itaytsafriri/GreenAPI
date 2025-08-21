import { useEffect, useMemo, useState, useRef } from 'react'
import './App.css'
import { GreenApiClient } from './api/greenApiClient'
import { useGreenApiNotifications } from './hooks/useGreenApiNotifications'

// Media component for handling different message types
function MediaMessage({ mediaType, fileId, fileName, chatId, client }) {
	const [mediaData, setMediaData] = useState(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);

	useEffect(() => {
		if (!mediaType || !fileId || !chatId || mediaData || error) return;

		setLoading(true);
		setError(false);

		console.log('Downloading media:', { mediaType, fileId, chatId });

		// Try downloadFile first, then getFile as fallback
		client.downloadFile(fileId, chatId)
			.then(response => {
				console.log('Download response:', response);
				if (response && response.urlFile) {
					setMediaData(response.urlFile);
				} else if (response && response.url) {
					setMediaData(response.url);
				} else if (response && response.downloadUrl) {
					setMediaData(response.downloadUrl);
				} else if (response && response.fileUrl) {
					setMediaData(response.fileUrl);
				} else if (typeof response === 'string' && response.startsWith('http')) {
					setMediaData(response);
				} else {
					console.error('Unexpected response structure:', response);
					throw new Error('No valid URL in response');
				}
			})
			.catch(err => {
				console.error('downloadFile failed, trying getFile:', err);
				// Try getFile as fallback
				return client.getFile(fileId, chatId);
			})
			.then(response => {
				if (response && response.urlFile) {
					setMediaData(response.urlFile);
				} else if (response && response.url) {
					setMediaData(response.url);
				} else if (response && response.downloadUrl) {
					setMediaData(response.downloadUrl);
				} else if (response && response.fileUrl) {
					setMediaData(response.fileUrl);
				} else if (typeof response === 'string' && response.startsWith('http')) {
					setMediaData(response);
				} else {
					console.error('Unexpected response structure:', response);
					throw new Error('No valid URL in response');
				}
			})
			.catch(err => {
				console.error('Both downloadFile and getFile failed:', err);
				console.error('Error details:', {
					message: err.message,
					stack: err.stack,
					fileId,
					mediaType
				});
				setError(true);
			})
			.finally(() => {
				setLoading(false);
			});
	}, [mediaType, fileId, chatId, mediaData, error, client]);

	if (loading) {
		return (
			<div className="media-loading">
				<div className="loading-spinner"></div>
				<span>Loading {mediaType.replace('Message', '')}...</span>
			</div>
		);
	}

	if (error) {
		return (
			<div className="media-error">
				{mediaType === 'imageMessage' && '📷 Image (Failed to load)'}
				{mediaType === 'videoMessage' && '🎥 Video (Failed to load)'}
				{mediaType === 'audioMessage' && '🎵 Audio (Failed to load)'}
				{mediaType === 'documentMessage' && '📎 Document (Failed to load)'}
			</div>
		);
	}

	if (!mediaData) return null;

	switch (mediaType) {
		case 'imageMessage':
			return (
				<div className="media-container">
					<img 
						src={mediaData} 
						alt="Image" 
						className="media-image"
						onError={() => setError(true)}
					/>
				</div>
			);
		case 'videoMessage':
			return (
				<div className="media-container">
					<video 
						src={mediaData} 
						controls 
						className="media-video"
						onError={() => setError(true)}
					/>
				</div>
			);
		case 'audioMessage':
			return (
				<div className="media-container">
					<audio 
						src={mediaData} 
						controls 
						className="media-audio"
						onError={() => setError(true)}
					/>
				</div>
			);
		case 'documentMessage':
			return (
				<div className="media-container">
					<div className="document-preview">
						📎 {fileName || 'Document'}
						<a href={mediaData} target="_blank" rel="noopener noreferrer" className="download-link">
							Download
						</a>
					</div>
				</div>
			);
		default:
			return null;
	}
}

// Message bubble component
function MessageBubble({ message, client }) {
	const { text, mediaType, fileId, fileName, own, time, chatId } = message;

	return (
		<div className={`message-bubble ${own ? 'own' : 'other'}`}>
			<div className="message-content">
				{mediaType && fileId && (
					<MediaMessage 
						mediaType={mediaType} 
						fileId={fileId} 
						fileName={fileName} 
						chatId={chatId}
						client={client}
					/>
				)}
				{text && <div className="message-text">{text}</div>}
				<div className="message-time">{time}</div>
			</div>
		</div>
	);
}

// Group list item component
function GroupItem({ group, isSelected, onClick }) {
	return (
		<div 
			className={`group-item ${isSelected ? 'selected' : ''}`}
			onClick={onClick}
		>
			<div className="group-avatar">
				👥
			</div>
			<div className="group-info">
				<div className="group-name">{group.name}</div>
				<div className="group-id">{group.id}</div>
			</div>
		</div>
	);
}

// QR Code component
function QRCode({ qrSrc, authState, error, onRefresh, onTestAPI, onLogout }) {
	console.log('QRCode component - qrSrc:', qrSrc ? 'Has QR data' : 'No QR data');
	console.log('QRCode component - authState:', authState);
	
	const showQrPlaceholder = !qrSrc && authState !== 'authorized';
	const isConnected = authState === 'authorized';
	
	return (
		<div className="auth-container">
			<div className="auth-card">
				<h2>WhatsApp Groups</h2>
				
				{isConnected ? (
					<>
						<p className="auth-description">
							✅ Connected! Loading groups...
						</p>
						<div className="auth-status">
							State: {authState}
						</div>
					</>
				) : (
					<>
						<p className="auth-description">
							Scan this QR code with WhatsApp to connect
						</p>
						
						{qrSrc ? (
							<img src={qrSrc} alt="WhatsApp QR" className="qr-code" />
						) : showQrPlaceholder ? (
							<div className="qr-placeholder">
								Loading QR...
							</div>
						) : (
							<div className="qr-placeholder">
								Checking connection status...
							</div>
						)}
						
						<div className="auth-status">
							State: {authState}
						</div>
					</>
				)}
				
				{error && (
					<div className="auth-error">
						{error}
					</div>
				)}
				
				<div className="auth-info">
					Rate limiting: Active (8 requests/min)
				</div>
				
				<div className="auth-actions">
					<button onClick={onRefresh} className="btn btn-primary">
						Refresh Page
					</button>
					<button onClick={onTestAPI} className="btn btn-secondary">
						Test API
					</button>
					{authState !== 'notAuthorized' && (
						<button onClick={onLogout} className="btn btn-warning">
							Force Logout
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

// Main App component
function App() {
	const [authState, setAuthState] = useState('unknown');
	const [qrSrc, setQrSrc] = useState('');
	const [groups, setGroups] = useState([]);
	const [selectedGroup, setSelectedGroup] = useState(null);
	const [messages, setMessages] = useState([]);
	const [message, setMessage] = useState('');
	const [sending, setSending] = useState(false);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	// Initialize Green API client with your credentials
	const client = useMemo(() => new GreenApiClient({
		idInstance: '7103899702',
		apiTokenInstance: 'cf5010eda4fd493f99b6b6d367bfd911b56d9d43041b44f3b3',
	}), []);

	// Poll authorization state
	const lastStateCheck = useRef(0);
	const stateCheckInterval = useRef(null);
	const [showingQr, setShowingQr] = useState(false);

	useEffect(() => {
		async function updateState() {
			// Only do state checking if already authorized (for maintenance)
			if (authState !== 'authorized') {
				console.log('Skipping state check - not authorized yet');
				stateCheckInterval.current = setTimeout(updateState, 60000);
				return;
			}

			const now = Date.now();
			const timeSinceLastCheck = now - lastStateCheck.current;
			
			// Check every 5 minutes when authorized
			const minInterval = 300000;
			
			if (timeSinceLastCheck < minInterval) {
				const remainingTime = minInterval - timeSinceLastCheck;
				stateCheckInterval.current = setTimeout(updateState, remainingTime);
				return;
			}

			try {
				const data = await client.getStateInstance();
				const state = data?.stateInstance || 'unknown';
				console.log('Auth state maintenance check:', state);
				if (state !== 'authorized') {
					setAuthState(state);
				}
				setError('');
				lastStateCheck.current = now;
			} catch (e) {
				console.log('Auth state error:', e);
				if (e.message.includes('429')) {
					setError('Rate limited - waiting before retry...');
					stateCheckInterval.current = setTimeout(updateState, 60000);
					return;
				}
			}
			
			// Schedule next check
			stateCheckInterval.current = setTimeout(updateState, 300000);
		}
		
		updateState();
		return () => { 
			if (stateCheckInterval.current) {
				clearTimeout(stateCheckInterval.current);
			}
		};
	}, [client, authState]);

	// Fetch QR while not authorized
	const lastQrCheck = useRef(0);
	const qrCheckInterval = useRef(null);

	useEffect(() => {
		async function fetchQr() {
			const now = Date.now();
			const timeSinceLastCheck = now - lastQrCheck.current;
			
			const minInterval = 45000; // 45 seconds between QR checks
			
			if (timeSinceLastCheck < minInterval) {
				const remainingTime = minInterval - timeSinceLastCheck;
				qrCheckInterval.current = setTimeout(fetchQr, remainingTime);
				return;
			}

			try {
				console.log('Fetching QR, auth state:', authState);
				const data = await client.getQr();
				console.log('QR response:', data);
				console.log('QR response type:', data?.type);
				console.log('QR response message:', data?.message);
				console.log('Auth state:', authState);
				
				if (data?.type === 'qrCode' && data?.message && authState !== 'authorized') {
					console.log('Setting QR code with base64 data');
					setQrSrc(`data:image/png;base64,${data.message}`);
					setShowingQr(true);
					setError('');
				} else if (data?.type === 'alreadyLogged') {
					console.log('Instance already logged in - setting as authorized');
					setAuthState('authorized');
					setQrSrc('');
					setShowingQr(false);
					setError('');
					return; // Exit early, no need to continue QR polling
				} else {
					console.log('No QR code data available');
					setQrSrc('');
					setShowingQr(false);
				}
				lastQrCheck.current = now;
			} catch (e) {
				console.log('QR error:', e);
				setQrSrc('');
				if (e.message.includes('429')) {
					setError('QR rate limited - waiting before retry...');
					qrCheckInterval.current = setTimeout(fetchQr, 90000);
					return;
				} else if (e.message.includes('500')) {
					setError('QR server error - instance may be already connected');
				}
			}
			
			// Check if we might be authorized now (after potential QR scan)
			if (!qrSrc && authState !== 'authorized') {
				console.log('No QR available, checking if authorized...');
				try {
					const stateData = await client.getStateInstance();
					const currentState = stateData?.stateInstance || 'unknown';
					if (currentState === 'authorized') {
						console.log('Detected authorization!');
						setAuthState('authorized');
						setShowingQr(false);
						return;
					}
				} catch (stateErr) {
					console.log('Auth check failed:', stateErr);
				}
			}
			
			qrCheckInterval.current = setTimeout(fetchQr, 45000);
		}
		
		if (authState !== 'authorized') {
			fetchQr();
		} else {
			setQrSrc('');
			setShowingQr(false);
		}
		
		return () => { 
			if (qrCheckInterval.current) {
				clearTimeout(qrCheckInterval.current);
			}
		};
	}, [client, authState]);

	// Load groups once authorized
	useEffect(() => {
		async function loadGroups() {
			if (authState !== 'authorized') return;
			
			console.log('Loading groups, auth state:', authState);
			setLoading(true);
			try {
				setError('');
				const groupsList = await client.getGroups();
				console.log('Groups API response:', groupsList);
				
				if (Array.isArray(groupsList)) {
					const groupsWithNames = groupsList.map((group) => ({
						id: group.id || group.chatId,
						name: group.name || group.subject || group.id || group.chatId,
						raw: group
					}));
					console.log('Processed groups:', groupsWithNames);
					setGroups(groupsWithNames);
				} else {
					console.log('Groups response is not an array:', typeof groupsList, groupsList);
					setGroups([]);
				}
			} catch (e) {
				console.log('Groups error:', e);
				console.log('Error details:', {
					message: e.message,
					status: e.status,
					response: e.response
				});
				if (e.message.includes('403')) {
					setError('403 Forbidden: Instance may not have permission to access chats. Check Green API console settings.');
				} else if (e.message.includes('401')) {
					setError('401 Unauthorized: Check your API credentials and instance status.');
				} else {
					setError('Failed to load groups: ' + e.message);
				}
				setGroups([]);
			} finally {
				setLoading(false);
			}
		}
		loadGroups();
	}, [authState, client]);

	// Load messages when group is selected
	const messageLoadTimeout = useRef(null);
	const lastLoadedGroup = useRef(null);

	useEffect(() => {
		if (messageLoadTimeout.current) {
			clearTimeout(messageLoadTimeout.current);
		}

		messageLoadTimeout.current = setTimeout(async () => {
			if (!selectedGroup || authState !== 'authorized') return;
			
			if (lastLoadedGroup.current === selectedGroup.id) return;
			
			try {
				console.log('Loading messages for group:', selectedGroup.name, selectedGroup.id);
				const history = await client.getChatHistory(selectedGroup.id, 30);
				console.log('Chat history response:', history);
				
				// Debug: Log the first few messages to see their structure
				if (Array.isArray(history) && history.length > 0) {
					console.log('First message structure:', JSON.stringify(history[0], null, 2));
					const mediaMessages = history.filter(m => m.typeMessage && m.typeMessage.includes('Message') && m.typeMessage !== 'textMessage');
					if (mediaMessages.length > 0) {
						console.log('First media message structure:', JSON.stringify(mediaMessages[0], null, 2));
					}
				}
				
				if (Array.isArray(history)) {
					const normalized = history.map((m) => {
						let mediaType = null;
						let fileId = null;
						let fileName = null;
						let text = '';

						// Extract message content based on type
						if (m.typeMessage === 'imageMessage') {
							mediaType = 'imageMessage';
							fileId = m.imageMessageData?.idMessage || m.idMessage;
							text = m.caption || m.imageMessageData?.caption || '';
						} else if (m.typeMessage === 'videoMessage') {
							mediaType = 'videoMessage';
							fileId = m.videoMessageData?.idMessage || m.idMessage;
							text = m.caption || m.videoMessageData?.caption || '';
						} else if (m.typeMessage === 'audioMessage') {
							mediaType = 'audioMessage';
							fileId = m.audioMessageData?.idMessage || m.idMessage;
						} else if (m.typeMessage === 'documentMessage') {
							mediaType = 'documentMessage';
							fileId = m.documentMessageData?.idMessage || m.idMessage;
							fileName = m.fileName || m.documentMessageData?.fileName;
							text = m.caption || m.documentMessageData?.caption || '';
						} else if (m.typeMessage === 'textMessage') {
							text = m.textMessage || m.textMessageData?.textMessage || '';
						} else if (m.typeMessage === 'extendedTextMessage') {
							text = m.text || m.extendedTextMessageData?.text || '';
						} else {
							text = m.textMessage || m.text || '';
						}

						return {
							id: m.idMessage || `${m.timestamp}-${Math.random()}`,
							chatId: m.chatId,
							text: text,
							own: m.type === 'outgoing',
							time: new Date((m.timestamp || 0) * 1000).toLocaleTimeString(),
							mediaType,
							fileId,
							fileName
						};
					});
					setMessages(normalized);
				} else {
					console.log('History is not an array:', history);
					setMessages([]);
				}
			} catch (e) {
				console.log('Messages error:', e);
				setMessages([]);
			}
			
			lastLoadedGroup.current = selectedGroup?.id;
		}, 500);

		return () => {
			if (messageLoadTimeout.current) {
				clearTimeout(messageLoadTimeout.current);
			}
		};
	}, [selectedGroup, authState, client]);

	// Handle real-time notifications
	useGreenApiNotifications(client, {
		onEvent: async (notification) => {
			const body = notification?.body;
			if (!body) return;
			
			if (body.typeWebhook === 'stateInstanceChanged') {
				const newState = body.stateInstance || body?.stateAfter || body?.statusInstance;
				if (newState) setAuthState(newState);
				return;
			}
			
			if (body.typeWebhook === 'incomingMessageReceived') {
				const chatId = body.senderData?.chatId;
				const messageData = body.messageData;
				
				if (chatId && selectedGroup && chatId === selectedGroup.id) {
					let text = '';
					let mediaType = null;
					let fileId = null;
					let fileName = null;

					if (messageData?.typeMessage === 'textMessage') {
						text = messageData.textMessageData?.textMessage || '';
					} else if (messageData?.typeMessage === 'extendedTextMessage') {
						text = messageData.extendedTextMessageData?.text || '';
					} else if (messageData?.typeMessage === 'imageMessage') {
						mediaType = 'imageMessage';
						fileId = messageData.imageMessageData?.idMessage || body.idMessage;
						text = messageData.imageMessageData?.caption || '';
					} else if (messageData?.typeMessage === 'videoMessage') {
						mediaType = 'videoMessage';
						fileId = messageData.videoMessageData?.idMessage || body.idMessage;
						text = messageData.videoMessageData?.caption || '';
					} else if (messageData?.typeMessage === 'audioMessage') {
						mediaType = 'audioMessage';
						fileId = messageData.audioMessageData?.idMessage || body.idMessage;
					} else if (messageData?.typeMessage === 'documentMessage') {
						mediaType = 'documentMessage';
						fileId = messageData.documentMessageData?.idMessage || body.idMessage;
						fileName = messageData.documentMessageData?.fileName;
						text = messageData.documentMessageData?.caption || '';
					}

					if (text || mediaType) {
						setMessages((prev) => [...prev, {
							id: `${Date.now()}-${Math.random()}`,
							chatId: chatId,
							text: text,
							own: false,
							time: new Date().toLocaleTimeString(),
							mediaType,
							fileId,
							fileName
						}]);
					}
				}
			}
		}
	});

	// Send message function
	async function onSend() {
		if (!selectedGroup || !message.trim()) return;
		
		setSending(true);
		try {
			await client.sendMessage(selectedGroup.id, message.trim());
			setMessages((prev) => [...prev, {
				id: `${Date.now()}`,
				chatId: selectedGroup.id,
				text: message.trim(),
				own: true,
				time: new Date().toLocaleTimeString(),
			}]);
			setMessage('');
		} catch (e) {
			alert('Failed to send message: ' + e.message);
		} finally {
			setSending(false);
		}
	}

	// Test API function
	async function testAPI() {
		try {
			const state = await client.getStateInstance();
			console.log('Manual state check:', state);
			alert(`Instance state: ${state?.stateInstance || 'unknown'}`);
		} catch (e) {
			alert(`Error: ${e.message}`);
		}
	}

	// Logout function
	async function forceLogout() {
		try {
			await client.logout();
			setAuthState('notAuthorized');
			setQrSrc('');
			setError('');
			alert('Logged out successfully. Refresh page to get new QR code.');
		} catch (e) {
			alert(`Logout failed: ${e.message}`);
		}
	}

	const isAuthorized = authState === 'authorized';

	if (!isAuthorized) {
		return (
			<QRCode 
				qrSrc={qrSrc}
				authState={authState}
				error={error}
				onRefresh={() => window.location.reload()}
				onTestAPI={testAPI}
				onLogout={forceLogout}
			/>
		);
	}

	return (
		<div className="app-container">
			<div className="sidebar">
				<div className="sidebar-header">
					<h2>WhatsApp Groups</h2>
					<div className="sidebar-stats">
						{groups.length} groups available
					</div>
					<div className="rate-limit-info">
						Rate limiting: Active (8 req/min)
					</div>
				</div>
				
				{error && (
					<div className="error-banner">
						{error}
					</div>
				)}
				
				<div className="groups-list">
					{loading ? (
						<div className="loading-groups">
							<div className="loading-spinner"></div>
							Loading groups...
						</div>
					) : (
						groups.map((group) => (
							<GroupItem 
								key={group.id}
								group={group}
								isSelected={selectedGroup?.id === group.id}
								onClick={() => setSelectedGroup(group)}
							/>
						))
					)}
					
					{groups.length === 0 && !loading && !error && (
						<div className="no-groups">
							No groups found
						</div>
					)}
				</div>
			</div>
			
			<div className="chat-container">
				{selectedGroup ? (
					<>
						<div className="chat-header">
							{selectedGroup.name}
						</div>
						
						<div className="messages-container">
							{messages.map(m => (
								<MessageBubble 
									key={m.id} 
									message={m}
									client={client}
								/>
							))}
						</div>
						
						<div className="message-input">
							<input 
								value={message} 
								onChange={(e) => setMessage(e.target.value)} 
								placeholder="Type a message" 
								onKeyDown={(e) => { 
									if (e.key === 'Enter' && !e.shiftKey) { 
										e.preventDefault(); 
										onSend(); 
									} 
								}} 
								className="message-input-field"
							/>
							<button 
								disabled={sending} 
								onClick={onSend} 
								className="send-button"
							>
								{sending ? 'Sending...' : 'Send'}
							</button>
						</div>
					</>
				) : (
					<div className="no-chat-selected">
						Select a group to start chatting
					</div>
				)}
			</div>
		</div>
	);
}

export default App
