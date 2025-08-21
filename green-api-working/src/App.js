import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Rate Limiter class
class RateLimiter {
  constructor(maxRequests = 8, timeWindow = 60000) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.requests = [];
  }

  async waitForSlot() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.timeWindow - (now - oldestRequest);
      console.log(`Rate limit reached, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.requests.push(now);
  }
}

// Green API Client - simplified version based on official examples
class GreenApiClient {
  constructor({ idInstance, apiTokenInstance }) {
    this.idInstance = idInstance;
    this.apiTokenInstance = apiTokenInstance;
    this.baseUrl = `https://api.greenapi.com/waInstance${idInstance}`;
    this.rateLimiter = new RateLimiter(8, 60000); // 8 requests per minute
  }

  async request(endpoint, options = {}) {
    await this.rateLimiter.waitForSlot();
    
    const url = `${this.baseUrl}/${endpoint}/${this.apiTokenInstance}`;
    
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${endpoint} failed: ${response.status} - ${errorText}`);
    }

    if (response.status === 204) {
      return null;
    }

    return await response.json();
  }

  async getStateInstance() {
    return this.request('getStateInstance');
  }

  async getQr() {
    return this.request('qr');
  }

  async getChats() {
    return this.request('getChats', {
      method: 'POST',
      body: JSON.stringify({})
    });
  }

  async getChatHistory(chatId, count = 50) {
    return this.request('getChatHistory', {
      method: 'POST',
      body: JSON.stringify({ chatId, count })
    });
  }

  async sendMessage(chatId, message) {
    return this.request('sendMessage', {
      method: 'POST',
      body: JSON.stringify({ chatId, message })
    });
  }

  // Updated downloadFile method - matching official Green API client exactly
  async downloadFile(fileId, chatId) {
    // According to official Green API client:
    // URL: ${host}/waInstance${idInstance}/downloadFile/${apiTokenInstance}
    // Body: { 'idMessage': fileId, 'chatId': chatId }
    return this.request('downloadFile', {
      method: 'POST',
      body: JSON.stringify({ 
        'idMessage': fileId, 
        'chatId': chatId 
      })
    });
  }

  async logout() {
    return this.request('logout', {
      method: 'POST',
      body: JSON.stringify({})
    });
  }
}

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
  const client = new GreenApiClient({
    idInstance: '7103899702',
    apiTokenInstance: 'cf5010eda4fd493f99b6b6d367bfd911b56d9d43041b44f3b3',
  });

  const qrIntervalRef = useRef(null);
  const stateIntervalRef = useRef(null);

  // Check initial state
  useEffect(() => {
    checkState();
  }, []);

  // Check authorization state
  const checkState = async () => {
    try {
      const data = await client.getStateInstance();
      const state = data?.stateInstance || 'unknown';
      console.log('Auth state:', state);
      setAuthState(state);
      
      if (state === 'authorized') {
        setQrSrc('');
        loadGroups();
      } else {
        startQrPolling();
      }
    } catch (e) {
      console.error('State check error:', e);
      setError('Connection error: ' + e.message);
    }
  };

  // Start QR code polling
  const startQrPolling = () => {
    if (qrIntervalRef.current) {
      clearInterval(qrIntervalRef.current);
    }
    
    updateQrCode();
    qrIntervalRef.current = setInterval(updateQrCode, 5000);
  };

  // Update QR code
  const updateQrCode = async () => {
    try {
      const data = await client.getQr();
      console.log('QR response:', data);
      
      if (data?.type === 'qrCode' && data?.message) {
        console.log('Setting QR code');
        setQrSrc(`data:image/png;base64,${data.message}`);
        setError('');
      } else if (data?.type === 'alreadyLogged') {
        console.log('Already logged in');
        setQrSrc('');
        setAuthState('authorized');
        if (qrIntervalRef.current) {
          clearInterval(qrIntervalRef.current);
        }
        loadGroups();
      } else {
        console.log('No QR data available');
        setQrSrc('');
      }
    } catch (e) {
      console.error('QR error:', e);
      setQrSrc('');
      setError('QR error: ' + e.message);
    }
  };

  // Load groups
  const loadGroups = async () => {
    setLoading(true);
    try {
      const chats = await client.getChats();
      console.log('Chats response:', chats);
      
      if (Array.isArray(chats)) {
        const groupsList = chats.filter(chat => 
          chat.id && chat.id.includes('@g.us')
        );
        console.log('Filtered groups:', groupsList);
        
        const groupsWithNames = groupsList.map((group) => ({
          id: group.id || group.chatId,
          name: group.name || group.subject || group.id || group.chatId,
          raw: group
        }));
        setGroups(groupsWithNames);
      }
    } catch (e) {
      console.error('Groups error:', e);
      setError('Failed to load groups: ' + e.message);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  // Load messages for selected group
  const loadMessages = async (groupId) => {
    try {
      console.log('Loading messages for group:', groupId);
      const history = await client.getChatHistory(groupId, 30);
      console.log('Chat history response:', history);
      
      if (Array.isArray(history)) {
        const normalized = history.map((m) => {
          let mediaType = null;
          let fileId = null;
          let fileName = null;
          let text = '';

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
      }
    } catch (e) {
      console.error('Messages error:', e);
      setMessages([]);
    }
  };

  // Send message
  const sendMessage = async () => {
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
  };

  // Handle group selection
  const handleGroupSelect = (group) => {
    setSelectedGroup(group);
    loadMessages(group.id);
  };

  // Force logout
  const forceLogout = async () => {
    try {
      await client.logout();
      setAuthState('notAuthorized');
      setQrSrc('');
      setError('');
      setGroups([]);
      setSelectedGroup(null);
      setMessages([]);
      alert('Logged out successfully. Refresh page to get new QR code.');
    } catch (e) {
      alert(`Logout failed: ${e.message}`);
    }
  };

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (qrIntervalRef.current) {
        clearInterval(qrIntervalRef.current);
      }
      if (stateIntervalRef.current) {
        clearInterval(stateIntervalRef.current);
      }
    };
  }, []);

  // Show QR code if not authorized
  if (authState !== 'authorized') {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h2>WhatsApp Groups</h2>
          <p className="auth-description">
            Scan this QR code with WhatsApp to connect
          </p>
          
          {qrSrc ? (
            <img src={qrSrc} alt="WhatsApp QR" className="qr-code" />
          ) : (
            <div className="qr-placeholder">
              Loading QR...
            </div>
          )}
          
          <div className="auth-status">
            State: {authState}
          </div>
          
          {error && (
            <div className="auth-error">
              {error}
            </div>
          )}
          
          <div className="auth-info">
            Rate limiting: Active (8 req/min)
          </div>
          
          <div className="auth-actions">
            <button onClick={() => window.location.reload()} className="btn btn-primary">
              Refresh Page
            </button>
            <button onClick={checkState} className="btn btn-secondary">
              Check State
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show main app when authorized
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
              <div 
                key={group.id}
                className={`group-item ${selectedGroup?.id === group.id ? 'selected' : ''}`}
                onClick={() => handleGroupSelect(group)}
              >
                <div className="group-avatar">
                  👥
                </div>
                <div className="group-info">
                  <div className="group-name">{group.name}</div>
                  <div className="group-id">{group.id}</div>
                </div>
              </div>
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
                    sendMessage(); 
                  } 
                }} 
                className="message-input-field"
              />
              <button 
                disabled={sending} 
                onClick={sendMessage} 
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
    console.log('FileId type:', typeof fileId, 'FileId value:', fileId);

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
        console.error('Failed to load media:', err);
        console.error('Error details:', {
          message: err.message,
          fileId,
          chatId,
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

export default App;
