// Rate limiting utility
class RateLimiter {
	constructor(maxRequests = 10, timeWindow = 60000) {
		this.maxRequests = maxRequests;
		this.timeWindow = timeWindow;
		this.requests = [];
	}

	async throttle() {
		const now = Date.now();
		this.requests = this.requests.filter(time => now - time < this.timeWindow);
		
		if (this.requests.length >= this.maxRequests) {
			const oldestRequest = this.requests[0];
			const waitTime = this.timeWindow - (now - oldestRequest);
			if (waitTime > 0) {
				await new Promise(resolve => setTimeout(resolve, waitTime));
			}
		}
		
		this.requests.push(now);
	}
}

export class GreenApiClient {
	constructor({ idInstance, apiTokenInstance }) {
		this.idInstance = idInstance;
		this.apiTokenInstance = apiTokenInstance;
		this.baseUrl = `https://api.greenapi.com`;
		
		// Rate limiter for API calls
		this.rateLimiter = new RateLimiter(8, 60000); // 8 requests per minute
		this.retryDelays = [1000, 2000, 5000, 10000, 30000];
	}

	async makeRequest(requestFn, retryCount = 0) {
		await this.rateLimiter.throttle();
		
		try {
			return await requestFn();
		} catch (error) {
			if (error.message.includes('429') && retryCount < this.retryDelays.length) {
				const delay = this.retryDelays[retryCount];
				console.log(`Rate limited, retrying in ${delay}ms (attempt ${retryCount + 1})`);
				await new Promise(resolve => setTimeout(resolve, delay));
				return this.makeRequest(requestFn, retryCount + 1);
			}
			throw error;
		}
	}

	async request(endpoint, options = {}) {
		const url = `${this.baseUrl}/waInstance${this.idInstance}/${endpoint}/${this.apiTokenInstance}`;
		
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

		// Handle empty responses
		if (response.status === 204) {
			return null;
		}

		try {
			return await response.json();
		} catch (e) {
			throw new Error(`${endpoint} JSON parse failed: ${e.message}`);
		}
	}

	async getStateInstance() {
		return this.makeRequest(() => this.request('getStateInstance'));
	}

	async getQr() {
		return this.makeRequest(() => this.request('qr'));
	}

	async getChats() {
		console.log('Making getChats request...');
		const result = await this.makeRequest(() => this.request('getChats', {
			method: 'POST',
			body: JSON.stringify({})
		}));
		console.log('getChats result:', result);
		return result;
	}

	async getGroups() {
		try {
			console.log('Getting chats...');
			const chats = await this.getChats();
			console.log('Chats response:', chats);
			
			if (Array.isArray(chats)) {
				// Filter for groups only (groups have @g.us suffix)
				const groups = chats.filter(chat => 
					chat.id && chat.id.includes('@g.us')
				);
				console.log('Filtered groups:', groups);
				return groups;
			}
			console.log('Chats is not an array:', typeof chats, chats);
			return [];
		} catch (error) {
			console.error('getGroups error:', error);
			throw new Error(`getGroups failed: ${error.message}`);
		}
	}

	async getChatHistory(chatId, count = 50) {
		return this.makeRequest(() => this.request('getChatHistory', {
			method: 'POST',
			body: JSON.stringify({ chatId, count })
		}));
	}

	async sendMessage(chatId, message) {
		return this.makeRequest(() => this.request('sendMessage', {
			method: 'POST',
			body: JSON.stringify({ chatId, message })
		}));
	}

	async receiveNotification() {
		try {
			return await this.request('receiveNotification');
		} catch (error) {
			if (error.message.includes('502') || error.message.includes('204')) {
				return null;
			}
			throw error;
		}
	}

	async deleteNotification(receiptId) {
		return this.makeRequest(() => this.request(`deleteNotification/${receiptId}`, {
			method: 'DELETE'
		}));
	}

	async downloadFile(fileId, chatId) {
		return this.makeRequest(() => this.request('downloadFile', {
			method: 'POST',
			body: JSON.stringify({ fileId, chatId })
		}));
	}

	async getFile(fileId, chatId) {
		return this.makeRequest(() => this.request('getFile', {
			method: 'POST',
			body: JSON.stringify({ fileId, chatId })
		}));
	}

	// Additional methods for enhanced functionality
	async sendFileByUrl(chatId, url, fileName, caption = '') {
		return this.makeRequest(() => this.request('sendFileByUrl', {
			method: 'POST',
			body: JSON.stringify({ chatId, url, fileName, caption })
		}));
	}

	async sendButtons(chatId, message, buttons) {
		return this.makeRequest(() => this.request('sendButtons', {
			method: 'POST',
			body: JSON.stringify({ chatId, message, buttons })
		}));
	}

	async sendLocation(chatId, latitude, longitude, name = '', address = '') {
		return this.makeRequest(() => this.request('sendLocation', {
			method: 'POST',
			body: JSON.stringify({ chatId, latitude, longitude, name, address })
		}));
	}

	async sendContact(chatId, contact) {
		return this.makeRequest(() => this.request('sendContact', {
			method: 'POST',
			body: JSON.stringify({ chatId, contact })
		}));
	}

	async getContacts() {
		return this.makeRequest(() => this.request('getContacts'));
	}

	async getContactInfo(chatId) {
		return this.makeRequest(() => this.request('getContactInfo', {
			method: 'POST',
			body: JSON.stringify({ chatId })
		}));
	}

	async checkWhatsapp(phoneNumber) {
		return this.makeRequest(() => this.request('checkWhatsapp', {
			method: 'POST',
			body: JSON.stringify({ phoneNumber })
		}));
	}

	async getAvatar(chatId) {
		return this.makeRequest(() => this.request('getAvatar', {
			method: 'POST',
			body: JSON.stringify({ chatId })
		}));
	}

	async deleteMessage(chatId, idMessage) {
		return this.makeRequest(() => this.request('deleteMessage', {
			method: 'DELETE',
			body: JSON.stringify({ chatId, idMessage })
		}));
	}

	async editMessage(chatId, idMessage, newText) {
		return this.makeRequest(() => this.request('editMessage', {
			method: 'PUT',
			body: JSON.stringify({ chatId, idMessage, newText })
		}));
	}

	async archiveChat(chatId) {
		return this.makeRequest(() => this.request('archiveChat', {
			method: 'POST',
			body: JSON.stringify({ chatId })
		}));
	}

	async unarchiveChat(chatId) {
		return this.makeRequest(() => this.request('unarchiveChat', {
			method: 'POST',
			body: JSON.stringify({ chatId })
		}));
	}

	async setDisappearingChat(chatId, ephemeralExpiration) {
		return this.makeRequest(() => this.request('setDisappearingChat', {
			method: 'POST',
			body: JSON.stringify({ chatId, ephemeralExpiration })
		}));
	}

	async logout() {
		return this.makeRequest(() => this.request('logout', {
			method: 'POST',
			body: JSON.stringify({})
		}));
	}
}
