# WhatsApp Groups - Green API Client

A modern, responsive web application for managing and chatting with WhatsApp groups using the Green API service.

## Features

- 🔐 **Secure Authentication**: QR code-based WhatsApp authentication
- 📱 **Real-time Messaging**: Send and receive messages in real-time
- 🖼️ **Media Support**: View images, videos, audio, and documents
- 📊 **Rate Limiting**: Built-in rate limiting to prevent API abuse
- 🎨 **Modern UI**: Clean, WhatsApp-inspired interface
- 📱 **Responsive Design**: Works on desktop and mobile devices
- ⚡ **Real-time Updates**: Live notifications for new messages
- 🔄 **Auto-reconnection**: Automatic reconnection on connection loss

## Prerequisites

1. **Green API Account**: You need a Green API account with:
   - Instance ID
   - API Token
   - Active WhatsApp instance

2. **Node.js**: Version 16 or higher

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd GreenAPI/app
```

2. Install dependencies:
```bash
npm install
```

3. Configure your Green API credentials in `src/App.jsx`:
```javascript
const client = useMemo(() => new GreenApiClient({
    idInstance: 'YOUR_INSTANCE_ID',
    apiTokenInstance: 'YOUR_API_TOKEN',
}), []);
```

4. Start the development server:
```bash
npm run dev
```

5. Build for production:
```bash
npm run build
```

## Usage

### Authentication

1. Open the application in your browser
2. Scan the displayed QR code with WhatsApp on your phone
3. Wait for the connection to be established
4. Once authorized, your groups will load automatically

### Sending Messages

1. Select a group from the sidebar
2. Type your message in the input field
3. Press Enter or click Send
4. Messages are sent in real-time

### Media Messages

The application automatically handles:
- **Images**: Displayed inline with captions
- **Videos**: Playable video controls
- **Audio**: Audio player controls
- **Documents**: Download links with file names

## API Methods

The application uses the following Green API methods:

### Authentication
- `getStateInstance()` - Check instance status
- `getQr()` - Get QR code for authentication

### Messaging
- `sendMessage()` - Send text messages
- `sendFileByUrl()` - Send files via URL
- `sendButtons()` - Send interactive buttons
- `sendLocation()` - Send location data
- `sendContact()` - Send contact information

### Chat Management
- `getChats()` - Get all chats
- `getChatHistory()` - Get message history
- `getGroups()` - Get group chats only

### File Handling
- `downloadFile()` - Download media files
- `getAvatar()` - Get chat avatars

### Notifications
- `receiveNotification()` - Receive real-time notifications
- `deleteNotification()` - Delete processed notifications

## Rate Limiting

The application implements intelligent rate limiting:
- **8 requests per minute** by default
- **Automatic retry** with exponential backoff
- **Smart polling** intervals based on connection state

## Error Handling

The application handles various error scenarios:
- **Network errors**: Automatic retry with backoff
- **Rate limiting**: Graceful handling with user feedback
- **Authentication errors**: Clear error messages
- **Media loading errors**: Fallback display options

## Development

### Project Structure

```
src/
├── api/
│   └── greenApiClient.js    # Green API client implementation
├── hooks/
│   └── useGreenApiNotifications.js  # Real-time notifications hook
├── App.jsx                  # Main application component
├── App.css                  # Application styles
└── main.jsx                 # Application entry point
```

### Key Components

- **GreenApiClient**: Handles all API communication
- **MediaMessage**: Renders different media types
- **MessageBubble**: Individual message display
- **GroupItem**: Group list item component
- **QRCode**: Authentication screen component

### Styling

The application uses a modern CSS design with:
- WhatsApp-inspired color scheme
- Responsive layout
- Smooth animations
- Custom scrollbars
- Mobile-friendly design

## Troubleshooting

### Common Issues

1. **CORS Errors**: The application makes direct API calls to Green API
2. **403 Forbidden**: Check your instance permissions in Green API console
3. **Rate Limiting**: The app automatically handles rate limits
4. **Media Not Loading**: Check file permissions and API access

### Debug Mode

Enable debug logging by opening browser console and looking for:
- API request/response logs
- Rate limiting information
- Error details

## Security

- API credentials are stored in client-side code (consider environment variables for production)
- No data is stored locally
- All communication uses HTTPS
- Rate limiting prevents API abuse

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For issues related to:
- **Green API**: Contact Green API support
- **Application**: Open an issue in this repository

## Changelog

### Version 2.0.0
- Complete rewrite using modern React patterns
- Browser-compatible Green API client
- Enhanced media handling
- Improved error handling
- Modern UI/UX design
- Real-time notifications
- Rate limiting implementation
