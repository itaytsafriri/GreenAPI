import { useEffect, useRef } from 'react';

export function useGreenApiNotifications(client, { onEvent } = {}) {
	const isMountedRef = useRef(true);
	const pollIntervalRef = useRef(null);

	useEffect(() => {
		isMountedRef.current = true;
		let stopped = false;

		async function poll() {
			if (stopped || !client) return;
			
			try {
				const notification = await client.receiveNotification();
				
				if (notification && onEvent) {
					onEvent(notification);
					
					// Delete the notification after processing
					try {
						if (notification.receiptId) {
							await client.deleteNotification(notification.receiptId);
						}
					} catch (deleteError) {
						console.warn('Failed to delete notification:', deleteError);
						// Continue polling even if deletion fails
					}
				}
			} catch (error) {
				console.warn('Notification polling error:', error);
				// Backoff on errors - wait longer before next poll
				await new Promise((r) => setTimeout(r, 2000));
			}
			
			if (isMountedRef.current && !stopped) {
				// Poll every 500ms when no errors
				pollIntervalRef.current = setTimeout(poll, 500);
			}
		}

		poll();
		
		return () => {
			stopped = true;
			isMountedRef.current = false;
			if (pollIntervalRef.current) {
				clearTimeout(pollIntervalRef.current);
			}
		};
	}, [client, onEvent]);
}

