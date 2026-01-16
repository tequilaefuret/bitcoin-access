// src/components/social/MessageCard.jsx
import React, { useState } from 'react';
import { Heart, MessageCircle, Repeat2, Trash2, ThumbsDown } from 'lucide-react';
import { truncateAddress } from '../../supabaseClient';

const MessageCard = ({ 
  message,
  currentAddress,
  isTestMode,
  onLike,
  onDislike,
  onComment,
  onRepost,
  onDelete,
  onUserClick,
  showActions = true
}) => {
  const [showComments, setShowComments] = useState(false);
  
  // Vérifier si l'utilisateur actuel est l'auteur
  const isOwnMessage = message.bitcoin_address === currentAddress || 
                       (isTestMode && message.isTest);
  
  // Vérifier si déjà liké/disliké
  const hasLiked = message.user_has_liked || false;
  const hasDisliked = message.user_has_disliked || false;
  
  // Formater timestamp
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'À l\'instant';
    if (diffMins < 60) return `Il y a ${diffMins}min`;
    if (diffMins < 1440) return `Il y a ${Math.floor(diffMins / 60)}h`;
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const displayAddress = message.isDemo || message.isTest 
    ? message.author 
    : truncateAddress(message.bitcoin_address);

  return (
    <div className={`border-b border-gray-100 pb-4 ${
      message.isTest ? 'bg-yellow-50 p-3 rounded-lg' : ''
    }`}>
      {/* Header */}
      <div className="flex justify-between items-start mb-2">
        <button
          onClick={() => onUserClick && onUserClick(message.bitcoin_address)}
          className={`font-semibold text-sm hover:underline ${
            message.isDemo ? 'text-blue-600' : 
            message.isTest ? 'text-yellow-600' : 
            'text-gray-800'
          }`}
        >
          {displayAddress}
        </button>
        
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {formatTimestamp(message.created_at || message.timestamp)}
          </span>
          
          {/* Bouton supprimer (seulement pour ses propres messages) */}
          {isOwnMessage && showActions && onDelete && (
            <button
              onClick={() => onDelete(message.id)}
              className="text-red-500 hover:text-red-700 transition"
              title="Supprimer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Indicateur repost */}
      {message.repost_of && (
        <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
          <Repeat2 className="w-3 h-3" />
          Repost
        </div>
      )}

      {/* Contenu */}
      <p className="text-gray-700 whitespace-pre-wrap mb-3">{message.content}</p>

      {/* Actions */}
      {showActions && (
        <div className="flex items-center gap-4 text-sm">
          {/* Like */}
          <button
            onClick={() => onLike && onLike(message.id)}
            disabled={!onLike}
            className={`flex items-center gap-1 transition ${
              hasLiked 
                ? 'text-red-500 font-semibold' 
                : 'text-gray-500 hover:text-red-500'
            } disabled:cursor-not-allowed`}
          >
            <Heart className={`w-4 h-4 ${hasLiked ? 'fill-current' : ''}`} />
            <span>{message.likes_count || 0}</span>
          </button>

          {/* Dislike */}
          <button
            onClick={() => onDislike && onDislike(message.id)}
            disabled={!onDislike}
            className={`flex items-center gap-1 transition ${
              hasDisliked 
                ? 'text-blue-500 font-semibold' 
                : 'text-gray-500 hover:text-blue-500'
            } disabled:cursor-not-allowed`}
          >
            <ThumbsDown className={`w-4 h-4 ${hasDisliked ? 'fill-current' : ''}`} />
            <span>{message.dislikes_count || 0}</span>
          </button>

          {/* Commentaires */}
          <button
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1 text-gray-500 hover:text-orange-500 transition"
          >
            <MessageCircle className="w-4 h-4" />
            <span>{message.comments_count || 0}</span>
          </button>

          {/* Repost */}
          <button
            onClick={() => onRepost && onRepost(message.id)}
            disabled={!onRepost || isOwnMessage}
            className="flex items-center gap-1 text-gray-500 hover:text-green-500 transition disabled:cursor-not-allowed disabled:opacity-50"
            title={isOwnMessage ? "Impossible de reposter son propre message" : "Reposter"}
          >
            <Repeat2 className="w-4 h-4" />
            <span>{message.reposts_count || 0}</span>
          </button>
        </div>
      )}

      {/* Zone commentaires (si affichée) */}
      {showComments && onComment && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={() => onComment(message.id)}
            className="text-sm text-orange-600 hover:text-orange-700 font-semibold"
          >
            + Ajouter un commentaire
          </button>
          
          {/* Liste des commentaires (à implémenter) */}
          {message.comments && message.comments.length > 0 && (
            <div className="mt-3 space-y-2 pl-4 border-l-2 border-gray-200">
              {message.comments.map(comment => (
                <div key={comment.id} className="text-sm">
                  <span className="font-semibold text-gray-700">
                    {truncateAddress(comment.bitcoin_address)}
                  </span>
                  <p className="text-gray-600">{comment.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MessageCard;