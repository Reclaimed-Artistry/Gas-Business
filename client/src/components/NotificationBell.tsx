import React, { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../lib/format';

export function NotificationBell() {
  const { notifications, unreadNotifications, markNotificationRead, markAllNotificationsRead } = useAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg border border-[#E2E8F0] bg-white text-[#172B4D] hover:border-[#1769C2] hover:text-[#073B8C] transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadNotifications > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D64545] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
            {unreadNotifications > 9 ? '9+' : unreadNotifications}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0] bg-[#F7F9FC]">
            <div>
              <h3 className="text-sm font-bold text-[#06265B]">Notifications</h3>
              <p className="text-xs text-[#64748B]">{unreadNotifications} unread</p>
            </div>
            {unreadNotifications > 0 && (
              <button
                type="button"
                onClick={() => void markAllNotificationsRead()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#1769C2] hover:text-[#073B8C]"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-[#E2E8F0]">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#64748B]">No notifications yet.</div>
            ) : (
              notifications.slice(0, 15).map((n) => {
                let channels: string[] = ['IN_APP'];
                try {
                  channels = JSON.parse(n.channels_json || '["IN_APP"]');
                } catch {
                  channels = ['IN_APP'];
                }
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      if (!n.is_read) void markNotificationRead(n.id);
                    }}
                    className={`w-full text-left px-4 py-3 hover:bg-[#F7F9FC] transition-colors ${
                      n.is_read ? 'bg-white' : 'bg-[#EAF3FF]/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold text-[#06265B]">{n.title}</p>
                      {!n.is_read && <span className="w-2 h-2 rounded-full bg-[#1769C2] shrink-0 mt-1" />}
                    </div>
                    <p className="text-xs text-[#172B4D] mt-1 leading-relaxed">{n.message}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#64748B]">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(n.created_at)}
                      </span>
                      <div className="flex gap-1">
                        {channels.map((ch) => (
                          <span
                            key={ch}
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white border border-[#E2E8F0] text-[#64748B]"
                          >
                            {ch}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
