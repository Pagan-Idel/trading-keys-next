import React, { useEffect } from 'react';
import styled from 'styled-components';

const NotificationContainer = styled.div<{ color: string }>`
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  min-width: 280px;
  max-width: 90vw;
  padding: 16px 32px;
  border-radius: 8px;
  color: #fff;
  font-size: 1.15rem;
  font-weight: 600;
  z-index: 9999;
  background: ${({ color }) => color};
  box-shadow: 0 2px 12px rgba(0,0,0,0.18);
  animation: fadeIn 0.3s;
  @keyframes fadeIn {
    from { opacity: 0; top: -40px; }
    to { opacity: 1; top: 0; }
  }
`;

type NotificationType = 'success' | 'error' | 'warning';

const colorMap: Record<NotificationType, string> = {
  success: '#22c55e',
  error: '#ef4444',
  warning: '#facc15',
};

interface NotificationProps {
  message: string;
  type: NotificationType;
  onClose?: () => void;
  duration?: number; // ms
}

const Notification: React.FC<NotificationProps> = ({ message, type, onClose, duration = 3000 }) => {
  useEffect(() => {
    if (onClose) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [onClose, duration]);

  return (
    <NotificationContainer color={colorMap[type]}>
      {message}
    </NotificationContainer>
  );
};

export default Notification;
