# Green API WhatsApp Service

This is a Node.js service that mimics the functionality of the original `whatsapp.js` but uses Green API instead of whatsapp-web.js and Puppeteer.

## Features

- ✅ **QR Code Authentication** - Get QR codes for WhatsApp Web authentication
- ✅ **Group Management** - Fetch all WhatsApp groups
- ✅ **Real-time Monitoring** - Monitor specific groups for messages
- ✅ **Media Support** - Handle images, videos, audio, and documents
- ✅ **Text Messages** - Process text messages with sender information
- ✅ **C# Integration** - JSON-based communication protocol for C# applications
- ✅ **Standalone Mode** - Can run independently with command-line interface
- ✅ **Logging** - Comprehensive logging to file and console
- ✅ **Error Handling** - Robust error handling and retry logic

## Installation

1. Navigate to the app directory:
   ```bash
   cd app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Standalone Mode (Interactive)

Run the service in interactive mode:
```bash
node greenApiService.js
```

Available commands:
- `get_groups` - Fetch all WhatsApp groups
- `monitor <group_id>` - Start monitoring a specific group
- `stop_monitoring` - Stop monitoring
- `logout` - Logout and exit
- `quit` - Exit without logout

### C# Integration Mode

Run the service for C# integration (non-interactive):
```bash
node greenApiService.js
```

Send JSON commands via stdin:

#### Get Groups
```json
{"type":"get_groups"}
```

#### Monitor Group
```json
{"type":"monitor_group","groupId":"1234567890@c.us"}
```

#### Stop Monitoring
```json
{"type":"stop_monitoring"}
```

#### Logout
```json
{"type":"logout"}
```

## Message Types

The service sends JSON messages to stdout for C# integration:

### Status Messages
```json
{"type":"status","connected":true}
{"type":"userName","name":"Green API User"}
```

### QR Code
```json
{"type":"qr","qr":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."}
```

### Groups
```json
{"type":"groups","groups":[{"id":"1234567890@c.us","name":"My Group"}]}
```

### Text Messages
```json
{
  "type":"text",
  "Text":{
    "Id":"msg_1234567890",
    "From":"1234567890@c.us",
    "Author":"1234567890@c.us",
    "Type":"text",
    "Timestamp":1234567890,
    "Text":"Hello world!",
    "SenderName":"John Doe"
  }
}
```

### Media Messages
```json
{
  "type":"media",
  "Media":{
    "Id":"media_1234567890",
    "From":"1234567890@c.us",
    "Author":"1234567890@c.us",
    "Type":"image/jpeg",
    "Timestamp":1234567890,
    "Filename":"John_Doe_20231201_143022.jpg",
    "Data":"https://api.greenapi.com/...",
    "Size":1024000,
    "SenderName":"John Doe",
    "Body":"Check out this image!"
  }
}
```

### Error Messages
```json
{"type":"error","message":"Connection failed"}
```

## Configuration

The service uses the same Green API credentials as the React application:

- **idInstance**: `7103899702`
- **apiTokenInstance**: `cf5010eda4fd493f99b6b6d367bfd911b56d9d43041b44f3b3`
- **baseUrl**: `https://api.greenapi.com`

## Logging

The service creates a log file `green_api_debug.log` in the same directory with detailed information about:
- Connection status
- API requests and responses
- Error messages
- Command processing
- Message monitoring

## Differences from Original whatsapp.js

1. **No Puppeteer** - Uses Green API REST endpoints instead of browser automation
2. **No QR Code Display** - Returns QR code URLs instead of terminal display
3. **Simplified Media Handling** - Returns media URLs instead of base64 data
4. **Rate Limiting** - Built-in handling of Green API rate limits
5. **No Browser Dependencies** - Runs without Chromium or browser requirements

## Error Handling

The service handles various error scenarios:
- Network connectivity issues
- API rate limiting (429 errors)
- Authentication failures
- Invalid commands
- Media download failures

## Performance

- **Polling Interval**: 5 seconds for notifications
- **Connection Check**: 10 seconds for status verification
- **Timeout**: 30 seconds for group fetching
- **Rate Limiting**: Automatic handling of Green API limits

## Troubleshooting

### Common Issues

1. **"Not authorized" error**
   - Check if WhatsApp Web is properly connected
   - Verify API credentials are correct

2. **"HTTP 429: Too Many Requests"**
   - Normal behavior, service handles this automatically
   - Green API has rate limits that are respected

3. **"HTTP 404: Not Found"**
   - Normal when no notifications are available
   - Service continues polling automatically

4. **No groups returned**
   - Ensure WhatsApp Web is connected
   - Check if you have any groups in WhatsApp

### Log Analysis

Check the `green_api_debug.log` file for detailed error information and debugging.

## Integration with C#

The service is designed to work seamlessly with C# applications by:
- Reading JSON commands from stdin
- Sending JSON responses to stdout
- Providing the same message format as the original whatsapp.js
- Supporting the same command structure

Example C# integration:
```csharp
// Start the process
var process = new Process
{
    StartInfo = new ProcessStartInfo
    {
        FileName = "node",
        Arguments = "greenApiService.js",
        UseShellExecute = false,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        CreateNoWindow = true
    }
};

process.Start();

// Send command
var command = JsonSerializer.Serialize(new { type = "get_groups" });
process.StandardInput.WriteLine(command);

// Read response
var response = process.StandardOutput.ReadLine();
var result = JsonSerializer.Deserialize<dynamic>(response);
```
