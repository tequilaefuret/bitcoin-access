// src/components/ui/HistoryModal.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, History } from 'lucide-react';
import { FeedSkeleton } from './ContentSkeletons';

const HistoryModal = ({ show, onClose, messages: initialMessages, onLoadMore, hasMore }) => {
  const [messages, setMessages] = useState([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  const loadMoreMessages = useCallback(async () => {
    if (!onLoadMore || isLoadingMore) return;
    
    setIsLoadingMore(true);
    const newMessages = await onLoadMore(messages.length);
    setIsLoadingMore(false);
    
    if (newMessages && newMessages.length > 0) {
      setMessages(prevMessages => [...prevMessages, ...newMessages]);
    }
  }, [onLoadMore, messages.length, isLoadingMore]);

  useEffect(() => {
    const handleScroll = () => {
      if (!listRef.current || !hasMore || isLoadingMore) return;
      
      const { scrollTop, scrollHeight, clientHeight } = listRef.current;
      const scrolledToBottom = scrollHeight - scrollTop - clientHeight < 100;
      
      if (scrolledToBottom && hasMore && !isLoadingMore) {
        loadMoreMessages();
      }
    };

    const listElement = listRef.current;
    if (listElement) {
      listElement.addEventListener('scroll', handleScroll);
      return () => listElement.removeEventListener('scroll', handleScroll);
    }
  }, [hasMore, isLoadingMore, loadMoreMessages]);

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <History className="w-6 h-6 text-orange-500" />
            My published messages
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Compteur */}
        <div className="mb-4 text-sm text-gray-600">
          {messages.length > 0 ? (
            <p>
              {messages.length} message{messages.length > 1 ? 's' : ''} shown
              {hasMore && ' - Scroll to load more'}
            </p>
          ) : (
            <p>No messages published yet</p>
          )}
        </div>

        {/* Liste des messages */}
        <div 
          ref={listRef}
          className="flex-1 overflow-y-auto space-y-4"
        >
          {messages.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <History className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>You have not published a message yet</p>
              <p className="text-sm mt-2">Your messages will appear here</p>
            </div>
          ) : (
            <>
              {messages.map((msg, index) => (
                <div 
                  key={msg.id || index}
                  className="bg-gray-50 p-4 rounded-lg border border-gray-200"
                >
                  {/* Header du message */}
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-orange-600">
                        {msg.bitcoin_address ? `@${msg.bitcoin_address.slice(0, 6)}…` : '@anonymous'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatTimestamp(msg.created_at)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-600">
                        {msg.char_count} characters
                      </span>
                    </div>
                  </div>

                  {/* Contenu du message */}
                  <p className="text-gray-700 whitespace-pre-wrap break-words">
                    {msg.content}
                  </p>
                </div>
              ))}

              {isLoadingMore && (
                <FeedSkeleton count={2} compact />
              )}

              {/* Message fin de liste */}
              {!hasMore && messages.length > 0 && (
                <div className="text-center py-4 text-gray-400 text-sm">
                  All of your messages have been loaded
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;
